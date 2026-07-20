import { ZodError } from 'zod';
import { TeamSheet, teamSheetSchema } from '../../types/teamSheet.js';

export class LLMSchemaValidationError extends Error {
  public attempts: number;
  public issues: Array<{ path: string, expected: string, received: string }>;
  
  constructor(message: string, issues: Array<{ path: string, expected: string, received: string }>, attempts: number) {
    super(message);
    this.name = 'LLMSchemaValidationError';
    this.issues = issues;
    this.attempts = attempts;
  }
}

/**
 * Extracts a JSON block from a string containing markdown fences or leading/trailing text.
 * Rejects multiple JSON objects.
 */
export function extractJsonFromMarkdown(jsonStr: string): string {
  let cleaned = jsonStr.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '');
    cleaned = cleaned.replace(/\s*```$/, '');
  }
  
  // Extract the first JSON object using a basic brace matching algorithm
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) {
    throw new Error('No JSON object found.');
  }

  let braceCount = 0;
  let endIdx = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
  }

  if (endIdx === -1) {
    throw new Error('Truncated or malformed JSON object.');
  }

  const extracted = cleaned.substring(startIdx, endIdx + 1);

  // Check if there's another object afterwards
  const remainder = cleaned.substring(endIdx + 1).trim();
  if (remainder.includes('{')) {
    throw new Error('Multiple JSON objects found. Provide exactly one.');
  }

  return extracted;
}

/**
 * Normalizes low-risk fields before validation.
 * e.g., fixing acceptanceCriteria which is often hallucinated as objects.
 */
export function normalizeTeamSheetCandidate(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input; // Not an object, let Zod handle the failure
  }

  const obj = input as Record<string, unknown>;

  // Safe normalization of acceptanceCriteria
  if (obj.acceptanceCriteria) {
    if (Array.isArray(obj.acceptanceCriteria)) {
      obj.acceptanceCriteria = obj.acceptanceCriteria.reduce<string[]>((acc, item) => {
        let strVal: string | null = null;
        
        if (typeof item === 'string') {
          strVal = item.trim();
        } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          // Normalize `{ text: string }` or `{ criterion: string }` or `{ description: string }`
          const asRecord = item as Record<string, unknown>;
          if (typeof asRecord.text === 'string') {
            strVal = asRecord.text.trim();
          } else if (typeof asRecord.criterion === 'string') {
            strVal = asRecord.criterion.trim();
          } else if (typeof asRecord.description === 'string') {
            strVal = asRecord.description.trim();
          }
        }
        
        if (strVal && strVal.length > 0) {
          acc.push(strVal);
        }
        return acc;
      }, []);
    } else if (typeof obj.acceptanceCriteria === 'string') {
      const trimmed = obj.acceptanceCriteria.trim();
      obj.acceptanceCriteria = trimmed ? [trimmed] : [];
    } else {
      // Reject numbers, booleans, null, nested arrays, etc.
      // Set to an empty array so Zod or logic can decide if it's valid.
      // Wait, if it's invalid, we should leave it as is so Zod throws a meaningful error!
      // If we set it to [], Zod might accept it if it defaults to []. We should leave it.
    }
  }

  return obj;
}

/**
 * Parses, normalizes, and validates the candidate JSON.
 * Throws LLMSchemaValidationError if it fails Zod validation.
 */
export function processTeamSheetCandidate(jsonStr: string, attempts: number = 1): TeamSheet {
  let parsed: unknown;
  try {
    const extracted = extractJsonFromMarkdown(jsonStr);
    parsed = JSON.parse(extracted);
  } catch (err: any) {
    throw new LLMSchemaValidationError(`Invalid JSON syntax: ${err.message}`, [], attempts);
  }

  const normalized = normalizeTeamSheetCandidate(parsed);

  try {
    const valid = teamSheetSchema.parse(normalized);
    return valid;
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map(i => ({
        path: i.path.join('.'),
        expected: (i as any).expected || 'valid format',
        received: (i as any).received || 'invalid format'
      }));
      console.error("Zod Error details:", JSON.stringify(issues, null, 2));
      throw new LLMSchemaValidationError('The model could not produce a valid TeamSheet.', issues, attempts);
    }
    throw new LLMSchemaValidationError(`Unknown validation error: ${(err as Error).message}`, [], attempts);
  }
}
