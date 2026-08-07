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

describe('CodeX parse-failure budget (stalled local model must reach a terminal state)', () => {
  const oldEnv = process.env.CODEX_MAX_PARSE_FAILURES;
  let ws: string;

  beforeEach(() => {
    process.env.CODEX_MAX_PARSE_FAILURES = '2';
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parse-budget-'));
  });
  afterEach(() => {
    if (oldEnv === undefined) delete process.env.CODEX_MAX_PARSE_FAILURES;
    else process.env.CODEX_MAX_PARSE_FAILURES = oldEnv;
    fs.rmSync(ws, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('a model that repeatedly returns unparseable text fails the goal after the budget (no infinite planning loop)', async () => {
    // Chatty, non-JSON output — exactly the live failure (ollama/qwen3.5:4b
    // and the fallback returned prose instead of a strict-JSON tool call).
    vi.mocked(llmChat).mockResolvedValue({
      reply: 'I will inspect the repository files carefully and then report my findings.',
      provider: 'ollama',
      model: 'qwen3.5:4b',
      offline: false,
    } as any);

    const service = new CodexService();
    // createGoal with 'auto' approval starts the loop itself.
    const goalId = await service.createGoal(
      'Perform a read-only health inspection.',
      ws,
      'auto',
      'ollama',
      'conv-parse',
      'ws-parse',
      {}
    );

    // Bounded poll: the goal must reach a TERMINAL state instead of cycling
    // planning phases forever.
    let status = goalStore.get(goalId)?.status;
    for (let i = 0; i < 100 && status !== 'failed'; i++) {
      await sleep(50);
      status = goalStore.get(goalId)?.status;
    }
    expect(status).toBe('failed');

    const events = ((goalStore.get(goalId)?.history) || []) as any[];
    const limitEvents = events.filter((e: any) => e.errorCode === 'CODEX_PARSE_FAILURE_LIMIT');
    expect(limitEvents.length).toBe(1);
    expect(events.some((e: any) => e.eventType === 'task_failed')).toBe(true);
  });
});
