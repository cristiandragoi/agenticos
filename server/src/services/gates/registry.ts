/**
 * GateRunner v1 — built-in gate implementations (RunLedger + GateRunner milestone).
 *
 * Policy: command gates run only allowlisted command shapes, in the
 * workspace root, with a timeout and cancellation; evidence captures exit
 * code + a short summary — never environment dumps or raw giant logs.
 */
import { spawn } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GATE_TIMEOUT_MS, DEFAULT_ALLOWED_COMMANDS } from './types.js';
import type { Gate, GateConfig, GateContext, GateResult } from './types.js';

export const SUMMARY_TAIL = 400;

/** Run a command under policy; returns exit code + captured tail. */
export async function runCommandUnderPolicy(
  command: string,
  ctx: GateContext,
  timeoutMs = GATE_TIMEOUT_MS,
): Promise<{ exitCode: number | null; stdoutTail: string; stderrTail: string; timedOut: boolean; signal?: string }> {
  // Policy: only allowlisted command shapes (P8/P24). Commands are
  // configured/known — never arbitrary untrusted model output.
  const allowed = (ctx.allowedCommands?.length ? ctx.allowedCommands : DEFAULT_ALLOWED_COMMANDS);
  const shape = command.trim().split(/\s+/).slice(0, 3).join(' ');
  if (!allowed.some((a) => command.trim().startsWith(a))) {
    throw new Error(`Gate command not on the policy allowlist: ${shape}…`);
  }
  const cwd = ctx.workspacePath || process.cwd();
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    child.stdout.on('data', (d) => {
      out.push(String(d));
      if (out.join('').length > 8000) { out.length = 0; out.push('[stdout truncated]'); }
    });
    child.stderr.on('data', (d) => {
      err.push(String(d));
      if (err.join('').length > 8000) { err.length = 0; err.push('[stderr truncated]'); }
    });
    child.on('error', (e) => reject(e));
    let settled = false;
    const settle = (code: number | null) => { if (!settled) { settled = true; resolve(code); } };
    child.on('close', (code, sig) => settle(code ?? (sig ? null : 1)));
    // Timeout + cancellation (P15/P24). Windows caveat: with shell:true,
    // killing cmd.exe leaves the npm/node subtree alive holding the stdio
    // pipes, so 'close' may never fire — settle IMMEDIATELY on abort and kill
    // the whole process tree (taskkill /T) as best effort.
    const abort = () => {
      settle(null);
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill();
        }
      } catch { /* best effort */ }
    };
    if (ctx.signal?.aborted) { abort(); return; }
    ctx.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    child.once('close', () => clearTimeout(timer));
  });
  const tail = (arr: string[]) => arr.join('').slice(-SUMMARY_TAIL).trim();
  return { exitCode, stdoutTail: tail(out), stderrTail: tail(err), timedOut: exitCode === null };
}

function ts(): string { return new Date().toISOString(); }

/** P7-A — command gate (e.g. `npm test -- <target>`). */
export function commandGate(cfg: GateConfig): Gate {
  return {
    id: cfg.id,
    name: cfg.name || cfg.id,
    required: cfg.required !== false,
    retryOnFail: cfg.retryOnFail,
    maxRetries: cfg.maxRetries,
    async run(ctx: GateContext): Promise<GateResult> {
      const startedAt = ts();
      const command = cfg.command || '';
      try {
        const r = await runCommandUnderPolicy(command, ctx, cfg.timeoutMs || GATE_TIMEOUT_MS);
        const passed = r.exitCode === 0;
        const reason = r.timedOut
          ? `Gate timed out after ${(cfg.timeoutMs || GATE_TIMEOUT_MS) / 1000}s.`
          : passed ? 'Command exited 0.' : `Command exited ${r.exitCode}.`;
        const evidence = [command];
        if (r.stdoutTail) evidence.push(`stdout: ${r.stdoutTail.slice(0, 300)}`);
        if (r.stderrTail && !passed) evidence.push(`stderr: ${r.stderrTail.slice(0, 300)}`);
        return { gateId: cfg.id, passed, status: passed ? 'passed' : 'failed', reason, evidence, exitCode: r.exitCode, command, attempt: 1, startedAt, completedAt: ts() };
      } catch (e: any) {
        return { gateId: cfg.id, passed: false, status: 'failed', reason: e?.message || 'Gate error.', exitCode: null, command, attempt: 1, startedAt, completedAt: ts() };
      }
    },
  };
}

/** P7-B — build gate (pass only on exit 0). */
export function buildGate(cfg: GateConfig): Gate {
  const base = commandGate({ ...cfg, command: cfg.command || 'npm run build', id: cfg.id, type: 'command' });
  return { ...base, name: cfg.name || 'server-build' };
}

/** P7-C — file exists gate. */
export function fileExistsGate(cfg: GateConfig): Gate {
  return {
    id: cfg.id,
    name: cfg.name || cfg.id,
    required: cfg.required !== false,
    async run(ctx: GateContext): Promise<GateResult> {
      const startedAt = ts();
      const rel = cfg.path || '';
      const abs = ctx.workspacePath ? path.resolve(ctx.workspacePath, rel) : rel;
      try {
        const st = await stat(abs);
        const passed = st.isFile() || st.isDirectory();
        return {
          gateId: cfg.id, passed, status: passed ? 'passed' : 'failed',
          reason: passed ? `Exists: ${rel}` : `Missing: ${rel}`,
          evidence: [`${abs}`, passed ? `size ${st.size} bytes` : 'not found'],
          attempt: 1, startedAt, completedAt: ts(),
        };
      } catch {
        return { gateId: cfg.id, passed: false, status: 'failed', reason: `Missing: ${rel}`, evidence: [`${abs}`, 'not found'], attempt: 1, startedAt, completedAt: ts() };
      }
    },
  };
}

/** P7-D — JSON structure gate (required fields; no giant schema framework). */
export function jsonSchemaGate(cfg: GateConfig): Gate {
  return {
    id: cfg.id,
    name: cfg.name || cfg.id,
    required: cfg.required !== false,
    async run(ctx: GateContext): Promise<GateResult> {
      const startedAt = ts();
      const rel = cfg.schema?.filePath || cfg.path || '';
      const abs = ctx.workspacePath ? path.resolve(ctx.workspacePath, rel) : rel;
      const requiredFields = cfg.schema?.requiredFields || [];
      try {
        const raw = await readFile(abs, 'utf8');
        const data = JSON.parse(raw);
        const ptr = cfg.schema?.pointer || '';
        const node = ptr ? ptr.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), data) : data;
        const missing = requiredFields.filter((f) => node?.[f] === undefined);
        const passed = missing.length === 0;
        return {
          gateId: cfg.id, passed, status: passed ? 'passed' : 'failed',
          reason: passed ? `Schema OK (${requiredFields.length} field(s)).` : `Missing field(s): ${missing.join(', ')}`,
          evidence: [`${abs}`, missing.length ? `missing: ${missing.join(', ')}` : `present: ${requiredFields.join(', ')}`],
          attempt: 1, startedAt, completedAt: ts(),
        };
      } catch (e: any) {
        return { gateId: cfg.id, passed: false, status: 'failed', reason: `Cannot read/parse ${rel}: ${e?.message}`, evidence: [`${abs}`], attempt: 1, startedAt, completedAt: ts() };
      }
    },
  };
}

/** P7-E — human approval gate. Never auto-passes. The approval registry
 *  resolves it via explicit human action; until then the result is pending
 *  and REQUIRED pending gates block completion. */
export function humanApprovalGate(cfg: GateConfig): Gate {
  return {
    id: cfg.id,
    name: cfg.name || cfg.id,
    required: cfg.required !== false,
    async run(ctx: GateContext): Promise<GateResult> {
      const startedAt = ts();
      const approved = ctx.config?.approved === true || ctx.config?.approveOverride === true;
      const reason = cfg.reason || `Awaiting human approval for ${cfg.id}.`;
      if (approved) {
        return { gateId: cfg.id, passed: true, status: 'passed', reason: 'Approved by human.', evidence: [reason], attempt: 1, startedAt, completedAt: ts() };
      }
      return { gateId: cfg.id, passed: false, status: 'pending', reason, evidence: [reason], attempt: 1, startedAt, completedAt: ts() };
    },
  };
}

export function buildGateFromConfig(cfg: GateConfig): Gate {
  switch (cfg.type) {
    case 'build': return buildGate(cfg);
    case 'file-exists': return fileExistsGate(cfg);
    case 'json-schema': return jsonSchemaGate(cfg);
    case 'human-approval': return humanApprovalGate(cfg);
    case 'command':
    default: return commandGate(cfg);
  }
}
