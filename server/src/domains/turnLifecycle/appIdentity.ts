/**
 * How the lifecycle recognises "a window of application X".
 *
 * A process-name match is required whenever the process is known. Window
 * TITLES alone are never trusted for windows that already existed — a title
 * can mention anything (e.g. a terminal whose title contains "browser.exe").
 */
import type { ObservedWindow } from './types.js';

export interface AppIdentity {
  requested: string;
  displayName: string;
  processNames: string[];
}

export function appIdentity(requested: string, displayName?: string, processHint?: string): AppIdentity {
  const names = new Set<string>();
  const add = (n?: string) => {
    const v = (n || '').replace(/\.exe$/i, '').trim().toLowerCase();
    if (v && !v.includes('\\') && !v.includes('/')) names.add(v);
  };
  add(processHint);
  return { requested, displayName: displayName || requested, processNames: [...names] };
}

export function matchesApp(w: ObservedWindow, id: AppIdentity, opts: { allowTitleMatch?: boolean } = {}): boolean {
  const proc = (w.process || '').toLowerCase();
  if (id.processNames.length > 0) return id.processNames.includes(proc);
  if (!opts.allowTitleMatch) return false;
  const title = (w.title || '').toLowerCase();
  const want = [id.requested, id.displayName].map((s) => s.toLowerCase().trim()).filter(Boolean);
  return want.some((s) => title.includes(s));
}
