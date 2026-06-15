import type { PlaywrightCrawlingContext } from '@crawlee/playwright';
import type { CaptureMode, ProductSellerResponse } from '../dto/index.js';
import { extractTitle } from '../extractors/product/title.js';
import { extractPricing } from '../extractors/product/pricing.js';
import { extractMedia } from '../extractors/product/media.js';
import { extractDescription } from '../extractors/product/description.js';
import { extractSpecifications } from '../extractors/product/specifications.js';
import { extractHeadlineStats } from '../extractors/product/headlineStats.js';
import { extractAvailableQuantity } from '../extractors/product/stock.js';
import { extractReviews } from '../extractors/product/reviews.js';
import { extractShipping } from '../extractors/product/shipping.js';
import { extractSellerInline } from '../extractors/product/seller.js';
import { emptyProduct, emptySeller, emptyTechnical } from '../utils/defaults.js';
import { extractProductId } from '../utils/parse.js';
import { LABELS } from '../labels.js';

/**
 * Handle a DHGate product detail page.
 *
 * Currently scrapes title + pricing only; the rest of the Product is left at its
 * defaults so the response always matches the {@link ProductSellerResponse} contract.
 * `mode` is threaded in so we know whether to also enqueue the seller later.
 */
export async function handleProduct(ctx: PlaywrightCrawlingContext, mode: CaptureMode): Promise<void> {
    const { request, page, log, pushData, addRequests } = ctx;
    const url = request.loadedUrl ?? request.url;
    const wantSeller = mode === 'product_and_seller';

    // Read-only extractors can run concurrently. extractMedia hovers the gallery
    // (a DOM side effect), so it must run AFTER the price/title reads to avoid
    // racing them — otherwise the price read can pick up the wrong value.
    const id = extractProductId(url) ?? '';

    // Read-only extractors + the reviews API call can run concurrently. extractMedia
    // hovers the gallery (a DOM side effect), so it must run AFTER the price/title
    // reads to avoid racing them — otherwise the price read can pick up the wrong value.
    const [title, pricing, specifications, headline, availableQuantity, reviews, shipping] = await Promise.all([
        extractTitle(page),
        extractPricing(page),
        extractSpecifications(page),
        extractHeadlineStats(page),
        extractAvailableQuantity(page),
        extractReviews(page, id),
        extractShipping(page),
    ]);
    const media = await extractMedia(page);

    // Runs after the price/title reads: scrolls to the bottom to mount the lazy
    // description block (same DOM side effect as extractSellerInline below).
    const description = await extractDescription(page);

    // Runs last: it scrolls to the bottom of the page (a DOM side effect), so it must
    // not race the price/title reads above. Only needed when we also want the seller.
    const sellerInline = wantSeller ? await extractSellerInline(page) : null;

    const product = emptyProduct();
    product.id = id;
    product.title = title ?? '';
    product.pricing = pricing;
    product.specifications = specifications;
    product.media = media;
    product.description = description;
    product.shipping = shipping;
    product.stock.soldCount = headline.soldCount;
    product.stock.availableQuantity = availableQuantity;
    product.reviewsSummary.rating = headline.rating;
    product.reviewsSummary.reviewCount = headline.reviewCount;
    product.reviewsSummary.ratingBreakdown = reviews.ratingBreakdown;
    product.reviewsSummary.reviewSamples = reviews.reviewSamples;

    const response: ProductSellerResponse = {
        platform: 'dhgate',
        url,
        capturedAt: new Date().toISOString(),
        captureMode: mode,
        product,
        sellerRef: null,
        seller: null,
        technical: emptyTechnical(),
        sellerTechnical: null,
    };

    // In product_and_seller mode, resolve the seller from the PDP's "About the Store"
    // block and seed the seller profile with what's available inline.
    if (sellerInline) {
        response.sellerRef = sellerInline.ref;
        const seller = emptySeller();
        seller.platformSellerId = sellerInline.ref.platformSellerId;
        seller.name = sellerInline.ref.name;
        seller.url = sellerInline.ref.url;
        seller.positiveFeedbackPercent = sellerInline.positiveFeedbackPercent;
        seller.avatarUrl = sellerInline.avatarUrl;
        seller.badges = sellerInline.badges;
        response.seller = seller;
    }

    log.info(`Product scraped: ${product.title}`, {
        id: product.id,
        price: pricing.price,
        currency: pricing.currency,
        images: media.images.length,
        videos: media.videos.length,
        descriptionChars: description.plainText.length,
        specs: product.specifications.length,
        rating: headline.rating,
        reviews: headline.reviewCount,
        sold: headline.soldCount,
        stock: availableQuantity,
        reviewSamples: reviews.reviewSamples.length,
        ratingBreakdown: reviews.ratingBreakdown,
    });

    // Hand off to the seller store page so the seller handler can enrich the
    // profile and push ONE merged row. The full response is carried in userData.
    // The uniqueKey includes the product id so the same store is still visited
    // once per product (instead of being deduped across products).
    if (wantSeller && sellerInline?.ref.url) {
        log.info(`Enqueuing seller store page: ${sellerInline.ref.name ?? ''}`, {
            sellerId: sellerInline.ref.platformSellerId,
            storeUrl: sellerInline.ref.url,
        });
        await addRequests([
            {
                url: sellerInline.ref.url,
                label: LABELS.SELLER,
                uniqueKey: `seller:${id}:${sellerInline.ref.platformSellerId ?? sellerInline.ref.url}`,
                userData: { partialResponse: response },
            },
        ]);
        return; // the seller handler pushes the combined row
    }

    if (wantSeller && !sellerInline?.ref.url) {
        log.warning('product_and_seller mode: no seller store URL found on PDP — pushing product only', { url });
    }

    // No seller to visit (product_only, or the seller block was missing): push as-is.
    await pushData(response);
}
