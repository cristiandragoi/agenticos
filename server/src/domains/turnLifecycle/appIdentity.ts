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

const DEFAULT_PROCESS_MAP: Record<string, string[]> = {
  whatsapp: ['whatsapp.root', 'whatsapp', 'whatsappdesktop', 'msedgewebview2'],
  'whatsapp desktop': ['whatsapp.root', 'whatsapp', 'whatsappdesktop', 'msedgewebview2'],
  telegram: ['telegram'],
  'telegram desktop': ['telegram'],
  comet: ['comet'],
  perplexity: ['comet'],
  'comet perplexity': ['comet'],
  'perplexity comet': ['comet'],
  plexi: ['comet'],
  chrome: ['chrome'],
  edge: ['msedge'],
  calculator: ['calculatorapp', 'calc'],
  rechner: ['calculatorapp', 'calc'],
  notepad: ['notepad'],
};

export function appIdentity(requested: string, displayName?: string, processHint?: string): AppIdentity {
  const names = new Set<string>();
  const add = (n?: string) => {
    const v = (n || '').replace(/\.exe$/i, '').trim().toLowerCase();
    if (v && !v.includes('\\') && !v.includes('/')) names.add(v);
  };
  add(processHint);

  const reqLower = (requested || '').toLowerCase().trim();
  const dispLower = (displayName || '').toLowerCase().trim();
  for (const [key, procs] of Object.entries(DEFAULT_PROCESS_MAP)) {
    if (reqLower === key || reqLower.includes(key) || dispLower === key || dispLower.includes(key)) {
      procs.forEach((p) => names.add(p));
    }
  }

  return { requested, displayName: displayName || requested, processNames: [...names] };
}

const COMMON_ALIASES: Record<string, string[]> = {
  calculator: ['rechner', 'calc'],
  rechner: ['calculator', 'calc'],
  whatsapp: ['whatsapp desktop', 'whatsapp'],
  'whatsapp desktop': ['whatsapp'],
  telegram: ['telegram desktop'],
  'telegram desktop': ['telegram'],
  comet: ['comet perplexity', 'perplexity', 'plexi'],
  perplexity: ['comet', 'comet perplexity', 'plexi'],
  'comet perplexity': ['comet', 'perplexity', 'plexi'],
  plexi: ['comet', 'perplexity', 'comet perplexity'],
};

export function matchesApp(w: ObservedWindow, id: AppIdentity, opts: { allowTitleMatch?: boolean } = {}): boolean {
  const proc = (w.process || '').toLowerCase();
  const title = (w.title || '').toLowerCase();
  const want = [id.requested, id.displayName].map((s) => s.toLowerCase().trim()).filter(Boolean);
  for (const item of [...want]) {
    const aliases = COMMON_ALIASES[item];
    if (aliases) want.push(...aliases);
  }

  if (id.processNames.length > 0 && id.processNames.includes(proc)) {
    if (proc === 'msedgewebview2' || proc === 'applicationframehost') {
      return want.some((s) => title.includes(s));
    }
    return true;
  }
  const isUwpHost = proc === 'applicationframehost';
  if (!opts.allowTitleMatch && !isUwpHost) return false;
  return want.some((s) => title.includes(s));
}
