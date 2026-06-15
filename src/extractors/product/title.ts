import type { Page } from 'playwright';

/**
 * Extract the product title.
 *
 * The title lives in the SectionProductTitle block. The wrapper classes
 * (e.g. ZMwbU2N, UiW2OOi) are hashed and change between builds, so we target
 * the stable `data-section` / `itemprop="name"` heading instead.
 */
export async function extractTitle(page: Page): Promise<string | null> {
    const locator = page.locator('[data-section="SectionProductTitle"] h1, h1[itemprop="name"]').first();
    await locator.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    if ((await locator.count()) === 0) return null;
    return (await locator.textContent())?.trim() ?? null;
}
