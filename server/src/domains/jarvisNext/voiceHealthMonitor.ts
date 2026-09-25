/**
 * voiceHealthMonitor.ts — Real-time capability health monitoring for the voice pipeline:
 * - VOICE_CAPTURE
 * - VAD_ENDPOINTING
 * - STT_FINALIZATION
 * - TURN_COMMIT
 *
 * If repeated real physical turns exhibit premature endpointing, abnormal transcript truncation,
 * or repeated clarification, it creates an internal capability failure incident for Self-Heal.
 */

import { logger } from '../../utils/logger.js';
import { failureDetector } from '../selfHeal/FailureDetector.js';

export interface VoiceTurnRecord {
  turnId: number;
  captureStart: number;
  captureStop: number;
  rawDurationMs: number;
  rawPcmBytes: number;
  vadSpeechStart: number;
  vadSpeechEnd: number;
  endpointReason: string;
  wavPath: string;
  whisperFinalTranscript: string;
  routerTranscript: string;
  normalizedTranscript: string;
  route: string;
  finalResponse: string;
  isBargeIn: boolean;
  isAbnormalEarlyEndpoint: boolean;
  isClarification: boolean;
  isBareEntityFallback: boolean;
}

class VoiceHealthMonitor {
  private recentTurns: VoiceTurnRecord[] = [];
  private readonly WINDOW_SIZE = 5;
  private readonly FAILURE_THRESHOLD = 3;
  private incidentTriggered = false;

  public recordTurn(record: VoiceTurnRecord): void {
    this.recentTurns.push(record);
    if (this.recentTurns.length > this.WINDOW_SIZE) {
      this.recentTurns.shift();
    }

    this.evaluatePipelineHealth();
  }

  private evaluatePipelineHealth(): void {
    if (this.recentTurns.length < 3) return;

    // Check for abnormal premature endpointing or repeated clarification
    const abnormalTurns = this.recentTurns.filter(
      (t) => t.isAbnormalEarlyEndpoint || (t.isClarification && t.rawDurationMs < 1500) || t.isBareEntityFallback
    );

    logger.info('[VoiceHealthMonitor] Evaluation snapshot', {
      totalTurnsInWindow: this.recentTurns.length,
      abnormalTurns: abnormalTurns.length,
      threshold: this.FAILURE_THRESHOLD,
    });

    if (abnormalTurns.length >= this.FAILURE_THRESHOLD && !this.incidentTriggered) {
      this.incidentTriggered = true;
      const evidence = `${abnormalTurns.length} of last ${this.recentTurns.length} physical turns ended abnormally early or produced premature clarifications`;

      logger.warn('[VoiceHealthMonitor] CAPABILITY_FAILURE: voice_turn_finalization triggered!', {
        evidence,
        abnormalTurnIds: abnormalTurns.map((t) => t.turnId),
      });

      console.log(`\n======================================================`);
      console.log(`[CAPABILITY_FAILURE] voice_turn_finalization`);
      console.log(`EVIDENCE: ${evidence}`);
      console.log(`======================================================\n`);

      try {
        const incidentId = failureDetector.createManualIncident(
          'voice_turn_finalization',
          evidence,
          'voice' as any,
          'high',
          {
            abnormalTurnIds: abnormalTurns.map((t) => t.turnId),
            recentTurns: this.recentTurns.map((t) => ({
              turnId: t.turnId,
              durationMs: t.rawDurationMs,
              transcript: t.whisperFinalTranscript,
              route: t.route,
              response: t.finalResponse,
            })),
          }
        );
        logger.info('[VoiceHealthMonitor] Self-Heal capability incident created:', { incidentId });
      } catch (err: any) {
        logger.error('[VoiceHealthMonitor] Failed to create self-heal incident:', err?.message || err);
      }
    } else if (abnormalTurns.length === 0 && this.incidentTriggered) {
      // Pipeline recovered
      this.incidentTriggered = false;
      logger.info('[VoiceHealthMonitor] Voice pipeline health recovered to normal operation.');
    }
  }

  public reset(): void {
    this.recentTurns = [];
    this.incidentTriggered = false;
  }

  public getRecentTurns(): VoiceTurnRecord[] {
    return [...this.recentTurns];
  }
}

export const voiceHealthMonitor = new VoiceHealthMonitor();
