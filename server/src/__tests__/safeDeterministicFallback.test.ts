import { describe, it, expect } from 'vitest';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';

describe('Safe Deterministic Fallback & Disambiguation Suite (Repair 3)', () => {
  const telegramCtx = {
    conversationId: 'test-conv',
    activeApplication: 'Telegram',
    activeWindow: 'Telegram Desktop',
    activeChat: 'Agentic OS bot',
    verifiedSelectedChat: true,
  };

  it('prevents context poisoning: "open Chrome" when Telegram is active must compile as OPEN_APPLICATION', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open Chrome', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_APPLICATION');
    expect(step.application).toBe('Chrome');
    expect(step.targetType).toBe('APPLICATION_WINDOW');
    expect(step.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
  });

  it('prevents context poisoning: "open Google Chrome" when Telegram is active must compile as OPEN_APPLICATION', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open Google Chrome', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_APPLICATION');
    expect(step.application).toBe('Chrome');
    expect(step.targetType).toBe('APPLICATION_WINDOW');
    expect(step.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
  });

  it('prevents context poisoning: "open browser" when Telegram is active must compile as OPEN_APPLICATION', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open browser', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_APPLICATION');
    expect(step.application).toBe('Chrome');
    expect(step.targetType).toBe('APPLICATION_WINDOW');
    expect(step.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
  });

  it('prevents context poisoning: "open Notepad" when Telegram is active must compile as OPEN_APPLICATION', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open Notepad', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_APPLICATION');
    expect(step.application).toBe('Notepad');
    expect(step.targetType).toBe('APPLICATION_WINDOW');
    expect(step.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
  });

  it('prevents context poisoning: "open Terminal" when Telegram is active must compile as OPEN_APPLICATION', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open Terminal', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_APPLICATION');
    expect(step.application).toBe('Terminal');
    expect(step.targetType).toBe('APPLICATION_WINDOW');
    expect(step.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
  });

  it('prevents context poisoning: "open Explorer" when Telegram is active must compile as OPEN_APPLICATION', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open Explorer', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_APPLICATION');
    expect(step.application).toBe('Explorer');
    expect(step.targetType).toBe('APPLICATION_WINDOW');
    expect(step.interpretationPath).toBe('DETERMINISTIC_FALLBACK');
  });

  it('compound plan disambiguation: "open Google Chrome and go to YouTube" when Telegram is active', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open Google Chrome and go to YouTube', telegramCtx);
    expect(plan.isCompound).toBe(true);
    expect(plan.steps).toHaveLength(2);

    // Step 0: Open Chrome
    expect(plan.steps[0].action).toBe('OPEN_APPLICATION');
    expect(plan.steps[0].application).toBe('Chrome');
    expect(plan.steps[0].targetType).toBe('APPLICATION_WINDOW');

    // Step 1: Navigate to YouTube in browser
    expect(plan.steps[1].action).toBe('NAVIGATE_WEB');
    expect(plan.steps[1].target).toBe('YouTube');
    expect(plan.steps[1].targetType).toBe('WEB_URL');
  });

  it('preserves legitimate conversational OPEN_CHAT: "open AgenticOS" when Telegram is active', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open AgenticOS', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_CHAT');
    expect(step.application).toBe('Telegram');
    expect(step.target).toBe('Agentic OS bot');
    expect(step.targetType).toBe('CHAT_CONVERSATION');
  });

  it('preserves legitimate conversational OPEN_CHAT: "locate Agentic OS bot inside Telegram"', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('locate Agentic OS bot inside Telegram', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step.action).toBe('OPEN_CHAT');
    expect(step.application).toBe('Telegram');
    expect(step.target).toBe('Agentic OS bot');
  });

  it('fails closed / asks for clarification on ambiguous target without mutating Telegram', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('open mysterious_widget_xyz', telegramCtx);
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    // Must NOT become OPEN_CHAT in Telegram! Must fail closed with clarification request.
    expect(step.action).toBe('CONVERSATIONAL');
    expect(step.confidence).toBeLessThan(1.0);
    expect(step.reason).toContain('Clarification requested');
  });
});
