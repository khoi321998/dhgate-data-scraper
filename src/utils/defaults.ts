import type { Product, Pricing, ReviewsSummary } from '../dto/index.js';
import type { Seller } from '../dto/index.js';
import type { Technical } from '../dto/index.js';

export function emptyPricing(): Pricing {
    return {
        currency: 'USD',
        price: null,
        originalPrice: null,
        unit: null,
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
        authenticityKeywords: [],
        buyerMediaCounts: { images: 0, videos: 0 },
    };
}

/** A fully-defaulted Product. Handlers fill the fields they can scrape and leave the rest. */
export function emptyProduct(): Product {
    return {
        id: '',
        title: '',
        brand: null,
        pricing: emptyPricing(),
        stock: { availableQuantity: null, soldCount: null },
        condition: { conditionText: null, returnPolicySummary: null, guaranteeLabels: [] },
        shipping: { options: [], deliveryTimeText: null, shippingProtection: null },
        paymentMethods: [],
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
