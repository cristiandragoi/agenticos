import { describe, it, expect } from 'vitest';
import { detectLocalFastReply } from '../domains/jarvis/fastLocalReplies.js';
import { isCurrentWorkQuestion } from '../domains/jarvis/currentWorkContext.js';
import { isTaskStatusQuery } from '../domains/jarvis/taskStatusFormatter.js';
import { IntentRouter } from '../domains/jarvis/intentRouter.js';
import { classifyExecutiveIntent } from '../domains/jarvis/executiveIntent.js';

describe('JARVIS-RUNTIME-002: Deterministic Routing Test Matrix (A–J)', () => {
  const router = new IntentRouter();

  it('Case A: "Jarvis, how are you?" -> DIRECT / FAST (Hermes: NO, CodeX: NO)', async () => {
    const prompt = 'Jarvis, how are you?';
    const fastReply = detectLocalFastReply(prompt);
    expect(fastReply, 'Fast path must catch "Jarvis, how are you?"').not.toBeNull();
    expect(fastReply!.reply.length).toBeGreaterThan(0);

    const intent = await router.routeIntent(prompt);
    expect(intent.route).not.toBe('codex');
    expect(intent.route).not.toBe('hermes');
  });

  it('Case B: "Jarvis, what does Hermes do?" -> DIRECT EXPLANATION (Hermes execution: NO)', async () => {
    const prompt = 'Jarvis, what does Hermes do?';
    const fastReply = detectLocalFastReply(prompt);
    expect(fastReply, 'Fast path must catch "what does Hermes do?"').not.toBeNull();
    expect(fastReply!.reply.toLowerCase()).toContain('hermes');

    // Also verify that executive intent treats this as explanation, not execution
    const exec = classifyExecutiveIntent(prompt);
    expect(exec?.intent).toBe('direct_explanation');
  });

  it('Case C: "Jarvis, check Hermes health." -> SYSTEM HEALTH / INVESTIGATE (Hermes task: NO)', async () => {
    const prompt = 'Jarvis, check Hermes health.';
    const intent = await router.routeIntent(prompt);
    expect(intent.route).toBe('investigate');
    expect(intent.semanticIntent).toBe('investigation');
  });

  it.each(['check Revenue Operator', 'check the Revenue Operator', 'what is Revenue Operator doing?', 'Jarvis, check Revenue Operator.'])('routes %s to deterministic Revenue Operator status, never generic chat', (prompt) => {
    const exec = classifyExecutiveIntent(prompt);
    expect(exec?.intent).toBe('worker_status');
    expect(exec?.capability.id).toBe('revenue_operator');
  });

  it('Case D: "Jarvis, ask Hermes to inspect intentRouter.ts." -> HERMES DELEGATION', async () => {
    const prompt = 'Jarvis, ask Hermes to inspect intentRouter.ts.';
    const intent = await router.routeIntent(prompt);
    expect(intent.route).toBe('hermes');
    expect(intent.selectedCapability).toBe('hermes');
  });

  it('Case E: "Jarvis, explain what we should do next." -> DIRECT CONVERSATION / REASONING (CurrentWork hijack: NO)', async () => {
    const prompt = 'Jarvis, explain what we should do next.';
    const isHijacked = isCurrentWorkQuestion(prompt);
    expect(isHijacked, 'Should NOT be hijacked by currentWorkContext').toBe(false);

    const intent = await router.routeIntent(prompt);
    expect(intent.route).toBe('direct');
    expect(intent.mode).toBe('direct_conversation');
  });

  it('Case F: "Jarvis, inspect server/src/domains/jarvis/intentRouter.ts." -> READ/INVESTIGATION route', async () => {
    const prompt = 'Jarvis, inspect server/src/domains/jarvis/intentRouter.ts.';
    const intent = await router.routeIntent(prompt);
    expect(intent.route).toBe('codex');
    expect(intent.category).toBe('repository_analysis');
    expect(intent.requiresApproval).toBe(false); // Read-only inspection does not require mutation approval
  });

  it('Case G: "Jarvis, fix the bug in server/src/routers/jarvis.ts." -> CODEX / EXECUTION route', async () => {
    const prompt = 'Jarvis, fix the bug in server/src/routers/jarvis.ts.';
    const intent = await router.routeIntent(prompt);
    expect(intent.route).toBe('codex');
    expect(intent.category).toBe('repository_change');
  });

  it('Case H: "Why did the code fail earlier?" -> DIRECT CONVERSATION', async () => {
    const prompt = 'Why did the code fail earlier?';
    const intent = await router.routeIntent(prompt);
    expect(intent.route).toBe('direct');
    expect(intent.mode).toBe('direct_conversation');
  });

  it('Case I: "What is currently running?" -> CURRENT WORK STATUS', async () => {
    const prompt = 'What is currently running?';
    const isStatus = isCurrentWorkQuestion(prompt) || isTaskStatusQuery(prompt);
    expect(isStatus, 'Must be identified as current work or task status query').toBe(true);
  });

  it('Case J: "Thanks Jarvis." -> FAST LOCAL RESPONSE', async () => {
    const prompt = 'Thanks Jarvis.';
    const fastReply = detectLocalFastReply(prompt);
    expect(fastReply, 'Fast path must catch "Thanks Jarvis."').not.toBeNull();
    expect(fastReply!.reply.length).toBeGreaterThan(0);
  });
});
