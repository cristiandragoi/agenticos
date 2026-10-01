/**
 * projectNameMatch.ts — ONE project-name matcher for every path that turns an
 * utterance into a project (planner, entity providers, guards).
 *
 * Why this exists (P0): "start the project shop by." (STT for Shopify) matched
 * nothing, and each path then fell back to its own stale default — the active
 * project or a hardcoded 'proj-free-cash'. Keeping the matching rules in one
 * place means a garbled name resolves the same way everywhere, and "no match"
 * is a real answer the callers must handle instead of papering over.
 *
 * Matching precedence: alias → exact/full-name → distinctive token → near miss.
 */

export interface ProjectLike {
  id: string;
  name: string;
}

export interface ProjectMatch {
  id: string;
  name: string;
  match: 'alias' | 'exact' | 'near_miss';
  score: number;
}

export const ALIASES: Record<string, string[]> = {
  'proj-shopify': ['shopify', 'sharpify', 'shop if i', 'shopify store', 'shop by'],
  'proj-free-cash': ['free cash', 'freecash', 'freecash.com', 'free cache', 'freecache', 'free-cache', 'free-cash'],
  'proj-tiktok-shop': ['tiktok shop', 'tik tok shop', 'tiktokshop', 'tik tok'],
};

/**
 * Canonical normalizer for project entity names in utterances.
 * Normalizes acoustic / phonetic variants (e.g. "FreeCache", "Free Cache", "free-cache")
 * to canonical project names ("Free Cash").
 */
export function normalizeProjectEntityName(text: string): string {
  if (!text) return '';
  return text.replace(/\b(?:free\s+cache|freecache|free-cache)\b/gi, 'Free Cash');
}

function normalize(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function noSpace(s: string): string {
  return normalize(s).replace(/\s+/g, '');
}

/** Phonetic key: drop vowels and doubled letters ("shopify" -> "shpfy"). */
function phonetic(s: string): string {
  return noSpace(s).replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Best phonetic window match of an utterance against a project name. */
export function nearMissScore(utteranceNoSpace: string, name: string): number {
  if ((name || '').trim().length < 5) return 0;
  const nameP = phonetic(name);
  const qP = phonetic(utteranceNoSpace);
  if (nameP.length < 4 || qP.length < 4) return 0;
  let best = 0;
  for (let len = Math.max(4, nameP.length - 2); len <= nameP.length + 2; len++) {
    for (let i = 0; i + len <= qP.length; i++) {
      const win = qP.slice(i, i + len);
      const score = 1 - levenshtein(win, nameP) / Math.max(win.length, nameP.length);
      if (score > best) best = score;
    }
  }
  return best;
}

const NEAR_MISS_THRESHOLD = 0.75;

/**
 * Resolve a spoken/typed utterance to one project. Returns null when nothing
 * matches — callers must NOT substitute a default project for a state change.
 */
export function matchProjectByName(text: string, projects: ProjectLike[]): ProjectMatch | null {
  if (!text || !projects || projects.length === 0) return null;
  const q = normalize(text);
  const qNoSpace = noSpace(text);
  if (!q || !qNoSpace) return null;

  for (const [projId, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => q.includes(a) || qNoSpace.includes(noSpace(a)))) {
      const p = projects.find((x) => x.id === projId);
      if (p) return { id: p.id, name: p.name, match: 'alias', score: 1 };
    }
  }

  const qTokens = q.split(' ').filter((t) => t && t !== 'the' && t !== 'project');

  // Tokens shared by more than one project name are ambiguous ("shop" is a token
  // of TikTok Shop AND a substring of "shopify") and may not select on their own.
  const tokenOwners = new Map<string, number>();
  for (const p of projects) {
    for (const t of normalize(p.name).split(' ')) {
      if (t.length < 4) continue;
      const owners = projects.filter((x) => noSpace(x.name).includes(t)).length;
      tokenOwners.set(t, Math.max(tokenOwners.get(t) || 0, owners));
    }
  }

  for (const p of projects) {
    const nameNorm = normalize(p.name);
    const nameNoSpace = noSpace(p.name);
    if (!nameNorm) continue;
    if (nameNorm === q) return { id: p.id, name: p.name, match: 'exact', score: 1 };
    if (nameNoSpace === qNoSpace || qNoSpace.includes(nameNoSpace)) return { id: p.id, name: p.name, match: 'exact', score: 1 };
    if (qTokens.some((t) => t === nameNoSpace)) return { id: p.id, name: p.name, match: 'exact', score: 1 };
    if (qTokens.length > 0 && qTokens.every((t) => nameNorm.includes(t))) return { id: p.id, name: p.name, match: 'exact', score: 1 };
    const WORKER_NAMES = new Set(['hermes', 'codex', 'worker', 'operator', 'agent', 'jarvis']);
    const distinctive = nameNorm.split(' ').filter((t) => t.length >= 4 && !WORKER_NAMES.has(t) && (tokenOwners.get(t) || 0) <= 1);
    if (distinctive.some((d) => new RegExp(`\\b${d}\\b`, 'i').test(q))) return { id: p.id, name: p.name, match: 'exact', score: 1 };
  }

  let best: { id: string; name: string; score: number } | null = null;
  for (const p of projects) {
    const score = nearMissScore(qNoSpace, p.name);
    if (score > (best?.score ?? 0)) best = { id: p.id, name: p.name, score };
  }
  if (best && best.score >= NEAR_MISS_THRESHOLD) {
    return { id: best.id, name: best.name, match: 'near_miss', score: Number(best.score.toFixed(3)) };
  }
  return null;
}
