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
    const start = Date.now();
    const emitter = new EventEmitter();
    const controller = new AbortController();
    const runKey = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const args: string[] = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    if (opts.sandboxMode) args.push('-s', opts.sandboxMode);
    if (opts.model) args.push('-m', opts.model);
    // NOTE: Codex 0.145.0 has NO --model-provider flag (only --local-provider);
    // the provider is selected by the CODEX_HOME config.toml `model_provider`
    // key, which buildCodexOptions writes for DeepSeek.
    for (const [k, v] of Object.entries(opts.configOverrides || {})) {
      args.push('-c', `${k}=${JSON.stringify(v)}`);
    }
    args.push('-C', opts.workdir);
    args.push(opts.prompt);

    // Sanitized env: keep OS essentials; drop secret-ish vars; inject scoped provider env.
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH || '',
      SYSTEMROOT: process.env.SYSTEMROOT || 'C:\\Windows',
      WINDIR: process.env.WINDIR || 'C:\\Windows',
      TEMP: process.env.TEMP || '',
      TMP: process.env.TMP || '',
      HOME: process.env.HOME || process.env.USERPROFILE || '',
      USERPROFILE: process.env.USERPROFILE || '',
      CODEX_HOME: opts.codexHome || process.env.CODEX_HOME || '',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
    };
    for (const [k, v] of Object.entries(opts.providerConfig || {})) {
      if (k && v) env[k] = v;
    }

    logger.info(`[CodexRuntimeAdapter] spawn codex exec in ${opts.workdir} sandbox=${opts.sandboxMode || 'workspace-write'} timeout=${opts.timeoutMs || 300000}`);

    const spawnArgs = [...CODEX_CMD.argsPrefix, ...args];
    const child = spawn(CODEX_CMD.command, spawnArgs, { cwd: opts.workdir, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    this.active.set(runKey, { child, emitter });

    const promise = new Promise<CodexRunResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const secrets = Object.values(opts.providerConfig || {}).filter(Boolean);
      const events: Record<string, unknown>[] = [];
      const eventTail: CodexEventTailItem[] = [];
      const commands: CodexCommandEvent[] = [];
      const agentMessages: string[] = [];

      const timeout = opts.timeoutMs
        ? setTimeout(() => {
            if (!settled) {
              child.kill('SIGTERM');
              resolve({ exitCode: 124, status: 'timeout', events, eventTail, commands, agentMessages, error: `Codex timed out after ${opts.timeoutMs}ms`, durationMs: Date.now() - start });
              settled = true;
            }
          }, opts.timeoutMs)
        : null;

      const parseLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;
        try {
          const ev = JSON.parse(trimmed);
          events.push(ev);
          // Bounded, redacted event tail for diagnostics (tool blocks, etc.).
          if (ev.type === 'item.completed') {
            const item = ev.item || {};
            const redact = (v: unknown) => redactOutput(String(v ?? ''), secrets).slice(0, 300);
            eventTail.push({
              itemType: item.type || '',
              toolName: item.name || item.tool_name || '',
              status: item.status || '',
              exitCode: item.exit_code ?? null,
              summary: redact(item.text || item.error || item.aggregated_output || ''),
              at: new Date().toISOString(),
            });
            if (eventTail.length > 30) eventTail.shift();
          }
          if (ev.type === 'thread.started') emitter.emit('thread.started', ev);
          if (ev.type === 'item.completed') {
            const item = ev.item || {};
            if (item.type === 'command_execution') {
              commands.push({
                command: item.command || '',
                aggregatedOutput: redactOutput(String(item.aggregated_output || ''), secrets).slice(0, 2000),
                exitCode: item.exit_code ?? null,
                status: item.status || '',
              });
            }
            if (item.type === 'agent_message') {
              agentMessages.push(redactOutput(String(item.text || ''), secrets));
            }
          }
          if (ev.type === 'turn.completed') {
            emitter.emit('turn.completed', ev);
          }
        } catch { /* non-JSON noise */ }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        const lines = stdout.split(/\r?\n/);
        stdout = lines.pop() || '';
        for (const l of lines) parseLine(l);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      controller.signal.addEventListener('abort', () => {
        if (!settled) {
          child.kill('SIGTERM');
          resolve({ exitCode: 130, status: 'cancelled', events, eventTail, commands, agentMessages, error: 'Cancelled', durationMs: Date.now() - start });
          settled = true;
        }
      });

      child.on('error', (err) => {
        if (!settled) {
          resolve({ exitCode: 1, status: 'error', events, eventTail, commands, agentMessages, error: `Spawn error: ${err.message}`, durationMs: Date.now() - start });
          settled = true;
        }
      });

      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        if (settled) return;
        // Flush remaining buffered lines.
        if (stdout.trim()) {
          for (const l of stdout.split(/\r?\n/)) parseLine(l);
        }
        const lastUsage = events.filter((e) => (e as any).type === 'turn.completed').pop() as any;
        const usage: CodexTurnUsage | undefined = lastUsage?.usage ? {
          inputTokens: lastUsage.usage.input_tokens,
          cachedInputTokens: lastUsage.usage.cached_input_tokens,
          outputTokens: lastUsage.usage.output_tokens,
          reasoningOutputTokens: lastUsage.usage.reasoning_output_tokens,
        } : undefined;
        resolve({
          exitCode: code ?? 1,
          status: code === 0 ? 'completed' : 'failed',
          events,
          eventTail,
          commands,
          agentMessages,
          usage,
          error: code !== 0 ? (redactOutput(stderr, secrets).slice(0, 1000) || `exit code ${code}`) : undefined,
          durationMs: Date.now() - start,
        });
        settled = true;
      });
    });

    return { promise, cancel: () => controller.abort() };
  }
}

export const codexRuntimeAdapter = new CodexRuntimeAdapter();
