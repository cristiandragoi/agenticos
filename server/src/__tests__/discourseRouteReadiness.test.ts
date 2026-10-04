import * as dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });

import { describe, it, expect } from 'vitest';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { validateStructuredIntent } from '../domains/controlPlane/StructuredIntent.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { getAgentModelPolicy, normalizeAgentRoleId } from '../services/gateway/agentModelPolicy.js';
import { llmChat } from '../services/llmGateway.js';

describe('REAL Production Discourse Route Readiness Suite (Requirements B & G - NO MOCKS)', () => {
  it('verifies discourse policy resolves to dedicated cloud route without local fallback', () => {
    const role = normalizeAgentRoleId('agent-jarvis-discourse');
    expect(role).toBe('discourse');

    const policy = getAgentModelPolicy('discourse');
    expect(policy.agentId).toBe('discourse');
    expect(policy.primary).toContain('google/gemini-2.5-flash');
    expect(policy.allowLocalFallback).toBe(false);
    expect(policy.localFallback).toBe('');
    expect(policy.latencyBudgetMs).toBe(2500);
  });

  it('proves real production route produces valid StructuredIntent for noisy Telegram request within latency budget', async () => {
    // Ensure mock provider is DISABLED - MUST use real production route
    semanticDiscourseInterpreter.setMockProvider(null);

    const noisyTranscript = 'rigged to me the last four messages inside Telegram Board AgenticOS.';
    const context = {
      conversationId: 'real-readiness-test',
      activeApplication: 'Telegram',
      activeWindow: 'Telegram Desktop',
      activeChat: 'Agentic OS bot',
    };

    const t0 = Date.now();
    const res = await semanticDiscourseInterpreter.interpret(noisyTranscript, context);
    const totalLatency = Date.now() - t0;

    console.log('[PROD_READINESS] Noisy Transcript Latency:', totalLatency, 'ms');
    console.log('[PROD_READINESS] Interpretation Path:', res.interpretationPath);
    console.log('[PROD_READINESS] StructuredIntent:', JSON.stringify(res.structuredIntent, null, 2));

    // Must succeed via real semantic model
    expect(res.interpretationPath).toBe('SEMANTIC_LLM');
    expect(res.structuredIntent).toBeDefined();

    // Verify latency budget <= 2000ms
    expect(res.latencyMs).toBeLessThanOrEqual(2000);

    // Validate StructuredIntent schema deterministically
    const validation = validateStructuredIntent(res.structuredIntent!, context);
    expect(validation.valid).toBe(true);

    const intent = res.structuredIntent!;
    expect(intent.turnType).toBe('COMMAND');

    // Verify expected semantic meaning:
    // User requested reading last 4 messages from Telegram AgenticOS
    const readStep = intent.steps.find((s) => s.action === 'READ_MESSAGES' || s.action === 'READ_CONTENT');
    expect(readStep).toBeDefined();
    expect(readStep?.application?.toLowerCase()).toContain('telegram');
    expect(readStep?.target?.toLowerCase()).toContain('agentic');
    if (readStep?.entityCount !== undefined) {
      expect(readStep.entityCount).toBe(4);
    }

    // Verify compileFromStructuredIntent produces deterministic plan
    const plan = res.plan;
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    const mainStep = plan.steps[plan.steps.length - 1];
    expect(mainStep.action).toBe('READ_MESSAGES');
    expect(mainStep.application).toBe('Telegram');
  }, 10000);

  it('proves real production route produces valid StructuredIntent for "open Google Chrome and go to YouTube."', async () => {
    semanticDiscourseInterpreter.setMockProvider(null);

    const utterance = 'open Google Chrome and go to YouTube.';
    const context = {
      conversationId: 'real-readiness-test',
      activeApplication: 'Telegram', // Telegram was active during human test!
    };

    const t0 = Date.now();
    const res = await semanticDiscourseInterpreter.interpret(utterance, context);
    const totalLatency = Date.now() - t0;

    console.log('[PROD_READINESS] Chrome+YouTube Latency:', totalLatency, 'ms');
    console.log('[PROD_READINESS] StructuredIntent:', JSON.stringify(res.structuredIntent, null, 2));

    expect(res.interpretationPath).toBe('SEMANTIC_LLM');
    expect(res.structuredIntent).toBeDefined();
    expect(res.latencyMs).toBeLessThanOrEqual(2000);

    const intent = res.structuredIntent!;
    expect(intent.steps.length).toBeGreaterThanOrEqual(2);

    // Step 0: Open Chrome
    const openAppStep = intent.steps.find((s) => s.action === 'OPEN_APPLICATION');
    expect(openAppStep).toBeDefined();
    expect(openAppStep?.application?.toLowerCase()).toContain('chrome');

    // Step 1: Navigate to YouTube
    const navStep = intent.steps.find((s) => s.action === 'NAVIGATE_WEB');
    expect(navStep).toBeDefined();
    expect(navStep?.target?.toLowerCase()).toContain('youtube');

    // Verify compiled plan maintains compound order:
    // Step 0: OPEN_APPLICATION Chrome
    // Step 1: NAVIGATE_WEB YouTube
    expect(res.plan.steps[0].action).toBe('OPEN_APPLICATION');
    expect(res.plan.steps[0].application).toBe('Chrome');
    expect(res.plan.steps[1].action).toBe('NAVIGATE_WEB');
    expect(res.plan.steps[1].target).toContain('YouTube');
  }, 10000);

  it('proves real semantic interpretation understands venting & complaint turns from human session', async () => {
    semanticDiscourseInterpreter.setMockProvider(null);

    const ventingUtterance = "Ascii asked him to locate AgenticOS, he's not understanding what my request.";
    const context = {
      conversationId: 'real-readiness-test',
      activeApplication: 'Telegram',
    };

    const res = await semanticDiscourseInterpreter.interpret(ventingUtterance, context);
    console.log('[PROD_READINESS] Venting Transcript Result:', res.structuredIntent);

    expect(res.interpretationPath).toBe('SEMANTIC_LLM');
    expect(res.structuredIntent).toBeDefined();
    expect(res.latencyMs).toBeLessThanOrEqual(2000);

    // Venting / complaint utterance must be classified as VENTING_OR_META or CONVERSATIONAL
    // and MUST NOT trigger an unintended physical desktop mutation!
    const turnType = res.structuredIntent!.turnType;
    expect(['VENTING_OR_META', 'CONVERSATIONAL', 'CLARIFICATION']).toContain(turnType);
    expect(res.plan.steps[0].action).toBe('CONVERSATIONAL');
  }, 10000);
});
