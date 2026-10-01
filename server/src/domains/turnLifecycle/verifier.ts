/**
 * turnLifecycle/verifier.ts — INDEPENDENT VERIFY stage.
 *
 * Inputs: the postcondition fixed BEFORE execution, the pre-execution
 * snapshot (taken immediately before the action started), and the execution
 * receipt (used only to learn WHICH window/app to look at, never as proof).
 * It reads fresh state from the OS / browser after execution and returns the
 * evidence it saw.
 *
 * Rules:
 *  - A window, tab or text that already existed before the action is never
 *    proof that the action changed anything.
 *  - "Command dispatched", "exit code missing", "task id exists", "URL opened"
 *    are not observations and are never accepted.
 *  - If nothing can be observed, `observable` is false: the controller then
 *    reports EXECUTED_UNVERIFIED at best, never VERIFIED.
 */
import type {
  ExecutionReceipt, Postcondition, PreExecutionSnapshot, VerificationEvidence, VerificationResult,
} from './types.js';
import { hostOf, observeBrowserTabs, observeWindowText, observeWindows } from './probes.js';
import { matchesApp, appIdentity, type AppIdentity } from './appIdentity.js';

function now() { return new Date().toISOString(); }

function result(satisfied: boolean, observable: boolean, reason: string, evidence: VerificationEvidence[]): VerificationResult {
  return { verifier: 'TurnLifecycleVerifier', satisfied, observable, reason, evidence, checkedAt: now() };
}

function identityFromReceipt(receipt: ExecutionReceipt | undefined, fallbackApp: string): AppIdentity {
  const plan: any = receipt?.details?.plan;
  if (plan?.identity?.processNames) return plan.identity as AppIdentity;
  return appIdentity(fallbackApp, fallbackApp, undefined);
}

async function poll<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs: number, intervalMs = 700): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!done(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

async function verifyAppWindow(pc: Postcondition, snap: PreExecutionSnapshot | undefined, receipt?: ExecutionReceipt): Promise<VerificationResult> {
  if (!snap?.windows) return result(false, false, 'no pre-execution window snapshot; change cannot be proven', []);
  const app = String(pc.expected.app || '');
  const id = identityFromReceipt(receipt, app);
  const before = new Map(snap.windows.map((w) => [w.hwnd, w]));
  const evidence: VerificationEvidence[] = [];
  try {
    const after = await poll(
      () => observeWindows(),
      (o) => o.windows.some((w) => (!before.has(w.hwnd) && matchesApp(w, id, { allowTitleMatch: true }))
        || (w.hwnd === o.foreground && o.foreground !== snap.foregroundHwnd && matchesApp(w, id))),
      10_000,
    );
    const fresh = after.windows.filter((w) => !before.has(w.hwnd) && matchesApp(w, id, { allowTitleMatch: true }));
    const fgWin = after.windows.find((w) => w.hwnd === after.foreground);
    const foregroundChangedToApp = Boolean(fgWin && after.foreground !== snap.foregroundHwnd && matchesApp(fgWin, id));
    const preExisting = snap.windows.filter((w) => matchesApp(w, id));
    evidence.push({
      probe: 'lc_windows.ps1',
      observedAt: now(),
      observation: {
        identity: id,
        newWindows: fresh,
        foregroundBefore: snap.foregroundHwnd,
        foregroundAfter: after.foreground,
        foregroundWindowAfter: fgWin || null,
        foregroundChangedToApp,
        preExistingAppWindows: preExisting.length,
      },
    });
    if (fresh.length > 0) return result(true, true, `new ${id.displayName} window appeared: "${fresh[0].title}" (hwnd ${fresh[0].hwnd})`, evidence);
    if (foregroundChangedToApp) return result(true, true, `existing ${id.displayName} window became the foreground window: "${fgWin!.title}"`, evidence);
    if (preExisting.length > 0) {
      return result(false, true, `${id.displayName} was already open and no new window appeared or came to the foreground; nothing observably changed`, evidence);
    }
    return result(false, true, `no window of ${id.displayName} is visible after the action`, evidence);
  } catch (err: any) {
    return result(false, false, `window probe failed: ${err?.message || err}`, evidence);
  }
}

async function verifyTypedText(pc: Postcondition, snap: PreExecutionSnapshot | undefined, receipt?: ExecutionReceipt): Promise<VerificationResult> {
  const app = String(pc.expected.app || '');
  const text = String(pc.expected.text || '');
  if (!text) return result(false, false, 'postcondition has no text', []);
  if (!snap?.windows) return result(false, false, 'no pre-execution snapshot; change cannot be proven', []);
  const id = identityFromReceipt(receipt, app);
  const before = new Set(snap.windows.map((w) => w.hwnd));
  const preTexts = new Map((snap.appWindowTexts || []).map((t) => [t.hwnd, t.text]));
  const evidence: VerificationEvidence[] = [];
  try {
    const obs = await observeWindows();
    const candidates = obs.windows.filter((w) => (before.has(w.hwnd) ? matchesApp(w, id) : matchesApp(w, id, { allowTitleMatch: true })));
    const reads: Array<{ hwnd: number; title: string; isNew: boolean; containsExact: boolean; containedBefore: boolean; excerpt: string }> = [];
    for (const w of candidates.slice(0, 8)) {
      const read = await poll(
        () => observeWindowText(w.hwnd),
        (r) => r.texts.some((t) => t.includes(text)),
        candidates.length === 1 ? 4000 : 1500,
      ).catch((e) => ({ found: false, title: '', texts: [] as string[], error: String(e) }));
      const joined = read.texts.join('\n');
      const containsExact = joined.includes(text);
      const containedBefore = (preTexts.get(w.hwnd) || '').includes(text);
      const at = joined.indexOf(text);
      reads.push({
        hwnd: w.hwnd,
        title: w.title,
        isNew: !before.has(w.hwnd),
        containsExact,
        containedBefore,
        excerpt: at >= 0 ? joined.slice(Math.max(0, at - 20), at + text.length + 20) : joined.slice(0, 80),
      });
    }
    evidence.push({ probe: 'lc_window_text.ps1 (UI Automation)', observedAt: now(), observation: { identity: id, expectedText: text, windows: reads } });
    const hit = reads.find((r) => r.containsExact && !r.containedBefore);
    if (hit) return result(true, true, `exact text found in ${hit.isNew ? 'new' : 'existing'} window "${hit.title}" and was not there before`, evidence);
    if (reads.some((r) => r.containsExact && r.containedBefore)) {
      return result(false, true, 'the text was already present before the action; the action is not proven', evidence);
    }
    if (candidates.length === 0) return result(false, true, `no ${id.displayName} window to read`, evidence);
    return result(false, true, `the exact text "${text}" is not present in any ${id.displayName} window`, evidence);
  } catch (err: any) {
    return result(false, false, `text probe failed: ${err?.message || err}`, evidence);
  }
}

async function verifyBrowserNavigation(pc: Postcondition, snap: PreExecutionSnapshot | undefined): Promise<VerificationResult> {
  const host = String(pc.expected.host || '');
  if (!host) return result(false, false, 'postcondition has no host', []);
  if (!snap?.browserTabs) return result(false, false, 'no pre-execution tab snapshot; change cannot be proven', []);
  const before = new Map(snap.browserTabs.map((t) => [t.id, t.url]));
  const isTarget = (url: string) => {
    const h = hostOf(url);
    return !url.startsWith('chrome-error://') && (h === host || h.endsWith(`.${host}`));
  };
  const obs = await poll(
    () => observeBrowserTabs(),
    (o) => o.tabs.some((t) => isTarget(t.url) && before.get(t.id) !== t.url),
    12_000,
  );
  const evidence: VerificationEvidence[] = [{
    probe: `CDP http://127.0.0.1/json/list`,
    observedAt: now(),
    observation: { reachable: obs.reachable, error: obs.error, expectedHost: host, tabsBefore: snap.browserTabs, tabsAfter: obs.tabs },
  }];
  if (!obs.reachable) return result(false, false, `browser DevTools endpoint unreachable: ${obs.error}`, evidence);
  const changed = obs.tabs.find((t) => isTarget(t.url) && before.get(t.id) !== t.url);
  if (changed) return result(true, true, `tab ${changed.id} now shows ${changed.url} ("${changed.title}")`, evidence);
  const errTab = obs.tabs.find((t) => t.url.startsWith('chrome-error://'));
  if (errTab) return result(false, true, `the browser shows an error page (${errTab.title || errTab.url}); ${host} did not load`, evidence);
  if (obs.tabs.some((t) => isTarget(t.url))) {
    return result(false, true, `a ${host} tab already existed with the same URL before the action; no change observed`, evidence);
  }
  return result(false, true, `no browser tab shows ${host}`, evidence);
}

function verifyAnswer(receipt: ExecutionReceipt | undefined): VerificationResult {
  const text = (receipt?.handlerText || '').trim();
  const evidence: VerificationEvidence[] = [{
    probe: 'receipt_inspection',
    observedAt: now(),
    observation: { responseLength: text.length, handlerClaimedSideEffect: Boolean(receipt?.handlerClaimedSideEffect), handler: receipt?.executor },
  }];
  if (receipt?.handlerClaimedSideEffect) {
    return result(false, false, 'the handler performed a side effect for an answer-only request; it cannot be verified', evidence);
  }
  if (!text) return result(false, true, 'no response was produced', evidence);
  return result(true, true, 'answer delivered; no side effect performed (content is not fact-checked)', evidence);
}

export async function verify(pc: Postcondition, snap: PreExecutionSnapshot | undefined, receipt: ExecutionReceipt | undefined): Promise<VerificationResult> {
  switch (pc.kind) {
    case 'window_of_app_newly_present_or_foregrounded':
      return verifyAppWindow(pc, snap, receipt);
    case 'text_present_in_new_or_target_window':
      return verifyTypedText(pc, snap, receipt);
    case 'browser_tab_at_host_after_navigation':
      return verifyBrowserNavigation(pc, snap);
    case 'answer_delivered':
      return verifyAnswer(receipt);
    case 'none_control':
      return result(Boolean(receipt?.completedWithoutError), true, receipt?.completedWithoutError ? 'control applied' : 'control not applied', [{
        probe: 'receipt_inspection', observedAt: now(), observation: receipt?.details ?? {},
      }]);
    case 'legacy_unverifiable':
    default:
      return result(false, false, 'no independent observation exists for this legacy capability', [{
        probe: 'none', observedAt: now(), observation: { handler: receipt?.executor, handlerClaimedSideEffect: receipt?.handlerClaimedSideEffect },
      }]);
  }
}

/** Pre-execution snapshot, taken right before EXECUTE. */
export async function takeSnapshot(pc: Postcondition): Promise<PreExecutionSnapshot> {
  const snap: PreExecutionSnapshot = { takenAt: now() };
  if (pc.kind === 'window_of_app_newly_present_or_foregrounded' || pc.kind === 'text_present_in_new_or_target_window') {
    const w = await observeWindows();
    snap.windows = w.windows;
    snap.foregroundHwnd = w.foreground;
    if (pc.kind === 'text_present_in_new_or_target_window') {
      const id = appIdentity(String(pc.expected.app || ''), String(pc.expected.app || ''), await processHintFor(String(pc.expected.app || '')));
      const mine = w.windows.filter((x) => matchesApp(x, id, { allowTitleMatch: true })).slice(0, 8);
      snap.appWindowTexts = [];
      for (const x of mine) {
        try {
          const t = await observeWindowText(x.hwnd);
          snap.appWindowTexts.push({ hwnd: x.hwnd, text: t.texts.join('\n') });
        } catch { /* unreadable windows simply have no pre-text */ }
      }
    }
  }
  if (pc.kind === 'browser_tab_at_host_after_navigation') {
    const t = await observeBrowserTabs();
    snap.browserTabs = t.reachable ? t.tabs : [];
  }
  return snap;
}

async function processHintFor(app: string): Promise<string | undefined> {
  try {
    const { desktopExecutor } = await import('../jarvis/execution/executors/desktopExecutor.js');
    return desktopExecutor.resolveApp(app)?.processName;
  } catch { return undefined; }
}
