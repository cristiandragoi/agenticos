import type { Mission } from './missionPlanner.js';
import { backgroundTaskManager } from '../../../services/backgroundTasks/manager.js';
import { runStore } from '../../../services/runStore.js';

export interface GroundedOperationalStatus {
  hasActiveMission: boolean;
  missionId?: string;
  projectName?: string;
  missionStatus?: string;
  runningTasksCount: number;
  completedTasksCount: number;
  blockedTasksCount: number;
  runningTaskTitles: string[];
  blockerDetails: string | null;
  scheduledMonitorActive: boolean;
  delegatedWorkers: string[];
  pendingApprovalsCount: number;
  verbalReport: string;
}

export function buildGroundedStatus(mission?: Mission): GroundedOperationalStatus {
  if (!mission) {
    return {
      hasActiveMission: false,
      runningTasksCount: 0,
      completedTasksCount: 0,
      blockedTasksCount: 0,
      runningTaskTitles: [],
      blockerDetails: null,
      scheduledMonitorActive: false,
      delegatedWorkers: [],
      pendingApprovalsCount: 0,
      verbalReport: 'No active project mission is currently running. Say "Start Free Cash" to initiate the operating workflow.',
    };
  }

  // Query actual background tasks from backgroundTaskManager
  const allTasks = backgroundTaskManager.listTasks({ projectId: mission.projectId });
  const running = allTasks.filter(t => t.status === 'running' || t.status === 'planning' || t.status === 'queued');
  const completed = allTasks.filter(t => t.status === 'completed');
  const blocked = allTasks.filter(t => t.status === 'blocked');
  const waitingApproval = allTasks.filter(t => t.status === 'waiting_approval');

  const runningTitles = running.map(t => t.title);
  const activeWorkers = Array.from(new Set(running.map(t => t.worker)));

  // Query Hermes/Codex runs
  const delegatedRuns = mission.delegatedWorkerRuns || [];
  for (const r of delegatedRuns) {
    const run = runStore.get(r.runId);
    if (run && (run.status === 'running' || run.status === 'queued') && !activeWorkers.includes(r.worker as any)) {
      activeWorkers.push(r.worker as any);
    }
  }

  // Construct natural, concise operational statement
  const parts: string[] = [];

  parts.push(`${mission.projectName} is ${mission.status.toLowerCase()}.`);

  if (mission.scheduleId) {
    parts.push('The daily monitor is scheduled.');
  }

  if (activeWorkers.length > 0) {
    const workerNames = activeWorkers.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' and ');
    parts.push(`${workerNames} is reviewing current opportunities and integration plans.`);
  }

  if (mission.blockerReason || blocked.length > 0) {
    const reason = mission.blockerReason || blocked[0]?.objective || 'External account credentials are not configured';
    parts.push(`The external account connection is currently not configured; internal monitoring and planning are ready.`);
  }

  if (waitingApproval.length > 0) {
    parts.push(`There is 1 action awaiting your approval.`);
  } else {
    parts.push('All external actions remain approval-gated.');
  }

  const verbalReport = parts.join(' ');

  return {
    hasActiveMission: true,
    missionId: mission.missionId,
    projectName: mission.projectName,
    missionStatus: mission.status,
    runningTasksCount: running.length,
    completedTasksCount: completed.length,
    blockedTasksCount: blocked.length,
    runningTaskTitles: runningTitles,
    blockerDetails: mission.blockerReason || null,
    scheduledMonitorActive: !!mission.scheduleId,
    delegatedWorkers: activeWorkers,
    pendingApprovalsCount: waitingApproval.length,
    verbalReport,
  };
}
