import type { PlaywrightCrawlingContext } from '@crawlee/playwright';
import type { CaptureMode, ProductSellerResponse, Seller } from '../dto/index.js';
import { extractSellerProducts } from '../extractors/seller/products.js';
import { extractSellerHeader } from '../extractors/seller/header.js';
import { extractSellerAbout } from '../extractors/seller/about.js';
import { extractSellerFeedback } from '../extractors/seller/feedback.js';
import { emptySeller } from '../utils/defaults.js';
import { extractSellerId } from '../utils/parse.js';

/**
 * Handle a DHGate seller/store page.
 *
 * Two entry paths:
 * - `product_and_seller` — reached by enqueue from the product handler, which passes
 *   the already-scraped {@link ProductSellerResponse} in `userData.partialResponse`.
 *   We enrich its `seller` with store-page data and push ONE merged row.
 * - `seller_only` — reached directly from a start URL with no carried response; we
 *   build a fresh seller-only row (`product` stays null).
 */
export async function handleSeller(ctx: PlaywrightCrawlingContext, mode: CaptureMode): Promise<void> {
    const { request, page, log, pushData } = ctx;
    const url = request.loadedUrl ?? request.url;

    const partial = (request.userData as { partialResponse?: ProductSellerResponse } | undefined)?.partialResponse;

    // Store-page extractors (more will be added as their DOM is mapped).
    // Read the landing page (top-selling) FIRST, then visit the About Us tab —
    // extractSellerAbout navigates away, so anything read off this page must run before it.
    // Each extractor logs its own line as soon as it resolves, so a tester can watch
    // the run and see exactly what each piece of the Seller DTO collected.
    const productPreviews = await extractSellerProducts(page);
    log.info(`[seller] productPreviews: count=${productPreviews.length}`);

    const header = await extractSellerHeader(page);
    log.info('[seller] header', {
        name: header.name,
        avatarUrl: header.avatarUrl ? 'yes' : null,
        positiveFeedbackPercent: header.positiveFeedbackPercent,
        transactions: header.transactions,
        badges: header.badges.length,
        badgeLabels: header.badges,
    });

    // These navigate to other store tabs, so they must run AFTER the landing-page reads.
    // About Us first: its page still carries the store nav, so the Review tab is reachable from it.
    const about = await extractSellerAbout(page);
    if (about) {
        log.info('[seller] about', {
            fields: Object.values(about).filter((v) => v != null && v !== '').length,
            companyName: about.companyName ?? null,
            location: about.location ?? null,
            yearEstablished: about.yearEstablished ?? null,
            introductionChars: about.introduction?.length ?? 0,
        });
    } else {
        log.info('[seller] about: (none)');
    }

    const feedback = await extractSellerFeedback(page);
    log.info('[seller] feedback', {
        sellerReviews: feedback.reviews.length,
        positiveFeedbackPercent: feedback.positiveFeedbackPercent,
        transactions: feedback.transactions,
        reviewScore: feedback.reviewScore ?? null,
    });

    // Start from the inline seller carried off the PDP, or a fresh profile for seller_only.
    const seller: Seller = partial?.seller ?? emptySeller();
    if (!seller.url) seller.url = url;
    seller.productPreviews = productPreviews;
    // Identity: in product_and_seller these come off the PDP, so only fill the gaps.
    // In seller_only there's no PDP, so the store header is the sole source.
    seller.name ??= header.name;
    seller.platformSellerId ??= extractSellerId(url);
    seller.avatarUrl ??= header.avatarUrl;
    if (seller.badges.length === 0) seller.badges = header.badges;
    // Feedback %/transactions: prefer the store header, fall back to the review-page
    // header (some store layouts omit the header feedback panel), then keep whatever
    // the PDP inline block already provided.
    seller.positiveFeedbackPercent =
        header.positiveFeedbackPercent ?? feedback.positiveFeedbackPercent ?? seller.positiveFeedbackPercent;
    seller.transactions = header.transactions ?? feedback.transactions ?? seller.transactions;
    if (about) seller.about = about;
    if (feedback.reviewScore) seller.reviewScore = feedback.reviewScore;
    if (feedback.reviews.length > 0) seller.sellerReviews = feedback.reviews;

    const response: ProductSellerResponse = partial ?? {
        platform: 'dhgate',
        url,
        capturedAt: new Date().toISOString(),
        captureMode: mode,
        product: null,
        sellerRef: { platformSellerId: seller.platformSellerId, name: seller.name, url: seller.url },
        seller,
    };
    response.seller = seller;
    await pushData(response);
}
