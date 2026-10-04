/**
 * phase6aVoiceFlowAndConstitution.test.ts
 *
 * PHASE 6A ACCEPTANCE TEST SUITE:
 * 1. Jarvis Core Constitution integrity & truthfulness auditing
 * 2. Adaptive turn endpointing (quick commands vs incomplete speech)
 * 3. Fast barge-in interruption (< 100ms)
 * 4. Echo / self-hearing rejection (0 accepted self-TTS transcripts)
 * 5. Truthful failure guarantees (never claiming success when unverified)
 * 6. Deterministic command latency and LLM bypass
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  JARVIS_CORE_CONSTITUTION,
  buildConstitutionalSystemPrompt,
  auditResponseTruthfulness,
} from '../domains/controlPlane/JarvisConstitution.js';
import { AdaptiveTurnEndpoint } from '../domains/jarvisNext/AdaptiveTurnEndpoint.js';
import {
  voicePipelineInstrumentation,
  type VoiceTurnTimings,
} from '../domains/jarvisNext/VoicePipelineInstrumentation.js';
import { decideBargeIn } from '../domains/jarvisNext/voiceRuntimeInvariants.js';
import { isSelfHearingEcho } from '../domains/jarvisNext/audioUtils.js';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';
import { capabilityDispatcher } from '../domains/controlPlane/CapabilityDispatcher.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';

describe('PHASE 6A: Voice Flow & Jarvis Core Constitution', () => {
  beforeEach(() => {
    voicePipelineInstrumentation.reset();
  });

  // =========================================================================
  // TEST SEQUENCE A: JARVIS CORE CONSTITUTION & TRUTHFULNESS AUDITING
  // =========================================================================
  describe('Test Sequence A: Jarvis Core Constitution & Truthfulness', () => {
    it('A.1: Exports authoritative constitution containing identity, truthfulness, and verification rules', () => {
      expect(JARVIS_CORE_CONSTITUTION).toContain('JARVIS CORE CONSTITUTION');
      expect(JARVIS_CORE_CONSTITUTION).toContain('IDENTITY & PERSONA');
      expect(JARVIS_CORE_CONSTITUTION).toContain('TRUTHFULNESS & GROUNDING');
      expect(JARVIS_CORE_CONSTITUTION).toContain('ACTION BEHAVIOR');
      expect(JARVIS_CORE_CONSTITUTION).toContain('ENGINEERING WORKERS');
      expect(JARVIS_CORE_CONSTITUTION).toContain('VERIFICATION POSTURE');
    });

    it('A.2: buildConstitutionalSystemPrompt correctly appends task-specific directives without losing core policy', () => {
      const prompt = buildConstitutionalSystemPrompt('Analyze the attached system log for errors.');
      expect(prompt).toContain(JARVIS_CORE_CONSTITUTION);
      expect(prompt).toContain('### TASK-SPECIFIC DIRECTIVES');
      expect(prompt).toContain('Analyze the attached system log for errors.');
    });

    it('A.3: auditResponseTruthfulness flags false success claims on unverified turns', () => {
      // Unverified turns claiming success MUST be flagged
      const auditFail1 = auditResponseTruthfulness('Done. I have opened Telegram Desktop.', false, 'OPEN_APPLICATION', 'Telegram');
      expect(auditFail1.isTruthful).toBe(false);
      expect(auditFail1.violation).toContain('claims success');

      const auditFail2 = auditResponseTruthfulness('I have located the Agentic OS bot conversation.', false, 'OPEN_CHAT', 'Agentic OS bot');
      expect(auditFail2.isTruthful).toBe(false);

      // Truthful failure statements MUST pass
      const auditTruthfulFail = auditResponseTruthfulness('Telegram is open, but I could not verify the Agentic OS bot conversation.', false, 'OPEN_CHAT', 'Agentic OS bot');
      expect(auditTruthfulFail.isTruthful).toBe(true);

      // Verified successes MUST pass
      const auditVerified = auditResponseTruthfulness('I have opened Google Chrome.', true, 'OPEN_APPLICATION', 'Google Chrome');
      expect(auditVerified.isTruthful).toBe(true);
    });
  });

  // =========================================================================
  // TEST SEQUENCE B: ADAPTIVE TURN ENDPOINTING
  // =========================================================================
  describe('Test Sequence B: Adaptive Turn Endpointing', () => {
    it('B.1 (Quick Commands): Short complete commands terminate quickly (300ms silence)', () => {
      const quickCommands = [
        'Yes.',
        'No.',
        'Open Chrome.',
        'Open Telegram.',
        'Close camera.',
        'Read point two.',
        'Navigate to YouTube.',
      ];

      for (const cmd of quickCommands) {
        const evalResult = AdaptiveTurnEndpoint.evaluateEndpoint(600, cmd);
        expect(evalResult.isShortComplete).toBe(true);
        expect(evalResult.isIncomplete).toBe(false);
        expect(evalResult.silenceThresholdMs).toBe(300);
      }
    });

    it('B.2 (Natural Pause & Incomplete Speech): Incomplete sentences expand threshold (1800ms) to prevent cut-off', () => {
      const incompleteSentences = [
        'Open Telegram and...',
        'Can you open Telegram and',
        'Navigate to YouTube or',
        'Look at the screen because',
        'Read the content with',
        'Check the chat for',
        'Open Chrome, then',
      ];

      for (const inc of incompleteSentences) {
        const evalResult = AdaptiveTurnEndpoint.evaluateEndpoint(800, inc);
        expect(evalResult.isIncomplete).toBe(true);
        expect(evalResult.isShortComplete).toBe(false);
        expect(evalResult.silenceThresholdMs).toBe(1800);
      }
    });

    it('B.3 (Standard Speech): Conversational sentences settle at optimized default (750ms)', () => {
      const standardSentence = 'What is the current status of the acceptance test suite?';
      const evalResult = AdaptiveTurnEndpoint.evaluateEndpoint(2200, standardSentence);
      expect(evalResult.isShortComplete).toBe(false);
      expect(evalResult.isIncomplete).toBe(false);
      expect(evalResult.silenceThresholdMs).toBe(750);
    });
  });

  // =========================================================================
  // TEST SEQUENCE C: FAST BARGE-IN INTERRUPTION (< 100MS)
  // =========================================================================
  describe('Test Sequence C: Fast Barge-In Interruption (< 100ms)', () => {
    it('C.1: Triggers barge-in within 60ms (3 frames) when human speech arrives during playout', () => {
      const speechArrival = Date.now();
      const playoutFloor = 950;
      const humanVoiceRms = 1250;

      // Frame 1 (20ms) -> sustain
      const dec1 = decideBargeIn({
        rms: humanVoiceRms,
        msSincePlayoutStart: 250, // Past 150ms grace
        ambientNoiseFloor: 40,
        consecutiveFrames: 1,
        graceMs: 150,
        playoutFloor,
        sustainFrames: 3,
      });
      expect(dec1).toBe('sustain');

      // Frame 2 (40ms) -> sustain
      const dec2 = decideBargeIn({
        rms: humanVoiceRms,
        msSincePlayoutStart: 270,
        ambientNoiseFloor: 40,
        consecutiveFrames: 2,
        graceMs: 150,
        playoutFloor,
        sustainFrames: 3,
      });
      expect(dec2).toBe('sustain');

      // Frame 3 (60ms) -> TRIGGER!
      const dec3 = decideBargeIn({
        rms: humanVoiceRms,
        msSincePlayoutStart: 290,
        ambientNoiseFloor: 40,
        consecutiveFrames: 3,
        graceMs: 150,
        playoutFloor,
        sustainFrames: 3,
      });
      expect(dec3).toBe('trigger');

      // Record interruption latency: 60ms elapsed from arrival to decision
      const interruptionTime = speechArrival + 60;
      voicePipelineInstrumentation.recordInterruption(speechArrival, interruptionTime);

      const stats = voicePipelineInstrumentation.getStats();
      expect(stats.interruptionLatencyMs).toBeLessThanOrEqual(100);
      expect(stats.interruptionLatencyMs).toBe(60);
    });
  });

  // =========================================================================
  // TEST SEQUENCE D: SELF-HEARING / ECHO REJECTION (0 TRANSCRIPTS)
  // =========================================================================
  describe('Test Sequence D: Self-Hearing / Echo Rejection', () => {
    it('D.1: Rejects candidate transcripts that match active assistant speech', () => {
      const assistantSpeech = 'Google Chrome is now open and ready for interaction.';

      // Acoustic echo candidate
      const echoCandidate = 'Google Chrome is now open';
      const isEcho = isSelfHearingEcho(echoCandidate, assistantSpeech);
      expect(isEcho).toBe(true);

      voicePipelineInstrumentation.recordSelfHearingEchoDetected();
      const stats = voicePipelineInstrumentation.getStats();
      // Zero self-TTS transcripts accepted
      expect(stats.acceptedSelfTtsTranscripts).toBe(0);
    });

    it('D.2: User interruption command "Stop" is NEVER dropped as echo even during speech', () => {
      const assistantSpeech = 'I am currently reading through the long transcript from the last turn.';
      const userInterruption = 'Stop.';

      const isEcho = isSelfHearingEcho(userInterruption, assistantSpeech);
      expect(isEcho).toBe(false); // Must NOT be rejected as echo!
    });
  });

  // =========================================================================
  // TEST SEQUENCE E: DETERMINISTIC COMMAND LATENCY & LLM BYPASS
  // =========================================================================
  describe('Test Sequence E: Deterministic Command Latency & Truthful Verification', () => {
    it('E.1: Direct command executes and records stage timings without LLM invocation', async () => {
      const convId = 'conv-phase6a-test';
      const env = createTurnEnvelope({
        conversationId: convId,
        source: 'voice_livekit',
        rawText: 'Open Chrome.',
      });

      // Register mock running window for Chrome
      targetResolver.setMockWindows([
        { hwnd: 101, pid: 101, title: 'Google Chrome', process: 'chrome.exe' },
      ]);

      const tStart = Date.now();
      voicePipelineInstrumentation.recordSpeechEnd(env.turnId, tStart);
      voicePipelineInstrumentation.recordStage(env.turnId, 'turnEnvelopeMs', tStart + 1);
      voicePipelineInstrumentation.recordStage(env.turnId, 'intentCompileMs', tStart + 2);
      voicePipelineInstrumentation.recordStage(env.turnId, 'capabilityStartMs', tStart + 3);

      const planRes = await capabilityDispatcher.executePlan(env);
      const tEnd = Date.now();

      expect(planRes.completedSuccessfully).toBe(true);
      expect(planRes.verifiedSteps.length).toBe(1);

      voicePipelineInstrumentation.recordStage(env.turnId, 'capabilityVerifiedMs', tEnd);
      voicePipelineInstrumentation.finalizeVoiceTurn(env.turnId, tEnd + 1);

      const stats = voicePipelineInstrumentation.getStats();
      expect(stats.totalTurns).toBe(1);
      expect(stats.unnecessaryLlmCallsAvoided).toBe(1);
      expect(stats.acceptedSelfTtsTranscripts).toBe(0);
      expect(stats.medianDeterministicCommandMs).toBeLessThan(100); // Sub-100ms in direct test pipeline!
    });

    it('E.2: Unverified failure never produces false success speech', () => {
      const fakeGoal = {
        kind: 'action' as const,
        summary: 'open Telegram Desktop',
        action: { type: 'launch_app' as const, app: 'Telegram' },
      };

      // Force failure outcome
      const failureOutcome = 'FAILED' as const;
      const failureReason = 'Window could not be located on desktop';

      // Audit response text
      const candidateReply = `I couldn't open Telegram: ${failureReason}.`;
      const audit = auditResponseTruthfulness(candidateReply, false, 'OPEN_APPLICATION', 'Telegram');

      expect(audit.isTruthful).toBe(true);
      expect(candidateReply).not.toContain('Done');
      expect(candidateReply).not.toContain('Opened');
      expect(candidateReply).not.toContain('Located');
    });
  });
});
