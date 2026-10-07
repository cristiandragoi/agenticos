/**
 * AdaptiveTurnEndpoint.ts — Adaptive Turn Endpointing & Incomplete Sentence Protection
 *
 * PHASE 6A VOICE RUNTIME COMPONENT
 *
 * Implements modern LiveKit Agents turn-detection patterns:
 * 1. Short Complete Commands ("Yes.", "Open Chrome.", "Read point two.") endpoint fast (~300ms)
 *    to eliminate dead air.
 * 2. Incomplete Speech ("Can you open Telegram and...") expands the pause threshold (~1800ms)
 *    so Christian is not cut off while thinking.
 * 3. Default conversational pause settles at ~750ms (down from 1600ms).
 */

export interface EndpointEvaluation {
  silenceThresholdMs: number;
  isShortComplete: boolean;
  isIncomplete: boolean;
  reason: string;
}

const INCOMPLETE_TRAILING_WORDS = new Set([
  'and', 'or', 'but', 'because', 'so', 'plus', 'yet',
  'to', 'for', 'with', 'in', 'at', 'from', 'into', 'on', 'about',
  'that', 'which', 'where', 'who', 'if', 'while', 'when', 'then',
  'the', 'a', 'an', 'this', 'these', 'those', 'my', 'your',
  'uh', 'um', 'er', 'ah', 'like', 'well',
]);

const SHORT_COMPLETE_PATTERNS = [
  /^(?:yes|no|yep|nope|sure|okay|ok|stop|cancel|proceed|continue|halt|quiet|silence)\.?$/i,
  /^(?:open|launch|start|focus)\s+[\w\s]{2,20}\.?$/i,
  /^(?:close|quit|kill|exit)\s+[\w\s]{2,20}\.?$/i,
  /^(?:read|check|show)\s+(?:point\s+\w+|[\w\s]{2,20})\.?$/i,
  /^(?:navigate\s+to|go\s+to)\s+[\w\s]{2,25}\.?$/i,
];

export class AdaptiveTurnEndpoint {
  public static readonly SHORT_COMMAND_SILENCE_MS = 300;
  public static readonly DEFAULT_SILENCE_MS = 750;
  public static readonly INCOMPLETE_SILENCE_MS = 1800;

  /**
   * Checks if candidate transcript ends with an incomplete connector or hesitation.
   */
  public static isIncompleteSpeech(text: string): boolean {
    if (!text || !text.trim()) return false;
    const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = clean.split(' ');
    if (words.length === 0) return false;

    const lastWord = words[words.length - 1];
    if (INCOMPLETE_TRAILING_WORDS.has(lastWord)) {
      return true;
    }

    // Trailing ellipses or trailing dashes indicating mid-thought pause
    if (/\.{2,}$|—$|-$/.test(text.trim())) {
      return true;
    }

    return false;
  }

  /**
   * Checks if candidate transcript represents a decisive, short complete command.
   */
  public static isShortCompleteCommand(text: string): boolean {
    if (!text || !text.trim()) return false;
    const clean = text.trim();
    const wordCount = clean.split(/\s+/).length;

    if (wordCount > 6) return false;

    for (const pattern of SHORT_COMPLETE_PATTERNS) {
      if (pattern.test(clean)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Computes the adaptive silence threshold based on accumulated speech context.
   */
  public static evaluateEndpoint(
    accumulatedAudioMs: number,
    candidateText?: string
  ): EndpointEvaluation {
    if (!candidateText || !candidateText.trim()) {
      // Audio-duration based adaptive endpointing (pre-STT speech accumulation):
      // - Very short burst (< 600ms): rapid settle (450ms) for snappy acknowledgements ("Yes", "No", "Stop")
      // - Substantial phrase (>= 600ms): clause/pause protection (1000ms) to prevent premature cut-off during natural pauses like "Open Telegram and... [pause 700ms]"
      if (accumulatedAudioMs < 600) {
        return {
          silenceThresholdMs: 450,
          isShortComplete: true,
          isIncomplete: false,
          reason: 'short_audio_burst',
        };
      }
      return {
        silenceThresholdMs: 1000,
        isShortComplete: false,
        isIncomplete: false,
        reason: 'pause_protected_speech',
      };
    }

    // 1. Check for incomplete trailing speech
    if (this.isIncompleteSpeech(candidateText)) {
      return {
        silenceThresholdMs: this.INCOMPLETE_SILENCE_MS,
        isShortComplete: false,
        isIncomplete: true,
        reason: 'incomplete_trailing_connector',
      };
    }

    // 2. Check for short complete command
    if (this.isShortCompleteCommand(candidateText)) {
      return {
        silenceThresholdMs: this.SHORT_COMMAND_SILENCE_MS,
        isShortComplete: true,
        isIncomplete: false,
        reason: 'short_complete_command',
      };
    }

    // 3. Normal conversational sentence
    return {
      silenceThresholdMs: this.DEFAULT_SILENCE_MS,
      isShortComplete: false,
      isIncomplete: false,
      reason: 'standard_conversational_turn',
    };
  }
}
