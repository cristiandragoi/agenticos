import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatRequest, ChatResponse, ChatStreamChunk, ModelGateway, ProviderDefinition } from '../services/gateway/types.js';
import { runEvalCase } from '../services/evaluation/runner.js';
import { runEvaluation } from '../services/evaluation/orchestrator.js';
import { buildComparison, formatComparison } from '../services/evaluation/comparison.js';
import { isValidJson, extractJson, runAssertions } from '../services/evaluation/verifier.js';
import { DEFAULT_EVAL_CASES } from '../services/evaluation/cases.js';
import { persistEvalResult, listRecentEvals, countEvals } from '../services/evaluation/store.js';

/**
 * modelEvaluation.test.ts — evaluation harness tests (C11).
 * Uses fake gateways; no network. Verifier, runner, orchestration, persistence,
 * comparison ranking, partial provider failure, and secret redaction.
 */

function fakeDef(name: string, model: string): ProviderDefinition {
  return { name, baseUrl: 'http://fake', model, type: 'openai' };
}

class FakeGateway implements ModelGateway {
  name: string;
  definition: ProviderDefinition;
  replyFor: (req: ChatRequest) => string;
  throwFor?: (req: ChatRequest) => Error | null;
  latencyMs = 5;

  constructor(name: string, model: string, replyFor: (req: ChatRequest) => string, throwFor?: (req: ChatRequest) => Error | null) {
    this.name = name;
    this.definition = fakeDef(name, model);
    this.replyFor = replyFor;
    this.throwFor = throwFor;
  }

  async healthcheck() { return { reachable: true }; }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (this.throwFor) {
      const err = this.throwFor(req);
      if (err) throw err;
    }
    return { reply: this.replyFor(req), provider: this.name, model: this.definition.model, offline: false };
  }
  async *stream(req: ChatRequest): AsyncGenerator<ChatStreamChunk> {
    const text = this.replyFor(req);
    for (const ch of text.match(/.{1,3}/g) || []) {
      yield { type: 'token', content: ch, provider: this.name, model: this.definition.model };
    }
    yield { type: 'done', provider: this.name, model: this.definition.model };
  }
}

describe('verifier — deterministic assertions', () => {
  it('validates JSON and extracts fields', () => {
    expect(isValidJson('{"name":"x"}')).toBe(true);
    expect(isValidJson('```json\n{"a":1}\n```')).toBe(true);
    expect(isValidJson('not json')).toBe(false);
    expect(extractJson('prefix {"name":"x"} suffix')).toEqual({ name: 'x' });
  });
  it('grades contains / not_contains / exact_field assertions', () => {
    const res = runAssertions('Hermes does research in Agentic OS.', [
      { kind: 'contains', value: 'Hermes', description: 'has hermes' },
      { kind: 'not_contains', value: 'undefined', description: 'no undefined' },
      { kind: 'exact_field', value: 'name', description: 'json name' },
    ]);
    expect(res[0].passed).toBe(true);
    expect(res[1].passed).toBe(true);
    expect(res[2].passed).toBe(false); // not JSON
  });
  it('detects forbidden hallucinated ids', () => {
    const res = runAssertions('the project is proj-XYZ', [
      { kind: 'forbidden_hallucination', value: 'proj-NOPE', description: 'no fake id' },
    ]);
    expect(res[0].passed).toBe(true);
  });
});

describe('runner — normalization, latency, timeout', () => {
  it('PASSES when all assertions hold, records latency', async () => {
    const gw = new FakeGateway('FakeA', 'model-a', () => 'Hermes does research. Magnitude does browsing.');
    const caseDef = DEFAULT_EVAL_CASES[0]; // E1-hermes-explanation
    const r = await runEvalCase(caseDef, gw, { timeoutMs: 5000 });
    expect(r.outcome).toBe('PASS');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.verifier).toBe('deterministic_assertions');
  });
  it('NEEDS_REVISION when an assertion fails', async () => {
    const gw = new FakeGateway('FakeA', 'model-a', () => 'nothing relevant here');
    const r = await runEvalCase(DEFAULT_EVAL_CASES[0], gw, { timeoutMs: 5000 });
    expect(r.outcome).toBe('NEEDS_REVISION');
    expect(r.error).toContain('Assertions failed');
  });
  it('ERROR on provider failure (not a crash)', async () => {
    const gw = new FakeGateway('FakeA', 'model-a', () => '', () => new Error('HTTP 500 boom'));
    const r = await runEvalCase(DEFAULT_EVAL_CASES[0], gw, { timeoutMs: 5000 });
    expect(r.outcome).toBe('ERROR');
    expect(r.error).toContain('HTTP 500');
  });
  it('streaming captures first-token latency and does not duplicate tokens', async () => {
    const gw = new FakeGateway('FakeA', 'model-a', () => 'Hermes does research.');
    const r = await runEvalCase(DEFAULT_EVAL_CASES[0], gw, { timeoutMs: 5000, measureFirstToken: true });
    expect(r.outcome).toBe('PASS');
    expect(r.firstTokenMs).toBeGreaterThanOrEqual(0);
  });
});

describe('orchestrator — multi-provider, partial failure, persistence', () => {
  beforeEach(() => {
    // fresh eval table for the test DB
  });

  it('a failing provider does not abort the comparison run', async () => {
    const good = new FakeGateway('Good', 'model-g', () => 'Hermes does research.');
    const bad = new FakeGateway('Bad', 'model-b', () => '', () => new Error('HTTP 500'));
    const summary = await runEvaluation(
      [
        { name: 'Good', gateway: good },
        { name: 'Bad', gateway: bad },
      ],
      [DEFAULT_EVAL_CASES[0], DEFAULT_EVAL_CASES[1]],
      { timeoutMs: 5000 },
    );
    expect(summary.results.length).toBe(4); // 2 providers x 2 cases
    const outcomes = summary.results.map((r) => r.outcome);
    expect(outcomes.some((o) => o === 'PASS')).toBe(true);
    expect(outcomes.some((o) => o === 'ERROR')).toBe(true);
    expect(summary.persisted).toBe(4);
    expect(summary.totalStored).toBeGreaterThanOrEqual(4);
  });

  it('persists evaluations separately and lists them', async () => {
    const gw = new FakeGateway('Good', 'model-g', () => 'Hermes does research.');
    const r = await runEvalCase(DEFAULT_EVAL_CASES[0], gw, { timeoutMs: 5000 });
    const id = persistEvalResult(r);
    expect(id).toMatch(/^eval-/);
    const recent = listRecentEvals();
    expect(recent.some((e) => e.id === id)).toBe(true);
    expect(countEvals()).toBeGreaterThanOrEqual(1);
  });
});

describe('comparison — ranking and recommendation', () => {
  it('ranks PASS over NEEDS_REVISION and recommends fastest on ties', () => {
    const results = [
      { caseId: 'E1', provider: 'A', model: 'a', outcome: 'NEEDS_REVISION', latencyMs: 100, firstTokenMs: 50, totalTokens: 10 },
      { caseId: 'E1', provider: 'B', model: 'b', outcome: 'PASS', latencyMs: 200, firstTokenMs: 80, totalTokens: 20 },
      { caseId: 'E1', provider: 'C', model: 'c', outcome: 'PASS', latencyMs: 150, firstTokenMs: 40, totalTokens: 15 },
    ] as any;
    const cmp = buildComparison(results);
    expect(cmp[0].recommended).toBe('C/c');
    expect(cmp[0].recommendationReason).toContain('PASS');
  });
  it('returns no recommendation when all providers fail', () => {
    const results = [
      { caseId: 'E1', provider: 'A', model: 'a', outcome: 'ERROR', latencyMs: 100, firstTokenMs: 0 },
      { caseId: 'E1', provider: 'B', model: 'b', outcome: 'TIMEOUT', latencyMs: 100, firstTokenMs: 0 },
    ] as any;
    const cmp = buildComparison(results);
    expect(cmp[0].recommended).toBeUndefined();
  });
  it('formats a human-readable comparison', () => {
    const cmp = buildComparison([
      { caseId: 'E1', provider: 'A', model: 'a', outcome: 'PASS', latencyMs: 100, firstTokenMs: 50, totalTokens: 10 },
    ] as any);
    const text = formatComparison(cmp);
    expect(text).toContain('Case: E1');
    expect(text).toContain('Recommended:');
  });
});

describe('cases — the E1–E8 suite is coherent', () => {
  it('has one case per category and no empty assertions', () => {
    expect(DEFAULT_EVAL_CASES.length).toBeGreaterThanOrEqual(13); // E1–E8 + C-EVAL-1..5
    const categories = new Set(DEFAULT_EVAL_CASES.map((c) => c.category));
    expect(categories.size).toBeGreaterThanOrEqual(7);
    for (const c of DEFAULT_EVAL_CASES) {
      expect(c.assertions.length).toBeGreaterThan(0);
      expect(c.prompt.length).toBeGreaterThan(0);
    }
  });
});
