import type { Frame, Page } from 'playwright';

/**
 * The payment logo list is rendered by a separately-fetched "Buyer Protection"
 * mini-page (own <title>/<meta>, m.dhgate.com-authored) that DHGate embeds into
 * the modal — it may land in the main document or an iframe depending on build,
 * so poll every frame rather than assuming one.
 */
async function waitForPaymentFrame(page: Page, timeoutMs: number): Promise<Frame | null> {
    const deadline = Date.now() + timeoutMs;
    do {
        for (const frame of page.frames()) {
            const count = await frame
                .locator('.j-paymentListImg .paymentitem img')
                .count()
                .catch(() => 0);
            if (count > 0) return frame;
        }
        await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return null;
}

/**
 * Extract the accepted payment methods (as logo image URLs) from the
 * "Buyer Protection" modal.
 *
 * The list is NOT present in the initial DOM: clicking the trigger
 * (`[spm-c="buyPtc"]`) opens the modal, whose content itself fires an XHR
 * (`getPaymentMethodIcons.do`) and replaces `.j-paymentListImg` with `<img>`
 * logos localized to the buyer's shipping country. We wait for that
 * replacement, then read each logo's `src` — filenames aren't a reliable
 * naming scheme (e.g. "klarna2024", "Google_Pay"), so the URL is kept as-is.
 */
export async function extractPaymentMethods(page: Page): Promise<string[]> {
    const trigger = page.locator('[spm-c="buyPtc"]').first();
    if ((await trigger.count()) === 0) return [];

    await trigger.click({ timeout: 5_000 }).catch(() => {});

    const frame = await waitForPaymentFrame(page, 10_000);
    await page.keyboard.press('Escape').catch(() => {});
    if (!frame) return [];

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const el of await frame.locator('.j-paymentListImg .paymentitem img').all()) {
        const src = await el.getAttribute('src');
        if (!src || seen.has(src)) continue;
        seen.add(src);
        urls.push(src);
    }

    return urls;
}
