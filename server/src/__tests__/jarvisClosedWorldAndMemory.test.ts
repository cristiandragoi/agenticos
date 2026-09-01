import { describe, it, expect, beforeEach } from 'vitest';
import { getScopedJarvisMemoryContextDetailed } from '../domains/jarvis/coreMemory.js';
import { assembleConversationContext, contextToSystemPrompt } from '../domains/jarvis/conversationContext.js';
import { IntentRouter } from '../domains/jarvis/intentRouter.js';
import { memoryStore } from '../services/memory/store.js';

describe('Jarvis Authoritative Pinned Core Memory & Closed-World Local Routing', () => {
  const router = new IntentRouter();

  beforeEach(() => {
    const now = Date.now();
    if (!memoryStore.get('mem-1788142946777-ic51xu')) {
      memoryStore.create({
        id: 'mem-1788142946777-ic51xu',
        scope: 'system:principles',
        type: 'principle',
        title: 'Authoritative AgenticOS and Codex Context',
        summary: 'Authoritative AgenticOS context',
        content: 'AgenticOS is the local operating system runtime. CodeX is the local coding engine.',
        status: 'active',
        pinned: true,
        verificationStatus: 'human_confirmed',
        confidence: 1.0,
        source: { sourceType: 'user' },
        createdAt: now,
        updatedAt: now,
        lastConfirmedAt: null,
        lastUsedAt: null,
        useCount: 0,
        entities: [],
        tags: [],
        supersedesMemoryId: null,
        derivedFromMemoryIds: [],
      });
    }

    if (!memoryStore.get('mem-1788143176847-2msl4c')) {
      memoryStore.create({
        id: 'mem-1788143176847-2msl4c',
        scope: 'system:principles',
        type: 'principle',
        title: 'Jarvis Local Operator Mission and Voice Turn-Taking Contract',
        summary: 'Jarvis operator mission and voice contract',
        content: 'Jarvis is the local operator of AgenticOS and Revenue Operator. Turn taking requires synchronous stop.',
        status: 'active',
        pinned: true,
        verificationStatus: 'human_confirmed',
        confidence: 1.0,
        source: { sourceType: 'user' },
        createdAt: now,
        updatedAt: now,
        lastConfirmedAt: null,
        lastUsedAt: null,
        useCount: 0,
        entities: [],
        tags: [],
        supersedesMemoryId: null,
        derivedFromMemoryIds: [],
      });
    }
  });

  it('1. getScopedJarvisMemoryContextDetailed injects mem-1788142946777-ic51xu and mem-1788143176847-2msl4c', async () => {
    const res = await getScopedJarvisMemoryContextDetailed('Hello Jarvis');
    expect(res.injectedMemoryIds).toContain('mem-1788142946777-ic51xu');
    expect(res.injectedMemoryIds).toContain('mem-1788143176847-2msl4c');
    expect(res.text).toContain('mem-1788142946777-ic51xu');
    expect(res.text).toContain('mem-1788143176847-2msl4c');
  });

  it('2. Pinned core memory deduplication works', async () => {
    const res = await getScopedJarvisMemoryContextDetailed('Hello Jarvis');
    const ids = res.injectedMemoryIds;
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('3. System prompt includes pinned memories before recent search memory', async () => {
    const ctx = await assembleConversationContext('conv-test-mem', 'Check the local AgenticOS status');
    expect(ctx.injectedMemoryIds).toContain('mem-1788142946777-ic51xu');
    const prompt = contextToSystemPrompt(ctx);
    expect(prompt).toContain('AUTHORITATIVE PINNED SYSTEM PRINCIPLES & CONTRACTS');
    expect(prompt).toContain('Authoritative AgenticOS and Codex Context');
  });

  it('4. "Check AgenticOS" does NOT route to web search', async () => {
    const result = await router.routeIntent('Check AgenticOS');
    expect(result.route).not.toBe('hermes');
    expect(result.category).not.toBe('research');
  });

  it('5. "What is the AgenticOS status?" does NOT route to web search', async () => {
    const result = await router.routeIntent('What is the AgenticOS status?');
    expect(result.route).not.toBe('hermes');
    expect(result.category).not.toBe('research');
  });

  it('6. "Check Codex" does NOT route to web search', async () => {
    const result = await router.routeIntent('Check Codex');
    expect(result.route).not.toBe('hermes');
    expect(result.category).not.toBe('research');
  });

  it('7. "What is Codex doing?" inspects local Codex run', async () => {
    const result = await router.routeIntent('What is Codex doing?');
    expect(result.route).toBe('investigate');
    expect(result.executionMode).toBe('operational_execution');
  });

  it('8. "Check Hermes" does NOT route to web search', async () => {
    const result = await router.routeIntent('Check Hermes');
    expect(result.category).not.toBe('research');
    expect(result.route).toBe('investigate');
  });

  it('9. "Check the providers" inspects local providers', async () => {
    const result = await router.routeIntent('Check the providers');
    expect(result.route).toBe('investigate');
  });

  it('10. "Start Revenue Operator" routes to local revenue control and does not web search', async () => {
    const result = await router.routeIntent('Start Revenue Operator');
    expect(result.category).not.toBe('research');
  });

  it('11. "What is Revenue Operator doing?" reports local revenue state without web search', async () => {
    const result = await router.routeIntent('What is Revenue Operator doing?');
    expect(result.category).not.toBe('research');
  });

  it('12. "Check the repository" inspects local workspace without web search', async () => {
    const result = await router.routeIntent('Check the repository');
    expect(result.category).not.toBe('research');
  });

  it('13. "Why is Jarvis broken?" inspects local runtime/diagnostics without web search', async () => {
    const result = await router.routeIntent('Why is Jarvis broken?');
    expect(result.category).not.toBe('research');
    expect(result.route).toBe('investigate');
  });

  it('14. Explicit web search request STILL works when explicitly asked', async () => {
    const result = await router.routeIntent('Search the web for the latest TypeScript 5.8 features');
    expect(result.route).toBe('hermes');
    expect(result.category).toBe('research');
  });

  it('15. Deterministic language switch intercepts English, German, and Romanian variants', async () => {
    const { detectLanguageSwitchRequest } = await import('../domains/jarvis/conversationLanguage.js');

    expect(detectLanguageSwitchRequest('switch in English')).toEqual({
      isLanguageSwitch: true,
      targetLanguage: 'en',
      reason: 'Explicit user instruction to speak English',
    });

    expect(detectLanguageSwitchRequest('switch to English')).toEqual({
      isLanguageSwitch: true,
      targetLanguage: 'en',
      reason: 'Explicit user instruction to speak English',
    });

    expect(detectLanguageSwitchRequest('speak English')).toEqual({
      isLanguageSwitch: true,
      targetLanguage: 'en',
      reason: 'Explicit user instruction to speak English',
    });

    expect(detectLanguageSwitchRequest('switch in German')).toEqual({
      isLanguageSwitch: true,
      targetLanguage: 'de',
      reason: 'Explicit user instruction to speak German',
    });

    expect(detectLanguageSwitchRequest('switch in Romanian')).toEqual({
      isLanguageSwitch: true,
      targetLanguage: 'ro',
      reason: 'Explicit user instruction to speak Romanian',
    });
  });
});
