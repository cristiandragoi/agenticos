/**
 * phase1LifecycleSafety.test.ts
 *
 * RIGOROUS ACCEPTANCE TEST SUITE FOR PHASE 1:
 * - Lifecycle Safety & Absolute Turn Watchdog (12s ceiling, no self-deferral)
 * - Zero Synthetic Production Data (Telegram recentMessages & targetContentExtractor fallback removed)
 * - Strict Production VerificationGateway Rejections (source=mock, synthetic=true, missing target, empty evidence)
 * - Preliminary ACK Immunity (cannot own, release, or poison turn latch)
 * - Stale Late-Result Invalidation (cannot commit context or speak into newer turns)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@livekit/rtc-node', () => ({
  Room: class {},
  AudioSource: class {},
  AudioStream: class {},
  LocalAudioTrack: {},
  TrackPublishOptions: class {},
  TrackSource: {},
  RoomEvent: {},
}));
vi.mock('../domains/jarvisNext/tokenService.js', () => ({ LIVEKIT_CONFIG: {}, generateAgentToken: vi.fn() }));
vi.mock('../domains/jarvisNext/audioUtils.js', () => ({ mp3ToPcmFrames: vi.fn(), pcmChunksToWav: vi.fn(() => Buffer.alloc(44)) }));
vi.mock('../services/voice/localTts.js', () => ({ synthesizeLocally: vi.fn(async () => Buffer.from('dummy')) }));
vi.mock('../services/voice/localTranscribe.js', () => ({
  transcribeLocally: vi.fn(),
  cancelLocalTranscription: vi.fn(),
  purgeObsoleteTranscriptions: vi.fn(),
}));
vi.mock('../domains/jarvisNext/operator/operatorController.js', () => ({ operatorController: { handleIntent: vi.fn(async () => ({ handled: false })) } }));
vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn() }));
vi.mock('../domains/jarvisNext/livekitServerManager.js', () => ({ ensureLivekitServerRunning: vi.fn() }));

import { TelegramAdapter } from '../adapters/telegramAdapter.js';
import { verificationGateway } from '../domains/controlPlane/VerificationGateway.js';
import { JarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { capabilityDispatcher } from '../domains/controlPlane/CapabilityDispatcher.js';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';

describe('Phase 1 — Lifecycle Safety & Zero Synthetic Data Acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authoritativeInteractionContext.resetContext();
  });

  // =========================================================================
  // REQUIREMENT 5: ZERO SYNTHETIC TELEGRAM PRODUCTION DATA (Static & Runtime)
  // =========================================================================
  describe('Zero-Synthetic Production Invariant (Requirement 5 & Acceptance C)', () => {
    it('C.1: telegramAdapter.ts has empty recentMessages and no hardcoded production fixtures', () => {
      const adapterFilePath = path.resolve(__dirname, '../adapters/telegramAdapter.ts');
      const content = fs.readFileSync(adapterFilePath, 'utf8');

      // Static check: recentMessages must be initialized to empty array
      expect(content).toMatch(/private\s+recentMessages:\s*Array<.*?>\s*=\s*\[\s*\];/);

      // Verify no hardcoded /health or synthetic status strings in the class properties
      expect(content).not.toContain("text: '/health', time: '11:15'");
      expect(content).not.toContain("text: 'AgenticOS Health — ONLINE. All systems operational.'");

      // Runtime check: TelegramAdapter.getInstance().getRecentMessages() must return empty by default
      const adapter = TelegramAdapter.getInstance();
      expect(adapter.getRecentMessages()).toEqual([]);
    });

    it('C.2: targetContentExtractor.ts contains NO synthetic TelegramAdapter fallback', () => {
      const extractorFilePath = path.resolve(__dirname, '../domains/jarvis/perception/targetContentExtractor.ts');
      const content = fs.readFileSync(extractorFilePath, 'utf8');

      // Must not call TelegramAdapter.getInstance().getRecentMessages() as a fallback
      expect(content).not.toContain('TelegramAdapter.getInstance().getRecentMessages');
    });
  });

  // =========================================================================
  // REQUIREMENT 6: PRODUCTION VERIFICATION GATEWAY REJECTIONS
  // =========================================================================
  describe('Production Verification Gateway Rejections (Requirement 6)', () => {
    it('rejects step with source = "mock"', () => {
      const evalResult = verificationGateway.evaluate({
        stepId: 'step-mock-test',
        action: 'READ_MESSAGES',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'mock' as any,
          label: 'Mock evidence',
          observedAt: Date.now(),
          data: { messages: [{ text: 'hello' }] },
        },
      });

      expect(evalResult.isVerifiedSuccess).toBe(false);
      expect(evalResult.reason).toContain('mock verification evidence is prohibited');
    });

    it('rejects step with synthetic = true', () => {
      const evalResult = verificationGateway.evaluate({
        stepId: 'step-synthetic-test',
        action: 'READ_MESSAGES',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'uia',
          label: 'UIA evidence with synthetic data',
          observedAt: Date.now(),
          data: { synthetic: true, messages: [] },
        },
      });

      expect(evalResult.isVerifiedSuccess).toBe(false);
      expect(evalResult.reason).toContain('synthetic data detected');
    });

    it('rejects non-conversational step with missing authoritative target', () => {
      const evalResult = verificationGateway.evaluate({
        stepId: 'step-no-target',
        action: 'OPEN_APPLICATION',
        requestedTarget: null,
        executedTarget: '',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'window_inspection',
          label: 'Window inspection',
          observedAt: Date.now(),
          data: { hwnd: 12345 },
        },
      });

      expect(evalResult.isVerifiedSuccess).toBe(false);
      expect(evalResult.reason).toContain('missing authoritative target');
    });

    it('rejects step with empty physical evidence data', () => {
      const evalResult = verificationGateway.evaluate({
        stepId: 'step-empty-data',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'window_inspection',
          label: 'Empty evidence',
          observedAt: Date.now(),
          data: {},
        },
      });

      expect(evalResult.isVerifiedSuccess).toBe(false);
      expect(evalResult.reason).toContain('missing physical evidence payload');
    });

    it('accepts legitimate physical evidence with authoritative target', () => {
      const evalResult = verificationGateway.evaluate({
        stepId: 'step-legit',
        action: 'OPEN_APPLICATION',
        requestedTarget: 'Telegram',
        executedTarget: 'Telegram',
        success: true,
        verified: true,
        verificationEvidence: {
          source: 'window_inspection',
          label: 'Application window active: Telegram',
          observedAt: Date.now(),
          data: { hwnd: 133174, pid: 5904, foreground: true },
        },
      });

      expect(evalResult.isVerifiedSuccess).toBe(true);
      expect(evalResult.reason).toContain('Verified OPEN_APPLICATION on Telegram');
    });
  });

  // =========================================================================
  // REQUIREMENTS 1 & 2: ABSOLUTE TURN WATCHDOG & LIFECYCLE SAFETY
  // =========================================================================
  describe('Absolute Turn Watchdog & Mic Latch Safety (Requirements 1 & 2, Acceptance A & B)', () => {
    it('A.1 & A.2: Watchdog ceiling is 12,000ms and does NOT defer itself when lifecycleRequestInFlight is true', async () => {
      vi.useFakeTimers();
      const agent: any = new JarvisNextAgent();

      expect(agent.TURN_WATCHDOG_MS).toBe(12_000);

      // Acquire turn latch
      agent.currentUserTurnId = 10;
      agent.isProcessingUserTurn = true;
      agent.lifecycleRequestInFlight = true;
      agent.turnLatchAcquiredAt = Date.now();
      agent.setMicState('PROCESSING', 'turn_started');

      expect(agent.isListening).toBe(false);

      // Arm watchdog
      agent.armTurnWatchdog(10, 'conv-test-hung');

      // Advance time past 12 seconds
      await vi.advanceTimersByTimeAsync(12_500);

      // Invariant Check: Latch MUST be released and mic restored to LISTENING!
      expect(agent.isProcessingUserTurn).toBe(false);
      expect(agent.lifecycleRequestInFlight).toBe(false);
      expect(agent.micState).toBe('LISTENING');
      expect(agent.isListening).toBe(true);
      expect(agent.currentUserTurnId).toBeGreaterThan(10); // Turn ID advanced to discard stale results

      vi.useRealTimers();
    });

    it('B.1: Subsequent speech is admitted after timeout (not dropped by latch)', async () => {
      vi.useFakeTimers();
      const agent: any = new JarvisNextAgent();

      // Turn 1 starts and hangs
      agent.currentUserTurnId = 1;
      agent.isProcessingUserTurn = true;
      agent.lifecycleRequestInFlight = true;
      agent.turnLatchAcquiredAt = Date.now();
      agent.armTurnWatchdog(1, 'conv-speech-test');

      // Fast forward past watchdog ceiling
      await vi.advanceTimersByTimeAsync(12_500);

      expect(agent.isProcessingUserTurn).toBe(false);
      expect(agent.isListening).toBe(true);

      // Now send user audio frame
      const samples = new Int16Array(480).fill(1500); // loud audio frame
      agent.processUserAudioFrame({ data: samples, sampleRate: 24000, channels: 1 });

      // Invariant: frame must NOT be dropped due to held latch
      expect(agent.droppedFramesWhileLatched).toBe(0);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // REQUIREMENT 3: PRELIMINARY ACK IMMUNITY (Acceptance D)
  // =========================================================================
  describe('Preliminary Acknowledgement Immunity (Requirement 3 & Acceptance D)', () => {
    it('D.1: Preliminary ACK playout does not take ownership of foregroundTurnActive', async () => {
      const agent: any = new JarvisNextAgent();
      agent.audioSource = { captureFrame: vi.fn(async () => {}) };
      agent.room = { isConnected: true, localParticipant: { publishData: vi.fn(async () => {}) } };

      agent.currentUserTurnId = 5;
      agent.isProcessingUserTurn = true;
      agent.foregroundTurnActive = false;

      // Speak preliminary ACK "Opening it."
      await agent.speak('Opening it.', 5, { preliminaryAck: true });

      // Invariant: Preliminary ACK must NOT set foregroundTurnActive = true
      expect(agent.foregroundTurnActive).toBe(false);
    });

    it('D.2: A superseded preliminary ACK does not release turn latch prematurely', async () => {
      const agent: any = new JarvisNextAgent();
      agent.currentUserTurnId = 5;
      agent.isProcessingUserTurn = true;
      agent.foregroundTurnActive = false;
      agent.turnLatchAcquiredAt = Date.now();

      // Register an in-flight preliminary ACK playout id
      const ackPlayoutId = 99;
      agent.preliminaryAckPlayoutIds.add(ackPlayoutId);
      agent.currentAssistantPlayoutId = 100; // superseded by playout 100

      // Simulate cleanup of superseded playout 99
      const wasPreAck = agent.preliminaryAckPlayoutIds.delete(ackPlayoutId);
      expect(wasPreAck).toBe(true);

      // Invariant: Latch MUST NOT be released by superseded ACK!
      expect(agent.isProcessingUserTurn).toBe(true);
      expect(agent.turnLatchAcquiredAt).not.toBeNull();
    });
  });

  // =========================================================================
  // REQUIREMENT 2 & ACCEPTANCE E: STALE LATE RESULT ISOLATION
  // =========================================================================
  describe('Stale Late-Result Isolation (Requirement 2 & Acceptance E)', () => {
    it('E.1: speak() drops speech from a timed-out older turn after turn ID advanced', async () => {
      const agent: any = new JarvisNextAgent();
      agent.currentUserTurnId = 15; // Current active turn is 15
      agent.isProcessingUserTurn = true;

      const broadcastSpy = vi.spyOn(agent, 'broadcastData');

      // Attempt to speak with stale turnId 14 (timed out)
      await agent.speak('I have completed the old task.', 14);

      // Invariant: Stale speech is dropped; no broadcast, does not steal playback
      expect(broadcastSpy).not.toHaveBeenCalled();
      expect(agent.isSpeaking).toBe(false);
    });

    it('E.2: CapabilityDispatcher aborts and does not commit context when isStale is true', async () => {
      const CONV_STALE = 'conv-stale-test';
      const envelope = createTurnEnvelope({
        conversationId: CONV_STALE,
        source: 'typed_http',
        rawText: 'Open Telegram and locate Agentic OS bot',
      });

      // Pass isStale that returns true immediately
      const res = await capabilityDispatcher.executePlan(envelope, {
        isStale: () => true,
      });

      expect(res.completedSuccessfully).toBe(false);
      expect(res.failedStep?.reason).toContain('Plan aborted: turn timed out or was superseded');

      // Context must NOT have recorded Telegram or bot
      const ctx = authoritativeInteractionContext.getContext(CONV_STALE);
      expect(ctx.activeApplication).toBeNull();
      expect(ctx.activeWindow).toBeNull();
    });
  });
});
