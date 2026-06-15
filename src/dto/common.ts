/** Marketplace the data was scraped from. Extend as more platforms are added. */
export type Platform = 'dhgate';

/**
 * What a single run captures:
 * - `product_only`        — visit the product page, scrape the product (seller stays null).
 * - `product_and_seller`  — visit the product page, scrape product AND its seller.
 * - `seller_only`         — visit a seller/store URL, scrape only the seller (product stays null).
 */
export type CaptureMode = 'product_only' | 'product_and_seller' | 'seller_only';
