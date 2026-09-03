import { setTimeout as sleep } from 'node:timers/promises';

// For more information, see https://crawlee.dev
import { PlaywrightCrawler } from '@crawlee/playwright';
// For more information, see https://docs.apify.com/sdk/js
import { Actor, log } from 'apify';
// Drop-in Playwright fork with the automation leaks patched out — see `launcher` below.
import { chromium as patchrightChromium } from 'patchright';
import type { BrowserType } from 'playwright';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import type { ActorInput, ProductSellerResponse } from './dto/index.js';
import { pushItem } from './push.js';
import { createRouter, LABELS } from './routes.js';
import { chooseChrome } from './utils/browser.js';
import { passCloudflare } from './utils/cloudflare.js';
import { currentActorRunId, emptyResponse } from './utils/defaults.js';
import { DEFAULT_SHIP_COUNTRY, extractDhgateShipCountry, normalizeDhgateHost } from './utils/parse.js';
import { describeProxy, pickProxy } from './utils/proxy.js';
import { reportedUrl } from './utils/request.js';

// Initialize the Apify SDK
await Actor.init();

// Locally there is no run — `actorRunId` is null unless the Actor is running on the platform.
// The same value is stamped on every dataset row, see `emptyResponse`.
log.info(`Actor run ID: ${currentActorRunId() ?? '(none — running locally)'}`);

// Structure of input is defined in .actor/input_schema.json
const {
    startUrls = [],
    maxRequestsPerCrawl = 100,
    mode = 'product_only',
    enableProxy = true,
} = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);

// The exit itself is fixed in code (Apify residential US) — see utils/proxy.ts for why that is not
// a preference on a Cloudflare-fronted site. The input only decides whether to use it at all.
const proxyChoice = pickProxy(enableProxy);

// With the switch off we do not even ask the SDK. With it on, `undefined` back from here is a
// problem rather than a choice — Apify Proxy was asked for and could not be reached — so the two
// are logged differently.
const proxyConfiguration = proxyChoice.enabled ? await Actor.createProxyConfiguration(proxyChoice.settings) : undefined;
if (proxyConfiguration) {
    log.info(`Proxy: ${describeProxy(proxyChoice)}`);
} else if (!proxyChoice.enabled) {
    log.info('Proxy: none — disabled by `enableProxy: false`; hitting DHGate from this container’s own IP');
} else {
    // Locally this is the usual cause: `npm run start:dev` runs the script directly and never sees
    // `~/.apify/auth.json`, so the SDK finds no token, warns, and carries on without a proxy. Use
    // `apify run` (or set APIFY_TOKEN) to actually get one. On the platform the SDK throws instead.
    log.warning(
        'Proxy: none — Apify Proxy was requested but no token or password is available, so DHGate ' +
            'is being hit from this machine’s own IP. Expect many more Cloudflare challenges.',
    );
}

// Which browser binary we drive is the biggest single factor in how often Cloudflare challenges us,
// so it is resolved and logged up front rather than buried in the launch options. See utils/browser.ts.
const chrome = chooseChrome();
log[chrome.useChrome ? 'info' : 'warning'](`Browser: ${chrome.description}`);

// `seller_only` runs start from seller URLs; the other two modes start from
// product URLs. Route each start URL to the matching handler accordingly.
const startLabel = mode === 'seller_only' ? LABELS.SELLER : LABELS.PRODUCT;
// Regional hosts (es./fr./…) are rewritten to www: they serve the same product but in the
// local language — which the `language` cookie cannot override — and each one carries its own
// Cloudflare challenge. The regional context is preserved rather than discarded: the original
// subdomain becomes the ship-to country, applied per request in the pre-navigation hook.
const requests = startUrls.map((req) => {
    const url = normalizeDhgateHost(req.url);
    const shipCountry = extractDhgateShipCountry(req.url);
    if (url !== req.url) log.info(`Normalized ${req.url} -> ${url} (ship to ${shipCountry})`);
    return {
        ...req,
        url,
        label: startLabel,
        userData: { ...req.userData, shipCountry, inputUrl: req.url },
    };
});

// Force DHGate to render in English and price in USD regardless of the (proxy) IP
// geolocation. Ship-to is per request — see `shipCountry` — so a URL taken from a regional
// storefront still gets that region's shipping/availability, just described in English.
// Keeping the currency fixed at USD makes rows comparable across countries; flip
// `intl_currency` here if you would rather capture each region's local currency.
const localeCookies = (shipCountry: string) => [
    { name: 'language', value: 'en', domain: '.dhgate.com', path: '/' },
    { name: 'b2b_ship_country', value: shipCountry, domain: '.dhgate.com', path: '/' },
    { name: 'intl_currency', value: 'USD', domain: '.dhgate.com', path: '/' },
];

// How long to wait after a failed attempt before Crawlee retries the request.
// Crawlee retries immediately by default, which hammers DHGate right when it is
// already unhappy with us; a short pause makes failures easier to observe while testing.
const RETRY_DELAY_MILLIS = 5_000;

const crawler = new PlaywrightCrawler({
    // Proxy is configurable and defaults to Apify RESIDENTIAL/US. Note what it does and does not
    // fix: the earlier measurement still holds — the same IP that gets challenged in an automated
    // browser answers 200 to curl and to a real Chrome, so the challenge is a *fingerprint*
    // trigger, not an IP ban, and a proxy alone will not make it disappear. What a residential US
    // exit buys is a gentler Cloudflare threat score (fewer interactive "Verify you are human"
    // variants) and a fresh IP per retired session. See utils/cloudflare.ts.
    proxyConfiguration,
    maxRequestsPerCrawl,
    // Crawlee treats 403 as "blocked" and throws in its own response handler, before any of our
    // code — including the challenge wait below — gets a say. But on DHGate every first hit is a
    // 403: that is what the Cloudflare interstitial is served with, and it clears itself seconds
    // later. So 403 is taken off this list and judged after the wait instead, by `detectBlocked`
    // in the handlers, which by then knows whether the challenge actually passed.
    sessionPoolOptions: { blockedStatusCodes: [401, 429] },
    requestHandler: createRouter(mode),
    // Runs between a failed attempt and the next one (not after the last retry —
    // that is `failedRequestHandler`), so awaiting here delays only the retry.
    errorHandler: async ({ request }, error) => {
        log.warning(
            `Attempt ${request.retryCount + 1} failed for ${request.url}: ${(error as Error).message}. ` +
                `Retrying in ${RETRY_DELAY_MILLIS / 1000}s.`,
        );
        await sleep(RETRY_DELAY_MILLIS);
    },
    // Last stop after every retry is spent. Without this the URL would simply vanish from the
    // output, leaving the caller unable to tell "we never managed to load it" from "we never
    // tried" — so it gets a row like any other, marked FETCH_FAILED.
    failedRequestHandler: async (ctx, error) => {
        const { request } = ctx;
        // Report the caller's original URL, not the normalized one we actually navigated to.
        const url = reportedUrl(request);
        // A seller request carries the product already scraped off the PDP: keep it rather than
        // lose a good product to a store page we could not reach.
        const { partialResponse } = request.userData as { partialResponse?: ProductSellerResponse };
        const row = partialResponse ?? emptyResponse(url, mode);
        row.success = false;
        row.errorCode = 'FETCH_FAILED';
        row.errorMessage = `gave up after ${request.retryCount} retries: ${(error as Error).message}`;
        await pushItem(ctx, row);
    },
    // Headed, and not negotiable: Playwright's bundled Chromium in headless mode never clears
    // DHGate's Cloudflare challenge — verified against a live product URL, it sat on the
    // interstitial for the full 30s. Headed, the same browser clears it in about five seconds.
    headless: false,
    preNavigationHooks: [
        async ({ page, request }, gotoOptions) => {
            // Crawlee waits for `load` by default, which DHGate's error pages never fire: a dead
            // product/store URL burnt the full 60s navigation timeout, three times over, before
            // the handler ever got to say "not found". `domcontentloaded` fires on those pages in
            // about a second, and the extractors all gate on their own selectors anyway — none of
            // them needs images and trackers to have finished loading.
            gotoOptions.waitUntil = 'domcontentloaded';
            // Set the locale cookies before the first navigation so the very first render is
            // already English / USD and shipping to the right country. Browser contexts are
            // reused across requests, so this re-writes `b2b_ship_country` every time rather
            // than letting the previous request's country leak into this one.
            const { shipCountry = DEFAULT_SHIP_COUNTRY } = request.userData as { shipCountry?: string };
            await page.context().addCookies(localeCookies(shipCountry));
        },
    ],
    postNavigationHooks: [
        // DHGate serves a Cloudflare "Just a moment…" interstitial (HTTP 403) in front of its
        // pages. It has to be dealt with here, before any handler runs: the handlers' `detectBlocked`
        // sees the 403 and throws instantly, burning all three retries on a challenge that was
        // about to pass. See utils/cloudflare.ts for the two ways past it.
        passCloudflare,
    ],
    browserPoolOptions: {
        // Crawlee injects a generated fingerprint (usually a Windows Chrome UA and matching JS
        // shims) by default. That helps a bundled Chromium and actively hurts a real one: the
        // spoofed navigator says Windows while the platform APIs, fonts and GPU strings underneath
        // say Linux, and *that mismatch* is precisely what Cloudflare grades. It is also injected
        // with `addInitScript`, which is one of the things Patchright exists to keep off the page.
        // A real Chrome's own consistent fingerprint beats a fabricated one.
        useFingerprints: !chrome.useChrome,
        prePageCreateHooks: [
            (_pageId, _controller, pageOptions) => {
                // Playwright's default 1280x720 viewport is applied through the CDP call
                // `Emulation.setDeviceMetricsOverride`, and a page whose metrics are overridden does
                // not look like a window someone opened. `null` means "whatever the real window is",
                // which is what Patchright's own recommended configuration asks for. Click positions
                // are measured off the live DOM, so nothing downstream depends on a fixed size.
                // BrowserPool's hook contract is to mutate the options object it hands in; there is
                // no return value it would read, so the reassignment is the API, not a slip.
                // eslint-disable-next-line no-param-reassign
                if (pageOptions) pageOptions.viewport = null;
            },
        ],
    },
    launchContext: {
        // Patchright is a drop-in Playwright fork that closes the leaks vanilla Playwright opens in
        // the browser it drives — chiefly the `Runtime.Enable` CDP call, which Cloudflare and
        // DataDome both watch for. Everything measurable had already been ruled out on the platform
        // (real Chrome, residential IP, a click landing 1px off the checkbox centre, healthy CPU)
        // and the challenge still refused, which leaves how the browser is driven rather than what
        // it is. Crawlee only needs a launcher with Playwright's shape, so this is a one-line swap.
        // The cast bridges a *type* gap, not a behavioural one: `patchright-core` tracks Playwright
        // 1.62 while this project is pinned to 1.60 to match the Docker base image, so its `Locator`
        // declares methods (`waitForFunction`) that 1.60's does not, and the two structural types
        // refuse to unify. The runtime API Crawlee actually calls — `launch`, `name`, `connect` —
        // is identical, which is the whole premise of a drop-in fork. Upgrading Playwright instead
        // would break `check-playwright-version.mjs` against the 1.60 base image.
        launcher: patchrightChromium as unknown as BrowserType,
        // The real Google Chrome, not a bundled Chromium — Patchright's documented configuration
        // asks for the branded build too. `executablePath` is the one utils/browser.ts actually
        // probed for, so Crawlee does not have to guess a second time.
        useChrome: chrome.useChrome,
        launchOptions: {
            executablePath: chrome.executablePath,
            args: [
                '--disable-gpu', // Mitigates the "crashing GPU process" issue in Docker containers
            ],
            // Deliberately absent: `--disable-blink-features=AutomationControlled`. Patchright
            // handles `navigator.webdriver` at a lower level, and the flag is itself a deviation
            // from how a real Chrome is started — which is one of the things Patchright patches out
            // of the command line. Adding it back would undo part of what it is here to do.
        },
    },
});

await crawler.run(requests);

// Exit successfully
await Actor.exit();
