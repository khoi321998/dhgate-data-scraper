import { setTimeout as sleep } from 'node:timers/promises';

// For more information, see https://crawlee.dev
import { PlaywrightCrawler } from '@crawlee/playwright';
// For more information, see https://docs.apify.com/sdk/js
import { Actor, log } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import type { ActorInput } from './dto/index.js';
import { createRouter, LABELS } from './routes.js';
import { DEFAULT_SHIP_COUNTRY, extractDhgateShipCountry, normalizeDhgateHost } from './utils/parse.js';

// Initialize the Apify SDK
await Actor.init();

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
    // No proxy for now — running against DHGate directly.
    maxRequestsPerCrawl,
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
    headless: false,
    preNavigationHooks: [
        async ({ page, request }) => {
            // Set the locale cookies before the first navigation so the very first render is
            // already English / USD and shipping to the right country. Browser contexts are
            // reused across requests, so this re-writes `b2b_ship_country` every time rather
            // than letting the previous request's country leak into this one.
            const { shipCountry = DEFAULT_SHIP_COUNTRY } = request.userData as { shipCountry?: string };
            await page.context().addCookies(localeCookies(shipCountry));
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
