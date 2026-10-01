/**
 * domains/hermes/progressEvents.ts
 *
 * Authoritative First-Class Mission Progress Event Model for Hermes in AgenticOS.
 *
 * Guarantees:
 * - Real-time streaming of ACTIONS, FINDINGS, RESULTS, and NEXT STEPS.
 * - Strict suppression of internal scratchpads, private deliberations, and <think> tokens.
 * - Multi-channel distribution (Background Tasks, SSE, Conversation Streams, UI).
 * - Heartbeat mechanism so the user never experiences silence during long inference tasks.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';

export type HermesProgressEventType =
  | 'MISSION_STARTED'
  | 'OBSERVING'
  | 'PLANNING'
  | 'DELEGATING'
  | 'WORKER_STARTED'
  | 'INSPECTING'
  | 'EDITING'
  | 'COMMAND_RUNNING'
  | 'BUILD_RUNNING'
  | 'TEST_RUNNING'
  | 'VERIFYING'
  | 'FINDING'
  | 'REPAIRING'
  | 'RETRYING'
  | 'DEPLOYING'
  | 'LIVE_TESTING'
  | 'WORKER_COMPLETED'
  | 'MISSION_PROGRESS'
  | 'BLOCKED'
  | 'MISSION_COMPLETED'
  | 'MISSION_FAILED'
  | 'STOPPED';

export interface HermesMissionProgressEvent {
  id: string;
  missionId: string;
  taskId?: string;
  conversationId?: string;
  timestamp: number;
  phase: string;
  type: HermesProgressEventType;
  message: string;
  worker?: string;
  status: string;
  evidenceSummary?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Sanitizes user-facing progress updates to guarantee no raw model reasoning,
 * chain-of-thought, XML tags (<think>...</think>), or internal scratchpads leak to the user.
 */
export function sanitizeUserFacingProgressMessage(raw: string): string {
  if (!raw) return '';

  let text = String(raw)
    // Strip <think>...</think> and internal reasoning delimiters
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\[scratchpad[\s\S]*?\]/gi, '')
    .replace(/^thinking:[\s\S]*?\n/gim, '')
    .replace(/^thought:[\s\S]*?\n/gim, '')
    // Strip markdown headers and bolding if excessive
    .replace(/#{1,6}\s+/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();

  // If text is still too long or contains multiple internal lines, keep concise first 1-2 sentences
  if (text.length > 280) {
    const sentences = text.split(/(?<=[.?!])\s+/);
    text = sentences[0] || text.slice(0, 280);
    if (text.length < 120 && sentences[1]) {
      text = text + ' ' + sentences[1];
    }
  }

  return text.trim();
}

export class HermesProgressBus extends EventEmitter {
  private recentEvents: Map<string, HermesMissionProgressEvent[]> = new Map();
  private maxHistoryPerMission = 100;

  /**
   * Broadcasts a mission progress event across all subscribers.
   */
  public emitProgress(
    eventData: Omit<HermesMissionProgressEvent, 'id' | 'timestamp'> & { timestamp?: number }
  ): HermesMissionProgressEvent {
    const id = 'hevt-' + randomUUID().slice(0, 8);
    const timestamp = eventData.timestamp || Date.now();
    const sanitizedMessage = sanitizeUserFacingProgressMessage(eventData.message);

    const event: HermesMissionProgressEvent = {
      ...eventData,
      id,
      timestamp,
      message: sanitizedMessage || eventData.message,
    };

    // Store in history
    let history = this.recentEvents.get(event.missionId);
    if (!history) {
      history = [];
      this.recentEvents.set(event.missionId, history);
    }
    history.push(event);
    if (history.length > this.maxHistoryPerMission) {
      history.shift();
    }

    // Emit mission-specific event
    this.emit('mission:' + event.missionId, event);
    if (event.conversationId) {
      this.emit('conversation:' + event.conversationId, event);
    }
    // Emit global progress event
    this.emit('progress', event);

    logger.debug('[HermesProgressBus] [' + event.phase + '] (' + event.type + '): ' + event.message, {
      missionId: event.missionId,
      taskId: event.taskId,
      conversationId: event.conversationId,
    });

    return event;
  }

  /**
   * Subscribes to events for a specific mission.
   */
  public onMission(missionId: string, listener: (event: HermesMissionProgressEvent) => void): () => void {
    const eventName = 'mission:' + missionId;
    this.on(eventName, listener);
    return () => this.off(eventName, listener);
  }

  /**
   * Subscribes to events for a specific conversation.
   */
  public onConversation(conversationId: string, listener: (event: HermesMissionProgressEvent) => void): () => void {
    const eventName = 'conversation:' + conversationId;
    this.on(eventName, listener);
    return () => this.off(eventName, listener);
  }

  /**
   * Retrieves recent events for a mission (replay / catch-up).
   */
  public getRecentEvents(missionId: string): HermesMissionProgressEvent[] {
    return [...(this.recentEvents.get(missionId) || [])];
  }

  /**
   * Starts a heartbeat ticker that emits a periodic status update if no event was
   * emitted for over silenceThresholdMs. Prevents user silence during long inference tasks.
   */
  public startHeartbeat(
    missionId: string,
    getStatus: () => { phase: string; cycle: number; taskId?: string; conversationId?: string },
    intervalMs: number = 12000,
    silenceThresholdMs: number = 14000
  ): () => void {
    let lastEmitTime = Date.now();

    const onAnyEvent = (ev: HermesMissionProgressEvent) => {
      if (ev.missionId === missionId) {
        lastEmitTime = Date.now();
      }
    };

    this.on('mission:' + missionId, onAnyEvent);

    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastEmitTime >= silenceThresholdMs) {
        const { phase, cycle, taskId, conversationId } = getStatus();
        let message = 'Hermes is actively processing (Phase: ' + phase + ', Cycle: ' + cycle + ')...';
        if (phase === 'observing') message = 'Inspecting workspace environment and files...';
        if (phase === 'planning') message = 'Formulating autonomous execution plan...';
        if (phase === 'executing') message = 'Executing code edits and running commands...';
        if (phase === 'verifying') message = 'Running automated verification and tests...';
        if (phase === 'repairing') message = 'Autonomous repair cycle ' + cycle + ' in progress...';

        this.emitProgress({
          missionId,
          taskId,
          conversationId,
          phase,
          type: 'MISSION_PROGRESS',
          status: 'running',
          message,
        });
        lastEmitTime = now;
      }
    }, intervalMs);

    return () => {
      clearInterval(timer);
      this.off('mission:' + missionId, onAnyEvent);
    };
  }

  /**
   * Cleans up history for a mission.
   */
  public clearMission(missionId: string): void {
    this.recentEvents.delete(missionId);
    this.removeAllListeners('mission:' + missionId);
  }
}

export const hermesProgressBus = new HermesProgressBus();
