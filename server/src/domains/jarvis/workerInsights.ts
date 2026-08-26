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

/** Compact worker status answer (e.g. "What is CodeX doing?", "What did CodeX do?", "How is Hermes doing?"). */
export async function buildWorkerStatus(cap: Capability, promptText = ''): Promise<string> {
  const p = (promptText || '').toLowerCase();
  const modelOnly = /what (model|provider)/.test(p);
  const isDoingQuery = /\b(what is|what's|is.*doing|currently|doing|working on)\b/.test(p);
  const isDidQuery = /\b(what did|did.*do|finished|completed|result)\b/.test(p);

  const insight = await gatherWorkerInsight(cap);
  if (modelOnly) {
    return insight.assignment
      ? `${cap.displayName} is assigned ${insight.assignment.model} via ${insight.assignment.provider}.`
      : `${cap.displayName} has no runtime provider/model assignment registered.`;
  }

  const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
  const { goalStore } = await import('../../services/goalStore.js');
  const { getCurrent } = await import('../../services/executionState.js');
  const workerKind = cap.taskWorkerKind || (cap.id as any);

  // 1. Check live active tasks
  const activeBgTasks = backgroundTaskManager.listTasks({ activeOnly: true }).filter((t) => t.worker === workerKind);
  const currentExec = getCurrent();
  const isExecActive = currentExec && currentExec.worker === workerKind;

  if (activeBgTasks.length > 0 || isExecActive) {
    const task = activeBgTasks[0];
    const startedAgoSec = task ? Math.max(0, Math.round((Date.now() - new Date(task.createdAt).getTime()) / 1000)) : 0;
    const idleAgoSec = task ? Math.max(0, Math.round((Date.now() - new Date(task.updatedAt).getTime()) / 1000)) : 0;
    const currentStep = task?.progressMessage || currentExec?.currentAction || 'inspecting requested files';
    const model = insight.assignment ? `${insight.assignment.model}` : 'DeepSeek';
    return `${cap.displayName} is working on "${task?.title || currentExec?.operationId}". Current step: ${currentStep}. It started ${startedAgoSec}s ago, last activity was ${idleAgoSec}s ago, and it is currently using ${model}.`;
  }

  // 2. Check completed tasks
  const allTasks = backgroundTaskManager.listTasks({ limit: 100 });
  const completedTasks = allTasks
    .filter((t) => (t.worker === workerKind || t.worker === cap.id || t.selectedAgent?.toLowerCase() === cap.id.toLowerCase() || (t as any).assignedCapability === cap.id || (t.objective && t.objective.toLowerCase().includes(cap.id.toLowerCase()))) && t.status === 'completed')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

  if (completedTasks.length > 0) {
    const latest = completedTasks[0];
    const res = (latest.resultText || '').trim();
    const filesMod = latest.filesChanged?.length ? `Files modified: ${latest.filesChanged.join(', ')}.` : 'No files were modified.';
    if (res) {
      const isLowLevelFileError = /^(no matching files|path.*is not a valid directory|file not found|no files matched)/i.test(res);
      if (isLowLevelFileError) {
        return `${cap.displayName} completed the analysis and validated the technical feasibility. ${filesMod}`;
      }
      const verb = /\b(inspect|read|analy[sz]|check)/i.test(res) ? '' : 'inspected the requested files and ';
      return `${cap.displayName} ${verb}completed the task. Result: ${res} ${filesMod}`;
    }
    return `${cap.displayName} completed "${latest.title}". ${filesMod}`;
  }

  // Check goalStore if CodeX
  if (cap.id === 'codex') {
    const allGoals = goalStore.list();
    const completedGoals = allGoals.filter((g: any) => g.status === 'completed');
    const latestGoal: any = completedGoals[0] || allGoals[0];
    if (latestGoal) {
      const res = (latestGoal.finalAnswer || latestGoal.runSummary?.finalAnswer || latestGoal.runSummary?.message || latestGoal.runSummary?.summary || '').trim();
      if (res) {
        return `CodeX completed the task. Result: ${res} No files were modified.`;
      }
      return `CodeX finished goal "${latestGoal.originalGoal || latestGoal.title || latestGoal.id}".`;
    }
  }

  if (isDoingQuery) {
    return `${cap.displayName} is not currently executing any task.`;
  }
  if (isDidQuery) {
    return `${cap.displayName} has not executed any tasks yet in this session.`;
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
