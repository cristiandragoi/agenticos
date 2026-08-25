/**
 * findings.ts
 *
 * Typed worker finding contract for `execution_results.structured_output`.
 *
 * This is the machine-to-machine contract that replaces regex-parsing of
 * natural-language `finalAnswer` text. `finalAnswer` remains the human
 * presentation layer; `findings[]` here is the authoritative structured
 * contract for downstream machine consumers (Jarvis verification handoff).
 *
 * ── Source-of-truth boundary ──────────────────────────────────────────────
 * Structure first becomes authoritative at the worker completion boundary
 * (see `codexAdapter.reconcileGoalToResult`), where the completed CodeX
 * goal's `finalAnswer` is parsed ONCE into typed findings and persisted in
 * `execution_results.structured_output.findings`. Every downstream consumer
 * reads the persisted findings — it must never reparse `finalAnswer`.
 */

export type FindingPriority = 'P0' | 'P1' | 'P2' | 'P3';

/** Per-finding verification decision (verification results only). */
export type FindingVerdict = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'NOT_VERIFIED';

/**
 * Where a set of persisted findings was derived from.
 *  - 'structured'             — provided directly by the worker/provider in a
 *                               structured form (no text parsing).
 *  - 'legacy_text_fallback'   — derived by the TRANSITIONAL parser from
 *                               natural-language text at the completion
 *                               boundary (current reality; see parser below).
 */
export type FindingsSource = 'structured' | 'legacy_text_fallback';

export interface WorkerEvidence {
  /** Repository-relative file path (provenance). */
  file: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
  excerpt?: string;
  description?: string;
}

export interface WorkerFinding {
  /** Stable machine identifier (e.g. "finding-3"). */
  id: string;
  title: string;
  description?: string;
  evidence: WorkerEvidence[];
  impact?: string;
  /** Confidence in the defined range [0, 1]. */
  confidence?: number;
  priority?: FindingPriority;
  /** Verification-result-only fields. */
  verdict?: FindingVerdict;
  explanation?: string;
}

// ── TRANSITIONAL parser (clearly labeled — legacy text boundary) ───────────
//
// Current CodeX providers emit natural-language `finalAnswer`; there is no
// provider-level structured output. Per the Phase-1 plan, this parser runs
// ONCE at the worker completion boundary to seed typed findings. When the
// provider layer gains true structured output, the parser is retired and
// `findingsSource` becomes 'structured'.
//
// It is intentionally a SEPARATE, richer parser than the legacy display
// parser (`parseFindingsFromText` in jarvis/workerContextHandoff.ts): that one
// exists only to support historical rows with no typed findings.

const KEYWORD_HEADER_RE = /^(?:Finding|Problem|Issue|Claim|Defect|Vulnerability|Bug)\b\s*#?\s*(\d+)\b\s*[:.)\-–—]*\s*[=*#]*\s*(.*)$/i;
const NUMBERED_HEADER_RE = /^(\d+)\s*[.)]\s*(.+)$/;

const FILE_EXT = '(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|cs|jsonl?|md|css|html|scss|sql|ya?ml|sh|bat|ps1|vue|svelte|toml|log)';
const FILE_PART = '[A-Za-z0-9_.\\/\\\\-]+[.]' + FILE_EXT;

// Captures: (1) file, then optional line info — either parenthesised
// "(lines 300-310)" / "(line 205)" (groups 2/3) or colon ":215-220" (groups 4/5).
const EVIDENCE_RE = new RegExp(
  '(' + FILE_PART + ')' +
  '(?:\\s*(?:\\(\\s*lines?\\s*(\\d+)(?:\\s*[-–—]\\s*(\\d+))?\\s*\\)|:\\s*(\\d+)(?:\\s*[-–—]\\s*(\\d+))?))?',
  'g'
);

const IMPACT_RE = /(?:production\s+)?impact\s*:\s*(.+)/i;
const CONFIDENCE_RE = /confidence\s*[:\s]+\s*(high|medium|low|\d+(?:\.\d+)?\s*%?)/i;
const PRIORITY_RE = /\bP([0-3])\b/i;
const VERDICT_RE = /\b(VERIFIED|PARTIALLY\s+VERIFIED|NOT\s+VERIFIED)\b/i;
const EXPLANATION_RE = /(?:technical\s+)?assessment\s*:\s*(.+)/i;

function stripDecoration(s: string): string {
  return s.trim().replace(/^[=*#]+\s*/, '').replace(/\s*[=*#]+$/, '').trim();
}

function cleanTitle(t: string): string {
  return t.trim().replace(/^[=*#\s]+/, '').replace(/[=*#\s]+$/, '').trim();
}

/**
 * Split a numbered finding header line of the form:
 *   1. **Title** — description…
 *   1. Title: description…
 * into { title, description }. Returns the whole string as title when no
 * separator is present.
 */
function splitNumberedTitle(rest: string): { title: string; description: string } {
  const t = rest.trim();
  // **bold title** — description  (bold marker + em/en dash)
  const bold = t.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/);
  if (bold) return { title: bold[1].trim(), description: bold[2].trim() };
  // "Title — description" or "Title: description"
  const plain = t.match(/^(.+?)\s+(?:[—–-]|:)\s+(.+)$/);
  if (plain) return { title: plain[1].trim(), description: plain[2].trim() };
  return { title: t, description: '' };
}

function extractEvidence(body: string): WorkerEvidence[] {
  const map = new Map<string, WorkerEvidence>();
  const re = new RegExp(EVIDENCE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const file = m[1];
    let lineStart: number | undefined;
    let lineEnd: number | undefined;
    if (m[2] !== undefined) {
      lineStart = parseInt(m[2], 10);
      lineEnd = m[3] !== undefined ? parseInt(m[3], 10) : lineStart;
    } else if (m[4] !== undefined) {
      lineStart = parseInt(m[4], 10);
      lineEnd = m[5] !== undefined ? parseInt(m[5], 10) : lineStart;
    }
    if (map.has(file)) {
      const existing = map.get(file)!;
      if (lineStart !== undefined && existing.lineStart === undefined) {
        existing.lineStart = lineStart;
        existing.lineEnd = lineEnd;
      }
      continue;
    }
    const ev: WorkerEvidence = { file };
    if (lineStart !== undefined) {
      ev.lineStart = lineStart;
      ev.lineEnd = lineEnd;
    }
    map.set(file, ev);
  }
  return Array.from(map.values());
}

function extractImpact(body: string): string | undefined {
  const m = body.match(IMPACT_RE);
  return m ? m[1].trim() : undefined;
}

function extractConfidence(body: string): number | undefined {
  const m = body.match(CONFIDENCE_RE);
  if (!m) return undefined;
  const raw = m[1].toLowerCase();
  if (raw === 'high') return 0.9;
  if (raw === 'medium') return 0.6;
  if (raw === 'low') return 0.3;
  let n = parseFloat(raw.replace(/%/, ''));
  if (Number.isNaN(n)) return undefined;
  if (n > 1) n = n / 100; // percent → fraction
  if (n < 0) n = 0;
  if (n > 1) n = 1;
  return n;
}

function extractPriority(haystack: string): FindingPriority | undefined {
  const m = haystack.match(PRIORITY_RE);
  if (!m) return undefined;
  const p = parseInt(m[1], 10);
  if (p >= 0 && p <= 3) return `P${p}` as FindingPriority;
  return undefined;
}

function extractVerdict(body: string): FindingVerdict | undefined {
  const m = body.match(VERDICT_RE);
  if (!m) return undefined;
  const v = m[1].toUpperCase().replace(/\s+/g, '_');
  if (v === 'VERIFIED' || v === 'PARTIALLY_VERIFIED' || v === 'NOT_VERIFIED') return v;
  return undefined;
}

function extractExplanation(body: string): string | undefined {
  const m = body.match(EXPLANATION_RE);
  return m ? m[1].trim() : undefined;
}

function buildFinding(index: number, title: string, body: string): WorkerFinding {
  // Evidence/priority/confidence may appear in the title (bold-title format
  // carries prose on the header line) or the body — search both.
  const haystack = `${title}\n${body}`;
  const evidence = extractEvidence(haystack);
  const impact = extractImpact(body);
  const confidence = extractConfidence(haystack);
  const priority = extractPriority(haystack);
  const verdict = extractVerdict(body);
  const explanation = extractExplanation(body);

  const finding: WorkerFinding = {
    id: `finding-${index}`,
    title: title || `Finding ${index}`,
    evidence,
  };
  if (body) finding.description = body;
  if (impact) finding.impact = impact;
  if (confidence !== undefined) finding.confidence = confidence;
  if (priority) finding.priority = priority;
  if (verdict) finding.verdict = verdict;
  if (explanation) finding.explanation = explanation;
  return finding;
}

/**
 * Parse typed findings from natural-language worker result text.
 *
 * TRANSITIONAL — runs only at the worker completion boundary. Recognizes the
 * same numbered header styles as the legacy parser and stops at a decorated
 * non-finding section (e.g. "=== Additional observations ===").
 */
export function parseTypedFindingsFromText(text: string): WorkerFinding[] {
  if (!text || typeof text !== 'string') return [];

  const findings: WorkerFinding[] = [];
  const lines = text.split(/\r?\n/);

  let current: { index: number; title: string; body: string[] } | null = null;

  const flush = () => {
    if (current) {
      const body = current.body.join('\n').trim();
      findings.push(buildFinding(current.index, current.title, body));
      current = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const decorated = /^[=*#]/.test(line);
    const stripped = stripDecoration(line);
    const kw = stripped.match(KEYWORD_HEADER_RE);
    const num = kw ? null : stripped.match(NUMBERED_HEADER_RE);

    if (kw || num) {
      flush();
      let index: number;
      let title: string;
      let body: string[] = [];
      if (kw) {
        index = parseInt(kw[1], 10);
        title = cleanTitle(kw[2] || '');
      } else {
        index = parseInt(num![1], 10);
        const split = splitNumberedTitle(num![2] || '');
        title = cleanTitle(split.title);
        if (split.description) body = [split.description];
      }
      current = { index, title, body };
    } else if (decorated) {
      // A decorated line that is NOT a finding header (e.g. "=== Additional
      // observations ===") ends the findings section.
      break;
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();

  // Fallback: only when NO structured finding header was found.
  if (findings.length === 0 && text.trim().length > 20) {
    findings.push(buildFinding(1, 'Repository Inspection Finding', text.trim()));
  }

  return findings;
}

/**
 * Build the `structured_output` findings envelope for a completed result.
 * `source` records how the findings were derived at write time.
 */
export function buildStructuredFindings(
  findings: WorkerFinding[],
  source: FindingsSource,
): { findings: WorkerFinding[]; findingsSource: FindingsSource; findingsCount: number } {
  return {
    findings,
    findingsSource: source,
    findingsCount: findings.length,
  };
}
