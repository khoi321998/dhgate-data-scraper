import type { Platform, CaptureMode } from './common.js';
import type { ExtractionReport } from './extraction.js';
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
    /**
     * Health of this row's extraction: which fields we expected to find were actually there.
     * Filled in by {@link pushItem} immediately before the row is pushed — a `status` other
     * than `ok` usually means a DHGate markup change broke a selector.
     */
    extraction: ExtractionReport;
    // Temporarily disabled — not emitted to the dataset for now. Kept optional so the
    // diagnostic blocks can be re-enabled without changing the contract.
    technical?: Technical;
    sellerTechnical?: SellerTechnical | null;
}
