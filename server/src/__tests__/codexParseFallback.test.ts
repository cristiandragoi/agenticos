// codexParseFallback.test.ts — parse failure on the preferred provider must
// escalate to the configured fallback chain (a provider-attempt failure, not a
// task failure). Regression for the "invalid tool JSON twice → aborted" failure.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { llmChat } from '../services/llmGateway';
import { CodexService } from '../domains/codex/service';
import { goalStore } from '../services/goalStore';

vi.mock('../services/llmGateway', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, llmChat: vi.fn() };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FINISH = (msg: string) => JSON.stringify({ type: 'tool_call', tool: 'finish', arguments: { message: msg } });
const MALFORMED = '{"type":"tool_call","tool":"writeFile","arguments":{"path":"a.ts","content":"truncated';

describe('CodeX parse-failure fallback escalation', () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parse-fallback-'));
  });
  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('escalates to the fallback provider when the preferred provider emits malformed JSON, and completes with truthful metadata', async () => {
    const calls: any[] = [];
    vi.mocked(llmChat).mockImplementation(async (opts: any) => {
      calls.push(opts);
      // First two calls (preferred provider + its strict retry) → malformed JSON.
      if (calls.length <= 2) {
        return { reply: MALFORMED, provider: 'DeepSeek', model: 'deepseek-chat', offline: false } as any;
      }
      // Fallback provider → valid finish tool call.
      return { reply: FINISH('Recovered via fallback provider.'), provider: 'Ollama', model: 'llama3.2:3b', offline: false } as any;
    });

    const service = new CodexService();
    const goalId = await service.createGoal(
      'Perform a read-only inspection of the repository health.',
      ws,
      'auto',
      'prov-deepseek',
      'conv-fallback',
      'ws-fallback',
      {}
    );

    // Poll for a terminal state (the fallback should let it COMPLETE, not fail).
    let status = goalStore.get(goalId)?.status;
    for (let i = 0; i < 200 && status !== 'completed' && status !== 'failed'; i++) {
      await sleep(50);
      status = goalStore.get(goalId)?.status;
    }
    expect(status).toBe('completed');

    // The fallback call must have excluded the failed preferred provider.
    const fallbackCall = calls.find((c) => Array.isArray(c.excludeProviders) && c.excludeProviders.length > 0);
    expect(fallbackCall).toBeTruthy();
    expect(fallbackCall.excludeProviders).toContain('prov-deepseek');

    // Truthful metadata: the goal records the provider/model that actually succeeded.
    const goal = goalStore.get(goalId) as any;
    const events = (goal?.history || []) as any[];
    const fallbackEvent = events.find((e: any) => /Parse-failure fallback/i.test(e.message || ''));
    expect(fallbackEvent).toBeTruthy();
    expect(fallbackEvent.provider).toBe('Ollama');
  });

  it('fails truthfully when BOTH the preferred and fallback providers emit malformed JSON', async () => {
    vi.mocked(llmChat).mockResolvedValue({
      reply: MALFORMED,
      provider: 'DeepSeek',
      model: 'deepseek-chat',
      offline: false,
    } as any);

    const service = new CodexService();
    const goalId = await service.createGoal(
      'Inspect the repository health read-only.',
      ws,
      'auto',
      'prov-deepseek',
      'conv-fallback2',
      'ws-fallback2',
      {}
    );

    let status = goalStore.get(goalId)?.status;
    for (let i = 0; i < 200 && status !== 'failed' && status !== 'completed'; i++) {
      await sleep(50);
      status = goalStore.get(goalId)?.status;
    }
    expect(status).toBe('failed');

    // No fabricated tool execution: no writeFile/readFile tool events.
    const events = ((goalStore.get(goalId)?.history) || []) as any[];
    expect(events.some((e: any) => e.eventType === 'tool_completed' && e.tool && e.tool !== 'finish')).toBe(false);
    expect(events.some((e: any) => e.eventType === 'task_failed')).toBe(true);
  });
});
