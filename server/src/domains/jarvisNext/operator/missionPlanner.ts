import { randomUUID } from 'node:crypto';
import type { ResolvedInstructionSet } from './instructionResolver.js';
import { logger } from '../../../utils/logger.js';

export type MissionStatus =
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING_FOR_APPROVAL'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED';

export interface DelegatedRun {
  worker: string;
  runId: string;
  objective: string;
  startedAt: string;
}

export interface Mission {
  missionId: string;
  projectId: string;
  projectName: string;
  goal: string;
  status: MissionStatus;
  startedAt: string;
  instructions: ResolvedInstructionSet;
  tasks: string[];
  runningTasks: string[];
  blockedTasks: string[];
  completedTasks: string[];
  nextCheckAt?: string;
  lastUpdateAt: string;
  delegatedWorkerRuns: DelegatedRun[];
  scheduleId?: string;
  blockerReason?: string;
}

export class MissionPlanner {
  private missions: Map<string, Mission> = new Map();
  private activeMissionByProject: Map<string, string> = new Map();

  public createMission(params: {
    projectId: string;
    projectName: string;
    goal: string;
    instructions: ResolvedInstructionSet;
    scheduleId?: string;
  }): Mission {
    const missionId = `mission-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const mission: Mission = {
      missionId,
      projectId: params.projectId,
      projectName: params.projectName,
      goal: params.goal,
      status: 'STARTING',
      startedAt: now,
      instructions: params.instructions,
      tasks: [],
      runningTasks: [],
      blockedTasks: [],
      completedTasks: [],
      lastUpdateAt: now,
      delegatedWorkerRuns: [],
      scheduleId: params.scheduleId,
    };

    this.missions.set(missionId, mission);
    this.activeMissionByProject.set(params.projectId, missionId);

    logger.info('[JarvisNext:MissionPlanner] Created new mission:', {
      missionId,
      projectId: params.projectId,
      projectName: params.projectName,
    });

    return mission;
  }

  public getMission(missionId: string): Mission | undefined {
    return this.missions.get(missionId);
  }

  public getActiveMission(projectId?: string): Mission | undefined {
    if (projectId && this.activeMissionByProject.has(projectId)) {
      const id = this.activeMissionByProject.get(projectId)!;
      return this.missions.get(id);
    }
    // Return the latest active mission
    const all = Array.from(this.missions.values());
    return all.reverse().find(m => m.status === 'RUNNING' || m.status === 'STARTING' || m.status === 'BLOCKED');
  }

  public updateMission(missionId: string, patch: Partial<Mission>): Mission | undefined {
    const existing = this.missions.get(missionId);
    if (!existing) return undefined;

    const updated: Mission = {
      ...existing,
      ...patch,
      lastUpdateAt: new Date().toISOString(),
    };

    this.missions.set(missionId, updated);
    return updated;
  }

  public addTaskToMission(missionId: string, taskId: string, status: 'running' | 'completed' | 'blocked' = 'running'): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    if (!mission.tasks.includes(taskId)) {
      mission.tasks.push(taskId);
    }

    if (status === 'running' && !mission.runningTasks.includes(taskId)) {
      mission.runningTasks.push(taskId);
    } else if (status === 'completed' && !mission.completedTasks.includes(taskId)) {
      mission.completedTasks.push(taskId);
      mission.runningTasks = mission.runningTasks.filter(id => id !== taskId);
    } else if (status === 'blocked' && !mission.blockedTasks.includes(taskId)) {
      mission.blockedTasks.push(taskId);
      mission.runningTasks = mission.runningTasks.filter(id => id !== taskId);
    }

    mission.lastUpdateAt = new Date().toISOString();
  }

  public addDelegatedRun(missionId: string, run: DelegatedRun): void {
    const mission = this.missions.get(missionId);
    if (!mission) return;

    mission.delegatedWorkerRuns.push(run);
    mission.lastUpdateAt = new Date().toISOString();
  }
}

export const missionPlanner = new MissionPlanner();
