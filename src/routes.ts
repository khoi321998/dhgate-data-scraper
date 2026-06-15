import { createPlaywrightRouter } from '@crawlee/playwright';
import type { CaptureMode } from './dto/index.js';
import { handleProduct } from './handlers/product.js';
import { handleSeller } from './handlers/seller.js';
import { LABELS } from './labels.js';

// Re-export so existing importers (e.g. main.ts) keep working.
export { LABELS };

/**
 * Build the router for the given capture mode. The mode is captured in a closure
 * and passed to the handlers so they can decide whether to also visit the seller.
 */
export function createRouter(mode: CaptureMode) {
    const router = createPlaywrightRouter();

    router.addHandler(LABELS.PRODUCT, (ctx) => handleProduct(ctx, mode));
    router.addHandler(LABELS.SELLER, (ctx) => handleSeller(ctx, mode));

    return router;
}
