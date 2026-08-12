/**
 * GateRunner v1 — gate contract (RunLedger + GateRunner milestone).
 *
 * A gate is executable and produces evidence. It is NOT a checklist string.
 * Gates run under policy: configured/approved commands, workspace-root cwd,
 * per-gate timeout, cancellation, no secret dumps.
 */

export type GateResultStatus = 'passed' | 'failed' | 'pending' | 'skipped';

export interface GateResult {
  gateId: string;
  passed: boolean;
  /** 'pending' for human-approval gates awaiting explicit approval. */
  status: GateResultStatus;
  score?: number;
  reason: string;
  /** Short evidence strings — never raw giant logs; pointers preferred. */
  evidence?: string[];
  /** Exit code for command gates. */
  exitCode?: number | null;
  /** Command/check performed. */
  command?: string | null;
  /** Optional pointer to a persisted log/artifact path. */
  logPath?: string | null;
  /** Retry attempt number (1-based). */
  attempt: number;
  startedAt: string;
  completedAt: string;
}

export interface GateContext {
  runId: string;
  taskId?: string;
  projectId?: string;
  workspacePath?: string;
  /** Existing task artifacts (files_changed etc.) available to gates. */
  artifacts?: string[];
  /** Command allowlist (policy) — gates may only run approved command shapes. */
  allowedCommands?: string[];
  /** Abort signal — cancellation during verification stops gates where possible. */
  signal?: AbortSignal;
  /** Gate-level metadata passed by the task config. */
  config?: Record<string, unknown>;
}

export interface GateConfig {
  type: 'command' | 'build' | 'file-exists' | 'json-schema' | 'human-approval';
  id: string;
  /** Optional human-readable name. */
  name?: string;
  required?: boolean;
  retryOnFail?: boolean;
  maxRetries?: number;
  /** For command/build gates: the command to run. */
  command?: string;
  /** For file-exists gates: relative path (resolved against workspaceRoot). */
  path?: string;
  /** For json-schema gates: required fields or a JSON-schema-like spec. */
  schema?: { requiredFields?: string[]; filePath?: string; pointer?: string };
  /** For human-approval gates: reason shown to the human. */
  reason?: string;
  /** Optional timeout in ms (default GATE_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Extra metadata (e.g. expected output file for build gates). */
  [k: string]: unknown;
}

export interface Gate {
  id: string;
  name: string;
  required: boolean;
  retryOnFail?: boolean;
  maxRetries?: number;
  run(context: GateContext): Promise<GateResult>;
}

export interface GateSetResult {
  runId: string;
  taskId?: string;
  results: GateResult[];
  allRequiredPassed: boolean;
  anyFailed: boolean;
  startedAt: string;
  completedAt: string;
}

export const GATE_TIMEOUT_MS = 120_000;

/** Default policy allowlist — command gates may only run these shapes. */
export const DEFAULT_ALLOWED_COMMANDS = [
  'npm test',
  'npm run test',
  'npm run build',
  'npm run typecheck',
  'npx tsc',
  'npx vitest',
  'node --test',
  'npm run lint',
];
