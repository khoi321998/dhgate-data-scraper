import type { Product, Pricing, ReviewsSummary } from '../dto/index.js';
import type { Seller } from '../dto/index.js';
import type { Technical } from '../dto/index.js';

export function emptyPricing(): Pricing {
    return {
        currency: 'USD',
        priceMin: null,
        priceMax: null,
    };
}

export function emptyReviewsSummary(): ReviewsSummary {
    return {
        rating: null,
        reviewCount: null,
        ratingBreakdown: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
        reviewSamples: [],
    };
}

/** A fully-defaulted Product. Handlers fill the fields they can scrape and leave the rest. */
export function emptyProduct(): Product {
    return {
        id: '',
        title: '',
        pricing: emptyPricing(),
        stock: { availableQuantity: null, soldCount: null },
        deliveryTimeText: null,
        // DHGate shows the same payment-provider logos on every PDP, so hard-code
        // the list rather than scraping the (purely visual) logo strip.
        paymentMethods: ['Amex', 'Diners', 'Discover', 'Mastercard', 'Visa', 'Klarna', 'Google Pay', 'Apple Pay'],
        description: { html: '', plainText: '' },
        specifications: [],
        media: { images: [], videos: [] },
        reviewsSummary: emptyReviewsSummary(),
    };
}

/** A fully-defaulted Seller. Handlers fill the fields they can scrape and leave the rest. */
export function emptySeller(): Seller {
    return {
        platformSellerId: null,
        name: null,
        url: null,
        positiveFeedbackPercent: null,
        avatarUrl: null,
        transactions: null,
        badges: [],
        productPreviews: [],
        sellerReviews: [],
    };
}

/** A fully-defaulted Technical block. Fields are populated as diagnostic scraping is added. */
export function emptyTechnical(): Technical {
    return {
        scriptBlocks: [],
        jsonState: {},
        dataAttributes: {},
        rawUrlParameters: {},
        experimentIds: [],
        trackingIds: { googleAnalytics: [], facebookPixel: [] },
        pageContext: { pageType: null, searchQuery: null, position: 0, listingType: null, campaignId: null },
        fulfilmentCodes: [],
        jsBundles: [],
        cssBundles: [],
        apiEndpoints: [],
    };
}
