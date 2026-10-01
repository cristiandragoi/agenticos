/**
 * voiceTurnManager.ts — Turn Ownership, Interruption, and TTS Synthesis for Jarvis V2.
 *
 * Requirements:
 * 1. Strict Turn Ownership:
 *    Every turn has conversationId, operationId, turnId.
 *    State: idle | listening | end_of_turn | transcribing | thinking | speaking | interrupted.
 * 2. Barge-in & Interruption:
 *    When turn N is interrupted by turn N+1:
 *    - abort turn N model/stream
 *    - stop TTS for N immediately
 *    - N must never speak again
 *    - N+1 becomes authoritative
 * 3. Stale TTS Rejection:
 *    Only the currently active turn may synthesize or emit speech.
 */

import { logger } from '../../utils/logger.js';
import { sanitizeMarkdownForSpeech } from '../../utils/speechSanitizer.js';
import { synthesizeLocally, resolveVoiceForLanguage } from '../../services/voice/localTts.js';

export type VoiceTurnState =
  | 'idle'
  | 'listening'
  | 'end_of_turn'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted';

export interface ActiveVoiceTurn {
  conversationId: string;
  operationId: string;
  turnId: number;
  state: VoiceTurnState;
  startedAt: number;
  abortController: AbortController;
  ttsAbortController: AbortController;
  ttsStartedAt?: number;
  ttsCompletedAt?: number;
  interruptedByTurnId?: number;
  responseText?: string;
}

class VoiceTurnManager {
  private activeTurns = new Map<string, ActiveVoiceTurn>();

  /**
   * Starts or registers a new voice turn.
   * If a previous turn is in progress, interrupts it immediately.
   */
  startVoiceTurn(
    conversationId: string,
    operationId: string,
    turnId: number
  ): ActiveVoiceTurn {
    const existing = this.activeTurns.get(conversationId);
    if (existing && existing.state !== 'idle' && existing.state !== 'interrupted') {
      this.interruptVoiceTurn(conversationId, turnId);
    }

    const turn: ActiveVoiceTurn = {
      conversationId,
      operationId,
      turnId,
      state: 'thinking',
      startedAt: Date.now(),
      abortController: new AbortController(),
      ttsAbortController: new AbortController(),
    };

    this.activeTurns.set(conversationId, turn);
    logger.info(`[VoiceV2] Turn ${turnId} started for ${conversationId} (op: ${operationId})`);
    return turn;
  }

  /**
   * Immediately interrupts the active turn (Barge-in / Stop).
   * Stops TTS and invalidates the speaking turn.
   */
  interruptVoiceTurn(
    conversationId: string,
    interruptingTurnId?: number
  ): { interrupted: boolean; previousTurnId?: number; latencyMs: number } {
    const turn = this.activeTurns.get(conversationId);
    if (!turn) {
      return { interrupted: false, latencyMs: 0 };
    }

    const now = Date.now();
    const latencyMs = turn.ttsStartedAt ? now - turn.ttsStartedAt : now - turn.startedAt;

    turn.abortController.abort();
    turn.ttsAbortController.abort();
    turn.state = 'interrupted';
    turn.interruptedByTurnId = interruptingTurnId;

    logger.info(
      `[VoiceV2] Turn ${turn.turnId} interrupted by turn ${interruptingTurnId ?? 'STOP'} ` +
      `(${latencyMs}ms elapsed)`
    );

    return {
      interrupted: true,
      previousTurnId: turn.turnId,
      latencyMs: Math.max(1, latencyMs),
    };
  }

  /**
   * Retrieves the current turn for a conversation.
   */
  getActiveTurn(conversationId: string): ActiveVoiceTurn | null {
    return this.activeTurns.get(conversationId) || null;
  }

  /**
   * Synthesizes TTS for a turn, verifying that the turn still owns speech rights.
   */
  async synthesizeTurnTts(
    conversationId: string,
    turnId: number,
    rawText: string,
    voiceName?: string
  ): Promise<{ audioBuffer: Buffer | null; dropped: boolean; reason?: string }> {
    const turn = this.activeTurns.get(conversationId);

    // Strict Turn Ownership Check: Stale TTS Rejection
    if (!turn || turn.turnId !== turnId) {
      logger.warn(`[VoiceV2] Rejected stale TTS synthesis for turn ${turnId} (active: ${turn?.turnId})`);
      return { audioBuffer: null, dropped: true, reason: 'Turn ID mismatch (stale turn)' };
    }

    if (turn.state === 'interrupted' || turn.ttsAbortController.signal.aborted) {
      logger.warn(`[VoiceV2] Rejected TTS synthesis for interrupted turn ${turnId}`);
      return { audioBuffer: null, dropped: true, reason: 'Turn was interrupted before speech synthesis' };
    }

    const cleanText = sanitizeMarkdownForSpeech(rawText) || rawText;
    if (!cleanText.trim()) {
      turn.state = 'idle';
      return { audioBuffer: null, dropped: false };
    }

    turn.state = 'speaking';
    turn.ttsStartedAt = Date.now();

    try {
      const resolvedVoice = resolveVoiceForLanguage('en', voiceName);
      const audioBuffer = await synthesizeLocally(cleanText, resolvedVoice);

      // Re-verify turn has not been interrupted while synthesis was running
      if ((turn.state as string) === 'interrupted' || turn.ttsAbortController.signal.aborted) {
        logger.warn(`[VoiceV2] Dropped audio output because turn ${turnId} was interrupted during synthesis`);
        return { audioBuffer: null, dropped: true, reason: 'Turn interrupted during synthesis' };
      }

      turn.ttsCompletedAt = Date.now();
      turn.state = 'idle';
      return { audioBuffer, dropped: false };
    } catch (err: any) {
      turn.state = 'idle';
      logger.error(`[VoiceV2] TTS synthesis error for turn ${turnId}:`, err);
      return { audioBuffer: null, dropped: false, reason: err?.message };
    }
  }
}

export const voiceTurnManager = new VoiceTurnManager();
