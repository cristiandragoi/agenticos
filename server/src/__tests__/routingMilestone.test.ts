import { describe, it, expect, beforeEach } from 'vitest';
import { routingLedger } from '../services/routingLedger.js';
import { classifyActionSafety } from '../domains/jarvis/safeActionPolicy.js';
import { scoreSemanticIntent } from '../domains/jarvis/semanticIntent.js';

describe('routing ledger (PRIORITY 1 — authoritative routing state)', () => {
  beforeEach(() => routingLedger.clear());

  it('records requested vs resolved with fallback semantics', () => {
    routingLedger.record({
      operationId: 'op-1', worker: 'jarvis', routingMode: 'manual',
      requestedProvider: 'ollama', requestedModel: 'qwen2.5-coder',
      resolvedProvider: 'openrouter', resolvedModel: 'laguna',
      fallbackUsed: true, fallbackReason: 'Requested ollama but resolved openrouter',
      startedAt: 1, endedAt: 2,
    });
    const rec = routingLedger.get('op-1');
    expect(rec?.requestedProvider).toBe('ollama');
    expect(rec?.resolvedProvider).toBe('openrouter');
    expect(rec?.fallbackUsed).toBe(true);
  });

  it('latest() returns the newest record and supports worker filtering', () => {
    routingLedger.record({ operationId: 'op-a', worker: 'jarvis', routingMode: 'auto', requestedProvider: 'a', requestedModel: null, resolvedProvider: 'a', resolvedModel: null, fallbackUsed: false, fallbackReason: null, startedAt: 1, endedAt: 1 });
    routingLedger.record({ operationId: 'op-b', worker: 'codex', routingMode: 'auto', requestedProvider: 'b', requestedModel: null, resolvedProvider: 'b', resolvedModel: null, fallbackUsed: false, fallbackReason: null, startedAt: 2, endedAt: 2 });
    expect(routingLedger.latest()[0].operationId).toBe('op-b');
    expect(routingLedger.latest('jarvis')[0].operationId).toBe('op-a');
  });

  it('answers "what model are you using" from metadata, never from model knowledge', () => {
    routingLedger.record({ operationId: 'op-abc123', worker: 'jarvis', routingMode: 'manual', requestedProvider: 'ollama', requestedModel: 'qwen2.5-coder', resolvedProvider: 'ollama', resolvedModel: 'qwen2.5-coder', fallbackUsed: false, fallbackReason: null, startedAt: 1, endedAt: 2 });
    const latest = routingLedger.latest('jarvis')[0];
    expect(latest.operationId).toBe('op-abc123');
    expect(latest.resolvedProvider).toBe('ollama');
  });
});

describe('safe-action policy (PRIORITY 9)', () => {
  it('read-only investigation/health/diagnostic classes are SAFE', () => {
    expect(classifyActionSafety('investigate', 'investigation', 'Check Hermes health.')).toBe('safe');
    expect(classifyActionSafety('investigate', 'investigation', 'Inspect the current runtime state.')).toBe('safe');
    expect(classifyActionSafety('codex', 'repository_analysis', 'Inspect intentRouter.ts without changing anything.')).toBe('safe');
  });

  it('destructive actions always require approval', () => {
    expect(classifyActionSafety('codex', 'repository_change', 'Refactor the auth module')).toBe('destructive');
    expect(classifyActionSafety('investigate', 'investigation', 'Delete the config file and change the provider')).toBe('destructive');
    expect(classifyActionSafety('hermes', 'pipeline_operation', 'Send an email to the prospect')).toBe('destructive');
  });
});

describe('semantic intent scorer (PRIORITY 8)', () => {
  it('scores live-state, bug, delegation, repo, informational categories', () => {
    expect(scoreSemanticIntent('Check Hermes, Ollama, and OpenRouter health.').best).toBe('liveState');
    expect(scoreSemanticIntent("It's still showing the wrong model.").best).toBe('bugReport');
    expect(scoreSemanticIntent('Give this to Hermes.').best).toBe('delegation');
    expect(scoreSemanticIntent('Inspect server/src/domains/jarvis/intentRouter.ts.').best).toBe('repoAnalysis');
    expect(scoreSemanticIntent('What is OpenRouter?').best).toBe('informational');
  });

  it('does not route vague negatives without app signals', () => {
    const s = scoreSemanticIntent('I don\u2019t like this.');
    expect(s.best).toBeNull();
  });
});
