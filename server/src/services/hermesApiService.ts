/**
 * Hermes Live-Run Adapter — the SINGLE AgenticOS backend bridge to the
 * installed Hermes API server (gateway api_server platform).
 *
 * Verified against Hermes Agent v0.20.0 (gateway/platforms/api_server.py):
 *   POST /v1/runs                    — start a run (202 {run_id,...})
 *   GET  /v1/runs/{run_id}           — run status
 *   GET  /v1/runs/{run_id}/events    — SSE lifecycle events
 *   POST /v1/runs/{run_id}/approval  — {choice: once|session|always|deny}
 *   POST /v1/runs/{run_id}/stop      — interrupt
 *
 * Auth: Bearer API_SERVER_KEY, resolved at runtime (never hardcoded, never
 * logged): env HERMES_API_KEY wins, else the Hermes profile .env file.
 *
 * No second server, no new port — this runs inside the existing backend
 * on port 4000 and is mounted by routers/hermesApi.ts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { localDataPort } from '../adapters/localDataPort.js';
import { routingLedger } from './routingLedger.js';
import { logger } from '../utils/logger.js';
import { normalizeApprovalAction } from './backgroundTasks/approvalNormalization.js';

export type HermesRunStatus =
  | 'queued' | 'running' | 'waiting_for_approval' | 'stopping'
  | 'completed' | 'failed' | 'cancelled' | 'unknown';

export interface HermesActivityEvent {
  id: string;
  runId: string;
  ts: number;
  /** Normalized AgenticOS event kind (UI contract). */
  kind:
    | 'run.created' | 'run.started' | 'status.changed'
    | 'tool.started' | 'tool.completed' | 'tool.failed'
    | 'approval.request' | 'approval.responded'
    | 'file.changed' | 'terminal.command'
    | 'assistant.delta' | 'assistant.completed'
    | 'run.completed' | 'error' | 'done';
  summary: string;
  detail?: Record<string, unknown>;
}

export interface HermesRunRecord {
  id: string;                 // AgenticOS run id (kanban-linked)
  hermesRunId: string;        // upstream /v1/runs id
  cardId: string | null;      // linked Board card
  prompt: string;
  status: HermesRunStatus;
  provider: string;
  model: string;
  errorMessage?: string;      // upstream failure detail (run.failed / error)
  events: HermesActivityEvent[];
  pendingApproval: { action?: string; reason?: string; command?: string; files?: string[]; choices?: string[] } | null;
  finalText: string;
  createdAt: number;
  updatedAt: number;
}

const HERMES_PROFILE = process.env.HERMES_PROFILE || 'backend-engineer';
const MAX_EVENTS_PER_RUN = 200;

/**
 * Run model routing. The gateway's /v1/models exposes the PROFILE id (e.g.
 * "backend-engineer") as the runnable model — a run with `model: <profile>`
 * and NO provider uses the profile's configured provider/model (config.yaml
 * model.provider). Provider+model overrides remain available via env for
 * explicit routing. NOTE: a provider name that the installed Hermes gateway
 * does not know (e.g. 'qwen3-coder-plus') fails at run start with
 * "Provider authentication failed: Unknown provider ...".
 */
const HERMES_RUN_PROVIDER = process.env.HERMES_RUN_PROVIDER || '';
const HERMES_RUN_MODEL = process.env.HERMES_RUN_MODEL || HERMES_PROFILE;

/**
 * Resolve the live Hermes API base URL. Preference: explicit HERMES_API_URL
 * env → configured 8642 → observed 8643 (profile api_server platforms may
 * override the machine default). Probed once with the real key; cached.
 */
let resolvedUrlCache: string | null = null;

function findHermesConfigFile(): string | null {
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';
  const candidates = [
    path.join(localAppData, 'hermes', 'config.yaml'),
    path.join(localAppData, 'hermes', 'profiles', HERMES_PROFILE, 'config.yaml'),
    path.join(userProfile, '.hermes', 'config.yaml'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function findHermesEnvFile(): string | null {
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';
  const candidates = [
    path.join(localAppData, 'hermes', '.env'),
    path.join(localAppData, 'hermes', 'profiles', HERMES_PROFILE, '.env'),
    path.join(userProfile, '.hermes', '.env'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function findHermesExecutable(): string {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(localAppData, 'hermes', 'bin', 'hermes.exe'),
    path.join(localAppData, 'hermes', 'bin', 'hermes'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'hermes';
}

function getConfiguredHermesPort(): number {
  try {
    const cfgPath = findHermesConfigFile();
    if (!cfgPath) return 8643;
    const content = fs.readFileSync(cfgPath, 'utf8');
    const match = content.match(/platforms:\r?\n[\s\S]*?api_server:\r?\n[\s\S]*?port:[ \t]*['"]?(\d+)['"]?/);
    if (match && match[1]) {
      const p = parseInt(match[1], 10);
      if (!isNaN(p) && p > 0) return p;
    }
  } catch { /* fallback */ }
  return 8643;
}

export async function resolveHermesUrl(forceFresh = false): Promise<string> {
  if (process.env.HERMES_API_URL) return process.env.HERMES_API_URL;
  if (resolvedUrlCache && !forceFresh) return resolvedUrlCache;

  const configuredPort = getConfiguredHermesPort();
  const candidatePorts = Array.from(new Set([configuredPort, 8643, 8642, 9119]));
  const key = resolveHermesApiKey();

  for (const port of candidatePorts) {
    const url = `http://127.0.0.1:${port}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${url}/v1/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        resolvedUrlCache = url;
        return url;
      }
    } catch { /* try next candidate */ }
  }

  return `http://127.0.0.1:${configuredPort}`;
}

/** Resolve API_SERVER_KEY without ever persisting or logging it. */
function resolveHermesApiKey(): string {
  if (process.env.HERMES_API_KEY) return process.env.HERMES_API_KEY;
  try {
    const envPath = findHermesEnvFile();
    if (!envPath) return '';
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^API_SERVER_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Model-truth resolution (read-only, best effort).
 */
export function resolveHermesModelTruth(): { provider: string | null; model: string | null; baseUrl: string | null; context: number | null } {
  if (process.env.HERMES_RUN_PROVIDER || process.env.HERMES_RUN_MODEL) {
    return {
      provider: process.env.HERMES_RUN_PROVIDER || 'custom',
      model: process.env.HERMES_RUN_MODEL || 'qwen2.5:7b-64k',
      baseUrl: 'http://127.0.0.1:11434/v1',
      context: 65536,
    };
  }
  try {
    const cfgPath = findHermesConfigFile();
    if (!cfgPath) return { provider: 'custom', model: 'qwen2.5:7b-64k', baseUrl: 'http://127.0.0.1:11434/v1', context: 65536 };
    const content = fs.readFileSync(cfgPath, 'utf8');
    const modelBlock = content.match(/^model:\r?\n((?:[ \t]+[^\r\n]*\r?\n|\r?\n)*)/m);
    if (!modelBlock) return { provider: 'custom', model: 'qwen2.5:7b-64k', baseUrl: 'http://127.0.0.1:11434/v1', context: 65536 };
    const block = modelBlock[1];
    const provider = block.match(/^[ \t]+provider:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || 'custom';
    const model = block.match(/^[ \t]+default:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || 'qwen2.5:7b-64k';
    const baseUrl = block.match(/^[ \t]+base_url:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || 'http://127.0.0.1:11434/v1';
    const ctxMatch = block.match(/^[ \t]+context_length:[ \t]*"?(\d+)"?/m)?.[1]?.trim();
    const context = ctxMatch ? parseInt(ctxMatch, 10) : 65536;
    return { provider, model, baseUrl, context };
  } catch {
    return { provider: 'custom', model: 'qwen2.5:7b-64k', baseUrl: 'http://127.0.0.1:11434/v1', context: 65536 };
  }
}

class HermesApiService extends EventEmitter {
  private runs = new Map<string, HermesRunRecord>();
  private seq = 0;

  /** Truthful gateway status probe — never hardcoded healthy. */
  async getStatus(): Promise<{ reachable: boolean; detail: string; provider?: string; model?: string; baseUrl?: string; context?: number }> {
    const truth = resolveHermesModelTruth();
    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl(true);

    // 1. Probe HTTP gateway if listening
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        return {
          reachable: true,
          detail: `Hermes HTTP API online (${baseUrl})`,
          provider: truth.provider || 'custom',
          model: truth.model || 'qwen2.5:7b-64k',
          baseUrl: truth.baseUrl || 'http://127.0.0.1:11434/v1',
          context: truth.context || 65536,
        };
      }
    } catch {
      // Gateway HTTP not active, probe Ollama backend
    }

    // 2. Probe local Ollama backend
    const ollamaUrl = truth.baseUrl || 'http://127.0.0.1:11434/v1';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${ollamaUrl}/models`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const targetModel = truth.model || 'qwen2.5:7b-64k';
        return {
          reachable: true,
          detail: `Hermes ONLINE (Local Ollama: ${targetModel})`,
          provider: truth.provider || 'custom',
          model: targetModel,
          baseUrl: ollamaUrl,
          context: truth.context || 65536,
        };
      }
    } catch (err: any) {
      return {
        reachable: false,
        detail: `Hermes Ollama backend unreachable at ${ollamaUrl}: ${err?.message || err}`,
        provider: truth.provider || 'custom',
        model: truth.model || 'qwen2.5:7b-64k',
        baseUrl: ollamaUrl,
        context: truth.context || 65536,
      };
    }

    return {
      reachable: false,
      detail: 'Hermes offline (local Ollama backend not reachable)',
      provider: truth.provider || 'custom',
      model: truth.model || 'qwen2.5:7b-64k',
      baseUrl: ollamaUrl,
      context: truth.context || 65536,
    };
  }

  getProfile() { return HERMES_PROFILE; }
  async getUrl() {
    const truth = resolveHermesModelTruth();
    return truth.baseUrl || 'http://127.0.0.1:11434/v1';
  }

  listRuns(): HermesRunRecord[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  getRun(id: string): HermesRunRecord | undefined {
    return this.runs.get(id);
  }

  /** Recent meaningful activity across all runs (collapsible activity stream). */
  recentActivity(limit = 30): HermesActivityEvent[] {
    const all: HermesActivityEvent[] = [];
    for (const run of this.runs.values()) all.push(...run.events);
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /**
   * Create a Hermes run, link it to a Board card (existing Boards system —
   * b-hermes "Hermes Workspace", In Progress lane), and attach the SSE
   * event consumer. Returns the AgenticOS run record.
   */
  async createRun(opts: { prompt: string; cardId?: string; instructions?: string; provider?: string; model?: string }): Promise<HermesRunRecord> {
    const truth = resolveHermesModelTruth();
    const prompt = (opts.prompt || '').trim();
    if (!prompt) throw new Error('prompt is required');

    const provider = opts.provider || HERMES_RUN_PROVIDER || undefined;
    const model = opts.model || HERMES_RUN_MODEL || truth.model || 'qwen2.5:7b-64k';

    // 1. Probe HTTP gateway
    const baseUrl = await resolveHermesUrl();
    const key = resolveHermesApiKey();
    let isHttp = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const probe = await fetch(`${baseUrl}/v1/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (probe.ok) isHttp = true;
    } catch {}

    if (isHttp) {
      const body: Record<string, unknown> = {
        input: prompt,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
      };
      if (opts.instructions) body.instructions = opts.instructions;

      const res = await fetch(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      const hermesRunId: string | undefined = data?.run_id || data?.id;
      if (!res.ok || !hermesRunId) {
        const msg = data?.error?.message || `Hermes run creation failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      // Board linkage
      let cardId = opts.cardId || null;
      try {
        if (!cardId) {
          const card = await localDataPort.createCard({
            laneId: 'l-hermes-inprogress-hermes',
            title: prompt.slice(0, 80),
            body: `Hermes live run — created from Jarvis.\nRun: ${hermesRunId}`,
            order: Date.now(),
            agent: 'Hermes',
            model: 'api_server',
          });
          cardId = card.id;
        }
        await localDataPort.setCardState(cardId, 'running');
        const kanbanRun = await localDataPort.createRun({
          cardId,
          laneId: 'l-hermes-inprogress-hermes',
          workerKind: 'hermes-api',
          input: { hermesRunId, prompt },
        });
        await localDataPort.setCardRun(cardId, kanbanRun.id);
      } catch (err) {
        logger.warn(`[hermesApi] Board linkage failed (run continues): ${err}`);
      }

      const record: HermesRunRecord = {
        id: `hapi-${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
        hermesRunId,
        cardId,
        prompt,
        status: 'queued',
        provider: provider || 'custom',
        model,
        events: [],
        pendingApproval: null,
        finalText: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.runs.set(record.id, record);
      this.appendEvent(record, 'run.created', `Hermes run ${hermesRunId} created`, { hermesRunId });
      this.attachEventStream(record);
      return record;
    }

    // 2. Direct local CLI execution:
    const hermesRunId = `hr-${Date.now().toString(36)}`;
    let cardId = opts.cardId || null;
    try {
      if (!cardId) {
        const card = await localDataPort.createCard({
          laneId: 'l-hermes-inprogress-hermes',
          title: prompt.slice(0, 80),
          body: `Hermes local execution — created from Jarvis.\nRun: ${hermesRunId}`,
          order: Date.now(),
          agent: 'Hermes',
          model: model || 'qwen2.5:7b-64k',
        });
        cardId = card.id;
      }
      await localDataPort.setCardState(cardId, 'running');
    } catch {}

    const record: HermesRunRecord = {
      id: `hapi-${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
      hermesRunId,
      cardId,
      prompt,
      status: 'running',
      provider: provider || HERMES_RUN_PROVIDER || 'custom',
      model: model || HERMES_RUN_MODEL,
      events: [],
      pendingApproval: null,
      finalText: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.runs.set(record.id, record);
    this.appendEvent(record, 'run.created', `Hermes local CLI run ${hermesRunId} started`, { hermesRunId });

    // Execute via hermes.exe asynchronously
    (async () => {
      try {
        const exe = findHermesExecutable();
        const { execFile } = await import('child_process');
        const env = {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        };
        execFile(exe, ['-z', prompt], { env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            record.status = 'failed';
            record.errorMessage = String(stderr || err.message || err);
            this.appendEvent(record, 'error', `Hermes execution failed: ${record.errorMessage}`);
            this.emit('hermes:event', { type: 'error', error: record.errorMessage }, record);
          } else {
            record.status = 'completed';
            record.finalText = stdout.trim();
            this.appendEvent(record, 'assistant.completed', `Hermes plan produced`, { text: record.finalText });
            this.appendEvent(record, 'run.completed', `Hermes run completed successfully`);
            this.emit('hermes:event', { type: 'run.completed', finalText: record.finalText }, record);
          }
          this.touch(record);
          if (record.cardId) {
            localDataPort.setCardState(record.cardId, record.status === 'completed' ? 'done' : 'error').catch(() => {});
          }
        });
      } catch (err: any) {
        record.status = 'failed';
        record.errorMessage = err.message;
        this.touch(record);
      }
    })();

    return record;
  }

  /** Forward an approval decision — Allow maps to 'once', Deny to 'deny'. */
  async resolveApproval(id: string, choice: 'allow' | 'deny'): Promise<any> {
    const record = this.runs.get(id) || Array.from(this.runs.values()).find(r => r.hermesRunId === id);
    const hermesRunId = record ? record.hermesRunId : id;
    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl();
    const upstreamChoice = choice === 'allow' ? 'once' : 'deny';
    const res = await fetch(`${baseUrl}/v1/runs/${hermesRunId}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ choice: upstreamChoice }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Approval failed (HTTP ${res.status})`);
    if (record) {
      record.pendingApproval = null;
      this.appendEvent(record, 'approval.responded', `Approval ${upstreamChoice === 'once' ? 'allowed' : 'denied'}`, { choice: upstreamChoice });
      record.status = choice === 'allow' ? 'running' : 'cancelled';
      this.touch(record);
    }
    return data;
  }

  async stopRun(id: string): Promise<void> {
    const record = this.requireRun(id);
    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl();
    const res = await fetch(`${baseUrl}/v1/runs/${record.hermesRunId}/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      throw new Error(data?.error?.message || `Stop failed (HTTP ${res.status})`);
    }
    record.status = 'stopping';
    this.appendEvent(record, 'status.changed', 'Stop requested');
  }

  /**
   * Probe upstream Hermes run status directly from the gateway API.
   * Truthfully reconciles completion, errors, or confirms active liveness during long inference.
   */
  async probeRunLiveness(id: string): Promise<{
    status: HermesRunStatus;
    upstreamStatus?: string;
    output?: string;
    model?: string;
    provider?: string;
    isAlive: boolean;
    lastEvent?: string;
  }> {
    const record = this.runs.get(id) || Array.from(this.runs.values()).find(r => r.hermesRunId === id || r.id === id);
    const targetRunId = record ? record.hermesRunId : id;

    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl();
    if (!key) return { status: record ? record.status : 'unknown', isAlive: record ? (record.status === 'running' || record.status === 'queued') : false };

    try {
      const res = await fetch(`${baseUrl}/v1/runs/${targetRunId}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const rawStatus = (data?.status || '').toLowerCase();
        const output = data?.output || '';
        const model = data?.model || record?.model;

        let normalizedStatus: HermesRunStatus = record ? record.status : 'unknown';
        if (rawStatus === 'completed') normalizedStatus = 'completed';
        else if (rawStatus === 'failed') normalizedStatus = 'failed';
        else if (rawStatus === 'cancelled') normalizedStatus = 'cancelled';
        else if (rawStatus === 'waiting_for_approval') normalizedStatus = 'waiting_for_approval';
        else if (rawStatus === 'running' || rawStatus === 'queued') normalizedStatus = 'running';

        if (record && (normalizedStatus !== record.status || (output && !record.finalText))) {
          record.status = normalizedStatus;
          if (output && !record.finalText) record.finalText = output;
          this.touch(record);
        }

        const isAlive = rawStatus === 'running' || rawStatus === 'queued' || rawStatus === 'waiting_for_approval';
        return {
          status: normalizedStatus,
          upstreamStatus: rawStatus,
          output,
          model,
          isAlive,
          lastEvent: data?.last_event,
        };
      }
    } catch { /* probe error, return cached state */ }

    return { status: record ? record.status : 'unknown', isAlive: record ? (record.status === 'running' || record.status === 'queued') : false };
  }

  private requireRun(id: string): HermesRunRecord {
    const record = this.runs.get(id);
    if (!record) throw new Error(`Unknown AgenticOS hermes run: ${id}`);
    return record;
  }

  /** Consume the upstream SSE lifecycle stream for one run. */
  private async attachEventStream(record: HermesRunRecord): Promise<void> {
    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl();
    try {
      const res = await fetch(`${baseUrl}/v1/runs/${record.hermesRunId}/events`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'text/event-stream' },
      });
      if (!res.ok || !res.body) {
        this.appendEvent(record, 'error', `Event stream unavailable (HTTP ${res.status})`);
        return;
      }
      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim());
          if (!dataLines.length) continue;
          try {
            this.handleUpstreamEvent(record, JSON.parse(dataLines.join('')));
          } catch { /* non-JSON frame (keepalive comment already filtered) */ }
        }
      }
    } catch (err: any) {
      this.appendEvent(record, 'error', `Event stream failed: ${err?.message || err}`);
      record.status = record.status === 'completed' ? record.status : 'failed';
      record.errorMessage = record.errorMessage || `Event stream failed: ${err?.message || err}`;
      this.touch(record);
    }
  }

  /** Normalize upstream events into the UI activity contract. */
  private handleUpstreamEvent(record: HermesRunRecord, ev: any): void {
    const event: string = ev?.event || '';
    switch (event) {
      case 'run.started':
        record.status = 'running';
        this.appendEvent(record, 'run.started', 'Hermes agent started');
        break;
      case 'message.started':
        this.appendEvent(record, 'status.changed', 'Assistant message started');
        break;
      case 'assistant.delta':
      case 'message.delta':
        // Visible final-response text accumulation — progressive TTS source.
        record.finalText += ev?.delta || '';
        this.appendEvent(record, 'assistant.delta', ev?.delta || '', { streaming: true });
        if (record.status === 'queued') record.status = 'running';
        break;
      case 'assistant.completed':
        this.appendEvent(record, 'assistant.completed', 'Assistant reply completed');
        break;
      case 'tool.started': {
        // api_server emits `tool` + `preview` (not `tool_name`/`args`).
        const tool = ev?.tool || ev?.tool_name || 'tool';
        const preview = ev?.preview ?? ev?.args ?? null;
        const summary = this.summarizeTool(tool, preview);
        const kind = this.toolKind(tool, preview);
        this.appendEvent(record, kind, summary, { tool, preview });
        if (record.status === 'queued') record.status = 'running';
        break;
      }
      case 'tool.completed': {
        const tool = ev?.tool || ev?.tool_name || 'tool';
        const kind = this.toolKind(tool, null);
        this.appendEvent(record, kind === 'file.changed' ? 'file.changed' : 'tool.completed', `${tool} completed`, { tool, duration: ev?.duration, error: ev?.error });
        if (record.status === 'queued') record.status = 'running';
        break;
      }
      case 'tool.failed':
        this.appendEvent(record, 'tool.failed', `${ev?.tool || ev?.tool_name || 'tool'} failed`, { tool: ev?.tool || ev?.tool_name });
        break;
      case 'approval.request': {
        const norm = normalizeApprovalAction({
          action: ev?.tool_name || ev?.action,
          command: ev?.command,
          reason: ev?.reason || ev?.description || ev?.preview,
          files: Array.isArray(ev?.files) ? ev.files : undefined,
        });
        record.status = 'waiting_for_approval';
        record.pendingApproval = {
          action: norm.label,
          reason: ev?.reason || ev?.description || ev?.preview || norm.summary,
          command: ev?.command || '',
          files: Array.isArray(ev?.files) ? ev.files : undefined,
          choices: Array.isArray(ev?.choices) ? ev.choices : undefined,
        };
        this.appendEvent(record, 'approval.request', `Approval required: ${record.pendingApproval.action}`, ev);
        break;
      }
      case 'approval.responded':
        record.pendingApproval = null;
        record.status = 'running';
        this.appendEvent(record, 'approval.responded', `Approval resolved (${ev?.choice})`);
        break;
      case 'reasoning.available':
        // api_server emits reasoning.available with a `text` field.
        this.appendEvent(record, 'status.changed', 'Reasoning available', { text: ev?.text });
        if (record.status === 'queued') record.status = 'running';
        break;
      case 'subagent.start':
        this.appendEvent(record, 'status.changed', `Subagent started${ev?.subagent_id ? `: ${ev.subagent_id}` : ''}`, ev);
        break;
      case 'subagent.complete':
        this.appendEvent(record, 'status.changed', `Subagent ${ev?.status || 'completed'}${ev?.summary ? `: ${String(ev.summary).slice(0, 120)}` : ''}`, ev);
        break;
      case 'run.completed':
        record.status = 'completed';
        // Runs without streamed deltas carry the full output on completion.
        if (!record.finalText && typeof ev?.output === 'string') record.finalText = ev.output;
        this.appendEvent(record, 'run.completed', 'Hermes run completed', { stats: ev?.usage });
        this.finishBoardLinkage(record, 'done');
        {
          // Authoritative routing record (PRIORITY 1).
          routingLedger.record({
            operationId: record.id,
            worker: 'hermes',
            routingMode: 'auto',
            requestedProvider: record.provider || null,
            requestedModel: record.model || null,
            resolvedProvider: record.provider || null,
            resolvedModel: record.model || null,
            fallbackUsed: false,
            fallbackReason: null,
            startedAt: record.createdAt ? new Date(record.createdAt).getTime() : Date.now(),
            endedAt: Date.now(),
          });
        }
        break;
      case 'run.failed':
        record.status = 'failed';
        record.errorMessage = typeof ev?.error === 'string' ? ev.error : (ev?.message || 'Hermes run failed');
        this.appendEvent(record, 'status.changed', `run.failed: ${record.errorMessage}`, { error: record.errorMessage, event: 'run.failed' });
        this.finishBoardLinkage(record, 'error');
        break;
      case 'run.cancelled':
        record.status = 'cancelled';
        this.appendEvent(record, 'status.changed', 'Run cancelled');
        this.finishBoardLinkage(record, 'error');
        break;
      case 'error':
        record.status = 'failed';
        record.errorMessage = ev?.message || 'Run error';
        this.appendEvent(record, 'error', record.errorMessage || 'Run error', { error: record.errorMessage || 'Run error' });
        this.finishBoardLinkage(record, 'error');
        break;
      case 'done':
        this.appendEvent(record, 'done', 'Event stream closed');
        break;
      default:
        if (event) this.appendEvent(record, 'status.changed', event, ev);
    }
    this.touch(record);
  }

  private toolKind(tool: string, preview: any): HermesActivityEvent['kind'] {
    // Only MUTATING verbs count as file.changed — `read_file`, `list_*`,
    // `search_*` are reads and must not masquerade as changes.
    if (/write|edit|patch|apply|create|delete|remove|save|append|mkdir|touch/i.test(tool)) return 'file.changed';
    if (/terminal|shell|command|exec|bash|process/i.test(tool)) return 'terminal.command';
    return 'tool.started';
  }

  private summarizeTool(tool: string, preview: any): string {
    const p = typeof preview === 'string' && preview.trim() ? preview.trim().slice(0, 120) : '';
    return p ? `${tool}: ${p}` : `${tool} started`;
  }

  private async finishBoardLinkage(record: HermesRunRecord, state: 'done' | 'error'): Promise<void> {
    if (!record.cardId) return;
    try {
      await localDataPort.setCardState(record.cardId, state);
      // Completed runs move to the Review column for human verification.
      const targetLane = state === 'done' ? 'l-hermes-review' : 'l-hermes-blocked';
      await localDataPort.moveCard({ cardId: record.cardId, toLaneId: targetLane, toOrder: Date.now() });
    } catch (err) {
      logger.warn(`[hermesApi] Board finish update failed: ${err}`);
    }
  }

  private appendEvent(record: HermesRunRecord, kind: HermesActivityEvent['kind'], summary: string, detail?: Record<string, unknown>): void {
    const evt: HermesActivityEvent = {
      id: `he-${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
      runId: record.id,
      ts: Date.now(),
      kind,
      summary,
      detail,
    };
    record.events.push(evt);
    if (record.events.length > MAX_EVENTS_PER_RUN) record.events.shift();
    this.emit('hermes:event', evt, record);
  }

  private touch(record: HermesRunRecord): void {
    record.updatedAt = Date.now();
    this.emit('hermes:update', record);
  }
}

export const hermesApiService = new HermesApiService();
