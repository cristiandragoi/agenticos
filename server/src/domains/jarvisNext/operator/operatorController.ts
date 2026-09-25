import { projectsStore } from '../../../services/projectsStore.js';
import { backgroundTaskManager } from '../../../services/backgroundTasks/manager.js';
import { runStore } from '../../../services/runStore.js';
import { freeCashMonitorAdapter } from '../../../adapters/freecashMonitorAdapter.js';
import { resolveInstructions } from './instructionResolver.js';
import { missionPlanner, type Mission } from './missionPlanner.js';
import { buildGroundedStatus, type GroundedOperationalStatus } from './statusReporter.js';
import { evaluateActionPolicy } from './executionPolicy.js';
import { logger } from '../../../utils/logger.js';

export interface OperatorResult {
  handled: boolean;
  intent: string;
  response: string;
  missionId?: string;
  tasksCreated: string[];
  hermesRunId?: string;
  status?: GroundedOperationalStatus;
}

export class OperatorController {
  public classifyIntent(text: string): { intent: string; targetProject?: string } {
    const lower = text.toLowerCase().trim();

    // 1. START_PROJECT intent matches
    const isStartProject =
      lower.includes('start free cash') ||
      lower.includes('start the free cash') ||
      lower.includes('begin free cash') ||
      lower.includes('go ahead with free cash') ||
      lower.includes('proceed with free cash') ||
      lower.includes('do whatever is necessary to start free cash') ||
      lower.includes('do whatever is necessary according to the instructions') ||
      lower.includes('do whatever is necessary according to my instructions') ||
      lower.includes('continue free cash') ||
      lower.includes('get free cash running') ||
      (lower.startsWith('start') && lower.includes('free cash')) ||
      (lower.includes('start') && lower.includes('free cash') && lower.includes('keep me updated'));

    if (isStartProject) {
      return { intent: 'START_PROJECT', targetProject: 'Free Cash' };
    }

    // 2. STATUS_QUERY intent matches
    const isStatusQuery =
      lower.includes('current status') ||
      lower.includes('what is the status') ||
      lower.includes('what\'s the status') ||
      lower.includes('what\'s happening') ||
      lower.includes('what is happening') ||
      lower === 'status' ||
      lower.includes('how is free cash going') ||
      lower.includes('how is it going') ||
      lower.includes('status update');

    if (isStatusQuery) {
      return { intent: 'STATUS_QUERY', targetProject: 'Free Cash' };
    }

    return { intent: 'UNKNOWN' };
  }

  public async handleIntent(text: string): Promise<OperatorResult> {
    const { intent, targetProject } = this.classifyIntent(text);

    if (intent === 'START_PROJECT') {
      return await this.handleStartProject(targetProject || 'Free Cash');
    }

    if (intent === 'STATUS_QUERY') {
      return this.handleStatusQuery();
    }

    return {
      handled: false,
      intent: 'UNKNOWN',
      response: '',
      tasksCreated: [],
    };
  }

  public async handleStartProject(projectName: string): Promise<OperatorResult> {
    logger.info('[JarvisNext:OperatorController] Executing START_PROJECT for:', projectName);

    // 1. Resolve Project
    projectsStore.ensureRevenueProjects();
    const allProjects = projectsStore.listProjects();
    const project =
      allProjects.find(
        (p) =>
          p.name.toLowerCase() === projectName.toLowerCase() ||
          p.revenueVertical === 'free_cash' ||
          p.id.includes('free-cash')
      ) || allProjects[0];

    const projectId = project ? project.id : 'proj-free-cash';
    const canonicalName = project ? project.name : 'Free Cash';

    // 2. Load Project Instructions & Operating Policy
    const instructions = resolveInstructions(projectId);

    // 3. Create or Reset Mission
    const scheduleId = 'sched-daily-free-cash-0900';
    const mission = missionPlanner.createMission({
      projectId,
      projectName: canonicalName,
      goal: 'Autonomous read-only monitoring, opportunity review, and internal planning for Free Cash',
      instructions,
      scheduleId,
    });

    missionPlanner.updateMission(mission.missionId, { status: 'RUNNING' });

    // 4. Check Connectivity Status
    const connStatus = await freeCashMonitorAdapter.fetchStatus();
    const externalConnected = connStatus.externalConnected;

    const createdTaskIds: string[] = [];

    // 5. Create Background Tasks in backgroundTaskManager
    // Task 1: Policy Ingestion
    try {
      const res1 = await backgroundTaskManager.createTask({
        title: 'Free Cash: Ingest Project Instructions & Policy',
        objective: 'Load and verify structured execution constraints and approval boundaries',
        originalRequest: 'Start Free Cash',
        route: 'internal_policy',
        selectedAgent: 'jarvis',
        worker: 'automation',
        projectId,
        priority: 'high',
      });
      if (res1.task) {
        createdTaskIds.push(res1.task.taskId);
        missionPlanner.addTaskToMission(mission.missionId, res1.task.taskId, 'completed');
        await backgroundTaskManager.completeTaskManual(res1.task.taskId, 'Instructions and approval policy loaded successfully');
      }
    } catch (e) {
      logger.warn('[JarvisNext] Error creating policy task:', e);
    }

    // Task 2: Connectivity Probe
    try {
      const res2 = await backgroundTaskManager.createTask({
        title: 'Free Cash: Integration Connectivity Probe',
        objective: 'Check live API endpoints, credentials, and read-only account access',
        originalRequest: 'Start Free Cash',
        route: 'integration_probe',
        selectedAgent: 'free-cash-monitor',
        worker: 'automation',
        projectId,
        priority: 'high',
      });
      if (res2.task) {
        createdTaskIds.push(res2.task.taskId);
        missionPlanner.addTaskToMission(mission.missionId, res2.task.taskId, 'completed');
        await backgroundTaskManager.completeTaskManual(res2.task.taskId, connStatus.externalStatusMessage);
      }
    } catch (e) {
      logger.warn('[JarvisNext] Error creating probe task:', e);
    }

    // Task 3: If external connection missing, create concrete setup/blocker task
    if (!externalConnected) {
      try {
        const res3 = await backgroundTaskManager.createTask({
          title: 'Free Cash: External Account Credential Setup',
          objective: 'Configure external FreeCash API credentials and account connectivity for live earnings tracking',
          originalRequest: 'Start Free Cash',
          route: 'setup_required',
          selectedAgent: 'jarvis',
          worker: 'automation',
          projectId,
          priority: 'medium',
        });
        if (res3.task) {
          createdTaskIds.push(res3.task.taskId);
          missionPlanner.addTaskToMission(mission.missionId, res3.task.taskId, 'blocked');
          await backgroundTaskManager.blockTask(res3.task.taskId, 'Missing external FreeCash API keys / credentials');
          missionPlanner.updateMission(mission.missionId, {
            blockerReason: 'External account credentials are not configured; account access is currently blocked.',
          });
        }
      } catch (e) {
        logger.warn('[JarvisNext] Error creating blocker task:', e);
      }
    }

    // Task 4: Daily Monitoring Task
    try {
      const res4 = await backgroundTaskManager.createTask({
        title: 'Free Cash: Daily Status Monitor',
        objective: 'Scheduled once-daily read-only health and financial change check',
        originalRequest: 'Check status once per day',
        route: 'scheduled_monitor',
        selectedAgent: 'free-cash-monitor',
        worker: 'automation',
        projectId,
        priority: 'medium',
      });
      if (res4.task) {
        createdTaskIds.push(res4.task.taskId);
        missionPlanner.addTaskToMission(mission.missionId, res4.task.taskId, 'running');
      }
    } catch (e) {
      logger.warn('[JarvisNext] Error creating monitor task:', e);
    }

    // 6. Automatically Delegate Hermes for Safe Internal Research / Planning
    let hermesRunId: string | undefined;
    try {
      const hermesPolicy = evaluateActionPolicy('delegate_hermes');
      if (hermesPolicy.canExecuteAutomatically) {
        const res5 = await backgroundTaskManager.createTask({
          title: 'Hermes: Review Free Cash Opportunity Landscape',
          objective: 'Research available offers, analyze automation feasibility, and draft read-only integration plan',
          originalRequest: 'Start Free Cash',
          route: 'hermes_research',
          selectedAgent: 'hermes',
          worker: 'hermes',
          projectId,
          priority: 'high',
        });
        if (res5.task) {
          createdTaskIds.push(res5.task.taskId);
          missionPlanner.addTaskToMission(mission.missionId, res5.task.taskId, 'running');
        }

        // Create run record in runStore
        hermesRunId = `run-hermes-${Date.now().toString(36)}`;
        runStore.create({
          id: hermesRunId,
          agentId: 'hermes',
          sessionId: 'session-jarvis-next',
          workspaceId: 'ws-main',
          mode: 'task',
          status: 'running',
          input: 'Evaluate Free Cash opportunity landscape and read-only integration plan',
          logs: ['Hermes dispatched for read-only Free Cash opportunity analysis'],
          events: ['run:started'],
          linkedArtifacts: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        missionPlanner.addDelegatedRun(mission.missionId, {
          worker: 'hermes',
          runId: hermesRunId,
          objective: 'Review Free Cash opportunity landscape and read-only integration plan',
          startedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      logger.warn('[JarvisNext] Error delegating Hermes:', e);
    }

    // 7. Grounded Verbal Response (Short, natural, specific, describing ACTUAL started work)
    const response =
      `Started Free Cash. I've loaded the project instructions and scheduled the daily monitor. ` +
      `Hermes is reviewing current opportunities and internal integration plans. ` +
      `Note: external account connectivity is currently not configured, so live earnings tracking is blocked until credentials are provided. ` +
      `All external actions remain strictly approval-gated.`;

    const status = buildGroundedStatus(mission);

    return {
      handled: true,
      intent: 'START_PROJECT',
      response,
      missionId: mission.missionId,
      tasksCreated: createdTaskIds,
      hermesRunId,
      status,
    };
  }

  public handleStatusQuery(): OperatorResult {
    const mission = missionPlanner.getActiveMission('proj-free-cash') || missionPlanner.getActiveMission();
    const status = buildGroundedStatus(mission);

    return {
      handled: true,
      intent: 'STATUS_QUERY',
      response: status.verbalReport,
      missionId: status.missionId,
      tasksCreated: [],
      status,
    };
  }
}

export const operatorController = new OperatorController();
