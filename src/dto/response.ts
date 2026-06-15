import type { Platform, CaptureMode } from './common.js';
import type { Product } from './product.js';
import type { SellerRef, Seller } from './seller.js';
import type { Technical, SellerTechnical } from './technical.js';

/** The top-level object pushed to the dataset for each crawled URL. */
export interface ProductSellerResponse {
    platform: Platform;
    url: string;
    /** ISO-8601 timestamp of when the page was captured. */
    capturedAt: string;
    captureMode: CaptureMode;
    /** The scraped product, or `null` in `seller_only` runs (no product page is visited). */
    product: Product | null;
    sellerRef: SellerRef | null;
    seller: Seller | null;
    technical: Technical;
    sellerTechnical: SellerTechnical | null;
}
