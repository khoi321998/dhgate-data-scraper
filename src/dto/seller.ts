/** Lightweight pointer to a seller (id/handle) without the full profile. */
export interface SellerRef {
    platformSellerId: string | null;
    name: string | null;
    url: string | null;
}

/**
 * A lightweight preview of one of the seller's other products, scraped from the PDP's
 * "Recommended from <store>" strip.
 *
 * Every field is optional: keys whose value is missing on the card (e.g. no rating bar,
 * no original/list price) are omitted from the output object rather than emitted as null.
 */
export interface SellerProductPreview {
    productId?: string;
    title?: string;
    url?: string;
    imageUrl?: string;
    price?: number;
    priceText?: string;
    originalPrice?: number;
    originalPriceText?: string;
    /** Discount magnitude as a positive percentage (e.g. 50 for "-50%"). */
    discountPercent?: number;
    soldCount?: number;
    soldText?: string;
    /** Star rating 0–5, derived from the rating bar's fill width. */
    rating?: number;
    /** Number of reviews shown next to the rating. */
    reviewCount?: number;
}

/**
 * A single review from the store's "Reviews Received" list on the Review tab.
 */
export interface SellerReviewSample {
    /** Reviewer's masked display name, e.g. "Laura****hetta" ("By:" stripped). */
    user: string | null;
    /** ISO-3166 country code of the reviewer, e.g. "US". */
    country: string | null;
    /** Star rating 0–5, derived from the rating bar's fill width. */
    rating: number | null;
    /** Date shown on the review, e.g. "06 11,2026". */
    reviewDate: string | null;
    comment: string | null;
    helpfulCount: number | null;
    unhelpfulCount: number | null;
}

/**
 * Extra seller info scraped from the store's "About Us" tab (Basic Information +
 * store introduction). Every field is optional: empty rows on the page are omitted.
 */
export interface SellerAbout {
    /** Store introduction / welcome text shown on the About Us page. */
    introduction?: string;
    companyName?: string;
    businessType?: string;
    location?: string;
    /** When the store opened, e.g. "Mar 2025". */
    yearEstablished?: string;
    /** The "Main Product(s)/Service" value. */
    mainProducts?: string;
}

/** Seller feedback breakdown (Total column) from the store's Review page. */
export interface SellerReviewScore {
    positive: number | null;
    neutral: number | null;
    negative: number | null;
}

/** Full seller profile. Shape extends as more seller fields are scraped. */
export interface Seller {
    platformSellerId: string | null;
    name: string | null;
    url: string | null;
    positiveFeedbackPercent: number | null;
    /** Store avatar/logo image URL. */
    avatarUrl: string | null;
    /** Total transactions count shown on the store header's feedback panel. */
    transactions: number | null;
    /** Tooltip labels of the store's badges (tier, Trade Assurance, "1st year", …). */
    badges: string[];
    /** Positive/neutral/negative feedback totals from the store's Review page. */
    reviewScore?: SellerReviewScore;
    /** Extra info from the store's "About Us" tab (Basic Information + introduction). */
    about?: SellerAbout;
    /** Other products by this seller, scraped from the PDP recommendation strip. */
    productPreviews?: SellerProductPreview[];
    /** Sample store reviews, collected per star rating. */
    sellerReviews?: SellerReviewSample[];
    [key: string]: unknown;
}
