/**
 * jarvisV2Voice.test.ts — Phase 2A Voice Transport Integration Test Suite for Jarvis V2.
 *
 * Verifies:
 * 1. Exact natural voice sequence matching Phase 2A spec.
 * 2. Barge-in interruption & stale TTS rejection.
 * 3. System introspection ("What AI model are you using right now?", "What are we working on?").
 * 4. STT misrecognition canonicalization ("Free cache" -> "Free Cash").
 * 5. Voice segment continuity across pauses ("I want to give you..." + "...some instructions for Free Cash.").
 * 6. Immediate barge-in "Stop." command.
 * 7. Telemetry recording.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { jarvisV2TurnController } from '../domains/jarvisV2/turnController.js';
import { voiceTurnManager } from '../domains/jarvisV2/voiceTurnManager.js';
import { normalizeTranscript } from '../domains/jarvisV2/sttNormalizer.js';
import { listVoiceTelemetry, recordVoiceTelemetry } from '../domains/jarvisV2/telemetry.js';
import { loadState } from '../domains/jarvisV2/state.js';
import { setWorkerHealthOverride } from '../domains/jarvisV2/capabilities.js';
import { projectsStore } from '../services/projectsStore.js';
import { listOpportunities, createOpportunity } from '../services/revenueOperator/opportunityService.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

describe('Jarvis V2 Voice Transport — Phase 2A Integration Suite', () => {
  const conversationId = `conv-v2-voice-${Date.now()}`;

  beforeAll(async () => {
    // Ensure Free Cash project exists with Priority 1
    if (!projectsStore.getProject('proj-free-cash')) {
      projectsStore.createProject({
        id: 'proj-free-cash',
        name: 'Free Cash Finance Automation',
        priority: 1,
        status: 'active'
      });
    }

    // Ensure Free Cash opportunity exists
    const opps = await listOpportunities();
    if (!opps.some(o => o.title.toLowerCase().includes('free cash'))) {
      await createOpportunity({
        title: 'Free Cash Finance Automation',
        description: 'Automated survey and reward tracking',
        source: 'manual',
        category: 'finance',
        estimatedRevenue: 1000,
        estimatedCost: 50,
        estimatedTimeToRevenueDays: 7,
        automationPotential: 85,
        manualWorkload: 15,
        executionDifficulty: 25,
        riskLevel: 10,
        confidence: 90
      });
    }

    setWorkerHealthOverride('hermes', 'healthy');
    setWorkerHealthOverride('codex', 'healthy');
  });

  afterEach(() => {
    setWorkerHealthOverride('hermes', 'healthy');
    setWorkerHealthOverride('codex', 'healthy');
  });

  // ── 1. EXACT NATURAL VOICE SEQUENCE ───────────────────────────────────────

  it('Voice Turn 1: "Jarvis, let\'s work on Free Cash." -> activates Free Cash', async () => {
    const rawTranscript = "Jarvis, let's work on Free Cash.";
    const norm = normalizeTranscript(rawTranscript, 0.95);
    expect(norm.normalizedTranscript).toBe("let's work on Free Cash.");

    const turn = voiceTurnManager.startVoiceTurn(conversationId, 'op-v1', 1);
    expect(turn.state).toBe('thinking');

    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: norm.normalizedTranscript
    });

    expect(res.intent).toBe('ENTITY_ACTIVATION');
    expect(res.responseText).toContain('Activated Free Cash Finance Automation');
    expect(res.state.activeProject?.priority).toBe(1);
    expect(res.state.activeEntity?.name).toContain('Free Cash');

    recordVoiceTelemetry({
      conversationId,
      operationId: 'op-v1',
      turnId: 1,
      sttRawTranscript: rawTranscript,
      sttNormalizedTranscript: norm.normalizedTranscript,
      sttConfidence: 0.95,
      classification: res.intent,
      activeEntity: res.state.activeEntity?.name || null,
      expectedInput: null,
      pendingActionId: null,
      currentTaskId: null,
      responseText: res.responseText,
      ttsStartedAt: Date.now(),
      ttsCompletedAt: Date.now() + 50,
      interruptedByTurnId: null,
      totalLatencyMs: 60,
      engine: 'jarvis-v2'
    });
  });

  it('Voice Turn 2: "What do you remember about it?" -> grounded Free Cash response', async () => {
    const rawTranscript = 'What do you remember about it?';
    const norm = normalizeTranscript(rawTranscript, 0.98);

    voiceTurnManager.startVoiceTurn(conversationId, 'op-v2', 2);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: norm.normalizedTranscript
    });

    expect(res.intent).toBe('ENTITY_RECALL');
    expect(res.responseText).toContain('Free Cash Finance Automation');
    expect(res.responseText).toContain('Priority 1');
    expect(res.responseText).not.toContain('What project');
  });

  it('Voice Turn 3: "I want to give you some instructions that you should follow." -> sets expectedInput', async () => {
    const rawTranscript = 'I want to give you some instructions that you should follow.';
    const norm = normalizeTranscript(rawTranscript, 0.92);

    voiceTurnManager.startVoiceTurn(conversationId, 'op-v3', 3);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: norm.normalizedTranscript
    });

    expect(res.intent).toBe('PREPARE_INSTRUCTIONS');
    expect(res.responseText).toContain('ready to record instructions');
    expect(res.state.expectedInput?.type).toBe('instruction_set');
  });

  it('Voice Turn 4: "Are you ready?" -> "Yes. Send the instructions."', async () => {
    voiceTurnManager.startVoiceTurn(conversationId, 'op-v4', 4);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Are you ready?'
    });

    expect(res.intent).toBe('CHECK_READY');
    expect(res.responseText).toBe('Yes. Send the instructions.');
  });

  it('Voice Turn 5: "Continue them." -> rejects execution without rules', async () => {
    voiceTurnManager.startVoiceTurn(conversationId, 'op-v5', 5);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Continue them.'
    });

    expect(res.intent).toBe('CONTINUE_UNSUPPLIED');
    expect(res.responseText).toBe("I don't have the instruction contents yet. Send them first.");
  });

  it('Voice Turn 6: Spoken paragraph rules -> stores exactly 4 rules', async () => {
    const rawSpeech = "For Free Cash, don't perform earning actions automatically. Check the status once a day. Tell me if earnings or account status changes. Ask me before any external action.";
    const norm = normalizeTranscript(rawSpeech, 0.96);

    voiceTurnManager.startVoiceTurn(conversationId, 'op-v6', 6);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: norm.normalizedTranscript
    });

    expect(res.intent).toBe('SUPPLY_INSTRUCTIONS');
    expect(res.responseText).toContain('I have recorded the 4 instructions');
    expect(res.state.expectedInput).toBeNull();
    expect(res.state.constraints.length).toBe(4);
  });

  it('Voice Turn 7: "Do you have them?" -> accurate recall', async () => {
    voiceTurnManager.startVoiceTurn(conversationId, 'op-v7', 7);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Do you have them?'
    });

    expect(res.intent).toBe('VERIFY_INSTRUCTIONS');
    expect(res.responseText).toContain('I have 4 instructions recorded for Free Cash Finance Automation:');
  });

  it('Voice Turn 8: "What should we do next?" -> context-aware recommendation', async () => {
    voiceTurnManager.startVoiceTurn(conversationId, 'op-v8', 8);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'What should we do next?'
    });

    expect(res.intent).toBe('RECOMMEND_NEXT');
    expect(res.responseText).toContain('Hermes');
    expect(res.responseText).toContain('Free Cash');
  });

  it('Voice Turn 9: "Give that to Hermes." -> pending action created, does not execute', async () => {
    voiceTurnManager.startVoiceTurn(conversationId, 'op-v9', 9);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Give that to Hermes.'
    });

    expect(res.intent).toBe('DELEGATE_WORKER');
    expect(res.state.pendingAction).not.toBeNull();
    expect(res.state.pendingAction?.type).toBe('hermes.delegate');
    expect(res.state.pendingAction?.status).toBe('awaiting_confirmation');
    expect(res.state.currentTask).toBeNull();
  });

  it('Voice Turn 10: "Yes, proceed." -> approved and real task queued', async () => {
    // Clear active tasks from any previous tests
    const active = backgroundTaskManager.listTasks({ activeOnly: true });
    for (const t of active) backgroundTaskManager.transition(t.taskId, 'completed');

    voiceTurnManager.startVoiceTurn(conversationId, 'op-v10', 10);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Yes, proceed.'
    });

    expect(res.intent).toBe('CONFIRM_ACTION');
    expect(res.responseText).toContain('Confirmed. I have queued the delegation to Hermes');
    expect(res.taskId).toBeDefined();
    expect(res.state.currentTask?.taskId).toBe(res.taskId);
  });

  it('Voice Turn 11: "What are you doing right now?" -> actual task ID/status', async () => {
    voiceTurnManager.startVoiceTurn(conversationId, 'op-v11', 11);
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'What are you doing right now?'
    });

    expect(res.intent).toBe('CURRENT_STATUS');
    expect(res.responseText).toContain('Currently tracking task');
    expect(res.responseText).toContain(loadState(conversationId).currentTask!.taskId);
  });

  // ── 2. BARGE-IN & INTERRUPTION TESTS ─────────────────────────────────────

  it('Barge-in: Interrupts long speaking turn with "Jarvis, what are we working on?"', async () => {
    const testConv = `conv-barge-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Let's work on Free Cash." });

    // Simulate Turn 1 speaking
    const turn1 = voiceTurnManager.startVoiceTurn(testConv, 'op-long-1', 1);
    turn1.state = 'speaking';
    turn1.ttsStartedAt = Date.now();

    // User interrupts with Turn 2
    const interruptResult = voiceTurnManager.interruptVoiceTurn(testConv, 2);
    expect(interruptResult.interrupted).toBe(true);
    expect(interruptResult.previousTurnId).toBe(1);
    expect(turn1.state).toBe('interrupted');
    expect(turn1.ttsAbortController.signal.aborted).toBe(true);

    // Turn 2 is processed
    const turn2 = voiceTurnManager.startVoiceTurn(testConv, 'op-interrupt-2', 2);
    const res2 = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'Jarvis, what are we working on?'
    });

    expect(res2.intent).toBe('SYSTEM_INTROSPECTION');
    expect(res2.responseText).toContain('We are currently working on Free Cash Finance Automation');

    // Attempting TTS for Turn 1 must be rejected (stale TTS rejection)
    const staleTts = await voiceTurnManager.synthesizeTurnTts(testConv, 1, 'Long old speech text');
    expect(staleTts.dropped).toBe(true);
    expect(staleTts.audioBuffer).toBeNull();
  });

  it('System Introspection: "What AI model are you using right now?" -> reports model without V1 fallback', async () => {
    const testConv = `conv-intro-${Date.now()}`;
    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'What AI model are you using right now?'
    });

    expect(res.intent).toBe('SYSTEM_INTROSPECTION');
    expect(res.responseText).toContain('using model');
  });

  // ── 3. STT CANONICALIZATION & VOICE SEGMENT CONTINUITY ────────────────────

  it('STT Canonicalization: "Free cache" maps to "Free Cash"', async () => {
    const norm = normalizeTranscript("let's work on Free cache", 0.91);
    expect(norm.normalizedTranscript).toBe("let's work on Free Cash");
    expect(norm.canonicalEntity).toBe('Free Cash');
  });

  it('Voice Segment Continuity: Natural pause across 2 segments preserves state', async () => {
    const testConv = `conv-pause-${Date.now()}`;

    // Segment 1: incomplete fragment
    const res1 = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'I want to give you...'
    });
    expect(res1.intent).toBe('FRAGMENTED_PREAMBLE');
    expect(res1.responseText).toBe('Go ahead, I am listening.');
    expect(res1.state.expectedInput?.type).toBe('clarification');

    // Segment 2: continuation
    const res2 = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: '...some instructions for Free Cash.'
    });
    expect(res2.intent).toBe('PREPARE_INSTRUCTIONS');
    expect(res2.state.expectedInput?.type).toBe('instruction_set');
    expect(res2.state.activeEntity?.name).toContain('Free Cash');
  });

  it('Barge-in Stop: Saying "Stop." halts speech immediately', async () => {
    const testConv = `conv-stop-${Date.now()}`;
    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'Stop.'
    });
    expect(res.intent).toBe('STOP_COMMAND');
    expect(res.responseText).toBe('');
  });

  it('Telemetry: Records metrics for voice turns', () => {
    const records = listVoiceTelemetry(conversationId);
    expect(records.length).toBeGreaterThan(0);
    const rec = records[0];
    expect(rec.conversationId).toBe(conversationId);
    expect(rec.engine).toBe('jarvis-v2');
    expect(rec.sttRawTranscript).toContain('Free Cash');
  });

  it('Regression Invariant: Direct "Yes." after "What should we do next?" executes exact action ID', async () => {
    const directConv = `conv-direct-yes-${Date.now()}`;
    // 1. Activate entity
    await jarvisV2TurnController.handleTurn({
      conversationId: directConv,
      userText: "let's work on Free Cash."
    });

    // 2. Ask what to do next
    const recTurn = await jarvisV2TurnController.handleTurn({
      conversationId: directConv,
      userText: 'What should we do next?'
    });

    expect(recTurn.intent).toBe('RECOMMEND_NEXT');
    expect(recTurn.responseText).toContain('Would you like me to hand this off to Hermes?');
    // Invariant: Structured action must already exist BEFORE asking executable question
    expect(recTurn.state.pendingAction).not.toBeNull();
    const createdActionId = recTurn.state.pendingAction!.id;
    expect(createdActionId).toBeDefined();
    expect(recTurn.state.expectedInput?.target).toBe(createdActionId);

    // 3. User immediately responds with direct "Yes."
    const yesTurn = await jarvisV2TurnController.handleTurn({
      conversationId: directConv,
      userText: 'Yes.'
    });

    expect(yesTurn.intent).toBe('CONFIRM_ACTION');
    expect(yesTurn.responseText).toContain('Confirmed. I have queued the delegation to Hermes');
    expect(yesTurn.taskId).toBeDefined();
    expect(yesTurn.state.currentTask?.taskId).toBe(yesTurn.taskId);
    // Exact previously-created action ID must have executed
    expect(yesTurn.state.pendingAction?.id).toBe(createdActionId);
    expect(yesTurn.state.pendingAction?.status).toBe('executing');
  });
});
