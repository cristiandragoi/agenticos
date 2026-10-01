import { describe, it, expect, beforeEach } from 'vitest';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { projectsStore } from '../services/projectsStore.js';
import { intentArbitrator } from '../domains/jarvis/execution/intentArbitrator.js';

describe('Physical Microphone Acceptance Invariants', () => {
  const conversationId = 'conv-phys-acceptance-' + Date.now();

  beforeEach(() => {
    projectsStore.ensureRevenueProjects();
  });

  it('Variant phonetic matching: "free cache" and "freecache" map to Free Cash project', async () => {
    const res1 = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, open free cache and check the status',
      conversationId,
      sttConfidence: 0.95,
      rawStt: 'Jarvis, open free cache and check the status',
    });

    expect(res1.handled).toBe(true);
    expect(res1.spokenText).toMatch(/Free Cash/i);

    const res2 = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, check the status of freecache',
      conversationId,
      sttConfidence: 0.95,
      rawStt: 'Jarvis, check the status of freecache',
    });

    expect(res2.handled).toBe(true);
    expect(res2.spokenText).toMatch(/Free Cash/i);
  });

  it('Contextual continuation: "Yeah, and?" answers with blocked tasks and credential requirements', async () => {
    // Create a blocked task on Free Cash with credential blocker
    backgroundTaskManager.createTask({
      title: 'Free Cash: External Account Credential Setup',
      objective: 'Configure Free Cash credentials',
      worker: 'revenue',
      projectId: 'proj-free-cash',
      status: 'blocked',
      blocker: 'Free Cash login credentials required',
    } as any);

    // Initial query
    const initialTurn = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, open the Free Cash project and check the status',
      conversationId,
      sttConfidence: 0.95,
      rawStt: 'Jarvis, open the Free Cash project and check the status',
    });

    expect(initialTurn.spokenText).toMatch(/Free Cash/i);

    // Contextual continuation: "Yeah, and?"
    const continuationTurn = await universalExecutionController.handleUserTurn({
      prompt: 'Yeah, and?',
      conversationId,
      sttConfidence: 0.95,
      rawStt: 'Yeah, and?',
      context: {
        activeProjectId: 'proj-free-cash',
        activeProjectName: 'Free Cash',
        lastResolvedEntityId: 'proj-free-cash',
        lastResolvedEntityName: 'Free Cash',
      },
    });

    expect(continuationTurn.handled).toBe(true);
    expect(continuationTurn.spokenText.length).toBeGreaterThan(0);
    expect(continuationTurn.spokenText).not.toMatch(/couldn't make that out/i);
    // Should mention blocked tasks and credentials
    expect(continuationTurn.spokenText.toLowerCase()).toMatch(/blocked|credential/i);
  });

  it('STOP invariant: STOP immediately cancels TTS, cancels turn, produces no TTS, and returns to READY / LISTENING', async () => {
    // Invariants:
    // STOP_IMMEDIATELY_CANCELS_TTS=true
    // STOP_CANCELS_CURRENT_RESPONSE=true
    // STOP_CANCELS_RETRY_QUEUE=true
    // STOP_RETURNS_READY=true
    // STOP_PRODUCES_NO_TTS=true
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'Stop',
      conversationId,
      sttConfidence: 1.0,
      rawStt: 'Stop',
    });

    expect(res.handled).toBe(true);
    expect(res.spokenText).toBe(''); // Immediate silence - STOP_PRODUCES_NO_TTS=true
    expect(res.goalId).toBe('stop');
    expect(res.execution?.output).toBe(''); // Canonical STOP produces no contradictory output
    expect(universalExecutionController.isSuspendedState()).toBe(false); // STOP_RETURNS_READY=true
  });

  it('Next command after STOP works immediately without requiring "Jarvis" wake word (NEXT_COMMAND_AFTER_STOP_WORKS=true)', async () => {
    // 1. Trigger STOP
    const stopRes = await universalExecutionController.handleUserTurn({
      prompt: 'Stop',
      conversationId,
      sttConfidence: 1.0,
      rawStt: 'Stop',
    });
    expect(stopRes.spokenText).toBe('');
    expect(universalExecutionController.isSuspendedState()).toBe(false);

    // 2. Immediately say "Tell me about the Shopify project." WITHOUT saying "Jarvis"
    const nextRes = await universalExecutionController.handleUserTurn({
      prompt: 'Tell me about the Shopify project.',
      conversationId,
      sttConfidence: 0.95,
      rawStt: 'Tell me about the Shopify project.',
    });

    expect(nextRes.handled).toBe(true);
    expect(nextRes.spokenText.length).toBeGreaterThan(0);
    // Answers normally about Shopify
    expect(nextRes.spokenText).toMatch(/Shopify/i);
    expect(nextRes.goalId).not.toBe('stop');
    expect(nextRes.goalId).not.toBe('suspended_ignored');
  });

  it('Out-of-band STOP variations ("shut up", "be quiet", "cancel", "halt") all produce immediate silence and return to READY', async () => {
    for (const phrase of ['shut up', 'be quiet', 'cancel', 'halt']) {
      const res = await universalExecutionController.handleUserTurn({
        prompt: phrase,
        conversationId,
        sttConfidence: 0.95,
        rawStt: phrase,
      });
      expect(res.handled).toBe(true);
      expect(res.spokenText).toBe(''); // STOP_PRODUCES_NO_TTS=true
      expect(res.goalId).toBe('stop');
      expect(universalExecutionController.isSuspendedState()).toBe(false); // STOP_RETURNS_READY=true
    }
  });

  it('Failed STT / noise: asks at most once then recovers quietly without infinite loop', async () => {
    // Reset to awake for this test
    universalExecutionController.resume('test_reset');

    // First low-confidence garbled utterance
    const first = await universalExecutionController.handleUserTurn({
      prompt: 'ksjdflkjsdf',
      conversationId,
      sttConfidence: 0.15,
      rawStt: 'ksjdflkjsdf',
    });

    expect(first.spokenText).toMatch(/couldn't make that out/i);
    expect(first.pendingClarification).toBeUndefined();

    // Second turn simulating quiet recovery condition
    const second = await universalExecutionController.handleUserTurn({
      prompt: 'ksjdflkjsdf',
      conversationId,
      sttConfidence: 0.15,
      rawStt: 'ksjdflkjsdf',
      context: {
        pendingClarification: {
          kind: 'generic_reask',
          attempt: 1,
          askedAt: Date.now(),
          options: [],
        },
      },
    });

    // Should suppress spoken re-ask to prevent infinite loop
    expect(second.goalId).toBe('quiet_recovery');
    expect(second.spokenText).toBe('');
  });

  it('Acoustic / spoken variants ("Javi stop", "I say stop", "Stop Jarvis") reliably trigger STOP with zero speech', async () => {
    for (const phrase of ['Javi stop.', 'I say stop', 'Stop Jarvis', 'stop it now', 'hold on']) {
      const res = await universalExecutionController.handleUserTurn({
        prompt: phrase,
        conversationId,
        sttConfidence: 0.37, // Even with low confidence!
        rawStt: phrase,
      });
      expect(res.handled).toBe(true);
      expect(res.spokenText).toBe('');
      expect(res.goalId).toBe('stop');
      expect(universalExecutionController.isSuspendedState()).toBe(false);
    }
  });

  it('Barge-in with marginal/uncertain audio never routes into "I couldn\'t make that out"', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'st...',
      conversationId,
      sttConfidence: 0.25,
      rawStt: 'st...',
      isBargeIn: true,
    });
    expect(res.handled).toBe(true);
    expect(res.spokenText).toBe('');
    expect(res.spokenText).not.toMatch(/couldn't make that out/i);
  });
});

describe('Phase 1 & 5: Deterministic Target Resolution and Cross-Turn Contamination Regression', () => {
  it('Open YouTube. resolves to browser.navigate for YouTube with trailing period', () => {
    const res = intentArbitrator.arbitrate('Open YouTube.', 'test-conv-1');
    expect(res.selectedRoute).toBe('browser');
    expect(res.actionIntent.capability).toBe('browser.navigate');
    expect(res.actionIntent.targetName).toBe('YouTube');
    expect(res.browserPlan?.action).toBe('navigate');
  });

  it('Open ChatGPT. resolves to browser.navigate for ChatGPT with trailing period', () => {
    const res = intentArbitrator.arbitrate('Open ChatGPT.', 'test-conv-2');
    expect(res.selectedRoute).toBe('browser');
    expect(res.actionIntent.capability).toBe('browser.navigate');
    expect(res.actionIntent.targetName).toBe('ChatGPT');
    expect(res.browserPlan?.action).toBe('navigate');
  });

  it('Open Telegram. resolves to desktop.open_app for Telegram with trailing period', () => {
    const res = intentArbitrator.arbitrate('Open Telegram.', 'test-conv-3');
    expect(res.selectedRoute).toBe('desktop');
    expect(res.actionIntent.capability).toBe('desktop.open_app');
    expect(res.actionIntent.targetName).toBe('Telegram');
  });

  it('Punctuation tolerance: "Open YouTube!" and "Open ChatGPT?"', () => {
    const resYt = intentArbitrator.arbitrate('Open YouTube!', 'test-conv-4');
    expect(resYt.actionIntent.capability).toBe('browser.navigate');
    expect(resYt.actionIntent.targetName).toBe('YouTube');

    const resGpt = intentArbitrator.arbitrate('Open ChatGPT?', 'test-conv-5');
    expect(resGpt.actionIntent.capability).toBe('browser.navigate');
    expect(resGpt.actionIntent.targetName).toBe('ChatGPT');
  });

  it('Locate Julian Goldy SEO on YouTube resolves to browser.open_entity', () => {
    const res1 = intentArbitrator.arbitrate('Locate Julian Goldy SEO on YouTube.', 'test-conv-6');
    expect(res1.selectedRoute).toBe('browser');
    expect(res1.actionIntent.capability).toBe('browser.open_entity');
    expect(res1.actionIntent.targetName).toBe('Julian Goldy SEO');

    const res2 = intentArbitrator.arbitrate('Go to YouTube and search for Julian Goldy SEO.', 'test-conv-7');
    expect(res2.selectedRoute).toBe('browser');
    expect(res2.actionIntent.capability).toBe('browser.open_entity');
    expect(res2.actionIntent.targetName).toBe('Julian Goldy SEO');
  });

  it('Sequential contamination: Turn 1: Open Telegram. -> Turn 2: Open YouTube.', () => {
    const convId = 'seq-test-1';
    const turn1 = intentArbitrator.arbitrate('Open Telegram.', convId);
    expect(turn1.actionIntent.targetName).toBe('Telegram');

    const turn2 = intentArbitrator.arbitrate('Open YouTube.', convId, { previousTurn: turn1 });
    expect(turn2.selectedRoute).toBe('browser');
    expect(turn2.actionIntent.capability).toBe('browser.navigate');
    expect(turn2.actionIntent.targetName).toBe('YouTube');
    expect(turn2.actionIntent.targetName).not.toBe('Telegram');
  });

  it('Sequential contamination: Turn 1: Open Telegram. -> Turn 2: Open ChatGPT.', () => {
    const convId = 'seq-test-2';
    const turn1 = intentArbitrator.arbitrate('Open Telegram.', convId);
    expect(turn1.actionIntent.targetName).toBe('Telegram');

    const turn2 = intentArbitrator.arbitrate('Open ChatGPT.', convId, { previousTurn: turn1 });
    expect(turn2.selectedRoute).toBe('browser');
    expect(turn2.actionIntent.capability).toBe('browser.navigate');
    expect(turn2.actionIntent.targetName).toBe('ChatGPT');
    expect(turn2.actionIntent.targetName).not.toBe('Telegram');
  });

  it('Sequential contamination: Turn 1: Open YouTube. -> Turn 2: Open Telegram.', () => {
    const convId = 'seq-test-3';
    const turn1 = intentArbitrator.arbitrate('Open YouTube.', convId);
    expect(turn1.actionIntent.targetName).toBe('YouTube');

    const turn2 = intentArbitrator.arbitrate('Open Telegram.', convId, { previousTurn: turn1 });
    expect(turn2.selectedRoute).toBe('desktop');
    expect(turn2.actionIntent.capability).toBe('desktop.open_app');
    expect(turn2.actionIntent.targetName).toBe('Telegram');
    expect(turn2.actionIntent.targetName).not.toBe('YouTube');
  });

  it('Negative test: Unknown/unparsed application target MUST NOT resolve to Telegram', () => {
    const res1 = intentArbitrator.arbitrate('Open the app.', 'test-neg-1');
    expect(res1.actionIntent.targetName).not.toBe('Telegram');
    expect(res1.actionIntent.capability).not.toBe('desktop.open_app');

    const res2 = intentArbitrator.arbitrate('Open.', 'test-neg-2');
    expect(res2.actionIntent.targetName).not.toBe('Telegram');
    expect(res2.actionIntent.capability).not.toBe('desktop.open_app');
  });
});
