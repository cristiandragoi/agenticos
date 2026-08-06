/**
 * Pipeline intake — parse a Jarvis request into a structured PipelineConfig.
 *
 * Deterministic extraction (no LLM): number words, niche-before-"businesses",
 * "in <city>", URLs, dry-run markers, and budget patterns. Anything uncertain
 * is left as a default and surfaced in `notes` — never guessed silently.
 */
import type { PipelineConfig } from './types.js';

export interface IntakeResult {
  config: Omit<PipelineConfig, 'workspacePath' | 'rawRequest'>;
  confidence: number;
  notes: string[];
}

const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "five" → 5; "5" → 5; "a few"/"several" → 3; default 3. */
export function parseProspectCount(text: string): number {
  const m = text.toLowerCase().match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(businesses|business|companies|firms|shops|prospects|leads|candidates)/);
  if (m) {
    const token = m[1].toLowerCase();
    if (/^\d+$/.test(token)) return Math.max(1, Math.min(10, parseInt(token, 10)));
    return NUMBERS[token] || 3;
  }
  if (/\b(a few|several)\s+(businesses|business|companies|firms|shops|prospects)/.test(text.toLowerCase())) return 3;
  return 3;
}

/** "roofing businesses in Berlin" → niche 'roofing', city 'Berlin'. */
function titleCase(s: string): string {
  return s.replace(/\b[a-zäöüß][a-zäöüß]*\b/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function parseNicheAndCity(text: string): { niche: string; city: string; notes: string[] } {
  const notes: string[] = [];
  const p = text.toLowerCase().replace(/\s+/g, ' ').trim();

  // Explicit markers first: "niche: roofing, city: berlin"
  const nicheMarker = p.match(/(?:niche|industry|sector|type)\s*[:=]\s*([a-zäöüß\- ]+?)(?:,|;|\.|$)/);
  const cityMarker = p.match(/(?:city|region|area|location)\s*[:=]\s*([a-zäöüß\- ]+?)(?:,|;|\.|$)/);

  let niche = nicheMarker?.[1]?.trim() || '';
  let city = cityMarker?.[1]?.trim() || '';

  // "N businesses in CITY" — city after 'in' up to a stop word.
  const inCity = p.match(/\b(?:in|near|around|for)\s+([a-zäöüß][\wäöüß\- ]*?)(?=\s+(?:with|that|which|whose|and|but|\.|,|$))/);
  if (!city && inCity) city = inCity[1].trim();

  // Niche = word(s) immediately before "business(es)/company(ies)/firm(s)".
  if (!niche) {
    const nicheMatch = p.match(/([a-zäöüß][\wäöüß\- ]{0,40}?)\s+(?:businesses|business|companies|company|firms|firm|shops|services|prospects|leads|candidates)\b/);
    if (nicheMatch) {
      const candidate = nicheMatch[1].trim();
      // Strip leading verbs/qualifiers like "find", "five", "the", "local".
      const cleaned = candidate
        .replace(/^(find|audit|research|discover|prepare|build|create|the|a|an|local|top|best)\s+/i, '')
        .replace(/^(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '')
        .trim();
      if (cleaned && !/^(and|or|for|with|in|of)$/.test(cleaned)) niche = cleaned;
    }
  }

  // Niche fallback from "with weak websites" context or specific keywords.
  if (!niche) {
    const kw = p.match(/(?:for|offering|providing|services? (?:for|in))\s+([a-zäöüß][\wäöüß\- ]{0,40}?)(?=\s+(?:services?|in|with|\.|,|$))/);
    if (kw) niche = kw[1].trim();
  }

  if (!niche) notes.push('Niche could not be extracted confidently — defaulting to "local business".');
  if (!city) notes.push('City/region could not be extracted confidently — defaulting to empty (no geo filter).');
  // Cities are proper nouns (title-case); niche keeps the user's casing.
  return { niche: niche || 'local business', city: titleCase(city), notes };
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

/** Dry-run is the DEFAULT (safe). Only explicit live-mode language disables it. */
export function parseDryRun(text: string): boolean {
  const p = text.toLowerCase();
  if (
    /\b(live mode|not dry ?run|real businesses|do contact|actually (contact|send)|send it|go ahead and contact|reach out for real)\b/.test(p)
  ) {
    return false;
  }
  return true;
}

export function parsePipelineRequest(text: string): IntakeResult {
  const notes: string[] = [];
  const { niche, city, notes: geoNotes } = parseNicheAndCity(text);
  notes.push(...geoNotes);
  const count = parseProspectCount(text);
  const keywords = parseServiceKeywords(text);
  const budget = parseBudgetUsd(text);
  const url = parseSpecificUrl(text);
  const dryRun = parseDryRun(text);

  if (count === 3 && !/\b(three|3)\b/.test(text.toLowerCase())) {
    notes.push('Prospect count not specified — defaulting to 3.');
  }
  if (!dryRun) notes.push('Live mode requested — V1 discovery will refuse without a specific business URL.');
  else if (!/\b(dry ?run|dry-run|do not contact|do not publish|nothing will be)\b/.test(text.toLowerCase())) {
    notes.push('Defaulting to dry-run (safe) — no explicit dry-run marker found.');
  }

  const explicit = (/\b(fixture|sample|dry run|dry-run)\b/.test(text.toLowerCase()) ? 1 : 0) +
    (/\b(do not contact|do not publish|nothing will be)/.test(text.toLowerCase()) ? 1 : 0);
  const confidence = Math.min(1, 0.55 + explicit * 0.2 + (niche !== 'local business' ? 0.1 : 0) + (city ? 0.1 : 0));

  return {
    config: {
      niche,
      city,
      serviceKeywords: keywords,
      prospectCount: count,
      specificUrl: url,
      maxResearchBudgetUsd: budget,
      dryRun,
      runBuild: true,
      useLlm: false,
    },
    confidence,
    notes,
  };
}
