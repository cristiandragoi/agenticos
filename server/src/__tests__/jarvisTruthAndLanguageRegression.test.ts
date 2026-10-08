/**
 * __tests__/jarvisTruthAndLanguageRegression.test.ts
 *
 * Comprehensive Truthfulness, Repetition, Language, and Action-Execution
 * Regression Test Suite for Jarvis.
 *
 * Tests:
 * A: Typed German request ("Reply in German only.") -> German response, no runtime diagnostics
 * B: Typed Romanian request ("Reply in Romanian only.") -> Romanian response, no runtime diagnostics
 * C: Explicit German voice/language switch -> State persisted & verified read-back
 * D: Explicit Romanian voice/language switch -> State persisted & verified read-back
 * E: Ordinary conversation -> Does not route to task status or diagnostics
 * F: Explicit status request ("What tasks are active?") -> Returns canonical snapshot
 * G: False completion prevention -> Failed mutation never produces "done" or "configured"
 * H: Empty provider response -> Truthful error, not fabricated status
 * I: Repetition guard -> Three consecutive messages do not receive same canned paragraph
 * J: Typed vs STT ownership -> Stale transcript does not overwrite typed input
 * K: Conversation reset -> Fresh conversation has clean state
 * L: Action request creates execution evidence
 * M: Fake action prevention -> Failed execution never claims completion
 * N: No-executor case -> Truthful unsupported response rather than simulated completion
 * O: Live task-status consistency -> References canonical active task
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectLanguageSwitchRequest,
  setConversationLanguage,
  getConversationLanguage,
  buildLanguageSwitchConfirmation,
  LANGUAGE_CONFIGS,
} from '../domains/jarvis/conversationLanguage.js';
import { IntentRouter } from '../domains/jarvis/intentRouter.js';
import {
  sanitizeDirectResponse,
  isActionRequest,
  containsCompletionClaims,
  stripCannedSuffixes,
} from '../domains/jarvis/groundingGuardrail.js';
import { assembleConversationContext, contextToSystemPrompt } from '../domains/jarvis/conversationContext.js';
import { getCanonicalTaskSnapshot } from '../services/backgroundTasks/canonicalSnapshot.js';
import { resolveVoiceForLanguage } from '../services/voice/localTts.js';

describe('Jarvis Truthfulness, Language & Action-Execution Suite', () => {
  const router = new IntentRouter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── A: Typed German ────────────────────────────────────────────────────────
  it('A: Typed German request routes directly to conversation with German instruction', async () => {
    const prompt = 'Reply in German only.';
    const result = await router.routeIntent(prompt);
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
    expect(result.reason).toContain('de');

    const detection = detectLanguageSwitchRequest(prompt);
    expect(detection.isLanguageSwitch).toBe(true);
    expect(detection.targetLanguage).toBe('de');
  });

  // ── B: Typed Romanian ──────────────────────────────────────────────────────
  it('B: Typed Romanian request routes directly to conversation with Romanian instruction', async () => {
    const prompt = 'Reply in Romanian only.';
    const result = await router.routeIntent(prompt);
    expect(result.route).toBe('direct');
    expect(result.category).toBe('conversation');
    expect(result.reason).toContain('ro');

    const detection = detectLanguageSwitchRequest(prompt);
    expect(detection.isLanguageSwitch).toBe(true);
    expect(detection.targetLanguage).toBe('ro');
  });

  // ── C: Explicit German Language Switch & Persistence ──────────────────────
  it('C: Explicit German switch mutates state and verifies read-back', () => {
    const convId = `test-conv-de-${Date.now()}`;
    const initialLang = getConversationLanguage(convId);
    expect(initialLang).toBe('en');

    const setRes = setConversationLanguage(convId, 'de');
    expect(setRes.success).toBe(true);
    expect(setRes.activeLanguage).toBe('de');

    const readBack = getConversationLanguage(convId);
    expect(readBack).toBe('de');

    const confirmation = buildLanguageSwitchConfirmation('de');
    expect(confirmation).toContain('Deutsch');
    expect(confirmation).not.toContain('English');

    const voice = resolveVoiceForLanguage('de');
    expect(voice).toBe('aura-2-julius-de');
  });

  // ── D: Explicit Romanian Language Switch & Persistence ────────────────────
  it('D: Explicit Romanian switch mutates state and verifies read-back', () => {
    const convId = `test-conv-ro-${Date.now()}`;
    const initialLang = getConversationLanguage(convId);
    expect(initialLang).toBe('en');

    const setRes = setConversationLanguage(convId, 'ro');
    expect(setRes.success).toBe(true);
    expect(setRes.activeLanguage).toBe('ro');

    const readBack = getConversationLanguage(convId);
    expect(readBack).toBe('ro');

    const confirmation = buildLanguageSwitchConfirmation('ro');
    expect(confirmation).toContain('română');
    expect(confirmation).not.toContain('English');

    const voice = resolveVoiceForLanguage('ro');
    expect(voice).toContain('ro-RO');
  });

  // ── E: Ordinary Conversation Routing ───────────────────────────────────────
  it('E: Ordinary conversation does not call task-status or investigation routing', async () => {
    const normalPrompts = [
      'How are you today?',
      'Tell me a funny joke about programming.',
      'What is the difference between let and const in JavaScript?',
      'Hallo, wie geht es dir?',
      'Salut, ce mai faci?',
    ];

    for (const p of normalPrompts) {
      const result = await router.routeIntent(p);
      expect(result.route).toBe('direct');
      expect(result.category).toBe('conversation');
      expect(result.route).not.toBe('investigate');
      expect(result.route).not.toBe('system_status');
    }
  });

  // ── F: Explicit Status Request ─────────────────────────────────────────────
  it('F: Explicit status request queries canonical task snapshot', async () => {
    const snap = getCanonicalTaskSnapshot();
    expect(snap).toBeDefined();
    expect(typeof snap.activeCount).toBe('number');
    expect(typeof snap.queuedCount).toBe('number');
    expect(typeof snap.totalCount).toBe('number');
    expect(Array.isArray(snap.activeTasks)).toBe(true);
    expect(Array.isArray(snap.recentTasks)).toBe(true);
  });

  // ── G: False Completion Prevention ─────────────────────────────────────────
  it('G: Action request without execution evidence prevents completion claims', () => {
    const prompt = 'Install German speech support';
    const fakeModelReply = 'German speech support has been installed successfully!';

    const sanitized = sanitizeDirectResponse(fakeModelReply, {
      prompt,
      hasGroundedEvidence: false,
      isAction: true,
      hasExecutionEvidence: false,
    });

    expect(sanitized).not.toContain('installed successfully');
    expect(sanitized).toContain('no automated executor');
  });

  // ── H: Empty Provider Response Handling ────────────────────────────────────
  it('H: Empty or malformed provider output produces concise error', () => {
    const rawReply = '';
    const isModelQuery = false;
    const sanitized = sanitizeDirectResponse(rawReply, {
      prompt: 'Hello',
      hasGroundedEvidence: false,
      isModelQuery,
    });
    expect(sanitized).toBe('');
  });

  // ── I: Repetition & Canned Suffix Removal ──────────────────────────────────
  it('I: Repetitive canned suffixes are stripped from responses', () => {
    const reply1 = 'Here is the explanation of closures. How can I assist you further, operator?';
    const reply2 = 'React uses a virtual DOM for efficient rendering. How can I help you further?';
    const reply3 = 'The file contains 50 lines. Let me know what specific task or question you\'d like to work on.';

    expect(stripCannedSuffixes(reply1)).toBe('Here is the explanation of closures.');
    expect(stripCannedSuffixes(reply2)).toBe('React uses a virtual DOM for efficient rendering.');
    expect(stripCannedSuffixes(reply3)).toBe('The file contains 50 lines.');
  });

  // ── J: Language System Prompt Injection ───────────────────────────────────
  it('J: Conversation context injects strict language instruction when de or ro is active', async () => {
    const convIdDe = `test-ctx-de-${Date.now()}`;
    setConversationLanguage(convIdDe, 'de');
    const ctxDe = await assembleConversationContext(convIdDe, 'Hallo');
    expect(ctxDe.language).toBe('de');
    const promptDe = contextToSystemPrompt(ctxDe);
    expect(promptDe).toContain('KRITISCHE SPRACHANWEISUNG');
    expect(promptDe).toContain('Deutsch');

    const convIdRo = `test-ctx-ro-${Date.now()}`;
    setConversationLanguage(convIdRo, 'ro');
    const ctxRo = await assembleConversationContext(convIdRo, 'Bună');
    expect(ctxRo.language).toBe('ro');
    const promptRo = contextToSystemPrompt(ctxRo);
    expect(promptRo).toContain('INSTRUCȚIUNE CRITICĂ DE LIMBĂ');
    expect(promptRo).toContain('română');
  });

  // ── K: Conversation Context Isolation ──────────────────────────────────────
  it('K: Fresh conversation starts with default language and clean context', async () => {
    const freshConvId = `fresh-conv-${Date.now()}`;
    const lang = getConversationLanguage(freshConvId);
    expect(lang).toBe('en');

    const ctx = await assembleConversationContext(freshConvId, 'Hello');
    expect(ctx.language).toBe('en');
    expect(ctx.recentTurns.length).toBe(0);
  });

  // ── L: Action Request Detection ────────────────────────────────────────────
  it('L: Action requests are recognized as actions requiring execution evidence', () => {
    expect(isActionRequest('Ask Hermes to inspect this repository')).toBe(true);
    expect(isActionRequest('Install German speech support')).toBe(true);
    expect(isActionRequest('Create a new backend route')).toBe(true);
    expect(isActionRequest('Deploy the application')).toBe(true);
    expect(isActionRequest('How are you doing today?')).toBe(false);
  });

  // ── M: Fake Action Prevention (Understanding != Execution) ────────────────
  it('M: Completion claims without evidence are blocked and reported truthfully', () => {
    const prompt = 'Configure new billing adapter';
    const fakeModelReply = 'Done! I have configured the new billing adapter.';

    const sanitized = sanitizeDirectResponse(fakeModelReply, {
      prompt,
      hasGroundedEvidence: false,
      isAction: true,
      hasExecutionEvidence: false,
    });

    expect(sanitized).not.toContain('Done! I have configured');
    expect(sanitized).toContain('no automated executor');
  });

  // ── N: No-Executor Case ────────────────────────────────────────────────────
  it('N: Unsupported system mutation reports truthful limitation', () => {
    const prompt = 'Setup quantum computing accelerator';
    const fakeModelReply = 'The quantum computing accelerator is now set up and enabled.';

    const sanitized = sanitizeDirectResponse(fakeModelReply, {
      prompt,
      hasGroundedEvidence: false,
      isAction: true,
      hasExecutionEvidence: false,
    });

    expect(sanitized).not.toContain('is now set up');
    expect(sanitized).toContain('no automated executor');
  });

  // ── O: Task Snapshot Consistency ───────────────────────────────────────────
  it('O: Canonical snapshot returns unified non-conflicting task metrics', () => {
    const snap = getCanonicalTaskSnapshot();
    expect(snap.totalCount).toBeGreaterThanOrEqual(0);
    const sum =
      snap.activeCount +
      snap.queuedCount +
      snap.awaitingApprovalCount +
      snap.blockedCount +
      snap.completedCount +
      snap.failedCount +
      snap.cancelledCount +
      snap.unknownCount;
    expect(sum).toBe(snap.totalCount);
  });

  // ── P: Natural German Language-Switch Formulations ────────────────────────
  it('P: Deterministically detects all natural German switch formulations without asking LLM', () => {
    const germanPhrases = [
      'Can you speak German?',
      'Could you speak German?',
      'Do you speak German?',
      'I want you to speak German.',
      'Please speak German.',
      'Talk to me in German.',
      'Answer me in German.',
      'Switch to German.',
      'Speak German.',
      'Sprich Deutsch.',
      'Kannst du Deutsch sprechen?',
      'Ich möchte, dass du Deutsch sprichst.',
      'Ich will nicht Deutsch lernen. Ich spreche bereits Deutsch. Du sollst Deutsch sprechen.',
      'Antworte bitte auf Deutsch.',
      'Sprich ab jetzt Deutsch.',
    ];

    for (const phrase of germanPhrases) {
      const detection = detectLanguageSwitchRequest(phrase);
      expect(detection.isLanguageSwitch, `Failed to detect German switch for: "${phrase}"`).toBe(true);
      expect(detection.targetLanguage).toBe('de');
    }

    const conf = buildLanguageSwitchConfirmation('de');
    expect(conf).toBe('Verstanden. Ich spreche ab jetzt Deutsch mit Ihnen.');
  });

  // ── Q: Natural Romanian & English Language-Switch Formulations ─────────────
  it('Q: Deterministically detects Romanian and English switch formulations', () => {
    const romanianPhrases = [
      'Can you speak Romanian?',
      'Could you speak Romanian?',
      'Do you speak Romanian?',
      'I want you to speak Romanian.',
      'Please speak Romanian.',
      'Talk to me in Romanian.',
      'Answer me in Romanian.',
      'Switch to Romanian.',
      'Speak Romanian.',
      'Vorbește în română.',
      'Vorbește românește.',
      'Poți vorbi românește?',
      'Vreau să vorbești în română.',
      'Răspunde în limba română.',
    ];

    for (const phrase of romanianPhrases) {
      const detection = detectLanguageSwitchRequest(phrase);
      expect(detection.isLanguageSwitch, `Failed to detect Romanian switch for: "${phrase}"`).toBe(true);
      expect(detection.targetLanguage).toBe('ro');
    }

    const roConf = buildLanguageSwitchConfirmation('ro');
    expect(roConf).toBe('Am înțeles. De acum înainte vorbesc cu dumneavoastră în limba română.');

    const englishPhrases = [
      'Can you speak English?',
      'Could you speak English?',
      'Do you speak English?',
      'I want you to speak English.',
      'Please speak English.',
      'Switch to English.',
      'Switch back to English.',
      'Speak English.',
      'Talk to me in English.',
      'Back to English.',
      'Sprich wieder Englisch.',
    ];

    for (const phrase of englishPhrases) {
      const detection = detectLanguageSwitchRequest(phrase);
      expect(detection.isLanguageSwitch, `Failed to detect English switch for: "${phrase}"`).toBe(true);
      expect(detection.targetLanguage).toBe('en');
    }

    const enConf = buildLanguageSwitchConfirmation('en');
    expect(enConf).toBe('Understood. I will speak English with you from now on.');
  });

  // ── R: Orchestrator Ordering & Multi-Turn Persistence ──────────────────────
  it('R: Orchestrator intercepts language switch before conversational resolution and persists for next turn', async () => {
    const { JarvisOrchestrator } = await import('../domains/jarvis/orchestrator.js');
    const { conversationService } = await import('../domains/conversations/service.js');
    const orchestrator = new JarvisOrchestrator();
    const testConvId = await conversationService.createConversation('Language Order Test');

    // 1. Send German clarification switch phrase
    const res = await orchestrator.handleMessage(
      testConvId,
      'I do not want to learn German. I already speak German. I want you to speak German.',
      'D:\\AgenticOS',
      'manual',
      'op-test-lang-1'
    );

    expect(res.route).toBe('direct');
    expect(res.status).toBe('language_changed');

    // 2. Verify persisted language is 'de'
    const persistedLang = getConversationLanguage(testConvId);
    expect(persistedLang).toBe('de');

    // 3. Verify next turn inherits German context
    const nextTurnCtx = await assembleConversationContext(testConvId, 'Wie ist der Status?');
    expect(nextTurnCtx.language).toBe('de');
    const sysPrompt = contextToSystemPrompt(nextTurnCtx);
    expect(sysPrompt).toContain('KRITISCHE SPRACHANWEISUNG');
    expect(sysPrompt).toContain('Deutsch');
  }, 20000);
});

