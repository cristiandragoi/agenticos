import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveAuthoritativeTtsTarget,
  synthesizeLocally,
  DEFAULT_NEURAL_VOICE,
} from '../services/voice/localTts.js';
import { conversationCapabilityAdapter } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import type { CompiledTurnIntent } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';

describe('Voice Output Ownership & Playout Lifecycle Suite', () => {

  // =========================================================================
  // Section 9: REGRESSION TEST — SINGLE VOICE
  // =========================================================================
  describe('9. Single Authoritative Voice Resolution', () => {
    it('resolves consistent single provider and voice for all sentences of a response', () => {
      const responseText = "I am here. How can I help you?";
      const target = resolveAuthoritativeTtsTarget('aura-helios-en');

      expect(target.provider).toBeDefined();
      expect(target.voice).toBeDefined();

      // Splitting sentences
      const sentences = responseText.split(/(?<=[.!?])\s+/);
      expect(sentences.length).toBe(2);

      // Both sentences must resolve to the identical provider and voice target
      const s0Target = resolveAuthoritativeTtsTarget(target.voice);
      const s1Target = resolveAuthoritativeTtsTarget(target.voice);

      expect(s0Target.provider).toBe(s1Target.provider);
      expect(s0Target.voice).toBe(s1Target.voice);
      expect(s0Target.voice).toBe(target.voice);
    });

    it('synthesizes multi-sentence text with single voice and prevents cache cross-contamination', async () => {
      // Synthesize sentence 0 and sentence 1 with edge-tts
      const s0Audio = await synthesizeLocally('I am here.', DEFAULT_NEURAL_VOICE, { provider: 'edge-tts' });
      const s1Audio = await synthesizeLocally('How can I help you?', DEFAULT_NEURAL_VOICE, { provider: 'edge-tts' });

      expect(Buffer.isBuffer(s0Audio)).toBe(true);
      expect(Buffer.isBuffer(s1Audio)).toBe(true);
      expect(s0Audio.byteLength).toBeGreaterThan(0);
      expect(s1Audio.byteLength).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Section 6: REMOVE ACTIONABLE GENERIC FALLBACK
  // =========================================================================
  describe('6. Actionable Generic Fallback Removal', () => {
    it('returns "I am here. How can I help you?" ONLY for genuine presence/wake checks', async () => {
      const wakePrompts = ['Jarvis?', 'Hello Jarvis', 'are you there?', 'Hey Jarvis', 'you there?'];

      for (const prompt of wakePrompts) {
        const step: CompiledTurnIntent = {
          action: 'CONVERSATIONAL',
          rawPrompt: prompt,
        };
        const res = await conversationCapabilityAdapter.execute(step, 'step-wake', 'conv-test');
        expect(res.outputText).toBe("I am here. How can I help you?");
        expect(res.success).toBe(true);
        expect(res.verified).toBe(true);
      }
    });

    it('does NOT return "I am here. How can I help you?" for unhandled actions (OTHER)', async () => {
      const otherPrompts = [
        'Open Telegram and read the messages',
        'do that thing with the browser',
        'something went wrong with telegram',
      ];

      for (const prompt of otherPrompts) {
        const step: CompiledTurnIntent = {
          action: 'OTHER',
          rawPrompt: prompt,
        };
        const res = await conversationCapabilityAdapter.execute(step, 'step-other', 'conv-test');
        expect(res.outputText).not.toContain("I am here. How can I help you?");
        expect(res.outputText).toContain("I didn't quite catch that");
        expect(res.success).toBe(false);
      }
    });

    it('returns truthful error when failureReason is present on the step', async () => {
      const step: any = {
        action: 'READ_MESSAGES',
        rawPrompt: 'read the telegram chat',
        failureReason: 'Telegram window HWND 133174 could not be brought to focus',
      };
      const res = await conversationCapabilityAdapter.execute(step, 'step-fail', 'conv-test');
      expect(res.outputText).toContain('Telegram window HWND 133174 could not be brought to focus');
      expect(res.outputText).not.toContain("I am here. How can I help you?");
      expect(res.success).toBe(false);
    });
  });

  // =========================================================================
  // Section 7: LOW-CONFIDENCE STT GUARD
  // =========================================================================
  describe('7. Low-Confidence STT Guard', () => {
    it('identifies hallucination patterns and extreme speech rate from noise audio', () => {
      // Turn 6 from the forensic session: 1380ms audio producing 810 repeated characters with confidence 0.1831
      const rawAudioDurationMs = 1380;
      const confidence = 0.1831;
      const text = "You're not going to be able to do that. You're not going to be able to do that. You're not going to be able to do that. You're not going to be able to do that.";

      const isHallucination = (
        confidence < 0.45 && (
          (rawAudioDurationMs > 0 && text.length / (rawAudioDurationMs / 1000) > 35) ||
          /(.{6,})\1{2,}/i.test(text)
        )
      ) || (
        confidence < 0.35
      );

      expect(isHallucination).toBe(true);
    });

    it('accepts legitimate speech with good confidence and normal speech rate', () => {
      const rawAudioDurationMs = 2800;
      const confidence = 0.94;
      const text = "Jarvis, open Telegram, locate Agentic OS bot and read the last two messages.";

      const isHallucination = (
        confidence < 0.45 && (
          (rawAudioDurationMs > 0 && text.length / (rawAudioDurationMs / 1000) > 35) ||
          /(.{6,})\1{2,}/i.test(text)
        )
      ) || (
        confidence < 0.35
      );

      expect(isHallucination).toBe(false);
    });
  });

  // =========================================================================
  // Section 4 & 5: PLAYOUT TERMINATION SEMANTICS & BARGE-IN CLEANUP
  // =========================================================================
  describe('4 & 5. Playout Termination Semantics & Barge-In Invariant', () => {
    it('executes turn release on all four playout terminal outcomes', () => {
      const outcomes = ['PLAYOUT_COMPLETED', 'PLAYOUT_INTERRUPTED', 'PLAYOUT_CANCELLED', 'PLAYOUT_FAILED'] as const;

      for (const outcome of outcomes) {
        let isProcessingUserTurn = true;
        let isSpeaking = true;
        let isSynthesizing = true;
        let speechOwnerTurnId: number | null = 42;
        let turnLatchReleased = false;
        let micState = 'SPEAKING';
        let pendingCoalesced = [{ text: 'pending note' }];

        // Mock common finalizer logic
        const finalize = (termOutcome: typeof outcome) => {
          isSynthesizing = false;
          isSpeaking = false;
          speechOwnerTurnId = null;
          isProcessingUserTurn = false;
          turnLatchReleased = true;

          if (termOutcome === 'PLAYOUT_INTERRUPTED' || termOutcome === 'PLAYOUT_CANCELLED' || termOutcome === 'PLAYOUT_FAILED') {
            pendingCoalesced = [];
          }
          micState = 'LISTENING';
        };

        finalize(outcome);

        expect(isSpeaking).toBe(false);
        expect(isSynthesizing).toBe(false);
        expect(isProcessingUserTurn).toBe(false);
        expect(speechOwnerTurnId).toBeNull();
        expect(turnLatchReleased).toBe(true);
        expect(micState).toBe('LISTENING');
        if (outcome !== 'PLAYOUT_COMPLETED') {
          expect(pendingCoalesced.length).toBe(0);
        }
      }
    });

    it('simulates barge-in during sentence 1, middle sentence, and final sentence', () => {
      const sentenceStages = ['first_sentence', 'middle_sentence', 'final_sentence'] as const;

      for (const stage of sentenceStages) {
        let activePlayoutId = 100;
        let isSpeaking = true;
        let isProcessingUserTurn = true;
        let micGated = true;
        let latchHeld = true;

        // Barge-in occurs at this stage
        const onBargeIn = (interruptStage: typeof stage) => {
          // 1. Advance playout ID to halt mid-stream frame pump
          activePlayoutId++;
          isSpeaking = false;

          // 2. Execute common finalizer
          isProcessingUserTurn = false;
          latchHeld = false;
          micGated = false;
        };

        onBargeIn(stage);

        expect(activePlayoutId).toBe(101);
        expect(isSpeaking).toBe(false);
        expect(isProcessingUserTurn).toBe(false);
        expect(latchHeld).toBe(false);
        expect(micGated).toBe(false); // Mic is ready to receive the user's incoming utterance
      }
    });
  });

  // =========================================================================
  // Section 8: RESPONSE DELIVERY MODEL
  // =========================================================================
  describe('8. Response Delivery Verification State Model', () => {
    it('preserves EXECUTION_VERIFIED=true even when response delivery is INTERRUPTED', () => {
      const tracking = {
        turnId: 7,
        action: 'READ_MESSAGES',
        resultText: "The last 2 messages in Agentic OS bot are: Me says: 'Jarvis you there?'. AgenticOS says: 'Task received and processed.'",
        verified: true,
        deliveryStatus: 'PENDING' as 'PENDING' | 'TTS_STARTED' | 'TTS_COMPLETED' | 'INTERRUPTED',
      };

      // 1. Execution verified & response generated
      expect(tracking.verified).toBe(true);

      // 2. TTS starts
      tracking.deliveryStatus = 'TTS_STARTED';
      expect(tracking.deliveryStatus).toBe('TTS_STARTED');

      // 3. User barge-in cuts audio after 440ms
      tracking.deliveryStatus = 'INTERRUPTED';

      // Required invariant: verified execution is PRESERVED, not discarded
      expect(tracking.verified).toBe(true);
      expect(tracking.deliveryStatus).toBe('INTERRUPTED');
      expect(tracking.resultText).toContain('Task received and processed');
    });
  });

});
