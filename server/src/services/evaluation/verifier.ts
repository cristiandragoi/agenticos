/**
 * evaluation/verifier.ts — deterministic assertion engine (C4).
 *
 * For deterministic cases, explicit assertions grade the model output —
 * never the model grading itself. Subjective cases can delegate to the
 * canonical verification service; the runner decides which verifier applies.
 */
import type { EvalAssertion } from './types.js';

export interface AssertionResult {
  description: string;
  passed: boolean;
  detail?: string;
}

function normalize(text: string): string {
  return (text || '').toLowerCase();
}

/** Validate that a string is parseable JSON (object or array). */
export function isValidJson(text: string): boolean {
  const t = (text || '').trim();
  // Strip a single code fence if present.
  const cleaned = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!cleaned) return false;
  try {
    const parsed = JSON.parse(cleaned);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

/** Extract the first JSON object/array from a text blob. */
export function extractJson(text: string): any | null {
  const t = (text || '').trim();
  const cleaned = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function runAssertions(output: string, assertions: EvalAssertion[]): AssertionResult[] {
  return assertions.map((a) => {
    const desc = a.description || a.kind;
    switch (a.kind) {
      case 'contains': {
        const passed = normalize(output).includes(normalize(a.value));
        return { description: desc, passed, detail: passed ? undefined : `missing "${a.value}"` };
      }
      case 'not_contains': {
        const present = normalize(output).includes(normalize(a.value));
        return { description: desc, passed: !present, detail: present ? `unexpected "${a.value}"` : undefined };
      }
      case 'exact_field': {
        const obj = extractJson(output);
        if (obj && typeof obj === 'object' && a.value in obj) {
          return { description: desc, passed: true };
        }
        return { description: desc, passed: false, detail: `JSON missing field "${a.value}"` };
      }
      case 'valid_json': {
        const passed = isValidJson(output);
        return { description: desc, passed, detail: passed ? undefined : 'output is not valid JSON' };
      }
      case 'tool_selected': {
        // Tool name present near the top of the output, or as a bare token.
        const passed = normalize(output).includes(normalize(a.value));
        return { description: desc, passed, detail: passed ? undefined : `tool "${a.value}" not selected` };
      }
      case 'forbidden_hallucination': {
        const present = normalize(output).includes(normalize(a.value));
        return { description: desc, passed: !present, detail: present ? `hallucinated "${a.value}"` : undefined };
      }
      case 'url_title': {
        const passed = normalize(output).includes(normalize(a.value));
        return { description: desc, passed, detail: passed ? undefined : `expected title "${a.value}"` };
      }
      default:
        return { description: desc, passed: false, detail: `unknown assertion kind ${a.kind}` };
    }
  });
}
