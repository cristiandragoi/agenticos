/**
 * Worker status & feedback gatherer.
 *
 * Builds truthful, structured assessments for internal workers from real
 * runtime data: provider/model assignments, background task manager state,
 * Hermes API reachability, and recent runs. Never invents activity.
 */
import { capabilityAssignment, type Capability } from './capabilityRegistry.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { hermesApiService } from '../../services/hermesApiService.js';
import { runStore } from '../../services/runStore.js';

interface WorkerInsight {
  capability: Capability;
  assignment: { provider: string; model: string } | null;
  activeTasks: string[];
  recentRuns: { id: string; status: string; agentId?: string; createdAt: string }[];
  hermesReachable?: boolean;
  hermesDetail?: string;
  blockers: string[];
}

async function gatherWorkerInsight(cap: Capability): Promise<WorkerInsight> {
  const assignment = await capabilityAssignment(cap);
  const workerKinds = cap.taskWorkerKind ? [cap.taskWorkerKind] : [];
  const activeTasks = workerKinds.length
    ? backgroundTaskManager
        .listTasks({ activeOnly: true })
        .filter((t) => t.worker === cap.taskWorkerKind)
        .map((t) => `${t.taskId.slice(-8)} [${t.status}] ${t.title}`)
    : [];

  const recentRuns = runStore
    .list()
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5)
    .map((r) => ({ id: r.id, status: r.status, agentId: r.agentId, createdAt: r.createdAt }));

  let hermesReachable: boolean | undefined;
  let hermesDetail: string | undefined;
  if (cap.id === 'hermes') {
    try {
      const status = await hermesApiService.getStatus();
      hermesReachable = status.reachable;
      hermesDetail = status.detail;
    } catch {
      hermesReachable = false;
      hermesDetail = 'Hermes API unreachable';
    }
  }

  const blockers = backgroundTaskManager
    .listTasks({ status: ['blocked', 'failed'] })
    .filter((t) => !workerKinds.length || t.worker === cap.taskWorkerKind)
    .map((t) => `${t.taskId.slice(-8)} ${t.blocker || t.lastError || 'blocked'}`);

  return { capability: cap, assignment, activeTasks, recentRuns, hermesReachable, hermesDetail, blockers };
}

/** Structured but concise worker feedback assessment (e.g. "Give me feedback regarding CodeX"). */
export async function buildWorkerFeedback(cap: Capability): Promise<string> {
  const insight = await gatherWorkerInsight(cap);
  const lines: string[] = [];
  lines.push(`${cap.displayName} — current assessment`);
  lines.push(`Purpose: ${cap.responsibilities}`);
  lines.push(
    insight.assignment
      ? `Provider/model: ${insight.assignment.provider} / ${insight.assignment.model}`
      : 'Provider/model: no runtime assignment registered'
  );
  if (cap.id === 'hermes') {
    lines.push(`Hermes API: ${insight.hermesReachable ? 'online' : 'offline'}${insight.hermesDetail ? ` (${insight.hermesDetail})` : ''}`);
  }
  lines.push(
    insight.activeTasks.length
      ? `Active tasks (${insight.activeTasks.length}): ${insight.activeTasks.join('; ')}`
      : 'Active tasks: none'
  );
  const completed = insight.recentRuns.filter((r) => r.status === 'completed').length;
  const failed = insight.recentRuns.filter((r) => r.status === 'failed' || r.status === 'error').length;
  lines.push(`Recent runs (last 5): ${completed} completed / ${failed} failed`);
  lines.push(
    insight.blockers.length
      ? `Known blockers: ${insight.blockers.join('; ')}`
      : 'Known blockers: none'
  );
  lines.push(`Build/test capability: ${cap.id === 'codex' ? 'CodeX runs builds and tests via goals' : 'managed by the assigned worker'}`);
  lines.push(`Recommended next use: ${cap.supportedActions[0] || 'available for delegation'}`);
  return lines.join('\n');
}

/** Compact worker status answer (e.g. "How is Hermes doing?" / "What model is CodeX using?"). */
export async function buildWorkerStatus(cap: Capability, modelOnly = false): Promise<string> {
  const insight = await gatherWorkerInsight(cap);
  if (modelOnly) {
    return insight.assignment
      ? `${cap.displayName} is assigned ${insight.assignment.model} via ${insight.assignment.provider}.`
      : `${cap.displayName} has no runtime provider/model assignment registered.`;
  }
  const parts: string[] = [];
  if (cap.id === 'hermes') {
    parts.push(`Hermes API: ${insight.hermesReachable ? 'online' : 'offline'}${insight.hermesDetail ? ` (${insight.hermesDetail})` : ''}`);
  }
  parts.push(
    insight.assignment
      ? `Provider/model: ${insight.assignment.provider} / ${insight.assignment.model}`
      : 'Provider/model: no runtime assignment'
  );
  parts.push(
    insight.activeTasks.length
      ? `Active tasks: ${insight.activeTasks.length}`
      : 'Active tasks: none'
  );
  const completed = insight.recentRuns.filter((r) => r.status === 'completed').length;
  const failed = insight.recentRuns.filter((r) => r.status === 'failed' || r.status === 'error').length;
  parts.push(`Recent runs: ${completed} completed / ${failed} failed`);
  if (insight.blockers.length) parts.push(`Blockers: ${insight.blockers.join('; ')}`);
  return `${cap.displayName} status — ${parts.join(' · ')}`;
}

/** Explanation answer from the registry (no task, no fake activity). */
export function buildCapabilityExplanation(cap: Capability): string {
  return [
    `${cap.displayName}: ${cap.responsibilities}`,
    `Supported actions: ${cap.supportedActions.join(', ')}.`,
    cap.limitations ? `Limitations: ${cap.limitations}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
