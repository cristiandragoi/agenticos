import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyInputAuthority,
  canonicalObjectiveManager,
  EXECUTION_CONFIDENCE_THRESHOLD,
  type InputSourceLabel,
} from '../domains/jarvis/conversationalAuthority.js';
import { IntentRouter } from '../domains/jarvis/intentRouter.js';
import { assembleConversationContext } from '../domains/jarvis/conversationContext.js';
import { conversationService } from '../domains/conversations/service.js';

describe('Jarvis Conversational Authority & Context Isolation', () => {
  const router = new IntentRouter();

  beforeEach(() => {
    canonicalObjectiveManager.clearCurrentUserTask();
  });

  // 1. Source Classification Labels
  it('1. should classify explicit user commands as USER_EXPLICIT and authorize work', () => {
    const res = classifyInputAuthority('Have CodeX inspect server/src/domains/jarvis/executionSupervisor.ts and verify tests.');
    expect(res.source).toBe('USER_EXPLICIT');
    expect(res.isOperationalAuthorized).toBe(true);
    expect(res.confidence).toBe(1.0);
  });

  it('2. should classify YouTube / video stream transcript as AMBIENT_AUDIO and ask "Was that meant for me?"', async () => {
    const prompt = "Welcome back to my channel, don't forget to like and subscribe and hit the bell for more gameplay walkthroughs!";
    const res = classifyInputAuthority(prompt);
    expect(res.source).toBe('AMBIENT_AUDIO');
    expect(res.isOperationalAuthorized).toBe(false);
    expect(res.clarificationPrompt).toBe('Was that meant for me?');

    const routed = await router.routeIntent(prompt);
    expect(routed.route).toBe('clarification_required');
    expect(routed.voiceIssue).toBe('Was that meant for me?');
  });

  it('3. should classify third-party background speech as AMBIENT_AUDIO and ask "Was that meant for me?"', async () => {
    const prompt = 'Pass the salt, honey what do you want for dinner tonight?';
    const res = classifyInputAuthority(prompt);
    expect(res.source).toBe('AMBIENT_AUDIO');
    expect(res.isOperationalAuthorized).toBe(false);
    expect(res.clarificationPrompt).toBe('Was that meant for me?');

    const routed = await router.routeIntent(prompt);
    expect(routed.route).toBe('clarification_required');
    expect(routed.voiceIssue).toBe('Was that meant for me?');
  });

  it('4. should classify system events as SYSTEM_EVENT and refuse user command interpretation', async () => {
    const prompt = '[supervisor] State changed to RUNNING_ACTIVE, migration notice (tables already exist)';
    const res = classifyInputAuthority(prompt);
    expect(res.source).toBe('SYSTEM_EVENT');
    expect(res.isOperationalAuthorized).toBe(false);

    const routed = await router.routeIntent(prompt);
    expect(routed.route).toBe('direct');
    expect(routed.category).toBe('system_status');
  });

  it('5. should ask for clarification when intent confidence is 55% (< 60% threshold)', async () => {
    const prompt = 'maybe we should change something in the database';
    const res = classifyInputAuthority(prompt, { confidence: 0.55 });
    expect(res.source).toBe('USER_UNCERTAIN');
    expect(res.confidence).toBe(0.55);
    expect(res.isOperationalAuthorized).toBe(false);
    expect(res.clarificationPrompt).toMatch(/clarify/i);

    const routed = await router.routeIntent(prompt, { confidence: 0.55 });
    expect(routed.route).toBe('clarification_required');
    expect(routed.confidence).toBe(0.55);
  });

  it('6. should recognize "no, that wasn\'t for you" and discard previous turn from operational context', async () => {
    const disavowPrompt = "no, that wasn't for you";
    const res = classifyInputAuthority(disavowPrompt);
    expect(res.rejectionDetected).toBe(true);
    expect(res.clarificationPrompt).toMatch(/discarded that from our operational context/i);

    // Simulate discarding a previous turn
    const noisyTranscript = 'Hey honey turn on the TV';
    canonicalObjectiveManager.discardTurn(noisyTranscript);
    expect(canonicalObjectiveManager.isTurnDiscarded(noisyTranscript)).toBe(true);
    expect(canonicalObjectiveManager.isTurnDiscarded('Real command')).toBe(false);
  });

  it('7. should enforce canonical objectives: revenue baseline, explicit user command precedence', () => {
    const baseline = canonicalObjectiveManager.getStrategicObjective();
    expect(baseline).toMatch(/revenue/i);

    expect(canonicalObjectiveManager.getCurrentUserTask()).toBeNull();
    canonicalObjectiveManager.setCurrentUserTask('Inspect heartbeat supervisor', 'task-123');
    const active = canonicalObjectiveManager.getCurrentUserTask();
    expect(active?.description).toBe('Inspect heartbeat supervisor');
    expect(active?.taskId).toBe('task-123');
  });

  it('8. should isolate context so old conversation fragments do not override latest explicit user command', async () => {
    const convId = await conversationService.createConversation('Authority Test Conversation');
    await conversationService.appendMessage({
      conversationId: convId,
      role: 'user',
      content: 'Make a coffee recipe app',
      routedAgent: 'jarvis',
    });
    await conversationService.appendMessage({
      conversationId: convId,
      role: 'agent',
      content: 'Sure, let us plan a recipe app.',
      routedAgent: 'jarvis',
    });

    const ctx = await assembleConversationContext(convId, 'Now inspect executionSupervisor.ts instead.');
    expect(ctx.recentTurns.length).toBeGreaterThan(0);
    expect(ctx.currentPrompt).toBe('Now inspect executionSupervisor.ts instead.');
  });
});
