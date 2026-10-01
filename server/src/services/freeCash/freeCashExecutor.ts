/**
 * freeCashExecutor.ts — REAL FreeCash execution foundation (PHASES E+F).
 *
 * This is the first component in AgenticOS that can truthfully speak about the
 * EXTERNAL FreeCash service. Everything here is read-only with respect to the
 * external account: no withdrawals, no offers, no identity actions.
 *
 * Capabilities (first milestone):
 *   - checkAuthenticatedSession(): live probe of the managed browser profile
 *   - startInteractiveLogin(): open the real login page in the managed
 *     persistent profile; the USER authenticates; we detect the session
 *   - inspectAccountState() / inspectAvailableWork(): verified page state
 *   - resumePendingGoals(): automatic resume of the stored original goal once
 *     authentication succeeds (never re-asks "what would you like me to do")
 *
 * Auth evidence contract: sessionValid becomes true ONLY after a live probe
 * (this file) writes evidence. Internal project state never satisfies a
 * prerequisite (PHASE H).
 *
 * SECURITY: credentials are NEVER typed by this code, never read from chat,
 * never logged, never stored outside the persistent browser profile managed
 * by browserSessionManager.
 */
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { resolvedDbPath } from '../../db/index.js';
import {
  writeSessionEvidence,
  readSessionEvidence,
  clearSessionEvidence,
  type ExternalSessionEvidence,
} from '../prerequisites/prerequisiteService.js';
import { markResumePending, listResumePending, markActive, type ActiveGoalRecord } from '../prerequisites/activeGoalRegistry.js';

export const FREECASH_SERVICE = 'freecash';
export const FREECASH_ACCOUNT_ID = 'freecash-main';
const FREECASH_HOME = 'https://freecash.com/en';
const FREECASH_SIGNIN = 'https://freecash.com/en/signin';
const LOGIN_POLL_INTERVAL_MS = 5_000;
const LOGIN_WATCHDOG_MS = 15 * 60_000;

function dataDir(): string {
  return path.dirname(resolvedDbPath);
}

export function freeCashProfilePath(): string {
  return path.join(dataDir(), 'browser_profiles', FREECASH_ACCOUNT_ID);
}

export type FreeCashSessionState = 'authenticated' | 'unauthenticated' | 'unknown';

export interface FreeCashInspection {
  state: FreeCashSessionState;
  /** What was actually observed on the page (DOM facts only, no guesses). */
  observed: string[];
  /** Absolute path of the evidence artifact (screenshots/DOM snapshot). */
  evidencePath: string | null;
  inspectedAt: string;
  error?: string;
}

function headlessForLogin(): boolean {
  // An interactive login MUST be visible; tests/probes may force headless.
  return process.env.AGENTICOS_FREECASH_HEADLESS === '1';
}

/**
 * Detect an authenticated FreeCash session from a live page. Conservative:
 * only affirmative DOM/cookie signals count as authenticated; anything else
 * is 'unknown' or 'unauthenticated'. Never the reverse (a page error must not
 * fabricate 'authenticated').
 */
async function detectSession(page: any): Promise<{ state: FreeCashSessionState; observed: string[] }> {
  const observed: string[] = [];
  try {
    const url: string = page.url() || '';
    observed.push(`final_url=${url}`);

    // Signal 1: cookies — FreeCash keeps an auth/session cookie set post-login.
    const cookies: Array<{ name: string; value: string }> = await page
      .context()
      .cookies('https://freecash.com')
      .catch(() => [] as any[]);
    const cookieNames = cookies.map((c) => c.name).filter(Boolean);
    if (cookieNames.length) observed.push(`cookie_count=${cookieNames.length}`);
    const hasSessionCookie = cookieNames.some((n) => /^(__session|fc_session|session|jwt|access_token|auth)/i.test(n));
    if (hasSessionCookie) observed.push('session_cookie_present=true');

    // Signal 2: authenticated DOM markers (balance / logout affordances).
    const balanceVisible = await page
      .locator('[data-testid*="balance" i], [class*="balance" i]')
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);
    if (balanceVisible) observed.push('balance_element_visible=true');

    // Signal 3: sign-in form visible => definitely NOT authenticated.
    const signinForm = await page
      .locator('input[type="password"], form[action*="login" i], [data-testid*="signin" i]')
      .first()
      .isVisible({ timeout: 2500 })
      .catch(() => false);
    if (signinForm) observed.push('signin_form_visible=true');

    const redirectedToSignin = /signin|login/i.test(url);

    if (signinForm || redirectedToSignin) return { state: 'unauthenticated', observed };
    if (hasSessionCookie || balanceVisible) return { state: 'authenticated', observed };
    return { state: 'unknown', observed };
  } catch (err: any) {
    observed.push(`detect_error=${err?.message || 'unknown'}`);
    return { state: 'unknown', observed };
  }
}

function writeEvidenceArtifact(kind: string, payload: unknown): string {
  const dir = path.join(dataDir(), FREECASH_SERVICE, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify({ kind, payload, writtenAt: new Date().toISOString() }, null, 2), 'utf-8');
  return file;
}

/** Launch (or reuse) the managed persistent-profile session and probe state. */
async function withFreeCashPage<T>(
  fn: (page: any, close: () => Promise<void>) => Promise<T>,
  opts: { headless: boolean; timeoutMs?: number },
): Promise<T> {
  const { browserSessionManager } = await import('../revenueOperator/browser/browserSessionManager.js');
  const session = await browserSessionManager.acquireSession(
    FREECASH_ACCOUNT_ID,
    freeCashProfilePath(),
    `freecash-executor-${randomUUID().slice(0, 8)}`,
    { headless: opts.headless },
  );
  try {
    return await fn(session.page, () => session.close());
  } finally {
    await session.close().catch(() => {});
  }
}

/**
 * LIVE session check — the only legitimate source of `sessionValid=true`.
 * Navigates to FreeCash home from the managed profile and evaluates real DOM
 * signals. Writes persistent evidence (or clears stale evidence on failure).
 */
export async function checkAuthenticatedSession(): Promise<FreeCashInspection> {
  const inspectedAt = new Date().toISOString();
  try {
    return await withFreeCashPage(async (page) => {
      await page.goto(FREECASH_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e: any) => e);
      const { state, observed } = await detectSession(page);
      const evidencePath = writeEvidenceArtifact(`session-${state}`, { observed, url: page.url() });
      if (state === 'authenticated') {
        writeSessionEvidence({
          service: FREECASH_SERVICE,
          authenticated: true,
          verifiedAt: inspectedAt,
          evidencePath,
          detail: observed.join('; '),
        });
      } else if (state === 'unauthenticated') {
        const prev = readSessionEvidence(FREECASH_SERVICE);
        if (prev?.authenticated) {
          writeSessionEvidence({
            service: FREECASH_SERVICE,
            authenticated: false,
            verifiedAt: inspectedAt,
            evidencePath,
            detail: `Live recheck found no session (${observed.join('; ')}).`,
          });
        }
      }
      return { state, observed, evidencePath, inspectedAt };
    }, { headless: true });
  } catch (err: any) {
    logger.warn(`[freeCashExecutor] session check failed: ${err?.message}`);
    return {
      state: 'unknown',
      observed: [`check_error=${err?.message || 'launch failure'}`],
      evidencePath: null,
      inspectedAt,
      error: err?.message,
    };
  }
}

/**
 * Open the managed browser VISIBLE on the real FreeCash login page and watch
 * for the user to complete authentication. Credentials are entered ONLY by
 * the human in that window — this code never sees or touches them.
 *
 * On verified login: writes session evidence, marks the stored original goal
 * resume_pending, and pumps the automatic resume.
 */
export async function startInteractiveLogin(): Promise<{ started: boolean; message: string }> {
  try {
    const { BrowserSessionManager } = await import('../revenueOperator/browser/browserSessionManager.js');
    // Recover a stale profile lock from an earlier crashed session.
    BrowserSessionManager.recoverOrphanLock(freeCashProfilePath());
    const session = await BrowserSessionManager.launchSession({
      workerId: `freecash-login-${randomUUID().slice(0, 8)}`,
      providerAccountId: FREECASH_ACCOUNT_ID,
      profilePath: freeCashProfilePath(),
      headless: headlessForLogin(),
    });
    logger.info('[freeCashExecutor] interactive login window opened (managed persistent profile)');
    void (async () => {
      try {
        await session.page.goto(FREECASH_SIGNIN, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        const deadline = Date.now() + LOGIN_WATCHDOG_MS;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, LOGIN_POLL_INTERVAL_MS));
          const { state } = await detectSession(session.page);
          if (state === 'authenticated') {
            const verifiedAt = new Date().toISOString();
            const evidencePath = writeEvidenceArtifact('login-verified', { state, url: session.page.url() });
            writeSessionEvidence({
              service: FREECASH_SERVICE,
              authenticated: true,
              verifiedAt,
              evidencePath,
              detail: 'interactive_login_verified',
            });
            logger.info('[freeCashExecutor] authenticated session detected — original goal will resume');
            markResumePending(FREECASH_SERVICE);
            await resumePendingGoals().catch((e) => logger.warn(`[freeCashExecutor] resume pump failed: ${e?.message}`));
            break;
          }
        }
        logger.info('[freeCashExecutor] interactive login window closed (watchdog end).');
      } catch (err: any) {
        logger.warn(`[freeCashExecutor] login watcher error: ${err?.message}`);
      } finally {
        await session.close().catch(() => {});
      }
    })();
    return {
      started: true,
      message: 'FreeCash login window opened in the managed browser profile. Complete the sign-in there; authentication will be detected automatically and the original goal will resume.',
    };
  } catch (err: any) {
    logger.warn(`[freeCashExecutor] interactive login failed to start: ${err?.message}`);
    return { started: false, message: `Could not open the login window: ${err?.message || 'browser launch failed'}` };
  }
}

/** Read-only account inspection (milestone 1). */
export async function inspectAccountState(): Promise<FreeCashInspection> {
  const inspectedAt = new Date().toISOString();
  try {
    return await withFreeCashPage(async (page) => {
      await page.goto(FREECASH_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e: any) => e);
      const { state, observed } = await detectSession(page);
      const extras: string[] = [];
      if (state === 'authenticated') {
        const title = await page.title().catch(() => '');
        if (title) extras.push(`page_title=${title}`);
        const balanceText = await page
          .locator('[data-testid*="balance" i], [class*="balance" i]')
          .first()
          .innerText({ timeout: 2500 })
          .catch(() => '');
        if (balanceText) extras.push(`balance_text_present=${balanceText.length > 0}`);
      }
      const all = [...observed, ...extras];
      const evidencePath = writeEvidenceArtifact('inspect-account', { state, observed: all, url: page.url() });
      return { state, observed: all, evidencePath, inspectedAt };
    }, { headless: true });
  } catch (err: any) {
    return { state: 'unknown', observed: [], evidencePath: null, inspectedAt, error: err?.message };
  }
}

/** Read-only inventory of what work is actually available on the page. */
export async function inspectAvailableWork(): Promise<FreeCashInspection & { items: string[] }> {
  const inspectedAt = new Date().toISOString();
  try {
    return await withFreeCashPage(async (page) => {
      await page.goto(FREECASH_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e: any) => e);
      const { state, observed } = await detectSession(page);
      const items: string[] = [];
      if (state === 'authenticated') {
        const offers = await page
          .locator('[data-testid*="offer" i] h3, [class*="offer" i] h3, [data-testid*="task" i]')
          .allInnerTexts({ timeout: 4000 })
          .catch(() => [] as string[]);
        for (const t of offers.slice(0, 10)) {
          const clean = (t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          if (clean) items.push(clean);
        }
      }
      const evidencePath = writeEvidenceArtifact('inspect-work', { state, items, url: page.url() });
      return { state, observed, evidencePath, inspectedAt, items };
    }, { headless: true });
  } catch (err: any) {
    return { state: 'unknown', observed: [], evidencePath: null, inspectedAt, items: [], error: err?.message };
  }
}

/** Open the FreeCash home page for the user in the managed profile. */
export async function openFreeCash(): Promise<{ opened: boolean; message: string }> {
  try {
    const { BrowserSessionManager } = await import('../revenueOperator/browser/browserSessionManager.js');
    BrowserSessionManager.recoverOrphanLock(freeCashProfilePath());
    const session = await BrowserSessionManager.launchSession({
      workerId: `freecash-open-${randomUUID().slice(0, 8)}`,
      providerAccountId: FREECASH_ACCOUNT_ID,
      profilePath: freeCashProfilePath(),
      headless: headlessForLogin(),
    });
    await session.page.goto(FREECASH_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    // Leave the window open; the watcher closes it when the user is done or
    // the profile lock would otherwise be orphaned.
    setTimeout(() => { void session.close().catch(() => {}); }, 5 * 60_000).unref?.();
    return { opened: true, message: 'FreeCash is open in the managed browser profile.' };
  } catch (err: any) {
    return { opened: false, message: `Could not open FreeCash: ${err?.message || 'browser launch failed'}` };
  }
}

// ── Automatic goal resume (PHASE D §9) ─────────────────────────────────────

/**
 * Pump for goals whose authentication blocker cleared. Runs on login-verified
 * events and at backend startup (goals survive restart). Resumption executes
 * the ORIGINAL goal via operateProject — never asks the user again.
 *
 * Idempotency:
 *   - a re-entrancy guard stops two pumps (event + startup) overlapping;
 *   - evidence is re-read per goal, so a goal cannot be resumed without it;
 *   - a goal that was successfully resumed stops being `resume_pending`
 *     (markActive), so a restart cannot resume it a second time.
 */
let resumePumpInFlight = false;

export async function resumePendingGoals(
  runOperate?: (goal: ActiveGoalRecord) => Promise<string>,
): Promise<number> {
  if (resumePumpInFlight) {
    logger.info('[freeCashExecutor] resume pump already in flight — skipping re-entrant run');
    return 0;
  }
  resumePumpInFlight = true;
  try {
    const pending = listResumePending().filter((g) => g.service === FREECASH_SERVICE);
    let resumed = 0;
    for (const goal of pending) {
      try {
        const ev = readSessionEvidence(FREECASH_SERVICE);
        if (!ev?.authenticated) continue; // evidence vanished mid-flight — stay pending only if still blocked
        logger.info(`[freeCashExecutor] resuming original goal: "${goal.originalGoal}"`);
        if (runOperate) {
          await runOperate(goal);
          // Resumed ONCE through the injected runner too: the goal stops being
          // resume_pending so no later pump can execute it a second time.
          markActive(goal.id);
        } else {
          const { operateProject } = await import('../projectExecution/projectController.js');
          if (goal.projectId) {
            const outcome = await operateProject({
              projectId: goal.projectId,
              conversationId: goal.conversationId ?? undefined,
              resumeFromAuth: true,
              originalGoal: goal.originalGoal,
            });
            // Resumed ONCE: stop being resume_pending unless the prerequisite
            // is (still) unsatisfied, in which case the goal must stay blocked
            // and the controller has already re-marked it.
            if (!outcome.waitingForAuth) {
              markActive(goal.id);
            }
          }
        }
        resumed++;
      } catch (err: any) {
        logger.warn(`[freeCashExecutor] resume of goal ${goal.id} failed: ${err?.message}`);
        // Keep it pending — a transient failure must not destroy the user goal.
      }
    }
    return resumed;
  } finally {
    resumePumpInFlight = false;
  }
}

/** Startup hook: goals blocked before a restart remain; if evidence says the
 *  session is already valid, arm + pump the resume automatically.
 *
 *  Runs at most ONCE per process: a second call (e.g. a duplicate boot hook)
 *  must not resume the same goal twice. */
let startupReconciled = false;

export async function reconcileGoalsOnStartup(): Promise<void> {
  if (startupReconciled) {
    logger.info('[freeCashExecutor] startup reconciliation already performed this process — skipped');
    return;
  }
  startupReconciled = true;
  try {
    const ev = readSessionEvidence(FREECASH_SERVICE);
    if (!ev?.authenticated) {
      // Still blocked: the durable goal stays blocked_waiting_for_auth and the
      // user is not asked again — no state is invented, nothing is started.
      logger.info('[freeCashExecutor] startup: no verified FreeCash session — goals remain blocked_waiting_for_auth');
      return;
    }
    markResumePending(FREECASH_SERVICE);
    const resumed = await resumePendingGoals();
    logger.info(`[freeCashExecutor] startup reconciliation resumed ${resumed} goal(s) against verified session evidence`);
  } catch (err: any) {
    logger.warn(`[freeCashExecutor] startup reconcile failed: ${err?.message}`);
  }
}

export { clearSessionEvidence, markResumePending };
