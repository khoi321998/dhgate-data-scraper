import { setTimeout as sleep } from 'node:timers/promises';

import type { PlaywrightCrawlingContext, Request } from '@crawlee/playwright';
import { log } from 'apify';
import type { Page } from 'playwright';

/**
 * DHGate sits behind a Cloudflare challenge ("Just a moment…"), in two flavours.
 *
 * It is not an IP ban: the same IP answers 200 to curl with a plain Chrome User-Agent, and to a
 * real Google Chrome. What trips it is the browser fingerprint — an automated browser gets
 * challenged, and then has to prove itself by running Cloudflare's JS for a few seconds.
 *
 * Two consequences for the crawler:
 *
 * 1. The interstitial is served with **HTTP 403**, which is exactly what `detectBlocked` treats as
 *    a refusal. We used to throw on it immediately — three retries, three challenges, `FETCH_FAILED`
 *    — while the challenge sitting in that very tab would have cleared itself a second later.
 * 2. Once cleared, Cloudflare navigates the tab to the real page on its own. Crawlee never sees
 *    that second navigation, so `ctx.response` keeps reporting the challenge's 403 for a document
 *    that is, by then, the product page.
 *
 * So {@link passCloudflare} runs the whole gate as one post-navigation step, in three moves:
 *
 * - wait the non-interactive variant out ({@link settleCloudflareChallenge}),
 * - if waiting is not enough, tick the "Verify you are human" checkbox (Crawlee's
 *   `handleCloudflareChallenge`, which clicks it with a real mouse event — the widget lives in a
 *   cross-origin iframe, so a click at the right coordinates is the only way in),
 * - and stop trusting the recorded status once we are through ({@link effectiveStatus}).
 *
 * Two things outside this file do most of the work of *not* being challenged in the first place:
 * `main.ts` launches the real Google Chrome rather than the bundled Chromium (see utils/browser.ts
 * for why that matters more than anything in here), and it runs headed — headless never cleared the
 * challenge in testing, no matter how long it was given.
 */

/**
 * Read a timeout from the environment, falling back to `fallback` for unset or unparseable values.
 * Both budgets below are exposed this way because the right number depends on how fast the machine
 * is, and on Apify that can be changed from the Console without rebuilding the Actor.
 */
function millisFromEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * How long to let Cloudflare's JS work before calling it stuck.
 *
 * It clears in ~5s on a developer machine — but this code's real home is a shared-CPU Apify
 * container, and the challenge is a CPU-bound JS workload. Measured against DHGate with the CPU
 * throttled, page work scales close to linearly: 4x throttle ≈ 4x the wall clock, 8x ≈ 10x. So a
 * budget that looks generous locally is not, and the asymmetry favours patience: waiting too long
 * costs seconds on a request that was failing anyway, while cutting a challenge off one second
 * early throws away an attempt that was about to succeed.
 */
const CHALLENGE_TIMEOUT_MILLIS = millisFromEnv('DHGATE_CHALLENGE_TIMEOUT_MS', 60_000);

/**
 * Budget for the *interactive* variant — the one with a "Verify you are human" checkbox.
 *
 * Deliberately much shorter, because waiting is not what solves this one: clicking is. This is only
 * the grace period we give Cloudflare to auto-solve its own widget (which it does, sometimes)
 * before {@link passCloudflare} stops waiting and goes for the checkbox. Every second spent here is
 * a second that click is delayed, so it is sized to "a slow container might just be slow", no more.
 */
const INTERACTIVE_TIMEOUT_MILLIS = millisFromEnv('DHGATE_INTERACTIVE_CHALLENGE_TIMEOUT_MS', 6_000);

/** How often to re-check whether the interstitial is gone. */
const POLL_INTERVAL_MILLIS = 500;

/** Titles Cloudflare's interstitials carry, across the managed/JS/legacy variants. */
export const CHALLENGE_TITLE = /just a moment|checking your browser|verifying you are human|attention required/i;

/** What {@link settleCloudflareChallenge} found. `none` is the happy path: no challenge at all. */
export type ChallengeOutcome = 'none' | 'passed' | 'stuck';

/**
 * Is the document currently on screen a Cloudflare interstitial?
 *
 * The title is the reliable signal; `_cf_chl_opt` (the challenge's config object) and the
 * `#challenge-error-text` node back it up for localized titles. A rejected `evaluate` means the
 * page navigated out from under us — which, mid-challenge, is the challenge passing.
 *
 * The pattern is handed in as a string because a `RegExp` does not survive the trip into the page.
 */
async function isChallengePage(page: Page): Promise<boolean> {
    return page
        .evaluate((titlePattern) => {
            if (new RegExp(titlePattern, 'i').test(document.title)) return true;
            return document.getElementById('challenge-error-text') != null || '_cf_chl_opt' in window;
        }, CHALLENGE_TITLE.source)
        .catch(() => false);
}

/**
 * Which flavour of challenge is on screen, straight from Cloudflare's own config object:
 * `non-interactive` clears itself, `interactive` wants a checkbox ticked. `null` when the page
 * is not a challenge, or is one we cannot read the type off.
 */
async function readChallengeType(page: Page): Promise<string | null> {
    return page
        .evaluate(() => {
            // eslint-disable-next-line no-underscore-dangle -- Cloudflare's name for it, not ours.
            const opt = (window as unknown as { _cf_chl_opt?: { cType?: string } })._cf_chl_opt;
            return opt?.cType ?? null;
        })
        .catch(() => null);
}

/** What a challenge cost us, so the budgets above can be tuned from evidence rather than guesswork. */
export interface ChallengeResult {
    outcome: ChallengeOutcome;
    /** Cloudflare's own label for the variant (`non-interactive`, `interactive`, …), when readable. */
    type: string | null;
    /** Wall clock spent waiting. Zero when there was no challenge. */
    elapsedMillis: number;
    /** What it was allowed to spend — the number to raise if `stuck` keeps landing near it. */
    budgetMillis: number;
}

/**
 * How long a challenge of this flavour is worth waiting on. Waiting is the *only* move against the
 * non-interactive variant — there is no checkbox on that page for {@link passCloudflare} to click —
 * so it gets the long budget. The interactive one gets barely any, because clicking solves it and
 * every second here delays that click.
 */
function budgetFor(type: string | null): number {
    return type === 'interactive' ? INTERACTIVE_TIMEOUT_MILLIS : CHALLENGE_TIMEOUT_MILLIS;
}

/**
 * Sit on the Cloudflare interstitial until it clears itself.
 *
 * Polls rather than using `waitForFunction`, because clearing the challenge is a real navigation:
 * an injected predicate loses its execution context halfway through and throws instead of
 * resolving. Returns immediately when there is no challenge, so it is cheap on the happy path.
 */
export async function settleCloudflareChallenge(page: Page): Promise<ChallengeResult> {
    if (!(await isChallengePage(page))) {
        return { outcome: 'none', type: null, elapsedMillis: 0, budgetMillis: 0 };
    }

    let type = await readChallengeType(page);
    let budgetMillis = budgetFor(type);

    const startedAt = Date.now();
    // The budget is re-read every iteration rather than frozen into a deadline, because the branch
    // below can shrink it partway through.
    while (Date.now() - startedAt < budgetMillis) {
        await sleep(POLL_INTERVAL_MILLIS);

        if (await isChallengePage(page)) {
            // Cloudflare can escalate a non-interactive challenge into the checkbox one while we
            // are sitting on it. Nothing about waiting solves that second one, so re-read the type
            // and cut the budget the moment it flips — otherwise a request that needs one click
            // burns the full non-interactive minute first.
            const current = await readChallengeType(page);
            if (current && current !== type) {
                log.info(
                    `Cloudflare escalated the challenge: ${type ?? 'unknown'} -> ${current}, cutting the wait short`,
                );
                type = current;
                budgetMillis = budgetFor(current);
            }
            continue;
        }

        // Not a challenge *right now* — but that is not the same as being through. Two ways this
        // reading lies, both seen against DHGate: the check can land in the gap between documents
        // (the `evaluate` rejects, which we read as "no challenge"), and Cloudflare can hand the
        // challenge straight to *another* challenge. So let the next document parse, then look
        // again; only a page that is still clean after settling counts as passed, and anything
        // else drops back into the loop with the remaining budget.
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await sleep(POLL_INTERVAL_MILLIS);
        if (!(await isChallengePage(page))) {
            return { outcome: 'passed', type, elapsedMillis: Date.now() - startedAt, budgetMillis };
        }
    }
    return { outcome: 'stuck', type, elapsedMillis: Date.now() - startedAt, budgetMillis };
}

/**
 * The whole Cloudflare gate, as one post-navigation step.
 *
 * Waiting clears the non-interactive variant. What it never clears is the one with the "Verify you
 * are human" checkbox — for that, Crawlee's `handleCloudflareChallenge` aims a real
 * `page.mouse.click` (with a randomized offset) at where the widget renders, because the checkbox
 * lives in a cross-origin iframe that no selector of ours can reach into.
 *
 * That helper throws a `SessionError` when it finds the hard "Sorry, you have been blocked" page or
 * when the challenge survives its clicks. We deliberately let that propagate, because Crawlee
 * answers a `SessionError` by retiring the session before reclaiming the request — which is what
 * buys the retry a new IP and a new browser. Note that it *does* still cost one of the request's
 * three retries (`_requestFunctionErrorHandler` increments `retryCount` for every retryable error,
 * `SessionError` included); `maxSessionRotations` is a second, higher ceiling of 10, not a way
 * around `maxRequestRetries`.
 */
export async function passCloudflare(ctx: PlaywrightCrawlingContext): Promise<void> {
    const { page, request, session, handleCloudflareChallenge } = ctx;

    const waited = await settleCloudflareChallenge(page);
    if (waited.outcome !== 'stuck') {
        recordChallengeOutcome(request, waited.outcome);
        if (waited.outcome === 'passed') {
            // Logged with its timing on purpose: this is the only way to find out what the
            // challenge actually costs on Apify's shared CPU, which is where the budgets above are
            // guesses. An `elapsedMillis` creeping towards `budgetMillis` in production is the
            // signal to raise DHGATE_CHALLENGE_TIMEOUT_MS.
            log.info(
                `Cleared Cloudflare challenge (${waited.type ?? 'unknown'}) by waiting ` +
                    `${waited.elapsedMillis}ms of ${waited.budgetMillis}ms for ${request.url}`,
            );
        }
        return;
    }

    // `elapsedMillis`, not `budgetMillis`: an escalated challenge shrinks its own budget mid-wait,
    // so only the elapsed figure describes what this request actually cost.
    log.info(
        `Cloudflare challenge (${waited.type ?? 'unknown'}) still up after ${waited.elapsedMillis}ms ` +
            `for ${request.url} — going for the checkbox`,
    );
    // Crawlee's own challenge detector keys off one specific footer node (`.ray-id`); ours reads
    // the title and Cloudflare's `_cf_chl_opt`, which also survives localized interstitials. Hand
    // ours in so the helper and the re-check below agree on what "still challenged" means.
    await handleCloudflareChallenge({ verbose: true, isChallengeCallback: isChallengePage });

    // The helper returns quietly — no click, no error — when it cannot find the element it aims at,
    // so confirm rather than assume.
    const clicked = await settleCloudflareChallenge(page);
    if (clicked.outcome === 'stuck') {
        // The title and the URL we are stuck on are the two things that tell a "challenge loop"
        // (same interstitial, over and over) apart from a hard block page, which is the difference
        // between "rotate IP" and "this fingerprint is burnt".
        const stuckTitle = await page.title().catch(() => '(unreadable)');
        log.warning(
            `Cloudflare challenge (${clicked.type ?? 'unknown'}) survived the checkbox for ` +
                `${request.url} — retiring session. On screen: "${stuckTitle}" at ${page.url()}`,
        );
        recordChallengeOutcome(request, 'stuck');
        session?.retire();
        return;
    }

    // A clean page here means the click worked. That is `passed`, not `none`, even though there is
    // no challenge left to see: the status Crawlee recorded still belongs to the 403 interstitial,
    // not to the document now on screen, and `effectiveStatus` has to know to ignore it.
    recordChallengeOutcome(request, 'passed');
    log.info(`Cleared Cloudflare challenge (${waited.type ?? 'unknown'}) by clicking for ${request.url}`);
}

/** Key under which the pre/post-navigation hooks record the outcome for the handlers. */
const PASSED_FLAG = 'cloudflarePassed';

/** Record that this navigation ended up past a challenge (or did not). Written on every attempt. */
export function recordChallengeOutcome(request: Request, outcome: ChallengeOutcome): void {
    (request.userData as Record<string, unknown>)[PASSED_FLAG] = outcome === 'passed';
}

/**
 * The HTTP status that actually describes the document the handlers are about to read.
 *
 * When a challenge was passed, the recorded status belongs to the interstitial (403), not to the
 * page now on screen — and we never saw the status of that one. `undefined` says exactly that:
 * both `detectBlocked` and `detectNotFound` treat a missing status as "unknown, judge by the DOM",
 * which is the only honest thing to do here.
 */
export function effectiveStatus(request: Request, navigationStatus?: number): number | undefined {
    const passed = (request.userData as Record<string, unknown>)[PASSED_FLAG] === true;
    return passed ? undefined : navigationStatus;
}
