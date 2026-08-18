import { logger } from '../../utils/logger.js';
import { ZodError } from 'zod';
import { TeamSheet, teamSheetSchema } from '../../types/teamSheet.js';

export class LLMSchemaValidationError extends Error {
  public attempts: number;
  public issues: Array<{ path: string, expected: string, received: string, message?: string }>;
  
  constructor(message: string, issues: Array<{ path: string, expected: string, received: string, message?: string }>, attempts: number) {
    super(message);
    this.name = 'LLMSchemaValidationError';
    this.issues = issues;
    this.attempts = attempts;
  }
}

/**
 * Extracts the first complete JSON object from a model response.
 * Accepts plain JSON, fenced JSON (```json / ```), and JSON embedded in prose.
 * Trailing prose after the object is ignored; a missing or truncated object fails.
 */
export function extractJsonFromMarkdown(jsonStr: string): string {
  let cleaned = jsonStr.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '');
    cleaned = cleaned.replace(/\s*```\s*$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '');
    cleaned = cleaned.replace(/\s*```\s*$/, '');
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

  if (cleaned.slice(endIdx + 1).includes('{')) {
    throw new Error('Multiple JSON objects found.');
  }

  return cleaned.substring(startIdx, endIdx + 1);
}

/** Top-level field-name aliases the model commonly produces. */
const SHEET_ALIASES: Record<string, string> = {
  team_name: 'teamName',
  workspace_root: 'workspaceRoot',
  execution_sequence: 'executionSequence',
  acceptance_criteria: 'acceptanceCriteria',
  estimated_parallelism: 'estimatedParallelism',
  approval_required: 'approvalRequired',
  approval_policy: 'approvalPolicy'
};

/** Per-agent field-name aliases. */
const AGENT_ALIASES: Record<string, string> = {
  allowed_tools: 'allowedTools',
  read_scopes: 'readScopes',
  write_scopes: 'writeScopes',
  output_artifacts: 'outputArtifacts',
  deps: 'dependencies'
};

const KNOWN_ROLES = new Set(['planner', 'builder', 'verifier']);

function titleCaseRole(role: unknown): unknown {
  if (typeof role !== 'string') return role;
  const lower = role.trim().toLowerCase();
  if (KNOWN_ROLES.has(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1);
  return role;
}

/**
 * Convert a path that points INSIDE the workspace root into a workspace-
 * relative path. Models frequently emit absolute paths (e.g. "B:/Repo/out/")
 * when they mean workspace-relative ones ("out/"). Paths outside the
 * workspace are returned unchanged so the schema can reject them honestly.
 */
function relativizeToWorkspace(p: unknown, workspaceRoot?: string): unknown {
  if (typeof p !== 'string' || !workspaceRoot) return p;
  const normPath = p.replace(/\\/g, '/');
  const normRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normPath.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) {
    return normPath.slice(normRoot.length + 1);
  }
  return p;
}

function relativizeList(value: unknown, workspaceRoot?: string): unknown {
  if (!Array.isArray(value)) return value;
  return value.map(item => relativizeToWorkspace(item, workspaceRoot));
}

function applyAliases(obj: Record<string, unknown>, aliases: Record<string, string>) {
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (obj[canonical] === undefined && obj[alias] !== undefined) {
      obj[canonical] = obj[alias];
      delete obj[alias];
    }
  }
}

/**
 * Normalizes ONLY known-harmless variations before validation:
 * - common snake_case field-name aliases (top level and per agent)
 * - role casing ('builder' → 'Builder')
 * - missing optional arrays → []
 * - acceptanceCriteria given as a string or as objects ({text|criterion|description})
 * It never invents required agents, roles, or acceptance criteria — anything
 * structurally missing is left for the schema to reject with precise errors.
 */
export function normalizeTeamSheetCandidate(input: unknown, workspaceRoot?: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input; // Not an object, let Zod handle the failure
  }

  const obj = input as Record<string, unknown>;
  applyAliases(obj, SHEET_ALIASES);

  // Missing optional arrays → []
  if (obj.handoffs === undefined) obj.handoffs = [];
  if (obj.acceptanceCriteria === undefined) obj.acceptanceCriteria = [];

  // Per-agent normalization
  if (Array.isArray(obj.agents)) {
    obj.agents = obj.agents.map((agent: any) => {
      if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return agent;
      const a = { ...agent };
      applyAliases(a, AGENT_ALIASES);
      a.role = titleCaseRole(a.role);
      for (const field of ['responsibilities', 'dependencies', 'allowedTools', 'readScopes', 'writeScopes', 'outputArtifacts']) {
        if (a[field] === undefined) a[field] = [];
      }
      // Models often emit workspace-absolute paths where relative ones are required.
      a.readScopes = relativizeList(a.readScopes, workspaceRoot);
      a.writeScopes = relativizeList(a.writeScopes, workspaceRoot);
      a.outputArtifacts = relativizeList(a.outputArtifacts, workspaceRoot);
      return a;
    });
  }

  // Handoff artifact paths get the same treatment.
  if (Array.isArray(obj.handoffs)) {
    obj.handoffs = obj.handoffs.map((h: any) => {
      if (!h || typeof h !== 'object') return h;
      return { ...h, artifact: relativizeToWorkspace(h.artifact, workspaceRoot) };
    });
  }

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
    }
  }

  return obj;
}

/**
 * Parses, normalizes, and validates the candidate JSON with safeParse.
 * Throws LLMSchemaValidationError carrying detailed, readable issues
 * (path, expected, received, message) on any failure.
 */
export function processTeamSheetCandidate(jsonStr: string, attempts: number = 1, workspaceRoot?: string): TeamSheet {
  let parsed: unknown;
  try {
    const extracted = extractJsonFromMarkdown(jsonStr);
    parsed = JSON.parse(extracted);
  } catch (err: any) {
    throw new LLMSchemaValidationError(`Invalid JSON syntax: ${err.message}`, [{
      path: '(json)', expected: 'valid JSON object', received: 'unparseable text', message: err.message
    }], attempts);
  }

  const normalized = normalizeTeamSheetCandidate(parsed, workspaceRoot);

  const result = teamSheetSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues.map(i => ({
      path: i.path.length > 0 ? i.path.join('.') : '(root)',
      expected: String((i as any).expected ?? 'valid value'),
      received: String((i as any).received ?? 'invalid value'),
      message: i.message
    }));
    logger.error('[schemaRecovery] TeamSheet validation issues:', JSON.stringify(issues));
    throw new LLMSchemaValidationError('The model could not produce a valid TeamSheet.', issues, attempts);
  }
  return result.data;
}

/**
 * Renders validation issues as a compact, UI-safe one-line summary.
 * e.g. "agents.0.role: Invalid input: expected 'Planner' | (root): Exactly one Verifier must exist"
 */
export function summarizeValidationIssues(issues: Array<{ path: string; message?: string; expected?: string; received?: string }>, max = 4): string {
  if (!issues || issues.length === 0) return 'unknown validation issue';
  const rendered = issues.slice(0, max).map(i => `${i.path}: ${i.message || `expected ${i.expected}, received ${i.received}`}`);
  const suffix = issues.length > max ? ` (+${issues.length - max} more)` : '';
  return rendered.join(' | ') + suffix;
}
