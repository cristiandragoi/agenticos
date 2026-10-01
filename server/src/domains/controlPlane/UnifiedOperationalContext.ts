/**
 * UnifiedOperationalContext.ts — Shared Operational Context Layer for AgenticOS
 *
 * Implements Section 1, 2, 3, 4, 16 of the Unified Cross-Channel Mission:
 * - One shared owner identity ('local-owner') across Desktop, Voice, and Telegram.
 * - Single authoritative operational context for active GoalRuns, tasks, worker states,
 *   referents, and verification states.
 * - Deterministic Task Referent Resolution across channels.
 * - Preserves cross-channel task continuity across reboots.
 */

import { logger } from '../../utils/logger.js';
import { backgroundTaskRepo } from '../../services/backgroundTasks/store.js';
import { backgroundTaskManager } from '../../services/backgroundTasks/manager.js';
import { goalLifecycleManager } from './GoalLifecycle.js';
import { engineeringWorkerRegistry } from './EngineeringWorkerRegistry.js';
import type { BackgroundTaskRecord } from '../../services/backgroundTasks/types.js';

export type OperationalChannel = 'desktop' | 'voice' | 'telegram' | 'internal';

export interface OperationalReferent {
  activeTaskId?: string;
  activeGoalRunId?: string;
  activeWorker?: string;
  activeProject?: string;
  activeRepository?: string;
  activeSubject?: string;
  originChannel: OperationalChannel;
  originConversationId?: string;
  updatedAt: string;
}

export interface TaskLedgerEntry {
  taskId: string;
  goalRunId?: string;
  ownerId: string;
  originChannel: OperationalChannel;
  originConversationId?: string;
  originTelegramChatId?: string;
  worker: string;
  objective: string;
  subject?: string;
  createdAt: string;
  acceptedAt?: string;
  startedAt?: string;
  lastEventAt?: string;
  status: string;
  stage?: string;
  blocker?: string;
  verificationState?: string;
  completionEvidence?: string;
  linkedWorkerSession?: string;
  parentTaskId?: string;
  continuationOf?: string;
}

export interface ReferentResolutionResult {
  match: TaskLedgerEntry | null;
  candidates: TaskLedgerEntry[];
  resolutionMethod: 'explicit_id' | 'active_referent' | 'recent_goal' | 'worker_subject' | 'origin_channel' | 'recency' | 'semantic' | 'none';
  ambiguous: boolean;
  message?: string;
}

export class UnifiedOperationalContext {
  private static instance: UnifiedOperationalContext;
  public readonly ownerId = 'local-owner';

  public getOwnerId(): string {
    return this.ownerId;
  }

  // In-memory operational referents with persistence to SQLite / memory stores
  private activeReferent: OperationalReferent = {
    originChannel: 'desktop',
    updatedAt: new Date().toISOString(),
  };

  private constructor() {}

  public static getInstance(): UnifiedOperationalContext {
    if (!UnifiedOperationalContext.instance) {
      UnifiedOperationalContext.instance = new UnifiedOperationalContext();
    }
    return UnifiedOperationalContext.instance;
  }

  /**
   * Set the active operational referent (called whenever a task or goal is created, updated, or discussed).
   */
  public setActiveReferent(referent: Partial<OperationalReferent>): OperationalReferent {
    this.activeReferent = {
      ...this.activeReferent,
      ...referent,
      updatedAt: new Date().toISOString(),
    };
    logger.info(`[UnifiedOperationalContext] Active referent updated: task=${this.activeReferent.activeTaskId}, worker=${this.activeReferent.activeWorker}, channel=${this.activeReferent.originChannel}, subject="${this.activeReferent.activeSubject?.slice(0, 40)}"`);
    return this.activeReferent;
  }

  /**
   * Get the current active operational referent.
   */
  public getActiveReferent(): OperationalReferent {
    return { ...this.activeReferent };
  }

  /**
   * Return unified task ledger entry for a specific task.
   */
  public getTask(taskId: string): TaskLedgerEntry | null {
    const task = backgroundTaskRepo.getTask(taskId);
    if (!task) return null;
    return this.mapTaskToLedger(task);
  }

  /**
   * Return all tasks for the owner across all channels.
   */
  public getTasksForUser(ownerId: string = this.ownerId): TaskLedgerEntry[] {
    const all = backgroundTaskRepo.listTasks({ limit: 100 });
    return all.map(t => this.mapTaskToLedger(t));
  }

  /**
   * Get recent tasks ordered by recency.
   */
  public getRecentTasks(limit: number = 20): TaskLedgerEntry[] {
    const all = backgroundTaskRepo.listTasks({ limit });
    return all.map(t => this.mapTaskToLedger(t));
  }

  /**
   * Find tasks by subject or topic keywords.
   */
  public findTaskBySubject(query: string): TaskLedgerEntry[] {
    const qLower = query.toLowerCase();
    const tasks = this.getRecentTasks(50);
    return tasks.filter(t =>
      t.objective.toLowerCase().includes(qLower) ||
      (t.subject && t.subject.toLowerCase().includes(qLower)) ||
      (t.taskId.toLowerCase() === qLower)
    );
  }

  /**
   * Find tasks by assigned worker.
   */
  public findTaskByWorker(worker: string): TaskLedgerEntry[] {
    const wLower = worker.toLowerCase();
    const tasks = this.getRecentTasks(50);
    return tasks.filter(t => t.worker.toLowerCase() === wLower);
  }

  /**
   * Find tasks by origin channel.
   */
  public findTaskByOrigin(channel: OperationalChannel): TaskLedgerEntry[] {
    const tasks = this.getRecentTasks(50);
    return tasks.filter(t => t.originChannel === channel);
  }

  /**
   * Get current GoalRun state from goalLifecycleManager.
   */
  public getGoalRun(goalId: string) {
    return goalLifecycleManager.getGoalRun(goalId);
  }

  /**
   * Get live worker state from EngineeringWorkerRegistry and background tasks.
   */
  public getWorkerState(worker: string): {
    worker: string;
    status: 'IDLE' | 'BUSY' | 'DEGRADED' | 'OFFLINE';
    activeTask?: TaskLedgerEntry;
    recentSessions: any[];
    events: any[];
  } {
    const normWorker = worker.toLowerCase();
    const pool = engineeringWorkerRegistry.getWorkers();
    const workerInfo = pool.find(w => w.id.toLowerCase() === normWorker || w.name.toLowerCase().includes(normWorker));
    const events = engineeringWorkerRegistry.getWorkerEvents(normWorker as any);
    const sessions = engineeringWorkerRegistry.getAllSessions().filter(s => s.workerId.toLowerCase() === normWorker);

    const activeTasks = this.findTaskByWorker(normWorker).filter(t =>
      t.status === 'running' || t.status === 'executing' || t.status === 'planning' || t.status === 'worker_accepted'
    );
    const activeTask = activeTasks[0];

    const isBusy = Boolean(activeTask || sessions.some(s => s.status === 'BUSY'));

    return {
      worker: normWorker,
      status: isBusy ? 'BUSY' : (workerInfo?.status === 'ONLINE' ? 'IDLE' : workerInfo?.status === 'DEGRADED' ? 'DEGRADED' : workerInfo?.status === 'OFFLINE' ? 'OFFLINE' : 'IDLE'),
      activeTask,
      recentSessions: sessions.slice(-5),
      events: events.slice(-10),
    };
  }

  /**
   * Deterministic Shared Task Referent Resolution Engine (§3).
   *
   * Resolves phrases like:
   * "that task", "the GitHub task", "the task I gave Hermes",
   * "the task I sent on Telegram", "did Hermes finish it?", "what happened with it?"
   *
   * Resolution hierarchy:
   * 1. Explicit taskId (e.g. "bgtask-123", "goal-456")
   * 2. Current activeTaskId in UnifiedOperationalContext
   * 3. Recent GoalRun
   * 4. Worker + Subject match (e.g. worker="hermes" and subject="git")
   * 5. Origin channel (e.g. channel="telegram")
   * 6. Recency
   * 7. Task title / objective semantic match
   */
  public resolveTaskReferent(query: string, callerContext?: { conversationId?: string; channel?: OperationalChannel }): ReferentResolutionResult {
    const raw = query.trim();
    const lower = raw.toLowerCase();
    const recentTasks = this.getRecentTasks(50);

    // 1. Explicit Task ID in query
    const explicitTaskMatch = raw.match(/\b(bgtask-[a-zA-Z0-9_\-]+|goal-[a-zA-Z0-9_\-]+)\b/i);
    if (explicitTaskMatch) {
      const explicitId = explicitTaskMatch[1];
      const found = recentTasks.find(t => t.taskId.toLowerCase() === explicitId.toLowerCase() || t.goalRunId?.toLowerCase() === explicitId.toLowerCase());
      if (found) {
        this.setActiveReferent({ activeTaskId: found.taskId, activeGoalRunId: found.goalRunId, activeWorker: found.worker, activeSubject: found.objective, originChannel: found.originChannel });
        return { match: found, candidates: [found], resolutionMethod: 'explicit_id', ambiguous: false };
      }
      return {
        match: null,
        candidates: [],
        resolutionMethod: 'none',
        ambiguous: false,
        message: 'I could not find an existing task matching that request.',
      };
    }

    // 2. Worker Mention in Referent (e.g. "task I gave Hermes", "what is Hermes doing", "did Hermes finish it")
    const workerMention = lower.includes('hermes') ? 'hermes' : (lower.includes('antigravity') || lower.includes('anti-gravity')) ? 'antigravity' : lower.includes('codex') ? 'codex' : null;
    const channelMention: OperationalChannel | null = lower.includes('telegram') ? 'telegram' : lower.includes('voice') ? 'voice' : lower.includes('desktop') ? 'desktop' : null;

    // Detect subject keywords: e.g. "github", "git", "status", "word", "auth"
    const subjectKeywords: string[] = [];
    if (lower.includes('git') || lower.includes('github') || lower.includes('repository') || lower.includes('repo')) {
      subjectKeywords.push('git', 'github', 'repo');
    }
    if (lower.includes('auth') || lower.includes('token') || lower.includes('credential')) {
      subjectKeywords.push('auth');
    }

    // Filter candidate tasks
    let candidates = recentTasks;

    if (workerMention) {
      candidates = candidates.filter(t => t.worker.toLowerCase() === workerMention);
    }

    if (channelMention) {
      candidates = candidates.filter(t => t.originChannel === channelMention);
    }

    if (subjectKeywords.length > 0) {
      const filteredBySubject = candidates.filter(t => {
        const tLower = (t.objective + ' ' + (t.subject || '')).toLowerCase();
        return subjectKeywords.some(kw => tLower.includes(kw));
      });
      if (filteredBySubject.length > 0) {
        candidates = filteredBySubject;
      }
    }

    // Check for "that task", "the task", "it", "did he finish it", "what happened with it"
    const isAnaphoricReferent = /\b(?:that|the|this|it|current|previous|last)\s+(?:task|job|work|operation|goal)\b/i.test(lower) ||
      /\b(?:finish|completed?|done|status\s+of)\s+it\b/i.test(lower) ||
      /\bwhat\s+happened\s+with\s+(?:it|that)\b/i.test(lower) ||
      /\bwhat\s+is\s+the\s+status\s+of\s+the\s+task\b/i.test(lower);

    const hasFilter = Boolean(workerMention || channelMention || subjectKeywords.length > 0);
    if (!hasFilter && !isAnaphoricReferent) {
      return {
        match: null,
        candidates: [],
        resolutionMethod: 'none',
        ambiguous: false,
        message: 'I could not find an existing task matching that request.',
      };
    }

    if (candidates.length === 1) {
      const match = candidates[0];
      this.setActiveReferent({ activeTaskId: match.taskId, activeGoalRunId: match.goalRunId, activeWorker: match.worker, activeSubject: match.objective, originChannel: match.originChannel });
      return { match, candidates, resolutionMethod: workerMention ? 'worker_subject' : 'semantic', ambiguous: false };
    }

    // If multiple candidates exist, check if activeReferent matches one
    if (candidates.length > 1 && this.activeReferent.activeTaskId) {
      const activeMatch = candidates.find(t => t.taskId === this.activeReferent.activeTaskId);
      if (activeMatch && isAnaphoricReferent) {
        return { match: activeMatch, candidates: [activeMatch], resolutionMethod: 'active_referent', ambiguous: false };
      }
    }

    // If active referent matches when no strong candidate filter was applied
    if (isAnaphoricReferent && this.activeReferent.activeTaskId && candidates.length === 0) {
      const fromActive = this.getTask(this.activeReferent.activeTaskId);
      if (fromActive) {
        return { match: fromActive, candidates: [fromActive], resolutionMethod: 'active_referent', ambiguous: false };
      }
    }

    if (candidates.length > 1) {
      // If candidates share the same subject and worker, pick the most recent
      const mostRecent = candidates[0];
      return {
        match: mostRecent,
        candidates,
        resolutionMethod: 'recency',
        ambiguous: false,
      };
    }

    // If caller explicitly asked for a task and none found
    return {
      match: null,
      candidates: [],
      resolutionMethod: 'none',
      ambiguous: false,
      message: 'I could not find an existing task matching that request.',
    };
  }

  /**
   * PendingAction state management (§3).
   * Ensures explicit consent executes the proposed action rather than echoing generic acknowledgment.
   */
  private pendingActions: Map<string, PendingAction> = new Map();

  public proposeAction(proposal: {
    proposedObjective: string;
    proposedWorker: string;
    conversationId: string;
    proposingTurnId?: number | string;
    confirmationRequired?: boolean;
    metadata?: Record<string, any>;
  }): PendingAction {
    const pendingActionId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const action: PendingAction = {
      pendingActionId,
      proposedObjective: proposal.proposedObjective,
      proposedWorker: proposal.proposedWorker,
      proposingTurnId: proposal.proposingTurnId,
      conversationId: proposal.conversationId,
      ownerId: this.ownerId,
      createdAt: new Date().toISOString(),
      confirmationRequired: proposal.confirmationRequired !== false,
      status: 'PENDING',
      metadata: proposal.metadata,
    };
    this.pendingActions.set(pendingActionId, action);
    logger.info(`[UnifiedOperationalContext] PendingAction proposed: ${pendingActionId} [worker=${action.proposedWorker}, conv=${action.conversationId}] objective="${action.proposedObjective}"`);
    return action;
  }

  public getActivePendingAction(conversationId?: string): PendingAction | null {
    const now = Date.now();
    for (const action of this.pendingActions.values()) {
      if (action.status !== 'PENDING') continue;
      // Auto-expire actions older than 10 minutes
      const ageMs = now - new Date(action.createdAt).getTime();
      if (ageMs > 10 * 60 * 1000) {
        action.status = 'EXPIRED';
        continue;
      }
      if (!conversationId || action.conversationId === conversationId) {
        return action;
      }
    }
    return null;
  }

  public acceptPendingAction(pendingActionId: string): PendingAction | null {
    const action = this.pendingActions.get(pendingActionId);
    if (!action || action.status !== 'PENDING') return null;
    action.status = 'ACCEPTED';
    logger.info(`[UnifiedOperationalContext] PendingAction accepted: ${pendingActionId} [worker=${action.proposedWorker}]`);
    return action;
  }

  public rejectPendingAction(pendingActionId: string, reason?: string): PendingAction | null {
    const action = this.pendingActions.get(pendingActionId);
    if (!action || action.status !== 'PENDING') return null;
    action.status = 'REJECTED';
    logger.info(`[UnifiedOperationalContext] PendingAction rejected: ${pendingActionId} reason="${reason || 'user cancelled'}"`);
    return action;
  }

  public clearPendingAction(conversationId?: string): void {
    for (const [id, action] of this.pendingActions.entries()) {
      if (!conversationId || action.conversationId === conversationId) {
        action.status = 'EXPIRED';
      }
    }
  }

  /**
   * Telegram runtime state introspection getter.
   */
  public async getTelegramRuntimeState(): Promise<any> {
    try {
      const { telegramAdapter } = await import('../../adapters/telegramAdapter.js');
      return telegramAdapter.getStatus();
    } catch (err: any) {
      return {
        configured: false,
        connected: false,
        polling: false,
        botUsername: null,
        authorizedUserCount: 0,
        authorizedChatCount: 0,
      };
    }
  }

  /**
   * Helper to map internal BackgroundTaskRecord to TaskLedgerEntry.
   */
  private mapTaskToLedger(task: BackgroundTaskRecord): TaskLedgerEntry {
    const meta = (task.metadata || {}) as Record<string, any>;
    const originChannel: OperationalChannel = meta.originChannel || (meta.delegatedBy === 'telegram' ? 'telegram' : meta.delegatedBy === 'voice' ? 'voice' : 'desktop');

    return {
      taskId: task.taskId,
      goalRunId: meta.goalId || meta.goalRunId || undefined,
      ownerId: this.ownerId,
      originChannel,
      originConversationId: task.conversationId || undefined,
      originTelegramChatId: meta.telegramChatId || meta.originChatId || undefined,
      worker: task.worker || task.selectedAgent?.toLowerCase() || 'unknown',
      objective: task.objective || task.title || task.originalRequest || '',
      createdAt: task.createdAt,
      acceptedAt: meta.acceptedAt || (task.status !== 'queued' && task.status !== 'planning' ? task.createdAt : undefined),
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
      lastEventAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : undefined,
      status: task.status,
      stage: task.currentStage,
      subject: task.title,
      blocker: task.blocker || undefined,
      verificationState: task.verificationState === 'passed' ? 'VERIFIED' : task.status === 'completed' ? 'UNVERIFIED' : 'PENDING',
      completionEvidence: task.resultText || undefined,
      linkedWorkerSession: task.linkedRunId || undefined,
      parentTaskId: meta.parentTaskId,
      continuationOf: meta.continuationOf,
    };
  }
}

export interface PendingAction {
  pendingActionId: string;
  proposedObjective: string;
  proposedWorker: string;
  proposingTurnId?: number | string;
  conversationId: string;
  ownerId: string;
  createdAt: string;
  confirmationRequired: boolean;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  metadata?: Record<string, any>;
}

export const unifiedOperationalContext = UnifiedOperationalContext.getInstance();

