/**
 * domains/codingRuntime/codexRuntimeAdapter.ts — Codex CLI execution boundary
 * (Phase 7).
 *
 * Drives the REAL installed Codex CLI (>= 0.145.0) via its structured
 * non-interactive interface:
 *
 *   codex exec --json --ephemeral -s <sandbox> -C <workdir> <prompt>
 *
 * JSONL events on stdout are parsed into structured records. The adapter:
 *  - uses ARGUMENT ARRAYS (never shell-concatenated strings)
 *  - sanitizes the environment (strips production secrets; injects only a
 *    scoped provider key when explicitly configured)
 *  - supports cancellation (SIGTERM via child.kill; Windows tree handled by
 *    the caller's process manager)
 *  - enforces a bounded timeout
 *  - captures commands (item.completed command_execution), usage, exit code
 *
 * No Codex CLI process details leak outside this adapter.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../utils/logger.js';

/**
 * Resolve the real Codex CLI entry point on Windows (where `codex` is a
 * `.cmd` shim that Node's spawn with shell:false cannot execute). Returns
 * `{ command, argsPrefix }` for spawning `node <codex.js> ...` — argument
 * arrays only, no shell. Falls back to `codex` on PATH for non-Windows.
 */
function resolveCodexCommand(): { command: string; argsPrefix: string[] } {
  try {
    if (process.platform === 'win32') {
      // npm's global prefix from env or the standard Windows location.
      const npmPrefix = process.env.npm_config_prefix
        || path.join(process.env.APPDATA || process.env.USERPROFILE || '', 'npm');
      const npmRoot = path.join(npmPrefix, 'node_modules');
      const candidates = [
        path.join(npmRoot, '@openai', 'codex', 'bin', 'codex.js'),
        path.join(npmRoot, 'codex', 'bin', 'codex.js'),
        // Fallback: the package's own node_modules layout (doctor output).
        path.join(npmRoot, '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          const isExe = c.toLowerCase().endsWith('.exe');
          return isExe ? { command: c, argsPrefix: [] } : { command: process.execPath, argsPrefix: [c] };
        }
      }
    }
  } catch { /* fall through */ }
  return { command: 'codex', argsPrefix: [] };
}

const CODEX_CMD = resolveCodexCommand();

export interface CodexRunOptions {
  workdir: string;
  prompt: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  model?: string;
  modelProvider?: string;
  providerConfig?: Record<string, string>; // scoped env vars for the provider (e.g. DEEPSEEK_API_KEY)
  codexHome?: string;                      // custom CODEX_HOME (spike config)
  timeoutMs?: number;
  /** Extra config overrides passed as -c key=value pairs. */
  configOverrides?: Record<string, string>;
}

export interface CodexCommandEvent {
  command: string;
  aggregatedOutput: string;
  exitCode: number | null;
  status: string;
}

export interface CodexTurnUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface CodexEventTailItem {
  itemType: string;
  toolName: string;
  status: string;
  exitCode: number | null;
  summary: string;
  at: string;
}

export interface CodexRunResult {
  threadId?: string;
  turnId?: string;
  exitCode: number;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout' | 'error';
  events: Record<string, unknown>[];
  eventTail: CodexEventTailItem[];
  commands: CodexCommandEvent[];
  agentMessages: string[];
  usage?: CodexTurnUsage;
  error?: string;
  durationMs: number;
}

function redactOutput(text: string, secrets: string[]): string {
  let out = text || '';
  for (const s of secrets) {
    if (s && s.length >= 4) {
      out = out.split(s).join('[REDACTED]');
    }
  }
  return out;
}

export class CodexRuntimeAdapter {
  private active = new Map<string, { child: ChildProcess; emitter: EventEmitter }>();

  /**
   * Run Codex non-interactively in the given workdir.
   * Resolves with structured results; throws on spawn failure.
   */
  runCodex(opts: CodexRunOptions): { promise: Promise<CodexRunResult>; cancel: () => void } {
    // HARD INVARIANT: CODEX_INVOCATION_DISABLED=true
    // No execution path is permitted to spawn codex, codex exec, or OpenAI-backed tools.
    logger.warn('[CodexRuntimeAdapter] Blocked codex exec spawn attempt: CODEX_INVOCATION_DISABLED=true.');
    return {
      promise: Promise.resolve({
        status: 'failed',
        exitCode: 1,
        durationMs: 0,
        events: [],
        eventTail: [],
        commands: [],
        agentMessages: [],
        error: 'CODEX_INVOCATION_DISABLED=true: Codex execution is permanently disabled. Route through Hermes.',
      }),
      cancel: () => {},
    };
  }
}

export const codexRuntimeAdapter = new CodexRuntimeAdapter();
