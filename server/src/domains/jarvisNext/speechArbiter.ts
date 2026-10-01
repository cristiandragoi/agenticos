/**
 * speechArbiter.ts — Single Voice Output Authority for Jarvis.
 *
 * ALL speech must be routed through this module. No subsystem (Hermes, Revenue
 * Operator, Self-Heal, background tasks, scheduler, approval gates) may call
 * jarvisNextAgent.speak() or synthesizeLocally() directly.
 *
 * Priority Levels:
 *   P0 = user interruption / stop     → handled by handleStopCommand(), bypasses queue
 *   P1 = answer to current user turn  → always plays, interrupts P2-P5
 *   P2 = explicitly requested update  → queued, plays after P1 completes
 *   P3 = human approval required      → queued, plays after P1 completes
 *   P4 = background task completion   → silently dropped during active user turn
 *   P5 = informational status         → silently dropped during active user turn
 *
 * Stale Turn Cancellation:
 *   Any request that carries a `turnId` that does not match `currentActiveTurnId`
 *   is discarded before TTS synthesis even begins.
 */

import { logger } from '../../utils/logger.js';

export enum SpeechPriority {
  P0_STOP = 0,
  P1_USER_TURN = 1,
  P2_PROGRESS = 2,
  P3_APPROVAL = 3,
  P4_BACKGROUND = 4,
  P5_STATUS = 5,
}

export interface SpeechRequest {
  text: string;
  priority: SpeechPriority;
  /** The turn ID this speech was generated for. Required for background callers. */
  turnId?: number;
  originTurnId?: number;
  voiceSessionId?: string;
  utteranceId?: string;
  operationId?: string;
  responseId?: string;
  responseType?: string;
  createdAt?: number;
  deliveryStatus?: 'admitted' | 'rejected' | 'queued' | 'dropped_stale';
  /** Descriptive source label for logging (e.g. 'hermes', 'revenue_operator'). */
  source?: string;
  /** Semantic event type (e.g. 'user_response', 'gate_notification', 'worker_event'). */
  eventType?: string;
}

type SpeakFn = (text: string, turnId?: number) => Promise<void>;

/**
 * Direct TTS callers BEFORE the arbiter was implemented.
 * These are the subsystems that previously bypassed the central authority.
 * After the arbiter is in place, all of them must route through `speechArbiter.request()`.
 */
export const DIRECT_TTS_CALLERS_BEFORE = [
  'hermes_events',
  'revenue_operator_events',
  'self_heal_supervisor',
  'background_task_manager',
  'scheduler_events',
  'approval_gate',
  'jarvis_next_router_speak_endpoint',
  'voice_router_speak_endpoint',
];

class SpeechArbiterImpl {
  private speakFn: SpeakFn | null = null;
  private getCurrentTurnId: (() => number) | null = null;
  private isUserTurnActive: (() => boolean) | null = null;
  private isSpeaking: (() => boolean) | null = null;

  /** Max queued items for P2/P3 while foreground is busy. */
  private readonly MAX_QUEUE_DEPTH = 3;
  private queue: SpeechRequest[] = [];

  /** Cooldown between unsolicited background announcements to prevent spam chatter. */
  private lastBackgroundSpeechTime = 0;
  private readonly BACKGROUND_SPEECH_COOLDOWN_MS = 8000;

  /**
   * Register the arbiter with the JarvisNextAgent instance.
   * Must be called once during agent initialization.
   */
  register(opts: {
    speakFn: SpeakFn;
    getCurrentTurnId: () => number;
    isUserTurnActive: () => boolean;
    isSpeaking?: () => boolean;
  }): void {
    this.speakFn = opts.speakFn;
    this.getCurrentTurnId = opts.getCurrentTurnId;
    this.isUserTurnActive = opts.isUserTurnActive;
    this.isSpeaking = opts.isSpeaking ?? null;
    this.lastBackgroundSpeechTime = 0;
    this.queue = [];
    logger.info('[SpeechArbiter] Registered. Single voice output authority ACTIVE.');
    logger.info('[SpeechArbiter] DIRECT_TTS_CALLERS_BEFORE:', DIRECT_TTS_CALLERS_BEFORE);
    logger.info('[SpeechArbiter] DIRECT_TTS_CALLERS_AFTER: [jarvisNextAgent internal speak path only]');
  }

  get isReady(): boolean {
    return this.speakFn !== null;
  }

  /**
   * Request speech output through the arbiter.
   *
   * Returns `true` if the speech was accepted (will be played).
   * Returns `false` if dropped (stale turn, foreground blocked, arbiter not ready).
   *
   * P1 callers (internal Jarvis turn responses) bypass the queue entirely and play
   * immediately. P2-P5 callers are queued or dropped based on foreground state.
   */
  async request(req: SpeechRequest): Promise<boolean> {
    const { text, priority, turnId, source = 'unknown' } = req;
    const currentTurn = this.getCurrentTurnId ? this.getCurrentTurnId() : (turnId ?? 0);
    const originTurnId = req.originTurnId ?? (turnId ?? currentTurn);
    const voiceSessionId = req.voiceSessionId || 'session-live';
    const utteranceId = req.utteranceId || `utt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const operationId = req.operationId || `op-${Date.now()}`;
    const responseId = req.responseId || `resp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const responseType = req.responseType || (priority === SpeechPriority.P1_USER_TURN ? 'direct_answer' : 'operational_status');
    const createdAt = req.createdAt || Date.now();
    const eventType = req.eventType || (priority === SpeechPriority.P1_USER_TURN ? 'user_turn_answer' : priority <= SpeechPriority.P3_APPROVAL ? 'human_action_gate' : 'background_progress');

    const logArbiterDecision = (admitted: boolean, reason: string) => {
      const trace = [
        `SPEECH_ARBITER_TRACE:`,
        `VOICE_SESSION_ID=${voiceSessionId}`,
        `UTTERANCE_ID=${utteranceId}`,
        `ORIGIN_TURN_ID=${originTurnId}`,
        `OPERATION_ID=${operationId}`,
        `RESPONSE_ID=${responseId}`,
        `RESPONSE_TYPE=${responseType}`,
        `CREATED_AT=${createdAt}`,
        `DELIVERY_STATUS=${admitted ? 'admitted' : 'rejected'}`,
        `SOURCE=${source}`,
        `EVENT_TYPE=${eventType}`,
        `PRIORITY=P${priority}`,
        `TEXT=${text.replace(/\r?\n/g, ' ')}`,
        `CURRENT_FOREGROUND_TURN=${currentTurn}`,
        `ADMITTED_OR_REJECTED=${admitted ? 'ADMITTED' : 'REJECTED'}`,
        `REASON=${reason}`,
      ].join('\n');
      console.log(`[JRT] ${trace}`);
      logger.info('[JRT] SPEECH_ARBITER_TRACE', { trace });
    };

    if (!text?.trim()) {
      logger.debug('[SpeechArbiter] Dropped empty speech request.', { source, priority });
      logArbiterDecision(false, 'empty_text');
      return false;
    }

    if (!this.speakFn) {
      logger.warn('[SpeechArbiter] Not registered — dropping speech request.', { source, priority });
      logArbiterDecision(false, 'arbiter_not_registered');
      return false;
    }

    // ── Stale turn check: obsolete speech from superseded turn is discarded ───
    if (this.getCurrentTurnId) {
      if (originTurnId < currentTurn || (turnId !== undefined && turnId < currentTurn)) {
        logArbiterDecision(false, `superseded_stale_turn (origin=${originTurnId} active=${currentTurn})`);
        return false;
      }
    }

    // ── Clean background speech: never speak internal IDs / database rows ───
    let speakableText = text;
    if (priority >= SpeechPriority.P2_PROGRESS) {
      speakableText = text
        .replace(/Gate\s+gate-[a-f0-9-]+,?\s*/gi, '')
        .replace(/task\s+(?:bgtask|expt)-[a-f0-9-]+:?\s*/gi, '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\b(?:gate_id|task_id|project_id|experiment_id)\b[^\s,.]*/gi, '')
        .replace(/"Based on my research[\s\S]*$/gi, 'product research review is ready.')
        .replace(/\s+/g, ' ')
        .trim();
      if (/^Human action required\b/i.test(speakableText)) {
        speakableText = speakableText.replace(/^Human action required\s*—?\s*:?\s*/i, 'One other thing: ');
      }
    }

    // ── P1: user turn answer — always plays, callers already handle interruption ──
    if (priority === SpeechPriority.P1_USER_TURN) {
      logArbiterDecision(true, 'p1_user_turn_answer');
      await this.speakFn(speakableText, turnId);
      return true;
    }

    // ── P2/P3: queue if foreground is active or speaking, play immediately if not ──
    if (priority === SpeechPriority.P2_PROGRESS || priority === SpeechPriority.P3_APPROVAL) {
      if (this.isUserTurnActive?.() || this.isSpeaking?.()) {
        logArbiterDecision(true, `queued_behind_active_turn (queue_depth=${this.queue.length + 1})`);
        this.enqueue({ ...req, text: speakableText });
        return true;
      }
      logArbiterDecision(true, 'idle_direct_playback');
      void this.speakFn(speakableText, turnId).catch((err: any) => {
        logger.warn('[SpeechArbiter] Playback error:', err?.message);
      });
      return true;
    }

    // ── P4/P5: silently dropped during active user conversation or if already speaking ──
    if (this.isUserTurnActive?.() || this.isSpeaking?.()) {
      logArbiterDecision(false, 'foreground_active_or_speaking');
      return false;
    }

    // Rate-limiting / deduplicating unsolicited background messages
    if (priority >= SpeechPriority.P4_BACKGROUND) {
      const now = Date.now();
      if (now - this.lastBackgroundSpeechTime < this.BACKGROUND_SPEECH_COOLDOWN_MS) {
        logArbiterDecision(false, 'cooldown_active');
        return false;
      }
      this.lastBackgroundSpeechTime = now;
    }

    // Foreground idle: play P4/P5 background speech
    logArbiterDecision(true, 'idle_background_playback');
    void this.speakFn(speakableText, turnId).catch((err: any) => {
      logger.warn('[SpeechArbiter] Playback error:', err?.message);
    });
    return true;
  }

  /**
   * Call this when the user turn latch is released (foreground turn complete).
   * Drains the highest-priority item from the queue (P2 > P3).
   */
  async onUserTurnComplete(): Promise<void> {
    if (this.queue.length === 0 || !this.speakFn) return;
    const currentTurn = this.getCurrentTurnId ? this.getCurrentTurnId() : undefined;
    // Discard any items from older turns (stale-turn leakage prevention)
    this.queue = this.queue.filter(
      (item) => item.turnId === undefined || currentTurn === undefined || item.turnId === currentTurn
    );
    if (this.queue.length === 0) return;

    // Sort ascending by priority (P2 before P3)
    this.queue.sort((a, b) => a.priority - b.priority);
    const next = this.queue.shift();
    if (next) {
      console.log(
        `[SpeechArbiter] QUEUE_DRAIN source=${next.source || 'unknown'} P${next.priority}`,
      );
      await this.speakFn(next.text, next.turnId).catch((err: any) => {
        logger.warn('[SpeechArbiter] Queued speech error:', err?.message);
      });
    }
  }

  /** Flush all queued items (call on stop/disconnect). */
  flush(): void {
    if (this.queue.length > 0) {
      logger.info('[SpeechArbiter] Flushing speech queue:', { depth: this.queue.length });
      this.queue = [];
    }
  }

  private enqueue(req: SpeechRequest): void {
    if (this.queue.length >= this.MAX_QUEUE_DEPTH) {
      const dropped = this.queue.shift();
      logger.debug('[SpeechArbiter] Queue overflow — dropping oldest item:', {
        dropped: dropped?.source,
        priority: dropped?.priority,
      });
    }
    this.queue.push(req);
  }

  /** Diagnostic snapshot for health / monitoring. */
  snapshot(): {
    registered: boolean;
    queueDepth: number;
    foregroundActive: boolean;
    directCallersBeforeArbiter: string[];
    directCallersAfterArbiter: string[];
  } {
    return {
      registered: this.isReady,
      queueDepth: this.queue.length,
      foregroundActive: this.isUserTurnActive?.() ?? false,
      directCallersBeforeArbiter: DIRECT_TTS_CALLERS_BEFORE,
      directCallersAfterArbiter: [],
    };
  }
}

/** Global singleton — one voice output authority for the entire process. */
export const speechArbiter = new SpeechArbiterImpl();
