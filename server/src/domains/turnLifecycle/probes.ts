/**
 * turnLifecycle/probes.ts — low-level OS/browser access for the lifecycle.
 *
 * `observe*` functions are READ-ONLY observers used by the verifier and by the
 * pre-execution snapshot. `act*` functions are used only by executors. Both
 * shell out to scripts in server/scripts/lifecycle/ so the same code runs in
 * the installed runtime (cwd = resources/server) and from the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ObservedTab, ObservedWindow } from './types.js';

function scriptsDir(): string {
  const candidates: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/domains/turnLifecycle -> ../../../scripts/lifecycle
    candidates.push(path.resolve(here, '../../../scripts/lifecycle'));
  } catch { /* not ESM */ }
  candidates.push(path.join(process.cwd(), 'scripts', 'lifecycle'));
  candidates.push(path.join(process.cwd(), 'server', 'scripts', 'lifecycle'));
  return candidates.find((p) => fs.existsSync(path.join(p, 'lc_windows.ps1'))) || candidates[0];
}

export function runPowerShell(script: string, args: string[], timeoutMs = 15000): Promise<any> {
  const file = path.join(scriptsDir(), script);
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error(`probe ${script} requires Windows (platform=${process.platform})`));
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const text = String(stdout || '').trim();
        const start = text.indexOf('{');
        if (start >= 0) {
          try {
            resolve(JSON.parse(text.slice(start)));
            return;
          } catch { /* fall through */ }
        }
        reject(new Error(`probe ${script} failed: ${err?.message || ''} ${String(stderr || '').slice(0, 400)} ${text.slice(0, 200)}`.trim()));
      },
    );
  });
}

// ── read-only observers ────────────────────────────────────────────────────

export async function observeWindows(): Promise<{ foreground: number; windows: ObservedWindow[] }> {
  const raw = await runPowerShell('lc_windows.ps1', []);
  const list = Array.isArray(raw?.windows) ? raw.windows : raw?.windows ? [raw.windows] : [];
  return {
    foreground: Number(raw?.foreground || 0),
    windows: list.map((w: any) => ({
      hwnd: Number(w.hwnd),
      pid: Number(w.pid),
      process: String(w.process || ''),
      title: String(w.title || ''),
    })),
  };
}

export async function observeWindowText(hwnd: number): Promise<{ found: boolean; title: string; texts: string[]; error?: string }> {
  const raw = await runPowerShell('lc_window_text.ps1', ['-Hwnd', String(hwnd)]);
  const texts = Array.isArray(raw?.texts) ? raw.texts : raw?.texts ? [raw.texts] : [];
  return { found: Boolean(raw?.found), title: String(raw?.title || ''), texts: texts.map(String), error: raw?.error };
}

export const CDP_PORT = Number(process.env.AGENTICOS_BROWSER_CDP_PORT || 9223);

/** Fresh tab list straight from Chrome's DevTools endpoint — not from the executor's Playwright handle. */
export async function observeBrowserTabs(): Promise<{ reachable: boolean; tabs: ObservedTab[]; error?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { reachable: false, tabs: [], error: `HTTP ${res.status}` };
    const targets = (await res.json()) as any[];
    return {
      reachable: true,
      tabs: targets
        .filter((t) => t.type === 'page')
        .map((t) => ({ id: String(t.id), url: String(t.url || ''), title: String(t.title || '') })),
    };
  } catch (err: any) {
    return { reachable: false, tabs: [], error: err?.message || String(err) };
  }
}

// ── actuators (executors only) ─────────────────────────────────────────────

export async function actLaunch(target: string, kind: 'path' | 'aumid'): Promise<{ started: boolean; pid?: number; error?: string }> {
  const raw = await runPowerShell('lc_launch.ps1', ['-Target', target, '-Kind', kind], 20000);
  return { started: Boolean(raw?.started), pid: raw?.pid ?? undefined, error: raw?.error };
}

export async function actTypeText(hwnd: number, text: string): Promise<{ sent: boolean; foregroundConfirmed: boolean; error?: string; raw: any }> {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  const raw = await runPowerShell('lc_type_text.ps1', ['-Hwnd', String(hwnd), '-TextB64', b64], 20000);
  return { sent: Boolean(raw?.sent), foregroundConfirmed: Boolean(raw?.foregroundConfirmed), error: raw?.error, raw };
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}
