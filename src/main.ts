import { setTimeout as sleep } from 'node:timers/promises';

// For more information, see https://crawlee.dev
import { PlaywrightCrawler } from '@crawlee/playwright';
// For more information, see https://docs.apify.com/sdk/js
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import type { ActorInput, ProductSellerResponse } from './dto/index.js';
import { pushItem } from './push.js';
import { createRouter, LABELS } from './routes.js';
import { recordChallengeOutcome, settleCloudflareChallenge } from './utils/cloudflare.js';
import { currentActorRunId, emptyResponse } from './utils/defaults.js';
import { DEFAULT_SHIP_COUNTRY, extractDhgateShipCountry, normalizeDhgateHost } from './utils/parse.js';
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
} = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);

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
    // No proxy for now — running against DHGate directly. Measured, not assumed: the same IP that
    // gets challenged in the browser answers HTTP 200 to curl with a plain Chrome User-Agent, and
    // to a real Google Chrome. What DHGate refuses is the automated browser's fingerprint, so
    // rotating IPs would buy nothing here — see utils/cloudflare.ts.
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
        // DHGate started serving a Cloudflare "Just a moment…" interstitial (HTTP 403) in front of
        // its pages. It clears itself once the browser has run Cloudflare's JS — but only if we
        // wait: the handlers' `detectBlocked` sees the 403 and throws instantly, burning all three
        // retries on a challenge that was about to pass. Wait it out here, before any handler runs.
        // See utils/cloudflare.ts for why this is a fingerprint problem, not an IP ban.
        async ({ page, request, session }) => {
            const { outcome, type, elapsedMillis, budgetMillis } = await settleCloudflareChallenge(page);
            recordChallengeOutcome(request, outcome);

            if (outcome === 'passed') {
                // Logged with its timing on purpose: this is the only way to find out what the
                // challenge actually costs on Apify's shared CPU, which is where the budgets in
                // utils/cloudflare.ts are guesses. An `elapsedMillis` creeping towards
                // `budgetMillis` in production is the signal to raise DHGATE_CHALLENGE_TIMEOUT_MS.
                log.info(
                    `Cleared Cloudflare challenge (${type ?? 'unknown'}) in ${elapsedMillis}ms ` +
                        `of ${budgetMillis}ms for ${request.url}`,
                );
            } else if (outcome === 'stuck') {
                // Either it never cleared, or it was the interactive "Verify you are human"
                // checkbox, which no amount of waiting solves. Retire the session so the retry
                // comes back with a fresh browser fingerprint and cookie jar — in practice that
                // second attempt is waved straight through.
                log.warning(
                    `Cloudflare challenge (${type ?? 'unknown'}) did not clear in ${budgetMillis}ms ` +
                        `for ${request.url} — retiring session`,
                );
                session?.retire();
            }
        },
    ],
    launchContext: {
        launchOptions: {
            args: [
                '--disable-gpu', // Mitigates the "crashing GPU process" issue in Docker containers
            ],
        },
    },
});

await crawler.run(requests);

// Exit successfully
await Actor.exit();
