// For more information, see https://crawlee.dev
import { PlaywrightCrawler } from '@crawlee/playwright';
// For more information, see https://docs.apify.com/sdk/js
import { Actor } from 'apify';

// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// note that we need to use `.js` even when inside TS files
import type { ActorInput } from './dto/index.js';
import { createRouter, LABELS } from './routes.js';

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
const requests = startUrls.map((req) => ({ ...req, label: startLabel }));

// Show the browser window when running locally for testing; force headless
// on the Apify platform, where there is no display.
const isAtHome = Actor.isAtHome();

// Force DHGate to render in English, ship to the US, and price in USD,
// regardless of the (proxy) IP geolocation. These three cookies control the
// locale/ship-to/currency the storefront uses.
const LOCALE_COOKIES = [
    { name: 'language', value: 'en', domain: '.dhgate.com', path: '/' },
    { name: 'b2b_ship_country', value: 'US', domain: '.dhgate.com', path: '/' },
    { name: 'intl_currency', value: 'USD', domain: '.dhgate.com', path: '/' },
];

const crawler = new PlaywrightCrawler({
    // No proxy for now — running against DHGate directly.
    maxRequestsPerCrawl,
    requestHandler: createRouter(mode),
    headless: isAtHome,
    preNavigationHooks: [
        async ({ page }) => {
            // Set the locale cookies before the first navigation so the very
            // first render is already English / US / USD.
            await page.context().addCookies(LOCALE_COOKIES);
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
