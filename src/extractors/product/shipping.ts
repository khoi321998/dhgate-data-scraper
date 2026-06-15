import type { Page } from 'playwright';
import type { Shipping, ShippingOption } from '../../dto/index.js';
import { parseAmount, parseAmounts, parseCurrencySymbol, normalizeCurrency } from '../../utils/parse.js';

/**
 * Extract the PDP shipping quote (the single default option DHGate shows in the buy box).
 *
 * The block lives in a `[spm-c="soldby"]` container with hashed React classes, so we
 * anchor on the stable `spm-index="shipping"` rows and `spm-c="seel"` and read by DOM
 * structure rather than class names:
 *
 *   [spm-index="shipping"]  "Shipping Cost:" <span>US $4.21</span> <span>Cost-effective</span>
 *   [spm-index="shipping"]  <div>To<span>United States</span>Via<span>Seller-Defined STD…</span></div>
 *                           <div>Estimated delivery time:<span>15 Days Delivery</span><span>…tooltip…</span></div>
 *   [spm-c="seel"]          shipping-protection provider ("Seel")
 *
 * Uses locators (not page.evaluate) so it works under both the tsx dev runner and the
 * compiled build.
 */
export async function extractShipping(page: Page): Promise<Shipping> {
    const empty: Shipping = { options: [], deliveryTimeText: null, shippingProtection: null };

    const blocks = page.locator('[spm-index="shipping"]');
    await blocks
        .first()
        .waitFor({ state: 'attached', timeout: 8_000 })
        .catch(() => {});
    if ((await blocks.count()) === 0) return empty;

    // Cost row: first span is the price, second (if any) is the marketing tag.
    const costBlock = page.locator('[spm-index="shipping"]', { hasText: 'Shipping Cost' }).first();
    let costText: string | null = null;
    let costLabel: string | null = null;
    if ((await costBlock.count()) > 0) {
        const spans = costBlock.locator('span');
        costText = (await readText(spans.first())) || null;
        const label = await readText(spans.last());
        costLabel = label && label !== costText ? label : null;
    }

    // Route row: "To <dest> Via <method>" then "Estimated delivery time: <text> <tooltip>".
    const routeBlock = page.locator('[spm-index="shipping"]', { hasText: 'Estimated delivery' }).first();
    let destination: string | null = null;
    let method: string | null = null;
    let deliveryTimeText: string | null = null;
    let detail: string | null = null;
    if ((await routeBlock.count()) > 0) {
        const rows = routeBlock.locator(':scope > div');
        const routeSpans = rows.first().locator('span');
        destination = (await readText(routeSpans.nth(0))) || null;
        method = (await readText(routeSpans.nth(1))) || null;
        const deliveryRow = rows.nth(1);
        deliveryTimeText = (await readText(deliveryRow.locator('span').first())) || null;
        // The tooltip detail is the most deeply nested span in the delivery row.
        detail = (await readText(deliveryRow.locator('span span span').first())) || null;
    }

    const shippingProtection = (await readText(page.locator('span[spm-c="seel"]').first())) || null;

    // "15 Days Delivery" -> 15; a range like "10-15 Days" -> min 10 / max 15.
    const days = parseAmounts(deliveryTimeText);
    const minDays = days.length ? Math.round(days[0]) : null;
    const maxDays = days.length ? Math.round(days[days.length - 1]) : null;

    const options: ShippingOption[] = [];
    if (method || costText) {
        options.push({
            name: method ?? '',
            cost: parseAmount(costText),
            currency: normalizeCurrency(parseCurrencySymbol(costText)),
            estimatedDeliveryMinDays: minDays,
            estimatedDeliveryMaxDays: maxDays,
            destination,
            costLabel,
            detail,
        });
    }

    return { options, deliveryTimeText, shippingProtection };
}

/** Read trimmed text content from a locator, returning '' when the element is absent. */
async function readText(loc: ReturnType<Page['locator']>): Promise<string> {
    if ((await loc.count()) === 0) return '';
    return ((await loc.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}
