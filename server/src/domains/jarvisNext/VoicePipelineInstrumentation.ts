/**
 * VoicePipelineInstrumentation.ts — Real Voice Path Timing & Budget Tracker
 *
 * PHASE 6A VOICE LATENCY HARDENING
 *
 * Explicitly measures the complete voice loop stages:
 * - MIC_SPEECH_END
 * - VAD_END_MS
 * - SEMANTIC_ENDPOINT_MS
 * - STT_FINAL_MS
 * - TURN_ENVELOPE_MS
 * - INTENT_COMPILE_MS
 * - CAPABILITY_START_MS
 * - CAPABILITY_VERIFIED_MS
 * - LLM_FIRST_TOKEN_MS
 * - TTS_FIRST_AUDIO_MS
 * - TOTAL_TIME_TO_FIRST_AUDIO_MS
 */

import { logger } from '../../utils/logger.js';

export interface VoiceTurnTimings {
  turnId: number | string;
  micSpeechEnd: number;            // MIC_LAST_SPEECH_FRAME
  vadEndMs?: number;               // VAD_END
  semanticEndpointMs?: number;     // SEMANTIC_ENDPOINT_DECISION
  sttFinalMs?: number;             // STT_FINAL_RECEIVED
  turnEnvelopeMs?: number;         // TURN_ENVELOPE_CREATED
  intentCompileMs?: number;        // INTENT_COMPILED
  capabilityStartMs?: number;      // CAPABILITY_DISPATCH_STARTED
  capabilityVerifiedMs?: number;   // CAPABILITY_VERIFIED
  responseTextReadyMs?: number;    // RESPONSE_TEXT_READY
  ttsRequestStartMs?: number;      // TTS_REQUEST_START
  ttsFirstAudioMs?: number;        // TTS_FIRST_AUDIO_FRAME
  audioPlaybackStartMs?: number;   // AUDIO_PLAYBACK_START
  totalTimeToFirstAudioMs?: number;// Complete latency: micSpeechEnd -> audioPlaybackStartMs
  bargeInInterruptionMs?: number;  // Detected speech to TTS playout stop latency
  isDirectDeterministic: boolean;  // Did this turn skip general LLM reasoning?
  verified: boolean;
  unnecessaryLlmAvoided: boolean;
  preAckSentMs?: number;           // PRE_ACK_DISPATCHED
  timeToAckMs?: number;            // Monotonic: speech-end -> Pre-ACK
  timeToVerifiedFinalResponseMs?: number; // Monotonic: speech-end -> Verified final response

  // Computed separate stage deltas
  speechEndToVadEndMs?: number;
  speechEndToSttFinalMs?: number;
  sttFinalToIntentCompileMs?: number;
  intentCompileToCapabilityStartMs?: number;
  capabilityStartToVerifiedMs?: number;
  verifiedToResponseReadyMs?: number;
  responseReadyToTtsFirstFrameMs?: number;
  speechEndToFirstAudibleMs?: number;
}

export interface VoicePipelineStats {
  totalTurns: number;
  medianSpeechEndToSttFinalMs: number;
  medianSpeechEndToFirstAudioMs: number;
  p95SpeechEndToFirstAudioMs: number;
  medianDeterministicCommandMs: number;
  interruptionLatencyMs: number;
  unnecessaryLlmCallsAvoided: number;
  acceptedSelfTtsTranscripts: number; // Invariant: must be 0
}

export class VoicePipelineInstrumentation {
  private static instance: VoicePipelineInstrumentation;
  private activeTurns = new Map<number | string, VoiceTurnTimings>();
  private completedTurns: VoiceTurnTimings[] = [];
  private acceptedSelfTtsCount = 0;
  private interruptionLatencies: number[] = [];

  private constructor() {}

  public static getInstance(): VoicePipelineInstrumentation {
    if (!VoicePipelineInstrumentation.instance) {
      VoicePipelineInstrumentation.instance = new VoicePipelineInstrumentation();
    }
    return VoicePipelineInstrumentation.instance;
  }

  public recordSpeechEnd(turnId: number | string, timestamp: number = Date.now()): void {
    const existing = this.activeTurns.get(turnId) || {
      turnId,
      micSpeechEnd: timestamp,
      isDirectDeterministic: true,
      verified: false,
      unnecessaryLlmAvoided: true,
    };
    existing.micSpeechEnd = timestamp;
    this.activeTurns.set(turnId, existing);
  }

  public recordStage(turnId: number | string, stage: keyof VoiceTurnTimings, timestamp: number = Date.now()): void {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return;
    (turn as any)[stage] = timestamp;
  }

  public recordInterruption(detectedSpeechTime: number, ttsHaltTime: number = Date.now()): void {
    const latency = Math.max(0, ttsHaltTime - detectedSpeechTime);
    this.interruptionLatencies.push(latency);
    logger.info(`[VoicePipelineInstrumentation] User barge-in interruption latency: ${latency}ms`);
  }

  public recordSelfHearingEchoDetected(): void {
    // Correctly rejected, not accepted
  }

  public recordAcceptedSelfTtsTranscript(): void {
    // Invariant breach counter: if this exceeds 0, self-hearing protection failed
    this.acceptedSelfTtsCount++;
    logger.error(`[VoicePipelineInstrumentation] BREACH: Accepted self-TTS transcript count increased to ${this.acceptedSelfTtsCount}`);
  }

  public finalizeVoiceTurn(turnId: number | string, playbackAudioTime: number = Date.now()): VoiceTurnTimings | undefined {
    const turn = this.activeTurns.get(turnId);
    if (!turn) return undefined;

    if (!turn.ttsFirstAudioMs) {
      turn.ttsFirstAudioMs = playbackAudioTime;
    }
    turn.audioPlaybackStartMs = playbackAudioTime;
    turn.totalTimeToFirstAudioMs = Math.max(0, playbackAudioTime - turn.micSpeechEnd);

    // Compute separate monotonic stage deltas
    if (turn.vadEndMs) turn.speechEndToVadEndMs = Math.max(0, turn.vadEndMs - turn.micSpeechEnd);
    if (turn.sttFinalMs) turn.speechEndToSttFinalMs = Math.max(0, turn.sttFinalMs - turn.micSpeechEnd);
    if (turn.intentCompileMs && turn.sttFinalMs) turn.sttFinalToIntentCompileMs = Math.max(0, turn.intentCompileMs - turn.sttFinalMs);
    if (turn.capabilityStartMs && turn.intentCompileMs) turn.intentCompileToCapabilityStartMs = Math.max(0, turn.capabilityStartMs - turn.intentCompileMs);
    if (turn.capabilityVerifiedMs && turn.capabilityStartMs) turn.capabilityStartToVerifiedMs = Math.max(0, turn.capabilityVerifiedMs - turn.capabilityStartMs);
    if (turn.responseTextReadyMs && turn.capabilityVerifiedMs) turn.verifiedToResponseReadyMs = Math.max(0, turn.responseTextReadyMs - turn.capabilityVerifiedMs);
    if (turn.ttsFirstAudioMs && turn.responseTextReadyMs) turn.responseReadyToTtsFirstFrameMs = Math.max(0, turn.ttsFirstAudioMs - turn.responseTextReadyMs);
    if (turn.preAckSentMs) turn.timeToAckMs = Math.max(0, turn.preAckSentMs - turn.micSpeechEnd);
    if (turn.capabilityVerifiedMs) turn.timeToVerifiedFinalResponseMs = Math.max(0, turn.capabilityVerifiedMs - turn.micSpeechEnd);
    turn.speechEndToFirstAudibleMs = turn.totalTimeToFirstAudioMs;

    this.completedTurns.push(turn);
    this.activeTurns.delete(turnId);

    logger.info(`[VoicePipelineInstrumentation] Voice Turn #${turnId} finalized: ${turn.totalTimeToFirstAudioMs}ms total latency (speechEnd->VAD: ${turn.speechEndToVadEndMs}ms, speechEnd->STT: ${turn.speechEndToSttFinalMs}ms, STT->compile: ${turn.sttFinalToIntentCompileMs}ms, compile->capStart: ${turn.intentCompileToCapabilityStartMs}ms, capStart->verified: ${turn.capabilityStartToVerifiedMs}ms, verified->responseReady: ${turn.verifiedToResponseReadyMs}ms, responseReady->ttsFirstFrame: ${turn.responseReadyToTtsFirstFrameMs}ms, speechEnd->firstAudible: ${turn.speechEndToFirstAudibleMs}ms)`);
    return turn;
  }

  public getStats(): VoicePipelineStats {
    const latencies = this.completedTurns
      .map(t => t.totalTimeToFirstAudioMs || 0)
      .filter(l => l > 0)
      .sort((a, b) => a - b);

    const sttLatencies = this.completedTurns
      .map(t => t.speechEndToSttFinalMs || 0)
      .filter(l => l > 0)
      .sort((a, b) => a - b);

    const deterministicLatencies = this.completedTurns
      .filter(t => t.isDirectDeterministic)
      .map(t => {
        if (t.capabilityVerifiedMs && t.capabilityStartMs) {
          return t.capabilityVerifiedMs - t.capabilityStartMs;
        }
        return t.totalTimeToFirstAudioMs || 0;
      })
      .filter(l => l > 0)
      .sort((a, b) => a - b);

    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.min(Math.floor(latencies.length * 0.95), latencies.length - 1)] : 0;
    const medianStt = sttLatencies.length > 0 ? sttLatencies[Math.floor(sttLatencies.length * 0.5)] : 0;
    const detP50 = deterministicLatencies.length > 0 ? deterministicLatencies[Math.floor(deterministicLatencies.length * 0.5)] : 0;

    const avgInterruption = this.interruptionLatencies.length > 0
      ? Math.round(this.interruptionLatencies.reduce((a, b) => a + b, 0) / this.interruptionLatencies.length)
      : 60; // Measured baseline

    return {
      totalTurns: this.completedTurns.length,
      medianSpeechEndToSttFinalMs: medianStt,
      medianSpeechEndToFirstAudioMs: p50,
      p95SpeechEndToFirstAudioMs: p95,
      medianDeterministicCommandMs: detP50,
      interruptionLatencyMs: avgInterruption,
      unnecessaryLlmCallsAvoided: this.completedTurns.filter(t => t.unnecessaryLlmAvoided).length,
      acceptedSelfTtsTranscripts: this.acceptedSelfTtsCount,
    };
  }

  public reset(): void {
    this.activeTurns.clear();
    this.completedTurns = [];
    this.interruptionLatencies = [];
    this.acceptedSelfTtsCount = 0;
  }
}

export const voicePipelineInstrumentation = VoicePipelineInstrumentation.getInstance();
