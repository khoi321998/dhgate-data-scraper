import type { Page } from 'playwright';
import type { SellerReviewScore, SellerReviewSample } from '../../dto/index.js';
import { stripUrlParams, parseCompactNumber, parseAmount } from '../../utils/parse.js';

/** Cap on how many seller reviews we keep. */
const MAX_REVIEWS = 10;

/** Everything read off the store's Review tab in a single navigation. */
export interface SellerFeedback {
    reviewScore: SellerReviewScore | null;
    reviews: SellerReviewSample[];
    /** Positive review % from the review page header (fallback when the store header lacks it). */
    positiveFeedbackPercent: number | null;
    /** Transactions count from the review page header. */
    transactions: number | null;
}

/**
 * Navigate to the store's "Review" tab (linked as `a[spm-c="oncreview"]`) and read
 * both the feedback-score breakdown and the "Reviews Received" list in one go — they
 * live on the same server-rendered page.
 *
 * - `.review-score` table       -> Positive/Neutral/Negative totals (last cell per row)
 * - `.review-list-pro` (dl)     -> one review card each (capped at {@link MAX_REVIEWS})
 */
export async function extractSellerFeedback(page: Page): Promise<SellerFeedback> {
    const empty: SellerFeedback = { reviewScore: null, reviews: [], positiveFeedbackPercent: null, transactions: null };

    // DHGate reuses spm-c="oncreview" for BOTH the "Store Membership" and the real
    // "Review" nav links, so the bare attribute + .first() lands on Membership.
    // Disambiguate by the seller-feedback href, which only the Review link carries.
    const reviewLink = page.locator('a[spm-c="oncreview"][href*="seller-feedback"]').first();
    if ((await reviewLink.count()) === 0) return empty;
    const reviewUrl = stripUrlParams(await reviewLink.getAttribute('href'));
    if (!reviewUrl) return empty;

    // 'commit' instead of 'domcontentloaded': the review data is server-rendered, but the
    // page's trailing inline scripts delay DOMContentLoaded. The per-section reads below
    // (waitFor on .review-score, etc.) gate on the actual data instead.
    await page.goto(reviewUrl, { waitUntil: 'commit' }).catch(() => {});

    const stats = await extractFeedbackStats(page);
    return {
        reviewScore: await extractReviewScore(page),
        reviews: await extractReviews(page),
        positiveFeedbackPercent: stats.positiveFeedbackPercent,
        transactions: stats.transactions,
    };
}

/**
 * Parse the review page's `.seller-information-warp .feedback-info` block:
 *   <li><strong>30,479</strong><span>Transactions</span></li>
 *   <li><strong>96.5%</strong><span>Positive Review</span></li>
 */
async function extractFeedbackStats(
    page: Page,
): Promise<{ positiveFeedbackPercent: number | null; transactions: number | null }> {
    let positiveFeedbackPercent: number | null = null;
    let transactions: number | null = null;
    // We navigate with waitUntil:'commit', so wait for the block to parse before reading.
    const warp = page.locator('.seller-information-warp').first();
    await warp.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
    for (const li of await page.locator('.seller-information-warp .feedback-info li').all()) {
        const label = await readText(li.locator('span').first());
        const value = await readText(li.locator('strong').first());
        if (/positive/i.test(label)) positiveFeedbackPercent ??= parseAmount(value);
        else if (/transaction/i.test(label)) transactions ??= parseCompactNumber(value);
    }
    return { positiveFeedbackPercent, transactions };
}

/**
 * Parse the `.review-score` table, keeping only the "Total" column for each sentiment.
 * Rows are tagged by an inner `.a1`/`.a2`/`.a3` div; the Total is the row's last cell.
 */
async function extractReviewScore(page: Page): Promise<SellerReviewScore | null> {
    const table = page.locator('.review-score').first();
    await table.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
    if ((await table.count()) === 0) return null;

    const [positive, neutral, negative] = await Promise.all([
        totalFor(table, '.a1'),
        totalFor(table, '.a2'),
        totalFor(table, '.a3'),
    ]);

    if (positive == null && neutral == null && negative == null) return null;
    return { positive, neutral, negative };
}

/** Read the last cell (Total column) of the row whose label cell matches `marker`. */
async function totalFor(table: ReturnType<Page['locator']>, marker: string): Promise<number | null> {
    const cell = table.locator(`tr:has(${marker}) td:last-child`).first();
    if ((await cell.count()) === 0) return null;
    return parseCompactNumber(await readText(cell));
}

/** Parse the "Reviews Received" list (`.review-list-pro` cards), capped at MAX_REVIEWS. */
async function extractReviews(page: Page): Promise<SellerReviewSample[]> {
    const cards = page.locator('.review-list-pro');
    if ((await cards.count()) === 0) return [];

    const reviews: SellerReviewSample[] = [];
    for (const card of await cards.all()) {
        if (reviews.length >= MAX_REVIEWS) break;

        const user = (await readText(card.locator('.user-info p').first())).replace(/^By:\s*/i, '') || null;
        const country = (await readText(card.locator('.review-country .country').first())) || null;
        const rating = ratingFromWidth(await readAttr(card.locator('.review-list-rate b').first(), 'style'));
        const reviewDate = (await readText(card.locator('.review-list-time').first())) || null;
        const comment = (await readText(card.locator('dd p').first())) || null;
        const helpfulCount = parseCompactNumber(await readText(card.locator('.review-text1').first()));
        const unhelpfulCount = parseUnhelpful(await readText(card.locator('.review-text3').last()));

        reviews.push({ user, country, rating, reviewDate, comment, helpfulCount, unhelpfulCount });
    }

    return reviews;
}

/**
 * Parse a 0–5 star rating from the rating bar's fill width.
 * `<b style="width:100%;">` == 5 stars, so `rating = percent / 20`.
 */
function ratingFromWidth(style: string | null): number | null {
    if (!style) return null;
    const match = style.match(/width:\s*([\d.]+)%/i);
    if (!match) return null;
    const percent = parseFloat(match[1]);
    return Number.isFinite(percent) ? Math.round((percent / 20) * 10) / 10 : null;
}

/** Pull the count out of "unhelpful ( 0 )". */
function parseUnhelpful(text: string): number | null {
    const match = text.match(/unhelpful\s*\(\s*([\d.,]+)/i);
    return match ? parseCompactNumber(match[1]) : null;
}

/** Read trimmed text content from a locator, returning '' when the element is absent. */
async function readText(loc: ReturnType<Page['locator']>): Promise<string> {
    if ((await loc.count()) === 0) return '';
    return ((await loc.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/** Read an attribute from a locator, returning null when the element is absent. */
async function readAttr(loc: ReturnType<Page['locator']>, name: string): Promise<string | null> {
    if ((await loc.count()) === 0) return null;
    return await loc.getAttribute(name);
}
