import type { PlaywrightCrawlingContext } from '@crawlee/playwright';
import type { ProductSellerResponse } from './dto/index.js';
import { ITEM_CHECKS, auditExtraction, logExtractionReport } from './extraction-audit.js';

/**
 * The single exit point to the dataset.
 *
 * Every row goes through here so it is audited against {@link ITEM_CHECKS} first: a silent
 * selector break then shows up as `extraction.missingFields` instead of an unexplained `null`.
 * Handlers must not call `pushData` directly — a push that skips this is a push nobody is
 * watching.
 */
export async function pushItem(ctx: PlaywrightCrawlingContext, response: ProductSellerResponse): Promise<void> {
    const { pushData, log } = ctx;

    // Audited last, immediately before the push: auditing mid-pipeline would flag fields a
    // later extractor was still going to fill in.
    response.extraction = auditExtraction(response, ITEM_CHECKS);

    if (!response.success) {
        log.warning(`pushing error row: ${response.errorCode} — ${response.errorMessage}`, { url: response.url });
    }
    // A row with no sections left (a not-found product) gates every check off, so the audit
    // reports a vacuous `ok` that says nothing — the warning above is the real story. A row that
    // failed only halfway still carries a section worth auditing, so it is reported as usual.
    if (response.extraction.checkedFields > 0) {
        logExtractionReport(response.extraction, log, response.url);
    }

    await pushData(response);
}
