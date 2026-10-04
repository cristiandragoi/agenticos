import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuthoritativeIntentCompiler,
  CompiledTurnIntent,
} from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import {
  createTurnEnvelope,
  assertIntentCompatibility,
  getIntentOverrideAttemptsCount,
  resetIntentOverrideAttempts,
  TurnEnvelope,
} from '../domains/controlPlane/TurnEnvelope.js';

describe('Phase 1 — Turn Envelope & Authoritative Intent Compiler', () => {
  beforeEach(() => {
    resetIntentOverrideAttempts();
  });

  describe('1. TurnEnvelope canonical structure & immutability', () => {
    it('creates a complete canonical envelope with all required fields', () => {
      const envelope = createTurnEnvelope({
        turnId: 'test-turn-100',
        conversationId: 'conv-test-1',
        source: 'voice_livekit',
        rawText: 'Read what is inside Antigravity.',
      });

      expect(envelope.turnId).toBe('test-turn-100');
      expect(envelope.conversationId).toBe('conv-test-1');
      expect(envelope.source).toBe('voice_livekit');
      expect(envelope.rawText).toBe('Read what is inside Antigravity.');
      expect(envelope.normalizedText).toBe('Read what is inside Antigravity');
      expect(typeof envelope.timestamp).toBe('string');
      expect(envelope.interactionContextId).toBe('conv-test-1');
      expect(envelope.compiledIntent).toBeDefined();

      // Immutability checks: Object.isFrozen
      expect(Object.isFrozen(envelope)).toBe(true);
      expect(Object.isFrozen(envelope.compiledIntent)).toBe(true);

      // Mutating frozen envelope should throw in strict mode or fail
      expect(() => {
        (envelope as any).rawText = 'Mutated';
      }).toThrow();
      expect(() => {
        (envelope.compiledIntent as any).action = 'DELEGATE';
      }).toThrow();
    });

    it('produces identical CompiledTurnIntent for Voice and HTTP Typed inputs', () => {
      const rawUtterance = 'Open the Agentic OS bot.';

      const voiceEnvelope = createTurnEnvelope({
        turnId: 101,
        conversationId: 'conv-101',
        source: 'voice_livekit',
        rawText: rawUtterance,
      });

      const httpEnvelope = createTurnEnvelope({
        turnId: 'op-http-101',
        conversationId: 'conv-101',
        source: 'typed_http',
        rawText: rawUtterance,
      });

      expect(voiceEnvelope.compiledIntent.action).toBe(httpEnvelope.compiledIntent.action);
      expect(voiceEnvelope.compiledIntent.targetType).toBe(httpEnvelope.compiledIntent.targetType);
      expect(voiceEnvelope.compiledIntent.application).toBe(httpEnvelope.compiledIntent.application);
      expect(voiceEnvelope.compiledIntent.target).toBe(httpEnvelope.compiledIntent.target);
      expect(voiceEnvelope.compiledIntent.delegationRequested).toBe(httpEnvelope.compiledIntent.delegationRequested);
      expect(voiceEnvelope.compiledIntent.isDirectCommand).toBe(httpEnvelope.compiledIntent.isDirectCommand);
    });
  });

  describe('2. Direct vs Autonomous: Antigravity Window Perception vs Delegation', () => {
    it('compiles all natural speech variations of Antigravity reading to READ_CONTENT (never DELEGATE)', () => {
      const variants = [
        "Read what's inside Antigravity.",
        'Read what is inside anti-gravity.',
        'Can you read the anti gravity window?',
        'Tell me what Antigravity is showing.',
        'Antigravity, read what is inside this window.',
        'Jarvis, read what is inside the Antigravity page',
        'Can you see what is inside Antigravity',
      ];

      for (const v of variants) {
        const intent = AuthoritativeIntentCompiler.compile(v);
        expect(intent.action).toBe('READ_CONTENT');
        expect(intent.targetType).toBe('APPLICATION_WINDOW');
        expect(intent.application).toBe('Antigravity');
        expect(intent.delegationRequested).toBe(false);
        expect(intent.isDirectCommand).toBe(true);
        expect(intent.worker).toBeNull();
      }
    });

    it('compiles explicit delegation requests to DELEGATE with worker identified', () => {
      const del1 = AuthoritativeIntentCompiler.compile('Delegate this to Antigravity.');
      expect(del1.action).toBe('DELEGATE');
      expect(del1.targetType).toBe('WORKER');
      expect(del1.worker).toBe('antigravity');
      expect(del1.delegationRequested).toBe(true);
      expect(del1.isDirectCommand).toBe(false);

      const del2 = AuthoritativeIntentCompiler.compile('Ask Antigravity to fix this.');
      expect(del2.action).toBe('DELEGATE');
      expect(del2.targetType).toBe('WORKER');
      expect(del2.worker).toBe('antigravity');
      expect(del2.delegationRequested).toBe(true);

      const del3 = AuthoritativeIntentCompiler.compile('Delegate this bug to Antigravity.');
      expect(del3.action).toBe('DELEGATE');
      expect(del3.targetType).toBe('WORKER');
      expect(del3.worker).toBe('antigravity');
      expect(del3.delegationRequested).toBe(true);

      const delHermes = AuthoritativeIntentCompiler.compile('Ask Hermes to inspect the repository.');
      expect(delHermes.action).toBe('DELEGATE');
      expect(delHermes.targetType).toBe('WORKER');
      expect(delHermes.worker).toBe('hermes');
      expect(delHermes.delegationRequested).toBe(true);
    });

    it('verifies worker names alone NEVER imply delegation', () => {
      const statusCheck = AuthoritativeIntentCompiler.compile('What is Antigravity doing?');
      expect(statusCheck.action).toBe('TASK_STATUS');
      expect(statusCheck.delegationRequested).toBe(false);

      const showingCheck = AuthoritativeIntentCompiler.compile('Tell me what Antigravity is showing.');
      expect(showingCheck.action).toBe('READ_CONTENT');
      expect(showingCheck.delegationRequested).toBe(false);
    });
  });

  describe('3. Content-Reference & Ordinal Point Interpretation (Never OPEN_APPLICATION)', () => {
    it('compiles point references to READ_CONTENT with exact ordinal', () => {
      const pointVariants = [
        { text: 'Read point two.', expectedOrdinal: 2 },
        { text: 'Read point 2.', expectedOrdinal: 2 },
        { text: 'Read the second point.', expectedOrdinal: 2 },
        { text: "What's in number two?", expectedOrdinal: 2 },
        { text: 'Read point 3.', expectedOrdinal: 3 },
        { text: 'What does point three say?', expectedOrdinal: 3 },
        { text: 'Especially point 4. Can you read point 4?', expectedOrdinal: 4 },
      ];

      for (const { text, expectedOrdinal } of pointVariants) {
        const intent = AuthoritativeIntentCompiler.compile(text);
        expect(intent.action).toBe('READ_CONTENT');
        expect(intent.targetType).toBe('DOCUMENT_CONTENT');
        expect(intent.ordinal).toBe(expectedOrdinal);
        expect(intent.contentRequest).toBe(`point ${expectedOrdinal}`);
        expect(intent.delegationRequested).toBe(false);
        expect(intent.isDirectCommand).toBe(true);
        // CRITICAL INVARIANT: must NOT be OPEN_APPLICATION
        expect(intent.action).not.toBe('OPEN_APPLICATION');
      }
    });
  });

  describe('4. Desktop Application vs. Web Navigation (No open_url Invention)', () => {
    it('compiles "Open Telegram" to desktop application, NEVER web.telegram.org', () => {
      const tg = AuthoritativeIntentCompiler.compile('Open Telegram.');
      expect(tg.action).toBe('OPEN_APPLICATION');
      expect(tg.targetType).toBe('APPLICATION_WINDOW');
      expect(tg.application).toBe('Telegram');
      expect(tg.target).toBe('Telegram Desktop');
      expect(tg.target).not.toContain('web.telegram.org');
    });

    it('compiles "Open Telegram Web" to browser web action only when explicit', () => {
      const tgWeb = AuthoritativeIntentCompiler.compile('Open Telegram Web.');
      expect(tgWeb.action).toBe('OPEN_APPLICATION');
      expect(tgWeb.application).toBe('Browser');
      expect(tgWeb.target).toBe('https://web.telegram.org');
    });

    it('compiles "Open WhatsApp" to desktop application, NEVER web.whatsapp.com', () => {
      const wa = AuthoritativeIntentCompiler.compile('Open WhatsApp.');
      expect(wa.action).toBe('OPEN_APPLICATION');
      expect(wa.targetType).toBe('APPLICATION_WINDOW');
      expect(wa.application).toBe('WhatsApp');
      expect(wa.target).toBe('WhatsApp');
      expect(wa.target).not.toContain('web.whatsapp.com');
    });
  });

  describe('5. Chat Opening & Message Reading', () => {
    it('compiles "Open Agentic OS bot" to OPEN_CHAT', () => {
      const openBot = AuthoritativeIntentCompiler.compile('Open the Agentic OS bot.');
      expect(openBot.action).toBe('OPEN_CHAT');
      expect(openBot.targetType).toBe('CHAT_CONVERSATION');
      expect(openBot.application).toBe('Telegram');
      expect(openBot.target).toBe('Agentic OS bot');
      expect(openBot.delegationRequested).toBe(false);
    });

    it('compiles "Read the last four messages" to READ_MESSAGES with count 4', () => {
      const readMsgs = AuthoritativeIntentCompiler.compile('Read the last four messages.');
      expect(readMsgs.action).toBe('READ_MESSAGES');
      expect(readMsgs.targetType).toBe('CHAT_CONVERSATION');
      expect(readMsgs.application).toBe('Telegram');
      expect(readMsgs.target).toBe('Agentic OS bot');
      expect(readMsgs.count).toBe(4);
    });

    it('compiles "What does the last one mean?" to READ_MESSAGES explain_last', () => {
      const lastMsg = AuthoritativeIntentCompiler.compile('What does the last one mean?');
      expect(lastMsg.action).toBe('READ_MESSAGES');
      expect(lastMsg.targetType).toBe('CHAT_CONVERSATION');
      expect(lastMsg.contentRequest).toBe('explain_last');
      expect(lastMsg.count).toBe(1);
    });
  });

  describe('6. Downstream Override Prevention & Instrumentation', () => {
    it('detects and records INTENT_OVERRIDE_ATTEMPT if downstream tries to delegate when delegationRequested is false', () => {
      const envelope = createTurnEnvelope({
        turnId: 201,
        conversationId: 'conv-override-test',
        source: 'voice_livekit',
        rawText: 'Read what is inside Antigravity.',
      });

      expect(envelope.compiledIntent.delegationRequested).toBe(false);

      // Downstream legacy subsystem attempts to trigger DELEGATE
      const compatible = assertIntentCompatibility('legacyComponent', envelope, 'DELEGATE');
      expect(compatible).toBe(false);
      expect(getIntentOverrideAttemptsCount()).toBe(1);
    });

    it('detects and records INTENT_OVERRIDE_ATTEMPT if downstream tries open_url for desktop Telegram', () => {
      const envelope = createTurnEnvelope({
        turnId: 202,
        conversationId: 'conv-override-test',
        source: 'voice_livekit',
        rawText: 'Open Telegram.',
      });

      expect(envelope.compiledIntent.action).toBe('OPEN_APPLICATION');
      expect(envelope.compiledIntent.application).toBe('Telegram');

      // Downstream legacy planner attempts to trigger open_url
      const compatible = assertIntentCompatibility('legacyPlanner', envelope, 'open_url');
      expect(compatible).toBe(false);
      expect(getIntentOverrideAttemptsCount()).toBe(1);
    });

    it('confirms 0 override attempts during valid execution flow', () => {
      const envelope = createTurnEnvelope({
        turnId: 203,
        conversationId: 'conv-valid',
        source: 'voice_livekit',
        rawText: 'Delegate this problem to Antigravity.',
      });

      // Valid delegation
      const compatible = assertIntentCompatibility('canonicalTurnExecutionService', envelope, 'DELEGATE');
      expect(compatible).toBe(true);
      expect(getIntentOverrideAttemptsCount()).toBe(0);
    });
  });

  describe('7. Deterministic STT Normalization (Punctuation, Stutter, Fillers, Wake Words)', () => {
    it('normalizes punctuation between command and ordinal ("read. 2." -> READ_CONTENT ordinal 2)', () => {
      const intent = AuthoritativeIntentCompiler.compile('read. 2.');
      expect(intent.action).toBe('READ_CONTENT');
      expect(intent.ordinal).toBe(2);
      expect(intent.delegationRequested).toBe(false);
    });

    it('normalizes comma between command and ordinal word ("read, two" -> READ_CONTENT ordinal 2)', () => {
      const intent = AuthoritativeIntentCompiler.compile('read, two');
      expect(intent.action).toBe('READ_CONTENT');
      expect(intent.ordinal).toBe(2);
      expect(intent.delegationRequested).toBe(false);
    });

    it('normalizes punctuation inside "read point. two" -> READ_CONTENT ordinal 2', () => {
      const intent = AuthoritativeIntentCompiler.compile('read point. two');
      expect(intent.action).toBe('READ_CONTENT');
      expect(intent.ordinal).toBe(2);
      expect(intent.delegationRequested).toBe(false);
    });

    it('normalizes wake word repetition ("Jarvis Jarvis read point two" -> READ_CONTENT ordinal 2)', () => {
      const intent = AuthoritativeIntentCompiler.compile('Jarvis Jarvis read point two');
      expect(intent.action).toBe('READ_CONTENT');
      expect(intent.ordinal).toBe(2);
      expect(intent.delegationRequested).toBe(false);
    });

    it('normalizes real Whisper stutter and fillers ("Okay, okay, read. 2." -> READ_CONTENT ordinal 2)', () => {
      const envelope = createTurnEnvelope({
        turnId: 'live-stt-1',
        conversationId: 'conv-live-1',
        source: 'voice_livekit',
        rawText: 'Okay, okay, read. 2.',
      });
      expect(envelope.compiledIntent.action).toBe('READ_CONTENT');
      expect(envelope.compiledIntent.ordinal).toBe(2);
      expect(envelope.compiledIntent.application).toBe('Antigravity');
      expect(envelope.compiledIntent.delegationRequested).toBe(false);
    });

    it('normalizes conversational prefix with Antigravity read ("Yes, hello Jarvis. Jarvis, read what is inside anti-gravity.")', () => {
      const intent = AuthoritativeIntentCompiler.compile('Yes, hello Jarvis. Jarvis, read what is inside anti-gravity.');
      expect(intent.action).toBe('READ_CONTENT');
      expect(intent.application).toBe('Antigravity');
      expect(intent.delegationRequested).toBe(false);
    });
  });

  describe('8. Compound Intent Plan (Ordered Immutable Intent Plan)', () => {
    it('compiles "Open Telegram and locate Agentic OS bot." to [OPEN_APPLICATION Telegram, OPEN_CHAT Agentic OS bot]', () => {
      const envelope = createTurnEnvelope({
        turnId: 'compound-1',
        conversationId: 'conv-compound-1',
        source: 'voice_livekit',
        rawText: 'Open Telegram and locate Agentic OS bot.',
      });

      expect(envelope.compiledPlan).toBeDefined();
      expect(envelope.compiledPlan.length).toBe(2);
      expect(Object.isFrozen(envelope.compiledPlan)).toBe(true);

      const [step1, step2] = envelope.compiledPlan;
      expect(step1.action).toBe('OPEN_APPLICATION');
      expect(step1.application).toBe('Telegram');
      expect(step1.target).toBe('Telegram Desktop');

      expect(step2.action).toBe('OPEN_CHAT');
      expect(step2.application).toBe('Telegram');
      expect(step2.target).toBe('Agentic OS bot');
    });

    it('compiles "Open Chrome and open YouTube." to [OPEN_APPLICATION Chrome, NAVIGATE_WEB YouTube]', () => {
      const envelope = createTurnEnvelope({
        turnId: 'compound-2',
        conversationId: 'conv-compound-2',
        source: 'voice_livekit',
        rawText: 'Open Chrome and open YouTube.',
      });

      expect(envelope.compiledPlan).toBeDefined();
      expect(envelope.compiledPlan.length).toBe(2);

      const [step1, step2] = envelope.compiledPlan;
      expect(step1.action).toBe('OPEN_APPLICATION');
      expect(step1.application).toBe('Chrome');

      expect(step2.action).toBe('NAVIGATE_WEB');
      expect(step2.application).toBe('Chrome');
      expect(step2.target).toBe('YouTube');
    });

    it('compiles "Open Telegram and read the last four messages." to [OPEN_APPLICATION Telegram, READ_MESSAGES 4]', () => {
      const plan = AuthoritativeIntentCompiler.compilePlan('Open Telegram and read the last four messages.');
      expect(plan.steps.length).toBe(2);

      const [step1, step2] = plan.steps;
      expect(step1.action).toBe('OPEN_APPLICATION');
      expect(step1.application).toBe('Telegram');

      expect(step2.action).toBe('READ_MESSAGES');
      expect(step2.count).toBe(4);
      expect(step2.application).toBe('Telegram');
    });

    it('guarantees 4 canonical real LiveKit test phrases match exact Phase 1 matrix', () => {
      // 1. "Read point two."
      const t1 = createTurnEnvelope({
        turnId: 1,
        conversationId: 'c1',
        source: 'voice_livekit',
        rawText: 'Read point two.',
      });
      expect(t1.compiledIntent.action).toBe('READ_CONTENT');
      expect(t1.compiledIntent.ordinal).toBe(2);
      expect(t1.compiledIntent.delegationRequested).toBe(false);

      // 2. "Open Telegram and locate the Agentic OS bot."
      const t2 = createTurnEnvelope({
        turnId: 2,
        conversationId: 'c2',
        source: 'voice_livekit',
        rawText: 'Open Telegram and locate the Agentic OS bot.',
      });
      expect(t2.compiledPlan.length).toBe(2);
      expect(t2.compiledPlan[0].action).toBe('OPEN_APPLICATION');
      expect(t2.compiledPlan[0].application).toBe('Telegram');
      expect(t2.compiledPlan[1].action).toBe('OPEN_CHAT');
      expect(t2.compiledPlan[1].target).toBe('Agentic OS bot');

      // 3. "Open Chrome and open YouTube."
      const t3 = createTurnEnvelope({
        turnId: 3,
        conversationId: 'c3',
        source: 'voice_livekit',
        rawText: 'Open Chrome and open YouTube.',
      });
      expect(t3.compiledPlan.length).toBe(2);
      expect(t3.compiledPlan[0].action).toBe('OPEN_APPLICATION');
      expect(t3.compiledPlan[0].application).toBe('Chrome');
      expect(t3.compiledPlan[1].action).toBe('NAVIGATE_WEB');
      expect(t3.compiledPlan[1].target).toBe('YouTube');

      // 4. "Delegate this problem to Antigravity."
      const t4 = createTurnEnvelope({
        turnId: 4,
        conversationId: 'c4',
        source: 'voice_livekit',
        rawText: 'Delegate this problem to Antigravity.',
      });
      expect(t4.compiledIntent.action).toBe('DELEGATE');
      expect(t4.compiledIntent.worker).toBe('antigravity');
      expect(t4.compiledIntent.delegationRequested).toBe(true);

      expect(getIntentOverrideAttemptsCount()).toBe(0);
    });

    it('compiles user correction and acoustic variations from real audio recordings', () => {
      // Audio Turn 5: "No, you did not open Word on my desktop. I asked you to open Word."
      const turnWordCorrection = AuthoritativeIntentCompiler.compile(
        'No, you did not open Word on my desktop. I asked you to open Word.'
      );
      expect(turnWordCorrection.action).toBe('OPEN_APPLICATION');
      expect(turnWordCorrection.application).toBe('Word');

      // Audio Turn 6: "Jarvis, open PDF inside my laptop."
      const turnPdfDirect = AuthoritativeIntentCompiler.compile(
        'Jarvis, open PDF inside my laptop.'
      );
      expect(turnPdfDirect.action).toBe('OPEN_APPLICATION');
      expect(turnPdfDirect.application).toBe('PDF');

      // Audio Turn 6 (Whisper misrecognition): "open PDF and sell my laptop."
      const turnPdfWhisper = AuthoritativeIntentCompiler.compile(
        'open PDF and sell my laptop.'
      );
      expect(turnPdfWhisper.action).toBe('OPEN_APPLICATION');
      expect(turnPdfWhisper.application).toBe('PDF');

      // Audio Turn 7: "Jarvis, open Telegram. Locate AgenticOS inside Telegram."
      const planTelegram = AuthoritativeIntentCompiler.compilePlan(
        'Jarvis, open Telegram. Locate AgenticOS inside Telegram.'
      );
      expect(planTelegram.steps.length).toBe(2);
      expect(planTelegram.steps[0].action).toBe('OPEN_APPLICATION');
      expect(planTelegram.steps[0].application).toBe('Telegram');
      expect(planTelegram.steps[1].action).toBe('OPEN_CHAT');
      expect(planTelegram.steps[1].target).toBe('Agentic OS bot');
    });

    it('compiles all natural variations of Word to canonical OPEN_APPLICATION Word', () => {
      const wordVariants = [
        'Agent Jarvis, open word document.',
        'Open Word.',
        'Open Word document.',
        'Open Microsoft Word.',
        'Open Word on my laptop.',
        'Can you open Word?',
        'Please open Word.',
        'Would you please open Word document?',
        'I asked you to open Microsoft Word.',
      ];

      for (const variant of wordVariants) {
        const intent = AuthoritativeIntentCompiler.compile(variant);
        expect(intent.action).toBe('OPEN_APPLICATION');
        expect(intent.application).toBe('Word');
        expect(intent.targetType).toBe('APPLICATION_WINDOW');
      }
    });

    it('compiles PDF intents with correct disambiguation between generic and deictic/specific', () => {
      // Generic PDF opening -> default PDF Reader
      const genericPdf = AuthoritativeIntentCompiler.compile('Jarvis, open PDF.');
      expect(genericPdf.action).toBe('OPEN_APPLICATION');
      expect(genericPdf.application).toBe('PDF');

      const genericPdfDoc = AuthoritativeIntentCompiler.compile('Open PDF document');
      expect(genericPdfDoc.action).toBe('OPEN_APPLICATION');
      expect(genericPdfDoc.application).toBe('PDF');

      // Specific PDF file
      const specificPdf = AuthoritativeIntentCompiler.compile('Open financial_report.pdf');
      expect(specificPdf.action).toBe('OPEN_APPLICATION');
      expect(specificPdf.application).toBe('PDF');
      expect(specificPdf.target).toBe('financial_report.pdf');

      // Deictic without context -> truthful clarification request
      const deicticPdf = AuthoritativeIntentCompiler.compile('Jarvis, open this PDF.');
      expect(deicticPdf.action).toBe('CONVERSATIONAL');
      expect(deicticPdf.contentRequest).toBe('clarify_pdf_target');
    });

    it('compiles reading Agentic OS bot directly to Telegram chat conversation', () => {
      const readBot1 = AuthoritativeIntentCompiler.compile('Can you read what is inside Agentic OS bot?');
      expect(readBot1.action).toBe('READ_MESSAGES');
      expect(readBot1.targetType).toBe('CHAT_CONVERSATION');
      expect(readBot1.application).toBe('Telegram');
      expect(readBot1.target).toBe('Agentic OS bot');

      const readBot2 = AuthoritativeIntentCompiler.compile('Read what is inside AgenticOS');
      expect(readBot2.action).toBe('READ_MESSAGES');
      expect(readBot2.targetType).toBe('CHAT_CONVERSATION');
      expect(readBot2.application).toBe('Telegram');
      expect(readBot2.target).toBe('Agentic OS bot');
    });

    it('resolves ambiguous open target contextually on YouTube and fails closed otherwise', () => {
      // 1. YouTube active surface: "Open 1v." resolves to contextual video selection, NOT 1V.exe
      const ytCtx: IntentCompilerContext = {
        activeApplication: 'Chrome',
        activeUrl: 'https://www.youtube.com/results?search_query=Julian+Goldie+SEO',
        activeDomain: 'youtube.com',
        activeCapability: 'browser',
      };
      const ytVideo1 = AuthoritativeIntentCompiler.compile('Open 1v.', ytCtx);
      expect(ytVideo1.action).toBe('NAVIGATE_WEB');
      expect(ytVideo1.target).toBe('first_video_result');

      const ytVideo2 = AuthoritativeIntentCompiler.compile('open one video', ytCtx);
      expect(ytVideo2.action).toBe('NAVIGATE_WEB');
      expect(ytVideo2.target).toBe('first_video_result');

      // 2. No active surface / unknown desktop target: "Open 1v." MUST NOT compile to OPEN_APPLICATION 1V
      const noCtx: IntentCompilerContext = {
        activeApplication: null,
      };
      const unknownApp = AuthoritativeIntentCompiler.compile('Open 1v.', noCtx);
      expect(unknownApp.action).toBe('CONVERSATIONAL');
      expect(unknownApp.contentRequest).toBe('clarify_open_target');
      expect(unknownApp.application).toBeNull();
    });
  });
});

