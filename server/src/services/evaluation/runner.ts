/**
 * evaluation/runner.ts — executes evaluation cases against gateway providers
 * (C3/C4/C5/C6/C9). Provider-agnostic: uses the same ModelGateway contract as
 * production routing, so adding OpenAI/Claude/Ollama/Qwen later requires zero
 * runner changes.
 */
import type { ChatRequest } from '../gateway/types.js';
import type { ModelGateway } from '../gateway/types.js';
import type { EvalCase, EvalRunResult } from './types.js';
import { runAssertions, extractJson, isValidJson } from './verifier.js';

export interface EvalRunnerOptions {
  /** ms to wait for the first token / full completion. */
  timeoutMs?: number;
  /** Abort the whole run. */
  signal?: AbortSignal;
  /** Set to true to skip gateway registry and use a raw gateway directly. */
  directGateway?: ModelGateway;
  /** Report first-token latency (uses stream when available). */
  measureFirstToken?: boolean;
}

/**
 * Run one case through one provider gateway.
 * Latency uses provider/request timestamps (Date.now around the call), NOT
 * UI animation timestamps (C5).
 */
export async function runEvalCase(
  caseDef: EvalCase,
  provider: ModelGateway,
  opts: EvalRunnerOptions = {},
): Promise<EvalRunResult> {
  const startedAt = new Date().toISOString();
  const timeoutMs = opts.timeoutMs || caseDef.timeoutMs || 30000;
  const started = Date.now();
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let output = '';
  let firstTokenMs = 0;
  let toolCallCount = 0;
  let toolErrors = 0;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;
  let error: string | undefined;
  let outcome: EvalRunResult['outcome'] = 'PASS';

  const systemPrompt =
    (caseDef.context ? `CONTEXT:\n${caseDef.context}\n\n` : '') +
    (caseDef.longContext ? `PROVIDED CONTEXT:\n${caseDef.longContext}\n\n` : '') +
    (caseDef.systemPrompt || '');

  const request: ChatRequest = {
    systemPrompt: systemPrompt || undefined,
    prompt: caseDef.prompt,
    maxTokens: caseDef.maxTokens || 512,
    timeoutMs,
    signal: controller.signal,
    requiredCapabilities: caseDef.category === 'structured_json' ? ['json'] : undefined,
  };

  try {
    const firstTokenSeen = false;
    if (opts.measureFirstToken && provider.stream) {
      // Streaming path: capture first-token latency, then full stream.
      for await (const chunk of provider.stream(request)) {
        if (chunk.type === 'token' && chunk.content) {
          if (firstTokenMs === 0) firstTokenMs = Date.now() - started;
          output += chunk.content;
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error || 'stream error');
        }
      }
    } else {
      const resp = await provider.chat(request);
      output = resp.reply || '';
      promptTokens = resp.promptTokens;
      completionTokens = resp.completionTokens;
      totalTokens = resp.totalTokens;
      firstTokenMs = (resp as any).latencyMs ?? 0;
    }

    if (controller.signal.aborted && !output) {
      outcome = 'TIMEOUT';
      error = `Timed out after ${timeoutMs}ms`;
    } else if (!output || output.trim().length === 0) {
      outcome = 'ERROR';
      error = 'Empty response';
    } else {
      const results = runAssertions(output, caseDef.assertions);
      const allPass = results.every((r) => r.passed);
      outcome = allPass ? 'PASS' : 'NEEDS_REVISION';
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        error = `Assertions failed: ${failed.map((f) => f.description).join('; ')}`;
      }
      // Structured JSON validity is its own signal.
      if (caseDef.jsonSchema && !isValidJson(output)) {
        outcome = outcome === 'PASS' ? 'NEEDS_REVISION' : outcome;
      }
    }
  } catch (err: any) {
    const aborted = controller.signal.aborted || /abort|cancel/i.test(String(err?.message || ''));
    outcome = aborted ? 'CANCELLED' : 'ERROR';
    error = String(err?.message || err).slice(0, 500);
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }

  const latencyMs = Date.now() - started;
  // Recompute token counts from a streamed response if the gateway did not
  // report them (best-effort estimate).
  if (totalTokens === undefined && output) {
    totalTokens = Math.max(1, Math.round(output.length / 4));
  }

  return {
    caseId: caseDef.id,
    provider: provider.name,
    model: provider.definition.model,
    outcome,
    output: output.slice(0, 4000),
    assertions: runAssertions(output, caseDef.assertions),
    latencyMs,
    firstTokenMs,
    totalTokens,
    promptTokens,
    completionTokens,
    toolCallCount,
    toolErrors,
    structuredOutputValid: caseDef.jsonSchema ? isValidJson(output) : false,
    error,
    verifier: 'deterministic_assertions',
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
