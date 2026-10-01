/**
 * jarvisV2Kernel.test.ts — End-to-end acceptance tests for Jarvis V2 conversational kernel.
 *
 * Covers:
 * 1. Exact natural sequence & reference resolution ("it", "that", "them"):
 *    - "Let's work on Free Cash."
 *    - "What do you remember about it?"
 *    - "I want to give you a set of instructions you should follow for Free Cash."
 *    - "Are you ready?"
 *    - "Continue them."
 *    - Provide 4 numbered instructions
 *    - "Do you have them?"
 *    - "What should we do next?"
 *    - "Give that to Hermes."
 *    - "Yes, proceed."
 *    - "What are you doing right now?"
 * 2. Natural phrasing variants:
 *    - "work on FreeCash", "let's continue Free Cash", "what do you remember about that?",
 *      "do that", "yes, do it", "go ahead", "what is it doing now?"
 * 3. Negative tests:
 *    - No pending action ("Yes, do it") -> refuses to fabricate action
 *    - False memory claim ("Didn't I already give you five rules?") -> reports 4, no state overwrite
 *    - Worker unavailable -> simulates Hermes unhealthy, refuses fake task state
 *    - Historical contamination -> live runtime health wins over previous assistant text
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { jarvisV2TurnController } from '../domains/jarvisV2/turnController.js';
import { loadState } from '../domains/jarvisV2/state.js';
import { setWorkerHealthOverride } from '../domains/jarvisV2/capabilities.js';
import { projectsStore } from '../services/projectsStore.js';
import { listOpportunities, createOpportunity } from '../services/revenueOperator/opportunityService.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

describe('Jarvis V2 Conversational Kernel — Phase 1B Acceptance Suite', () => {
  const conversationId = `conv-v2-natural-${Date.now()}`;

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

    // Set Hermes and CodeX to healthy for main flow
    setWorkerHealthOverride('hermes', 'healthy');
    setWorkerHealthOverride('codex', 'healthy');
  });

  afterEach(() => {
    // Reset any temporary health overrides
    setWorkerHealthOverride('hermes', 'healthy');
    setWorkerHealthOverride('codex', 'healthy');
  });

  // ── 1. EXACT NATURAL SEQUENCE ─────────────────────────────────────────────

  it('Turn 1: "Let\'s work on Free Cash." -> activates canonical entity & project', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: "Let's work on Free Cash."
    });

    expect(res.intent).toBe('ENTITY_ACTIVATION');
    expect(res.responseText).toContain('Activated Free Cash Finance Automation');
    expect(res.state.activeProject).not.toBeNull();
    expect(res.state.activeProject?.name).toContain('Free Cash');
    expect(res.state.activeProject?.priority).toBe(1);
    expect(res.state.activeEntity).not.toBeNull();
    expect(res.state.activeEntity?.name).toContain('Free Cash');
  });

  it('Turn 2: "What do you remember about it?" -> resolves "it" to Free Cash without asking user to re-identify', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'What do you remember about it?'
    });

    expect(res.intent).toBe('ENTITY_RECALL');
    expect(res.responseText).toContain('Free Cash Finance Automation');
    expect(res.responseText).toContain('Priority 1');
    expect(res.responseText).not.toContain('What project');
    expect(res.responseText).not.toContain('Please specify');
  });

  it('Turn 3: "I want to give you a set of instructions you should follow for Free Cash." -> sets expectedInput', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'I want to give you a set of instructions you should follow for Free Cash.'
    });

    expect(res.intent).toBe('PREPARE_INSTRUCTIONS');
    expect(res.responseText).toContain('ready to record instructions');
    expect(res.state.expectedInput).not.toBeNull();
    expect(res.state.expectedInput?.type).toBe('instruction_set');
    expect(res.state.expectedInput?.target).toContain('Free Cash');
  });

  it('Turn 4: "Are you ready?" -> "Yes. Send the instructions."', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Are you ready?'
    });

    expect(res.intent).toBe('CHECK_READY');
    expect(res.responseText).toBe('Yes. Send the instructions.');
  });

  it('Turn 5: "Continue them." -> rejects execution before rules are supplied', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Continue them.'
    });

    expect(res.intent).toBe('CONTINUE_UNSUPPLIED');
    expect(res.responseText).toBe("I don't have the instruction contents yet. Send them first.");
  });

  it('Turn 6: Supplies 4 numbered instructions -> persists exactly 4 rules', async () => {
    const rulesText = `For Free Cash:
1. No earning action automatically.
2. Check status once per day.
3. Notify me if earnings or account status changes.
4. Human approval before any external action.`;

    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: rulesText
    });

    expect(res.intent).toBe('SUPPLY_INSTRUCTIONS');
    expect(res.responseText).toContain('I have recorded the 4 instructions');
    expect(res.state.expectedInput).toBeNull();
    expect(res.state.constraints.length).toBe(4);

    const targetId = res.state.activeEntity?.id || '';
    const stored = res.state.instructionSets[targetId];
    expect(stored).toBeDefined();
    expect(stored.instructions.length).toBe(4);
    expect(stored.instructions[0]).toBe('No earning action automatically.');
    expect(stored.instructions[1]).toBe('Check status once per day.');
    expect(stored.instructions[2]).toBe('Notify me if earnings or account status changes.');
    expect(stored.instructions[3]).toBe('Human approval before any external action.');
  });

  it('Turn 7: "Do you have them?" -> retrieves the exact four persisted constraints', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Do you have them?'
    });

    expect(res.intent).toBe('VERIFY_INSTRUCTIONS');
    expect(res.responseText).toContain('I have 4 instructions recorded for Free Cash Finance Automation:');
    expect(res.responseText).toContain('1. No earning action automatically.');
    expect(res.responseText).toContain('2. Check status once per day.');
    expect(res.responseText).toContain('3. Notify me if earnings or account status changes.');
    expect(res.responseText).toContain('4. Human approval before any external action.');
  });

  it('Turn 8: "What should we do next?" -> context-aware recommendation', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'What should we do next?'
    });

    expect(res.intent).toBe('RECOMMEND_NEXT');
    expect(res.responseText).toContain('Hermes');
    expect(res.responseText).toContain('Free Cash');
    expect(res.state.lastRecommendation).not.toBeNull();
  });

  it('Turn 9: "Give that to Hermes." -> creates pending action without executing', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Give that to Hermes.'
    });

    expect(res.intent).toBe('DELEGATE_WORKER');
    expect(res.responseText).toContain('Would you like me to proceed?');
    expect(res.state.pendingAction).not.toBeNull();
    expect(res.state.pendingAction?.type).toBe('hermes.delegate');
    expect(res.state.pendingAction?.status).toBe('awaiting_confirmation');
    expect(res.state.pendingAction?.requiresConfirmation).toBe(true);
    expect(res.state.currentTask).toBeNull(); // Has NOT executed
  });

  it('Turn 10: "Yes, proceed." -> approves and executes the pending action', async () => {
    const pendingId = loadState(conversationId).pendingAction?.id;
    expect(pendingId).toBeDefined();

    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'Yes, proceed.'
    });

    expect(res.intent).toBe('CONFIRM_ACTION');
    expect(res.responseText).toContain('Confirmed. I have queued the delegation to Hermes');
    expect(res.taskId).toBeDefined();
    expect(res.state.currentTask).not.toBeNull();
    expect(res.state.currentTask?.taskId).toBe(res.taskId);
  });

  it('Turn 11: "What are you doing right now?" -> actual task ID and status', async () => {
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: 'What are you doing right now?'
    });

    expect(res.intent).toBe('CURRENT_STATUS');
    expect(res.responseText).toContain('Currently tracking task');
    expect(res.responseText).toContain('Hermes');
    expect(res.responseText).toContain(res.state.currentTask!.taskId);
  });

  // ── 2. NATURAL PHRASING VARIANTS ──────────────────────────────────────────

  it('Natural Variant: "work on FreeCash" activates entity', async () => {
    const testConv = `conv-variant-1-${Date.now()}`;
    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'work on FreeCash'
    });
    expect(res.intent).toBe('ENTITY_ACTIVATION');
    expect(res.state.activeEntity?.name).toContain('Free Cash');
  });

  it('Natural Variant: "let\'s continue Free Cash" activates entity', async () => {
    const testConv = `conv-variant-2-${Date.now()}`;
    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: "let's continue Free Cash"
    });
    expect(res.intent).toBe('ENTITY_ACTIVATION');
    expect(res.state.activeEntity?.name).toContain('Free Cash');
  });

  it('Natural Variant: "what do you remember about that?" recalls entity', async () => {
    const testConv = `conv-variant-3-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: "Let's work on Free Cash."
    });
    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'what do you remember about that?'
    });
    expect(res.intent).toBe('ENTITY_RECALL');
    expect(res.responseText).toContain('Free Cash Finance Automation');
  });

  it('Natural Variant: "do that" confirms action', async () => {
    // Clear active tasks from previous tests so concurrency limit is not hit
    const active = backgroundTaskManager.listTasks({ activeOnly: true });
    for (const t of active) {
      backgroundTaskManager.transition(t.taskId, 'completed');
    }

    const testConv = `conv-variant-4-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Let's work on Free Cash." });
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Give that to Hermes." });
    const res = await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "do that" });
    expect(res.intent).toBe('CONFIRM_ACTION');
    expect(res.responseText).toContain('Confirmed. I have queued the delegation to Hermes');
  });

  it('Natural Variant: "yes, do it" confirms action', async () => {
    const active = backgroundTaskManager.listTasks({ activeOnly: true });
    for (const t of active) {
      backgroundTaskManager.transition(t.taskId, 'completed');
    }

    const testConv = `conv-variant-5-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Let's work on Free Cash." });
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Give that to Hermes." });
    const res = await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "yes, do it" });
    expect(res.intent).toBe('CONFIRM_ACTION');
    expect(res.responseText).toContain('Confirmed. I have queued the delegation to Hermes');
  });

  it('Natural Variant: "go ahead" confirms action', async () => {
    const active = backgroundTaskManager.listTasks({ activeOnly: true });
    for (const t of active) {
      backgroundTaskManager.transition(t.taskId, 'completed');
    }

    const testConv = `conv-variant-6-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Let's work on Free Cash." });
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Give that to Hermes." });
    const res = await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "go ahead" });
    expect(res.intent).toBe('CONFIRM_ACTION');
    expect(res.responseText).toContain('Confirmed. I have queued the delegation to Hermes');
  });

  it('Natural Variant: "what is it doing now?" checks status', async () => {
    const active = backgroundTaskManager.listTasks({ activeOnly: true });
    for (const t of active) {
      backgroundTaskManager.transition(t.taskId, 'completed');
    }

    const testConv = `conv-variant-7-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Let's work on Free Cash." });
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "Give that to Hermes." });
    await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "yes, proceed" });
    const res = await jarvisV2TurnController.handleTurn({ conversationId: testConv, userText: "what is it doing now?" });
    expect(res.intent).toBe('CURRENT_STATUS');
    expect(res.responseText).toContain('Currently tracking task');
  });

  // ── 3. NEGATIVE TESTS ─────────────────────────────────────────────────────

  it('Negative Test A: No pending action ("Yes, do it.") -> rejects without fabricating action', async () => {
    const testConv = `conv-neg-a-${Date.now()}`;
    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'Yes, do it.'
    });

    expect(res.intent).toBe('CONFIRM_ACTION');
    expect(res.responseText).toBe('There is no pending action waiting for confirmation.');
    expect(res.state.pendingAction).toBeNull();
    expect(res.state.currentTask).toBeNull();
  });

  it('Negative Test B: False memory claim ("Didn\'t I already give you five rules?") -> reports 4, no state overwrite', async () => {
    // Uses the conversation from section 1 where 4 rules are stored
    const res = await jarvisV2TurnController.handleTurn({
      conversationId,
      userText: "Didn't I already give you five rules?"
    });

    expect(res.intent).toBe('FALSE_RULE_COUNT_CLAIM');
    expect(res.responseText).toContain('No, you provided 4 rules for Free Cash Finance Automation, not 5.');
    // Assert structured state constraints length was NOT modified
    const reloaded = loadState(conversationId);
    expect(reloaded.constraints.length).toBe(4);
  });

  it('Negative Test C: Worker unavailable -> truthfully refuses delegation, no fake task state', async () => {
    const testConv = `conv-neg-c-${Date.now()}`;
    await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: "Let's work on Free Cash."
    });

    // Simulate Hermes offline
    setWorkerHealthOverride('hermes', 'unhealthy');

    const res1 = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'Give that to Hermes.'
    });

    expect(res1.responseText).toContain('Hermes is currently unavailable');
    expect(res1.state.pendingAction).toBeNull(); // No fake pending action created

    const res2 = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'Yes, proceed.'
    });

    expect(res2.responseText).toBe('There is no pending action waiting for confirmation.');
    expect(res2.state.currentTask).toBeNull(); // No fake task state
  });

  it('Negative Test D: Historical contamination -> current runtime health wins over assistant text history', async () => {
    const testConv = `conv-neg-d-${Date.now()}`;
    // State says last assistant turn mentioned offline
    const state = loadState(testConv);
    state.lastAssistantTurn = 'Hermes is offline and unavailable.';
    state.lastUserTurn = 'Check Hermes status.';

    // Current live health is healthy
    setWorkerHealthOverride('hermes', 'healthy');

    const res = await jarvisV2TurnController.handleTurn({
      conversationId: testConv,
      userText: 'Is Hermes still offline?'
    });

    expect(res.intent).toBe('WORKER_HEALTH_QUERY');
    expect(res.responseText).toContain('Hermes is currently online and healthy');
  });

  // ── 4. STATE PERSISTENCE & RESTORE ────────────────────────────────────────

  it('State restore check: reloads state from SQLite with all fields intact', () => {
    const reloaded = loadState(conversationId);
    expect(reloaded.conversationId).toBe(conversationId);
    expect(reloaded.activeProject?.name).toContain('Free Cash');
    expect(reloaded.activeEntity?.name).toContain('Free Cash');
    expect(reloaded.constraints.length).toBe(4);
    expect(reloaded.currentTask).not.toBeNull();
    expect(reloaded.currentTask?.worker).toBe('hermes');
  });
});
