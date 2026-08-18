/**
 * Pipeline intake — parse a Jarvis request into a structured PipelineConfig.
 *
 * Deterministic extraction (no LLM), robust to:
 *   - multiline prompts / numbered lists
 *   - "Find 5 …", "find five …", "a few …"
 *   - "in Berlin", "in Berlin, Germany", "near Munich"
 *   - singular/plural niche forms ("roofers", "roofing", "roofing businesses")
 *   - punctuation and line breaks
 *
 * Never silently invents a required value: if niche / city / prospectCount
 * cannot be extracted, it is reported in `missing` and the caller (Jarvis)
 * must ASK for it instead of creating a task with a default.
 */
import type { PipelineConfig } from './types.js';

export type MissingField = 'niche' | 'city' | 'prospectCount';

export interface IntakeResult {
  config: Omit<PipelineConfig, 'workspacePath' | 'rawRequest'>;
  confidence: number;
  notes: string[];
  /** Required values that could not be extracted — caller must ask, not default. */
  missing: MissingField[];
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1,
};

/** System words that must never be treated as a niche/business name. */
const SYSTEM_WORDS = new Set([
  'business', 'businesses', 'local', 'real', 'legitimate', 'pipeline', 'revenue',
  'website', 'websites', 'weak', 'best', 'top', 'strongest', 'candidate', 'candidates',
  'prospect', 'prospects', 'company', 'companies', 'firm', 'firms', 'shop', 'shops',
  'service', 'services', 'lead', 'leads', 'new', 'bounded', 'task', 'concept', 'rebuild',
  'proposal', 'audit', 'audited', 'rank', 'opportunity', 'opportunities',
  'find', 'audit', 'research', 'discover', 'prepare',
]);

const BUSINESS_NOUNS = /(businesses?|companies?|firms?|shops?|roofers|prospects?|leads|candidates|plumbers?|electricians?|mechanics?)/i;

function titleCase(s: string): string {
  return s.replace(/\b[a-zäöüß][a-zäöüß]*\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** Count: "find 5 …", "five …", "prospectCount: 5", "count: 5", "5 businesses". */
export function parseProspectCount(text: string): number | null {
  const p = text.replace(/\s+/g, ' ');

  // Explicit markers first.
  const marker = p.match(/\b(?:prospect\s*count|count|number of prospects?)\s*[:=]\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (marker) {
    const t = marker[1].toLowerCase();
    return /^\d+$/.test(t) ? Math.max(1, Math.min(10, parseInt(t, 10))) : NUMBER_WORDS[t] || null;
  }

  // "find 5 legitimate roofing businesses" / "find five …" — number followed by
  // optional adjectives and a business noun within a short window.
  const numRe = /\b(?:find|audit|research|discover|prepare)\s+(?:up to\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|several)\b[^.\n]{0,50}\b(?:businesses?|companies?|firms?|shops?|roofers|plumbers?|electricians?|mechanics?|prospects?|leads|candidates)\b/i;
  const numMatch = p.match(numRe);
  if (numMatch) {
    const t = numMatch[1].toLowerCase();
    if (/^\d+$/.test(t)) return Math.max(1, Math.min(10, parseInt(t, 10)));
    if (t === 'a few' || t === 'several') return 3;
    return NUMBER_WORDS[t] ?? null;
  }

  // Bare "5 roofing businesses in …" (no find verb).
  const bare = p.match(/\b(\d+)\s+(?:[a-zäöüß\-]+\s+){0,3}(?:businesses?|companies?|firms?|shops?|roofers|prospects?|leads|candidates)\b/i);
  if (bare) return Math.max(1, Math.min(10, parseInt(bare[1], 10)));

  // Bare number-word + prospect noun ("five prospects").
  const bareWord = p.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|a few|several)\s+prospects?\b/i);
  if (bareWord) {
    const t = bareWord[1].toLowerCase();
    if (t === 'a few' || t === 'several') return 3;
    return NUMBER_WORDS[t] ?? null;
  }

  return null;
}

/** City: explicit marker, "in/near/around/based in <Place>", title-cased. */
export function parseCity(text: string): { city: string; notes: string[] } {
  const notes: string[] = [];
  const p = text.replace(/\s+/g, ' ');

  const marker = p.match(/\b(?:city|region|area|location|based)\s*[:=]\s*([A-Za-zäöüß][\wäöüß\-]*(?:\s+[A-Za-zäöüß][\wäöüß\-]*){0,3})/i);
  if (marker) {
    return { city: titleCase(marker[1].trim()), notes };
  }

  // "in/near/around/based in <Capitalized Proper Noun(s)>" — prefer capitalized.
  // NOTE: no `i` flag — [A-ZÄÖÜ] must only match real capitals, otherwise
  // "in Berlin with weak websites" captures "with weak websites" too.
  const capCity = p.match(/\b(?:in|near|around|based in)\s+([A-ZÄÖÜ][\wäöüß\-]*(?:\s+(?:[A-ZÄÖÜ][\wäöüß\-]*|de|der|des|du|la|le|am|an|im)){0,3})\b/);
  if (capCity) {
    const raw = capCity[1].trim();
    if (!/^(a|an|the|this|my|your|their)$/i.test(raw)) return { city: titleCase(raw), notes };
  }

  // Fallback: "in <word phrase>" up to a stop — title-cased.
  const lowCity = p.match(/\bin\s+([a-zäöüß][\wäöüß\-]{1,30}(?:\s+[a-zäöüß][\wäöüß\-]{1,30}){0,2})\b(?=\s*(?:with|that|which|whose|\.|,|$|and\s+find|to\s+prepare|\d+\.))/i);
  if (lowCity) {
    const raw = lowCity[1].trim();
    if (!/^(a|an|the|this|my|your|their|berlin\s+with)$/i.test(raw) && !SYSTEM_WORDS.has(raw.toLowerCase())) {
      return { city: titleCase(raw), notes };
    }
  }

  notes.push('City/region could not be extracted confidently.');
  return { city: '', notes };
}

/** Niche: explicit marker, "for <niche> in", "find N … <niche> businesses", plural-tolerant. */
export function parseNiche(text: string): { niche: string; notes: string[] } {
  const notes: string[] = [];
  const p = text.replace(/\s+/g, ' ');
  const candidates: string[] = [];

  const marker = p.match(/\b(?:niche|industry|sector|type)\s*[:=]\s*([A-Za-zäöüß][\wäöüß\-]*(?:\s+[A-Za-zäöüß][\wäöüß\-]*){0,2})/i);
  if (marker) candidates.push(marker[1].trim());

  // "find 5 legitimate roofing businesses" — capture the noun before the business word.
  const findForm = p.match(/\b(?:find|audit|research|discover|prepare)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|several)\s+(?:(?:legitimate|real|local|top|best|weak)\s+)*(?:([a-zäöüß\-]{2,30})\s+)?(?:businesses?|companies?|firms?|shops?|roofers)\b/i);
  if (findForm && findForm[1]) candidates.push(findForm[1].trim());

  // "find 3 plumbers in Hamburg" — niche directly before "in <city>".
  const pluIn = p.match(/\b(?:find|audit|research|discover|prepare)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|several)\s+([a-zäöüß][\wäöüß\-]{2,30})\s+(?:in|near|around)\s+/i);
  if (pluIn && pluIn[1]) candidates.push(pluIn[1].trim());


  // "for roofers in Berlin" / "roofers in Berlin" / "roofing companies in …"
  const forIn = p.match(/\b(?:for|of)\s+([a-zäöüß][\wäöüß\-]*(?:\s+[a-zäöüß][\wäöüß\-]*){0,2})\s+(?:in|near|around)\s+/i);
  if (forIn && forIn[1]) candidates.push(forIn[1].trim());

  // "roofing businesses in Berlin" (niche directly before business noun + in)
  const nounIn = p.match(/\b([a-zäöüß][\wäöüß\-]{2,30})\s+(?:businesses?|companies?|firms?|shops?)\s+(?:in|near|around)\s+/i);
  if (nounIn && nounIn[1]) candidates.push(nounIn[1].trim());

  for (const c of candidates) {
    const cleaned = c
      .replace(/^(find|audit|research|discover|prepare|build|create|the|a|an|local|top|best|real|legitimate|weak)\b\s*/i, '')
      .replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b\s*/i, '')
      .trim();
    const words = cleaned.split(/\s+/).filter((w) => !SYSTEM_WORDS.has(w.toLowerCase()));
    if (words.length === 0) continue;
    const joined = words.join(' ').replace(/\s+/g, ' ').trim();
    if (joined.length >= 2 && joined.length <= 40) return { niche: joined, notes };
  }

  notes.push('Niche could not be extracted confidently.');
  return { niche: '', notes };
}

/** Dry-run is the DEFAULT (safe). Only explicit live-mode language disables it. */
export function parseDryRun(text: string): boolean {
  const p = text.toLowerCase();
  if (/\b(live mode|not dry ?run|do contact|actually (contact|send)|send it|go ahead and contact|reach out for real)\b/.test(p)) {
    return false;
  }
  return true;
}

export function parseServiceKeywords(text: string): string[] {
  const p = text.toLowerCase();
  const kw = p.match(/(?:keywords?|services?)\s*[:=]\s*([a-zäöüß,;/\- ]+?)(?:\.|$)/);
  if (kw) {
    return kw[1].split(/[,;\/]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  }
  return [];
}

export function parseBudgetUsd(text: string): number | null {
  const p = text.toLowerCase();
  const m = p.match(/(?:budget|max(?:imum)?\s*(?:research\s*)?budget|spend)\s*(?:of)?\s*[:=]?\s*[€$]?\s*(\d+(?:\.\d+)?)/);
  if (m) return Math.max(0, parseFloat(m[1]));
  const under = p.match(/under\s+[€$]\s*(\d+(?:\.\d+)?)/);
  if (under) return Math.max(0, parseFloat(under[1]));
  return null;
}

export function parseSpecificUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?)\]}]+$/, '');
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    /* not a URL */
  }
  return null;
}

export function parsePipelineRequest(text: string): IntakeResult {
  const notes: string[] = [];
  const { niche, notes: nicheNotes } = parseNiche(text);
  const { city, notes: cityNotes } = parseCity(text);
  notes.push(...nicheNotes, ...cityNotes);

  const count = parseProspectCount(text);
  const keywords = parseServiceKeywords(text);
  const budget = parseBudgetUsd(text);
  const url = parseSpecificUrl(text);
  const dryRun = parseDryRun(text);

  if (count === null) notes.push('Prospect count could not be extracted — a value is required.');
  if (!dryRun) notes.push('Live mode requested — V1 discovery refuses without a specific business URL.');
  else if (!/\b(dry ?run|dry-run|do not contact|do not publish|do not spend|nothing will be)\b/.test(text.toLowerCase())) {
    notes.push('Defaulting to dry-run (safe) — no explicit dry-run marker found.');
  }

  const missing: MissingField[] = [];
  if (!niche) missing.push('niche');
  if (!city) missing.push('city');
  if (count === null) missing.push('prospectCount');

  const explicit = (missing.length === 0 ? 1 : 0) +
    (/\b(do not contact|do not publish|do not spend|nothing will be)/.test(text.toLowerCase()) ? 1 : 0) +
    (/\b(fixture|sample|dry run|dry-run)\b/.test(text.toLowerCase()) ? 1 : 0);
  const confidence = Math.min(1, 0.5 + explicit * 0.15 + (niche ? 0.1 : 0) + (city ? 0.1 : 0) + (count !== null ? 0.1 : 0));

  return {
    config: {
      niche: niche || 'local business',
      city,
      serviceKeywords: keywords,
      prospectCount: count ?? 3,
      specificUrl: url,
      maxResearchBudgetUsd: budget,
      dryRun,
      fixturesOnly: false,
      runBuild: true,
      useCodex: true,
      useLlm: false,
    },
    confidence,
    notes,
    missing,
  };
}
