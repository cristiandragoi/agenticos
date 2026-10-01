/**
 * turnLifecycle/executors.ts — EXECUTE stage.
 *
 * Executors return ExecutionReceipts ONLY. ExecutionReceipt has no
 * "verified" field, and nothing in this file inspects the outcome of its own
 * action. They reuse the existing resolution capabilities (DesktopExecutor,
 * WindowsApplicationResolver, BrowserOperator) without their built-in
 * self-verification.
 */
import path from 'node:path';
import { logger } from '../../utils/logger.js';
import type { ExecutionReceipt, PreExecutionSnapshot, TurnGoal } from './types.js';
import { actLaunch, actTypeText, observeWindows } from './probes.js';
import { appIdentity, matchesApp, type AppIdentity } from './appIdentity.js';

function now() { return new Date().toISOString(); }

export interface LaunchPlan {
  kind: 'path' | 'aumid';
  target: string;
  identity: AppIdentity;
  resolvedBy: string;
}

/** Resolve an application name to something launchable. Returns null when it does not exist. */
export async function resolveLaunchPlan(app: string): Promise<LaunchPlan | null> {
  const { desktopExecutor } = await import('../jarvis/execution/executors/desktopExecutor.js');

  // 1. Start-menu / taskbar / UWP resolution (no 'learned' or 'running_window' shortcuts:
  //    a learned entry is an unverified past claim, and a running window is not a launcher).
  try {
    const { windowsApplicationResolver } = await import('../controlPlane/WindowsApplicationResolver.js');
    const cand = await windowsApplicationResolver.resolve(app);
    if (cand && cand.score >= 0.85 && cand.source !== 'learned' && cand.source !== 'running_window') {
      const processHint = cand.processName
        || (cand.targetPath && !/\\WindowsApps\\/i.test(cand.targetPath) ? path.basename(cand.targetPath, path.extname(cand.targetPath)) : undefined)
        || desktopExecutor.resolveApp(app)?.processName;
      const identity = appIdentity(app, cand.name, processHint);
      if (cand.shortcutPath) return { kind: 'path', target: cand.shortcutPath, identity, resolvedBy: `resolver:${cand.source}:shortcut` };
      if (cand.appUserModelId) return { kind: 'aumid', target: cand.appUserModelId, identity, resolvedBy: `resolver:${cand.source}:aumid` };
      if (cand.targetPath && !/\\WindowsApps\\/i.test(cand.targetPath)) {
        return { kind: 'path', target: cand.targetPath, identity, resolvedBy: `resolver:${cand.source}:target` };
      }
    }
  } catch (err: any) {
    logger.warn('[TurnLifecycle] WindowsApplicationResolver error', { app, error: err?.message });
  }

  // 2. Known application registry (bare executables resolved by Windows, e.g. notepad.exe).
  const known = desktopExecutor.resolveApp(app);
  if (known) {
    return {
      kind: 'path',
      target: known.executable,
      identity: appIdentity(app, known.displayName, known.processName),
      resolvedBy: `known:${known.id}`,
    };
  }

  // 3. File-system scan (desktop, start menu, Program Files). Results derived from an
  //    already-running process are not launchers and are ignored.
  const res = desktopExecutor.resolveWindowsDesktopApp(app);
  if (res.found) {
    const target = res.shortcutPath || res.executablePath;
    if (target && !/\\WindowsApps\\/i.test(target)) {
      const procHint = res.executablePath ? path.basename(res.executablePath, path.extname(res.executablePath)) : res.processName;
      return { kind: 'path', target, identity: appIdentity(app, res.displayName, procHint), resolvedBy: 'filesystem_scan' };
    }
  }
  return null;
}

export async function executeLaunchApp(goal: TurnGoal): Promise<ExecutionReceipt> {
  const startedAt = now();
  const app = goal.action!.app!;
  const plan = await resolveLaunchPlan(app);
  if (!plan) {
    return {
      executor: 'lifecycle.launch_app',
      attempted: false,
      completedWithoutError: false,
      startedAt,
      finishedAt: now(),
      error: `application_not_found: no installed application matches "${app}"`,
      details: { app },
    };
  }
  const launched = await actLaunch(plan.target, plan.kind);
  await new Promise((r) => setTimeout(r, 400));
  try {
    const { desktopExecutor } = await import('../jarvis/execution/executors/desktopExecutor.js');
    await desktopExecutor.focusApplication(plan.identity.displayName);
  } catch {}
  return {
    executor: 'lifecycle.launch_app',
    attempted: true,
    completedWithoutError: launched.started && !launched.error,
    startedAt,
    finishedAt: now(),
    error: launched.error,
    details: { app, plan, pid: launched.pid },
  };
}

async function waitForAppWindow(identity: AppIdentity, snapshot: PreExecutionSnapshot | undefined, timeoutMs: number) {
  const before = new Set((snapshot?.windows || []).map((w) => w.hwnd));
  const deadline = Date.now() + timeoutMs;
  let last: { hwnd: number; isNew: boolean } | null = null;
  while (Date.now() < deadline) {
    try {
      const obs = await observeWindows();
      // New windows may be matched by title when the process is unknown; existing ones only by process.
      const fresh = obs.windows.find((w) => !before.has(w.hwnd) && matchesApp(w, identity, { allowTitleMatch: true }));
      if (fresh) return { hwnd: fresh.hwnd, isNew: true };
      const fg = obs.windows.find((w) => w.hwnd === obs.foreground && matchesApp(w, identity));
      if (fg) last = { hwnd: fg.hwnd, isNew: false };
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return last;
}

/** Launch the app, find the window it produced, type the text into exactly that window. */
export async function executeTypeText(goal: TurnGoal, snapshot: PreExecutionSnapshot | undefined): Promise<ExecutionReceipt> {
  const startedAt = now();
  const { app, text } = goal.action as { app: string; text: string };
  const plan = await resolveLaunchPlan(app);
  if (!plan) {
    return {
      executor: 'lifecycle.type_text', attempted: false, completedWithoutError: false, startedAt, finishedAt: now(),
      error: `application_not_found: no installed application matches "${app}"`, details: { app },
    };
  }
  const launched = await actLaunch(plan.target, plan.kind);
  if (!launched.started) {
    return {
      executor: 'lifecycle.type_text', attempted: true, completedWithoutError: false, startedAt, finishedAt: now(),
      error: `launch_failed: ${launched.error || 'unknown'}`, details: { app, plan },
    };
  }
  const target = await waitForAppWindow(plan.identity, snapshot, 10_000);
  if (!target) {
    return {
      executor: 'lifecycle.type_text', attempted: true, completedWithoutError: false, startedAt, finishedAt: now(),
      error: 'no_target_window: the application produced no window to type into', details: { app, plan },
    };
  }
  await new Promise((r) => setTimeout(r, 400));
  const typed = await actTypeText(target.hwnd, text);
  return {
    executor: 'lifecycle.type_text',
    attempted: true,
    completedWithoutError: typed.sent && !typed.error,
    startedAt,
    finishedAt: now(),
    error: typed.error,
    details: { app, plan, targetHwnd: target.hwnd, targetWindowWasNew: target.isNew, typeReceipt: typed.raw },
  };
}

/** Navigate the visible CDP-controlled browser (the same one the verifier reads). */
export async function executeOpenUrl(goal: TurnGoal): Promise<ExecutionReceipt> {
  const startedAt = now();
  const url = goal.action!.url!;
  try {
    const { browserOperator } = await import('../../services/browser/browserOperator.js');
    const page = await browserOperator.ensurePage();
    let navError: string | undefined;
    let status: number | undefined;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      status = resp?.status();
    } catch (err: any) {
      navError = err?.message || String(err);
    }
    await page.bringToFront().catch(() => {});
    return {
      executor: 'lifecycle.open_url',
      attempted: true,
      completedWithoutError: !navError,
      startedAt,
      finishedAt: now(),
      error: navError ? `navigation_error: ${navError.split('\n')[0]}` : undefined,
      details: { url, httpStatus: status ?? null },
    };
  } catch (err: any) {
    return {
      executor: 'lifecycle.open_url', attempted: false, completedWithoutError: false, startedAt, finishedAt: now(),
      error: `browser_unavailable: ${err?.message || err}`, details: { url },
    };
  }
}
