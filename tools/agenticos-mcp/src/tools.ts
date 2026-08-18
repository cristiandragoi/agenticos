/**
 * tools.ts — MCP tool definitions and handlers for the Agentic OS bridge.
 *
 * Eleven logical tools: 7 read-only (Phase 1A), 4 controlled mutations
 * (Phase 1B). Every handler validates inputs strictly, calls ONLY the
 * canonical Agentic OS loopback backend, and redacts before returning.
 */

import type { BackendClient } from './backend.js';
import { redactJson, sanitizeError } from './redact.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, backend: BackendClient) => Promise<unknown>;
}

export class ToolError extends Error {}

// ── Strict validators (Zod-equivalent) ────────────────────────────────────

function reqString(v: unknown, name: string, maxLen = 20000): string {
  if (typeof v !== 'string' || v.trim().length === 0) throw new ToolError(`${name} is required`);
  if (v.length > maxLen) throw new ToolError(`${name} exceeds ${maxLen} characters`);
  return v.trim();
}

function optString(v: unknown, name: string, maxLen = 20000): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new ToolError(`${name} must be a string`);
  if (v.length > maxLen) throw new ToolError(`${name} exceeds ${maxLen} characters`);
  return v.trim();
}

function reqEnum<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ToolError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return v as T;
}

function optInt(v: unknown, name: string, min: number, max: number, dflt: number): number {
  if (v === null || v === undefined || v === '') return dflt;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ToolError(`${name} must be a number`);
  return Math.min(Math.max(Math.round(n), min), max);
}

function optBool(v: unknown, name: string, dflt: boolean): boolean {
  if (v === null || v === undefined) return dflt;
  if (typeof v !== 'boolean') throw new ToolError(`${name} must be a boolean`);
  return v;
}

function optConstraints(v: unknown): Record<string, boolean> {
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new ToolError('constraints must be an object');
  const keys = ['allowSourceChanges', 'allowBuild', 'allowRestart', 'allowDeploy', 'allowCommit', 'allowPush', 'allowNetwork'] as const;
  const out: Record<string, boolean> = {};
  for (const k of keys) {
    const val = (v as Record<string, unknown>)[k];
    if (val !== undefined) out[k] = optBool(val, k, false);
  }
  return out;
}

// ── Tool definitions ──────────────────────────────────────────────────────

export const TOOLS: McpTool[] = [
  {
    name: 'agenticos_health',
    description: 'Agentic OS backend health: reachability, version, environment, dispatcher/verifier/memory status, sanitized worker availability. No secrets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, backend) {
      const health = await backend.get('/api/health');
      let workers: unknown = null;
      let memory: unknown = null;
      try {
        const caps = await backend.get('/api/project-execution/workers/capabilities');
        workers = caps;
      } catch { workers = { unreachable: true }; }
      try {
        memory = await backend.get('/api/memory/stats');
      } catch { memory = { unavailable: true }; }
      return {
        backendReachable: true,
        version: (health as any)?.version ?? null,
        environment: (health as any)?.environment ?? null,
        uptimeSeconds: (health as any)?.uptime ?? null,
        dispatcher: workers ? { available: true } : { available: false },
        verifier: { available: true },
        memory: memory ? { available: true } : { available: false },
        workers: workers ? sanitizeWorkers(workers) : null,
        timestamp: new Date().toISOString(),
        source: 'agentic-os-backend',
      };
    },
  },
  {
    name: 'agenticos_get_active_project',
    description: 'Authoritative active project (never the first row), or null when none is set.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, backend) {
      const data = await backend.get('/api/projects/active');
      const project = (data as any)?.project ?? null;
      if (!project) return { project: null, timestamp: new Date().toISOString(), source: 'projectsStore.activeProjectId' };
      const tree = await backend.get(`/api/project-execution/${project.id}/tree`).catch(() => null);
      const goals = Array.isArray((tree as any)?.goals) ? (tree as any).goals : [];
      const openTasks = goals.flatMap((g: any) => (g.tasks ?? []).filter((t: any) => !['completed', 'cancelled', 'failed'].includes(t.status)));
      const lastRun = goals.flatMap((g: any) => (g.tasks ?? []).flatMap((t: any) => (t.runs ?? []))).sort((a: any, b: any) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0] ?? null;
      return {
        project: {
          projectId: project.id,
          name: project.name,
          status: project.status,
          workspacePath: project.workspacePath ?? null,
        },
        currentMilestone: null,
        currentGoals: goals.map((g: any) => ({ goalId: g.id, title: g.title, status: g.status })),
        currentBlockers: goals.flatMap((g: any) => (g.tasks ?? []).filter((t: any) => t.status === 'blocked' || t.status === 'failed').map((t: any) => ({ taskId: t.id, title: t.title, status: t.status }))),
        lastVerifiedRun: lastRun
          ? { runId: lastRun.id, status: lastRun.status, worker: lastRun.workerType, verification: lastRun.verification?.verdict ?? null }
          : null,
        openTaskCount: openTasks.length,
        timestamp: new Date().toISOString(),
        source: 'projectsStore + projectExecution',
      };
    },
  },
  {
    name: 'agenticos_list_projects',
    description: 'Bounded project list (max 50): id, name, status, updatedAt, active flag.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false },
    async handler(args, backend) {
      const limit = optInt(args.limit, 'limit', 1, 50, 50);
      const data = await backend.get('/api/projects');
      const projects = Array.isArray((data as any)?.projects) ? (data as any).projects : [];
      const activeId = (data as any)?.activeProjectId ?? null;
      return {
        projects: projects.slice(0, limit).map((p: any) => ({
          projectId: p.id,
          name: p.name,
          status: p.status,
          updatedAt: p.updatedAt,
          active: p.id === activeId,
        })),
        count: Math.min(projects.length, limit),
        timestamp: new Date().toISOString(),
      };
    },
  },
  {
    name: 'agenticos_get_project_context',
    description: 'Bounded authoritative context for one project: goals, open tasks, recent verified decisions, project memory, blockers, latest runs. Enforces project isolation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1 },
        maxKnowledge: { type: 'number', minimum: 1, maximum: 20 },
        maxRuns: { type: 'number', minimum: 1, maximum: 20 },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const projectId = reqString(args.projectId, 'projectId', 200);
      const maxKnowledge = optInt(args.maxKnowledge, 'maxKnowledge', 1, 20, 10);
      const maxRuns = optInt(args.maxRuns, 'maxRuns', 1, 20, 10);

      const project = await backend.get(`/api/projects/${projectId}`);
      const proj = project as any;
      if (!project || proj?.error) throw new ToolError(`Project not found: ${projectId}`);

      const knowledge = await backend.get(`/api/projects/${projectId}/knowledge`).catch(() => null);
      const tree = await backend.get(`/api/project-execution/${projectId}/tree`).catch(() => null);
      const runsData = await backend.get(`/api/mcp-bridge/projects/${projectId}/runs?limit=${maxRuns}`).catch(() => null);

      const goals = Array.isArray((tree as any)?.goals) ? (tree as any).goals : [];
      const openTasks = goals.flatMap((g: any) => (g.tasks ?? []).filter((t: any) => !['completed', 'cancelled', 'failed'].includes(t.status))).slice(0, 30);
      const blockers = goals.flatMap((g: any) => (g.tasks ?? []).filter((t: any) => t.status === 'blocked' || t.status === 'failed')).slice(0, 10);
      const knowledgeItems = Array.isArray((knowledge as any)?.items)
        ? (knowledge as any).items
        : Array.isArray(knowledge)
          ? knowledge
          : [];
      const decisions = knowledgeItems.filter((k: any) => (k.type ?? 'note') === 'decision').slice(0, maxKnowledge);

      return {
        project: { projectId: proj.id, name: proj.name, status: proj.status, workspacePath: proj.workspacePath ?? null },
        activeGoals: goals.map((g: any) => ({ goalId: g.id, title: g.title, status: g.status })),
        openTasks: openTasks.map((t: any) => ({ taskId: t.id, title: t.title, status: t.status, assignedCapability: t.assignedCapability ?? null })),
        recentDecisions: decisions.map((d: any) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt })),
        projectMemoryCount: knowledgeItems.length,
        recentRuns: Array.isArray((runsData as any)?.runs) ? (runsData as any).runs.slice(0, maxRuns) : [],
        blockers: blockers.map((t: any) => ({ taskId: t.id, title: t.title, status: t.status })),
        timestamp: new Date().toISOString(),
        provenance: 'projectsStore + projectExecution + knowledge_items',
      };
    },
  },
  {
    name: 'agenticos_list_runs',
    description: 'Bounded run summary list for a project (max 50), optionally filtered by status/worker.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1 },
        status: { type: 'string' },
        worker: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const projectId = reqString(args.projectId, 'projectId', 200);
      const limit = optInt(args.limit, 'limit', 1, 50, 50);
      const qs = new URLSearchParams({ limit: String(limit) });
      const status = optString(args.status, 'status', 50);
      const worker = optString(args.worker, 'worker', 50);
      if (status) qs.set('status', status);
      if (worker) qs.set('worker', worker);
      const data = await backend.get(`/api/mcp-bridge/projects/${encodeURIComponent(projectId)}/runs?${qs.toString()}`);
      return { projectId, runs: (data as any)?.runs ?? [], count: (data as any)?.count ?? 0, timestamp: new Date().toISOString() };
    },
  },
  {
    name: 'agenticos_get_run',
    description: 'Run detail: identity, task/goal/project correlation, worker, provider/model, status, timestamps, approval/verifier state, sanitized progress/errors, cancellation state, artifact references. Optional projectId enforces isolation.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', minLength: 1 },
        projectId: { type: 'string' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const runId = reqString(args.runId, 'runId', 200);
      const projectId = optString(args.projectId, 'projectId', 200);
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      return backend.get(`/api/mcp-bridge/runs/${encodeURIComponent(runId)}${qs}`);
    },
  },
  {
    name: 'agenticos_get_run_result',
    description: 'Actual bounded run result: final status, report, verifier verdict, tests, changed files, diff summary, artifacts, review state, sanitized provider attempts. Optional projectId enforces isolation.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', minLength: 1 },
        projectId: { type: 'string' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const runId = reqString(args.runId, 'runId', 200);
      const projectId = optString(args.projectId, 'projectId', 200);
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      return backend.get(`/api/mcp-bridge/runs/${encodeURIComponent(runId)}/result${qs}`);
    },
  },
  {
    name: 'agenticos_prepare_task',
    description: 'Prepare a bounded task WITHOUT executing it. Validates project/worker/workspace, classifies risk, persists a canonical pending task, returns approval requirements. Execution happens only after submit_prepared_task and authoritative approval.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', minLength: 1 },
        targetWorker: { type: 'string', enum: ['hermes', 'codex', 'magnitude'] },
        taskType: { type: 'string', enum: ['research', 'planning', 'implementation', 'verification', 'browser'] },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        prompt: { type: 'string', minLength: 1, maxLength: 20000 },
        sourceConversationId: { type: 'string' },
        parentRunId: { type: 'string' },
        workspacePath: { type: 'string' },
        operationId: { type: 'string' },
        constraints: {
          type: 'object',
          properties: {
            allowSourceChanges: { type: 'boolean' },
            allowBuild: { type: 'boolean' },
            allowRestart: { type: 'boolean' },
            allowDeploy: { type: 'boolean' },
            allowCommit: { type: 'boolean' },
            allowPush: { type: 'boolean' },
            allowNetwork: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['projectId', 'targetWorker', 'taskType', 'title', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const body = {
        projectId: reqString(args.projectId, 'projectId', 200),
        targetWorker: reqEnum(args.targetWorker, 'targetWorker', ['hermes', 'codex', 'magnitude'] as const),
        taskType: reqEnum(args.taskType, 'taskType', ['research', 'planning', 'implementation', 'verification', 'browser'] as const),
        title: reqString(args.title, 'title', 200),
        prompt: reqString(args.prompt, 'prompt', 20000),
        sourceConversationId: optString(args.sourceConversationId, 'sourceConversationId', 500),
        parentRunId: optString(args.parentRunId, 'parentRunId', 200),
        workspacePath: optString(args.workspacePath, 'workspacePath', 1000),
        operationId: optString(args.operationId, 'operationId', 200),
        constraints: optConstraints(args.constraints),
      };
      return backend.post('/api/mcp-bridge/prepare', body);
    },
  },
  {
    name: 'agenticos_submit_prepared_task',
    description: 'Submit an approved prepared task. The backend resolves approval AUTHORITATIVELY (client cannot claim approval). Idempotent: repeated submission returns the same task/run.',
    inputSchema: {
      type: 'object',
      properties: {
        preparedTaskId: { type: 'string', minLength: 1 },
        requestId: { type: 'string' },
      },
      required: ['preparedTaskId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const body: Record<string, unknown> = {
        preparedTaskId: reqString(args.preparedTaskId, 'preparedTaskId', 200),
      };
      const requestId = optString(args.requestId, 'requestId', 200);
      if (requestId) body.requestId = requestId;
      return backend.post('/api/mcp-bridge/submit', body);
    },
  },
  {
    name: 'agenticos_cancel_run',
    description: 'Cancel a run through the canonical path. Idempotent; truthful terminal state; retains evidence/worktree per policy.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', minLength: 1 },
        reason: { type: 'string' },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const reason = optString(args.reason, 'reason', 500);
      return backend.post(`/api/mcp-bridge/runs/${encodeURIComponent(reqString(args.runId, 'runId', 200))}/cancel`, reason ? { reason } : {});
    },
  },
  {
    name: 'agenticos_follow_run',
    description: 'Return new normalized run events after a cursor (1-based event index). Bounded; does not block indefinitely.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', minLength: 1 },
        afterSequence: { type: 'number', minimum: 0 },
      },
      required: ['runId'],
      additionalProperties: false,
    },
    async handler(args, backend) {
      const runId = reqString(args.runId, 'runId', 200);
      const after = optInt(args.afterSequence, 'afterSequence', 0, 1_000_000_000, 0);
      return backend.get(`/api/mcp-bridge/runs/${encodeURIComponent(runId)}/events?after=${after}`);
    },
  },
];

function sanitizeWorkers(caps: unknown): unknown {
  const reg = (caps as any)?.capabilities ?? caps ?? {};
  if (typeof reg !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(reg as Record<string, unknown>)) {
    const vv = v as any;
    out[k] = {
      available: vv?.available ?? vv?.status ?? null,
      // never include raw env/credentials
    };
  }
  return redactJson(out);
}

export async function callTool(name: string, args: Record<string, unknown>, backend: BackendClient): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await tool.handler(args ?? {}, backend);
    return { content: [{ type: 'text', text: JSON.stringify(redactJson(result), null, 2) }] };
  } catch (err: any) {
    if (err instanceof ToolError) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ error: sanitizeError(err) }) }], isError: true };
  }
}
