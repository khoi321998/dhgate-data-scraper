export interface Pricing {
    currency: string;
    price: number | null;
    /** Strikethrough / list price shown next to the current price. DHGate-specific extension. */
    originalPrice: number | null;
    /** Per-unit label shown next to the price, e.g. "Piece". DHGate-specific extension. */
    unit: string | null;
    priceMin: number | null;
    priceMax: number | null;
}

export interface Stock {
    availableQuantity: number | null;
    soldCount: number | null;
}

export interface Condition {
    conditionText: string | null;
    returnPolicySummary: string | null;
    guaranteeLabels: string[];
}

export interface ShippingOption {
    name: string;
    cost: number | null;
    currency: string;
    estimatedDeliveryMinDays: number | null;
    estimatedDeliveryMaxDays: number | null;
    /** Destination the quote is for, e.g. "United States". */
    destination?: string | null;
    /** Marketing tag shown next to the cost, e.g. "Cost-effective". */
    costLabel?: string | null;
    /** Longer delivery explanation from the tooltip. */
    detail?: string | null;
}

export interface Shipping {
    options: ShippingOption[];
    deliveryTimeText: string | null;
    /** Shipping protection provider offered on the PDP, e.g. "Seel". */
    shippingProtection: string | null;
}

export interface Description {
    html: string;
    plainText: string;
}

export interface Specification {
    name: string;
    value: string;
}

export interface ProductImage {
    url: string;
}

export interface ProductVideo {
    url: string;
    poster?: string | null;
}

export interface Media {
    images: ProductImage[];
    videos: ProductVideo[];
}

/** Count of reviews per star value, keyed "1".."5". */
export interface RatingBreakdown {
    '1': number;
    '2': number;
    '3': number;
    '4': number;
    '5': number;
}

export interface ReviewSample {
    user: string;
    userFeedbackScore: number | null;
    comment: string;
    /** English machine-translation of {@link comment}, when written in another language. */
    commentTranslated?: string | null;
    /** ISO-3166 country code of the reviewer, e.g. "BR". */
    country?: string | null;
    /** Free-text recency label as shown on the page, e.g. "Past 6 months". */
    commentDate: string;
    /** Star rating of this individual review (1–5), when shown. */
    rating: number | null;
    verifiedPurchase: boolean;
    /** The variant the reviewer bought, e.g. "Color:Rice white Nylon". */
    sku: string | null;
    /** Buyer-uploaded photo URLs attached to this review. */
    images: string[];
}

export interface BuyerMediaCounts {
    images: number;
    videos: number;
}

export interface ReviewsSummary {
    rating: number | null;
    reviewCount: number | null;
    ratingBreakdown: RatingBreakdown;
    /** Sample reviews as shown on the page, each carrying its own star `rating`. */
    reviewSamples: ReviewSample[];
    authenticityKeywords: string[];
    buyerMediaCounts: BuyerMediaCounts;
}

export interface Product {
    /** The marketplace's native item identifier (DHGate product id). */
    id: string;
    title: string;
    brand: string | null;
    pricing: Pricing;
    stock: Stock;
    condition: Condition;
    shipping: Shipping;
    paymentMethods: string[];
    description: Description;
    specifications: Specification[];
    media: Media;
    reviewsSummary: ReviewsSummary;
}
