import type { Page } from 'playwright';
import type { Pricing } from '../../dto/index.js';
import { emptyPricing } from '../../utils/defaults.js';
import { parseAmount, parseAmounts, parseCurrencySymbol, normalizeCurrency } from '../../utils/parse.js';

/**
 * Extract pricing.
 *
 * The price block has no `data-section` anchor and only hashed classes, but its
 * structure is stable: a single <b> holds the current price, a sibling <s> holds
 * the original (strikethrough) price, and a sibling <span cc="..."> holds the unit:
 *
 *   <div><b>US $14.9</b><span cc="Piece">/ Piece</span><s>US $35.23</s></div>
 *
 * We anchor on the <b> whose text looks like a price, then read its siblings from
 * the parent container. (Locators only — page.evaluate breaks under tsx/esbuild.)
 */
export async function extractPricing(page: Page): Promise<Pricing> {
    const pricing = emptyPricing();

    const priceLoc = page
        .locator('b')
        .filter({ hasText: /\$\s*[\d.,]+/ })
        .first();

    // The price block renders slightly later than the title, so wait for it.
    await priceLoc.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    if ((await priceLoc.count()) === 0) return pricing;

    const container = priceLoc.locator('xpath=..');
    const currentText = (await priceLoc.textContent())?.trim() ?? null;

    const originalLoc = container.locator('s');
    const originalText = (await originalLoc.count()) > 0 ? ((await originalLoc.first().textContent())?.trim() ?? null) : null;

    const unitLoc = container.locator('span[cc]');
    if ((await unitLoc.count()) > 0) {
        pricing.unit =
            (await unitLoc.first().getAttribute('cc')) ??
            (await unitLoc.first().textContent())?.replace(/^\/\s*/, '').trim() ??
            null;
    }

    // Current price may be a single value or a range ("US $14.9 - 20.0").
    const amounts = parseAmounts(currentText);
    pricing.price = amounts[0] ?? null;
    if (amounts.length > 1) {
        pricing.priceMin = amounts[0];
        pricing.priceMax = amounts[amounts.length - 1];
    }

    pricing.originalPrice = parseAmount(originalText);
    pricing.currency = normalizeCurrency(parseCurrencySymbol(currentText));

    return pricing;
}
