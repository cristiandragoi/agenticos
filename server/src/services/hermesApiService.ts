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

function getConfiguredHermesPort(): number {
  try {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (!localAppData) return 8643;
    const cfgPath = path.join(localAppData, 'hermes', 'profiles', HERMES_PROFILE, 'config.yaml');
    if (!fs.existsSync(cfgPath)) return 8643;
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
  const candidatePorts = Array.from(new Set([configuredPort, 8643, 8642]));
  const key = resolveHermesApiKey();

  for (const port of candidatePorts) {
    const url = `http://127.0.0.1:${port}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${url}/v1/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timer);
      // Any HTTP response proves the api_server platform lives here.
      resolvedUrlCache = url;
      return url;
    } catch { /* try next candidate */ }
  }

  // Nothing answered — return candidate without permanently caching a dead URL
  return `http://127.0.0.1:${configuredPort}`;
}


/** Resolve API_SERVER_KEY without ever persisting or logging it. */
function resolveHermesApiKey(): string {
  if (process.env.HERMES_API_KEY) return process.env.HERMES_API_KEY;
  try {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (!localAppData) return '';
    const envPath = path.join(localAppData, 'hermes', 'profiles', HERMES_PROFILE, '.env');
    if (!fs.existsSync(envPath)) return '';
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^API_SERVER_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Model-truth resolution (read-only, best effort). Runs created with
 * `model: <profile>` use the profile's configured provider/model — this
 * reads that pair from the profile config so RunLedger can report the
 * ACTUAL provider/model instead of the profile alias. Env overrides
 * (HERMES_RUN_PROVIDER/HERMES_RUN_MODEL) win when set. No secrets touched.
 */
export function resolveHermesModelTruth(): { provider: string | null; model: string | null } {
  if (process.env.HERMES_RUN_PROVIDER || process.env.HERMES_RUN_MODEL) {
    return {
      provider: process.env.HERMES_RUN_PROVIDER || null,
      model: process.env.HERMES_RUN_MODEL || null,
    };
  }
  try {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (!localAppData) return { provider: null, model: null };
    const cfgPath = path.join(localAppData, 'hermes', 'profiles', HERMES_PROFILE, 'config.yaml');
    if (!fs.existsSync(cfgPath)) return { provider: null, model: null };
    const content = fs.readFileSync(cfgPath, 'utf8');
    // CRLF-tolerant: Windows config files carry \r\n.
    const modelBlock = content.match(/^model:\r?\n((?:[ \t]+[^\r\n]*\r?\n|\r?\n)*)/m);
    if (!modelBlock) return { provider: null, model: null };
    const block = modelBlock[1];
    const provider = block.match(/^[ \t]+provider:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || null;
    const model = block.match(/^[ \t]+default:[ \t]*"?([^"\r\n]+)"?/m)?.[1]?.trim() || null;
    return { provider, model };
  } catch {
    return { provider: null, model: null };
  }
}

class HermesApiService extends EventEmitter {
  private runs = new Map<string, HermesRunRecord>();
  private seq = 0;

  /** Truthful gateway status probe — never hardcoded healthy. */
  async getStatus(): Promise<{ reachable: boolean; detail: string }> {
    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl(true);
    if (!key) return { reachable: false, detail: 'API_SERVER_KEY not configured' };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return { reachable: true, detail: `Hermes API online (${baseUrl})` };
      if (res.status === 401) return { reachable: false, detail: 'Hermes API key rejected (401)' };
      return { reachable: false, detail: `Hermes API HTTP ${res.status}` };
    } catch (err: any) {
      return { reachable: false, detail: `Hermes API unreachable: ${err?.cause?.code || err?.message || err}` };
    }
  }

  getProfile() { return HERMES_PROFILE; }
  async getUrl() { return resolveHermesUrl(); }

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
    const key = resolveHermesApiKey();
    if (!key) throw new Error('HERMES_API_KEY / API_SERVER_KEY not configured');
    const baseUrl = await resolveHermesUrl();
    const prompt = (opts.prompt || '').trim();
    if (!prompt) throw new Error('prompt is required');

    // Per-run override (RecoveryPolicy V1): a caller-provided provider/model
    // (e.g. the recovery-effective model) wins over the process env defaults.
    // Never rewritten: the ASSIGNED model stays on the task record.
    const provider = opts.provider || HERMES_RUN_PROVIDER || undefined;
    const model = opts.model || HERMES_RUN_MODEL || undefined;

    const body: Record<string, unknown> = {
      input: prompt,
      // Default: run as the gateway profile (model = profile id, no
      // provider) so the profile's configured provider/model is used. An
      // explicit provider is only sent when the operator sets one — an
      // unknown provider name fails at run start.
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

    // ── Board linkage (existing kanban dataport — no new Kanban system) ──
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
      provider: HERMES_RUN_PROVIDER,
      model: data.model || HERMES_RUN_MODEL,
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

  /** Forward an approval decision — Allow maps to 'once', Deny to 'deny'. */
  async resolveApproval(id: string, choice: 'allow' | 'deny'): Promise<any> {
    const record = this.requireRun(id);
    const key = resolveHermesApiKey();
    const baseUrl = await resolveHermesUrl();
    const upstreamChoice = choice === 'allow' ? 'once' : 'deny';
    const res = await fetch(`${baseUrl}/v1/runs/${record.hermesRunId}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ choice: upstreamChoice }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Approval failed (HTTP ${res.status})`);
    record.pendingApproval = null;
    this.appendEvent(record, 'approval.responded', `Approval ${upstreamChoice === 'once' ? 'allowed' : 'denied'}`, { choice: upstreamChoice });
    record.status = 'running';
    this.touch(record);
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
        break;
      case 'assistant.completed':
        this.appendEvent(record, 'assistant.completed', 'Assistant reply completed');
        break;
      case 'tool.started': {
        const tool = ev?.tool_name || 'tool';
        const args = ev?.args || {};
        const summary = this.summarizeTool(tool, args);
        const kind = this.toolKind(tool, args);
        this.appendEvent(record, kind, summary, { tool, args });
        break;
      }
      case 'tool.completed': {
        const tool = ev?.tool_name || 'tool';
        const kind = this.toolKind(tool, ev?.args || {});
        this.appendEvent(record, kind === 'file.changed' ? 'file.changed' : 'tool.completed', `${tool} completed`, { tool, preview: ev?.preview });
        break;
      }
      case 'tool.failed':
        this.appendEvent(record, 'tool.failed', `${ev?.tool_name || 'tool'} failed`, { tool: ev?.tool_name });
        break;
      case 'approval.request': {
        record.status = 'waiting_for_approval';
        record.pendingApproval = {
          action: ev?.tool_name || ev?.action || 'Unknown action',
          reason: ev?.reason || ev?.preview || '',
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

  private toolKind(tool: string, args: any): HermesActivityEvent['kind'] {
    if (/write|edit|patch|file/i.test(tool)) return 'file.changed';
    if (/terminal|shell|command|exec/i.test(tool) || typeof args?.command === 'string') return 'terminal.command';
    return 'tool.started';
  }

  private summarizeTool(tool: string, args: any): string {
    if (typeof args?.command === 'string') return `${tool}: ${args.command.slice(0, 120)}`;
    if (typeof args?.path === 'string') return `${tool}: ${args.path}`;
    if (typeof args?.file_path === 'string') return `${tool}: ${args.file_path}`;
    return `${tool} started`;
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
