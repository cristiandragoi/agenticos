import { describe, it, expect } from 'vitest';
import { arbitrateSemanticIntent, AuthoritativeIntentCompiler } from '../domains/jarvis/semanticIntentArbitrator.js';

describe('Authoritative Semantic Intent Arbitrator', () => {
  it('correctly resolves Antigravity application perception vs worker delegation', () => {
    // 1. Natural variations of Antigravity reading window content -> NOT delegation
    const variants = [
      'Read what is inside Antigravity.',
      'Read what is inside anti-gravity.',
      'Read what is inside anti gravity.',
      'Read what is inside the Antigravity page.',
      'Antigravity, read what is inside this window.',
      'Jarvis, read what is inside the Antigravity page',
    ];

    for (const v of variants) {
      const intent = arbitrateSemanticIntent(v);
      expect(intent.action).toBe('READ_CONTENT');
      expect(intent.targetType).toBe('APPLICATION_WINDOW');
      expect(intent.application).toBe('Antigravity');
      expect(intent.delegationRequested).toBe(false);
    }
  });

  it('correctly detects explicit delegation to Antigravity and Hermes', () => {
    // 2. Explicit delegation requests
    const del1 = arbitrateSemanticIntent('Delegate this to Antigravity.');
    expect(del1.action).toBe('DELEGATE');
    expect(del1.targetType).toBe('WORKER');
    expect(del1.worker).toBe('antigravity');
    expect(del1.delegationRequested).toBe(true);

    const del2 = arbitrateSemanticIntent('Ask Antigravity to inspect this repository.');
    expect(del2.action).toBe('DELEGATE');
    expect(del2.targetType).toBe('WORKER');
    expect(del2.worker).toBe('antigravity');
    expect(del2.delegationRequested).toBe(true);

    const del3 = arbitrateSemanticIntent('Delegate this problem to Antigravity.');
    expect(del3.action).toBe('DELEGATE');
    expect(del3.targetType).toBe('WORKER');
    expect(del3.worker).toBe('antigravity');
    expect(del3.delegationRequested).toBe(true);

    const delHermes = arbitrateSemanticIntent('Delegate this task to Hermes.');
    expect(delHermes.action).toBe('DELEGATE');
    expect(delHermes.targetType).toBe('WORKER');
    expect(delHermes.worker).toBe('hermes');
    expect(delHermes.delegationRequested).toBe(true);
  });

  it('distinguishes Telegram Desktop launch from Telegram Web', () => {
    // 3. Desktop Telegram
    const tgDesktop = arbitrateSemanticIntent('Open Telegram.');
    expect(tgDesktop.action).toBe('OPEN_APPLICATION');
    expect(tgDesktop.targetType).toBe('APPLICATION_WINDOW');
    expect(tgDesktop.application).toBe('Telegram');
    expect(tgDesktop.delegationRequested).toBe(false);

    // 4. Telegram Web
    const tgWeb = arbitrateSemanticIntent('Open Telegram Web.');
    expect(tgWeb.action).toBe('OPEN_APPLICATION');
    expect(tgWeb.targetType).toBe('APPLICATION_WINDOW');
    expect(tgWeb.application).toBe('Browser');
    expect(tgWeb.target).toBe('https://web.telegram.org');
    expect(tgWeb.delegationRequested).toBe(false);
  });

  it('resolves chat opening with exact target chat', () => {
    // 5. Open chat
    const openBot = arbitrateSemanticIntent('Open the Agentic OS bot.');
    expect(openBot.action).toBe('OPEN_CHAT');
    expect(openBot.targetType).toBe('CHAT_CONVERSATION');
    expect(openBot.application).toBe('Telegram');
    expect(openBot.target).toBe('Agentic OS bot');
    expect(openBot.delegationRequested).toBe(false);

    const plan = AuthoritativeIntentCompiler.compilePlan('Open Telegram and open the Agentic OS bot');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe('OPEN_APPLICATION');
    expect(plan.steps[0].application).toBe('Telegram');
    expect(plan.steps[0].target).toBe('Telegram Desktop');
    expect(plan.steps[1].action).toBe('OPEN_CHAT');
    expect(plan.steps[1].targetType).toBe('CHAT_CONVERSATION');
    expect(plan.steps[1].application).toBe('Telegram');
    expect(plan.steps[1].target).toBe('Agentic OS bot');
  });

  it('resolves reading chat messages with count', () => {
    // 6. Read last four messages
    const readMsgs = arbitrateSemanticIntent('Read the last four messages.');
    expect(readMsgs.action).toBe('READ_MESSAGES');
    expect(readMsgs.targetType).toBe('CHAT_CONVERSATION');
    expect(readMsgs.application).toBe('Telegram');
    expect(readMsgs.target).toBe('Agentic OS bot');
    expect(readMsgs.count).toBe(4);
    expect(readMsgs.delegationRequested).toBe(false);
  });

  it('resolves document point follow-ups and chat message explanations', () => {
    // 7. Point 3
    const p3 = arbitrateSemanticIntent('Read point 3.');
    expect(p3.action).toBe('READ_CONTENT');
    expect(p3.targetType).toBe('DOCUMENT_CONTENT');
    expect(p3.application).toBe('Antigravity');
    expect(p3.contentRequest).toBe('point 3');
    expect(p3.count).toBe(3);

    // 8. Explain last message
    const lastOne = arbitrateSemanticIntent('What does the last one mean?');
    expect(lastOne.action).toBe('READ_MESSAGES');
    expect(lastOne.targetType).toBe('CHAT_CONVERSATION');
    expect(lastOne.contentRequest).toBe('explain_last');
    expect(lastOne.count).toBe(1);
  });
});
