import { setTimeout as sleep } from 'node:timers/promises';

import type { Request } from '@crawlee/playwright';
import type { Page } from 'playwright';

/**
 * DHGate now sits behind a Cloudflare *non-interactive* challenge ("Just a moment…").
 *
 * It is not an IP ban: the same IP answers 200 to curl with a plain Chrome User-Agent, and to a
 * real Google Chrome. What trips it is the browser fingerprint — Playwright's bundled Chromium
 * gets challenged, and then has to prove itself by running Cloudflare's JS for a few seconds.
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
 * So: wait the challenge out ({@link settleCloudflareChallenge}), and stop trusting the recorded
 * status once we have ({@link effectiveStatus}).
 *
 * Headless is not an option here — the bundled Chromium in headless mode never clears the
 * challenge, no matter how long it is given. That is why `main.ts` runs headed.
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
 * Deliberately much shorter, because this is not a solve budget: nothing we do will ever tick that
 * box. The working answer for an interactive challenge is to retire the session and come back with
 * a different fingerprint, and every second spent here delays that. It is not zero only because
 * Cloudflare does sometimes auto-solve the interactive widget on its own — so it gets a grace
 * period sized to a slow container, and no more.
 */
const INTERACTIVE_TIMEOUT_MILLIS = millisFromEnv('DHGATE_INTERACTIVE_CHALLENGE_TIMEOUT_MS', 12_000);

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

    // An interactive challenge is not something waiting solves, so it gets a much shorter budget:
    // the sooner we return 'stuck', the sooner the caller retires the session and retries — which
    // is what actually gets us in.
    const type = await readChallengeType(page);
    const budgetMillis = type === 'interactive' ? INTERACTIVE_TIMEOUT_MILLIS : CHALLENGE_TIMEOUT_MILLIS;

    const startedAt = Date.now();
    const deadline = startedAt + budgetMillis;
    while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MILLIS);
        if (!(await isChallengePage(page))) {
            // Cloudflare has navigated us to the real page; let that document parse before the
            // extractors start querying it. A rejection here just means it parsed already.
            await page.waitForLoadState('domcontentloaded').catch(() => undefined);
            return { outcome: 'passed', type, elapsedMillis: Date.now() - startedAt, budgetMillis };
        }
    }
    return { outcome: 'stuck', type, elapsedMillis: Date.now() - startedAt, budgetMillis };
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
