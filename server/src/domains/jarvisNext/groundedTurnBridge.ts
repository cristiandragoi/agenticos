/**
 * groundedTurnBridge.ts — thin adapter from the realtime voice shell to the
 * existing Supervisor V2 grounding/capability stack.
 *
 * It owns NO intelligence. Supervisor V2 (domains/jarvis/supervisorLoop.ts) is
 * SSE-shaped and has no callable core beneath it, so this module supplies a
 * minimal response collector, invokes the real handler, and returns the text it
 * streamed. Entity resolution, capability registry, tools, grounding guardrail
 * and the operational claim gate all run inside the supervisor, unchanged.
 */

import { logger } from '../../utils/logger.js';
import { isProjectStateRequest, buildProjectStateContext } from '../jarvis/projectStateContext.js';

export interface GroundedTurnResult {
  /** True when the supervisor produced a spoken answer. */
  handled: boolean;
  text: string;
  route: string;
  status: string;
  /** An authoritative store returned rows for this prompt. */
  evidence: boolean;
  /** The prompt asked about project/operator/system state. */
  operational: boolean;
  fallbackReason?: string;
  operationId: string;
}

/** Minimal SSE sink implementing just what handleSupervisorV2Stream touches. */
class SseCollector {
  public deltas: string[] = [];
  public done: any = null;
  public intent: any = null;
  public errorEvent: any = null;
  public firstSentence: string | null = null;
  public onFirstSentence?: (sentence: string) => void;
  public writableEnded = false;
  private buffer = '';
  private finishHandlers: Array<() => void> = [];

  write(payload: string): boolean {
    this.buffer += payload;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.consume(frame);
    }
    return true;
  }

  private consume(frame: string) {
    let event = 'message';
    let dataRaw = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataRaw += line.slice(6);
    }
    if (!dataRaw) return;
    let data: any;
    try { data = JSON.parse(dataRaw); } catch { return; }

    if (event === 'chunk' && typeof data.delta === 'string') this.deltas.push(data.delta);
    else if (event === 'first_sentence' && typeof data.sentence === 'string') {
      this.firstSentence = data.sentence;
      this.onFirstSentence?.(data.sentence);
    }
    else if (event === 'done') this.done = data;
    else if (event === 'intent') this.intent = data;
    else if (event === 'error') this.errorEvent = data;
  }

  flush() { /* no-op */ }
  setHeader() { return this; }
  writeHead() { return this; }
  status() { return this; }
  json() { return this; }

  end() {
    if (!this.writableEnded) {
      this.writableEnded = true;
      for (const h of this.finishHandlers) { try { h(); } catch { /* ignore */ } }
    }
    return this;
  }

  once(event: string, handler: () => void) {
    if (event === 'finish') this.finishHandlers.push(handler);
    return this;
  }

  on(event: string, handler: () => void) { return this.once(event, handler); }
  get text(): string { return this.deltas.join(''); }
}

/** Markdown and layout artefacts are meaningless over TTS. */
function toSpeakable(input: string): string {
  return (input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, ', ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const GROUNDING_REFUSAL =
  "I couldn't retrieve the current project state, so I won't guess.";

/**
 * Run one voice turn through Supervisor V2.
 *
 * Contract for callers: when `operational` is true and `handled` is false, the
 * caller MUST speak a grounded refusal — it must NOT fall back to generic chat.
 */
export async function runGroundedVoiceTurn(opts: {
  prompt: string;
  conversationId: string;
  isStale?: () => boolean;
  timeoutMs?: number;
  onFirstSentence?: (sentence: string) => void;
}): Promise<GroundedTurnResult> {
  const { prompt, conversationId, isStale, timeoutMs = 20000, onFirstSentence } = opts;
  const operationId = `voice-${Date.now().toString(36)}`;
  const operational = isProjectStateRequest(prompt);

  // Probe the authoritative stores once so we can report evidence honestly in
  // the VOICE_GROUNDING trace. The supervisor hydrates independently.
  const tStart = Date.now();
  const timings: Record<string, number> = {};
  let evidence = false;
  let evidenceSource = 'none';
  let resolvedEntityId: string | undefined;
  let resolvedEntityType: string | undefined;
  let resolvedEntityName: string | undefined;
  let directAnswer: string | undefined;
  let readIntent: string | undefined;
  try {
    const tProbe = Date.now();
    const probe = await buildProjectStateContext(prompt);
    timings.hydrationMs = Date.now() - tProbe;
    directAnswer = probe.directAnswer;
    readIntent = probe.readIntent;
    evidence = probe.hasEvidence;
    evidenceSource = probe.source;
    resolvedEntityId = probe.entityId;
    resolvedEntityType = probe.entityType;
    resolvedEntityName = probe.entityName;
  } catch { /* evidence stays false */ }

  const base: GroundedTurnResult = {
    handled: false, text: '', route: 'none', status: 'none',
    evidence, operational, operationId,
  };

  const trace = (result: GroundedTurnResult, extra: Record<string, unknown> = {}) => {
    logger.info('[JRT] VOICE_GROUNDING', {
      operationId,
      conversationId,
      prompt,
      operational,
      resolvedEntityId: resolvedEntityId ?? null,
      resolvedEntityType: resolvedEntityType ?? null,
      resolvedEntityName: resolvedEntityName ?? null,
      evidenceSource,
      evidenceReturned: result.evidence ? 'YES' : 'NO',
      route: result.route,
      status: result.status,
      fallbackReason: result.fallbackReason ?? null,
      spokenText: result.text,
      timings: { ...timings, totalMs: Date.now() - tStart },
      ...extra,
    });
    return result;
  };

  // FAST GROUNDED READ — the authoritative provider already produced a complete,
  // exact answer (hydration measured at ~2ms). Sending it through the supervisor
  // added ~8s, introduced model arithmetic drift, and let post-generation gates
  // overwrite correct facts. Reads short-circuit here; reasoning, ambiguity and
  // execution still go through Supervisor V2 below.
  if (directAnswer) {
    return trace(
      { ...base, handled: true, text: directAnswer, route: 'fast_grounded_read', status: 'completed' },
      { readIntent },
    );
  }

  let semanticContext: any;
  try {
    const { resolveSemanticTurn } = await import('../jarvis/semanticTurnResolver.js');
    const tSemantic = Date.now();
    const semantic = await resolveSemanticTurn(prompt, conversationId);
    timings.semanticMs = Date.now() - tSemantic;
    semanticContext = semantic?.semanticContext;

    // The resolver's deterministic response is only a valid FINAL answer for
    // self-contained conversational turns. For anything requiring authoritative
    // system state or execution it returns intent labels and routing
    // acknowledgements ("Explanation request for X", "Yes, I see X…"), which
    // must never be spoken — we continue into Supervisor V2 so the answer is
    // generated from hydrated evidence and tool results instead.
    const direct = semantic?.response?.text;
    // A `intent_classified` decision carries a machine label as its text
    // ("Explanation request for Browser") — an intent descriptor, not an
    // answer. Runtime evidence (2026-09-23, acceptance T2): the label was
    // spoken verbatim. It must fall through to Supervisor V2, never play.
    const isIntentLabel = (semantic as any)?.decision?.type === 'intent_classified'
      || /^(Explanation request|Worker status query|Worker mentioned|.*routing acknowledgement)/i.test(direct || '');
    if (!operational && !isIntentLabel && semantic?.handled && typeof direct === 'string' && direct.trim()) {
      return trace({
        ...base, handled: true, text: toSpeakable(direct),
        route: 'semantic_resolver', status: 'completed',
      }, { semanticDecision: (semantic as any)?.decision?.type ?? null });
    }
    if (operational && semantic?.handled) {
      logger.info('[GroundedTurnBridge] semantic deterministic response suppressed for state request', {
        operationId,
        decision: (semantic as any)?.decision?.type ?? null,
        suppressedText: direct,
      });
    }
  } catch (err: any) {
    logger.warn('[GroundedTurnBridge] semantic resolution failed', err?.message || err);
  }

  if (isStale?.()) {
    return trace({ ...base, fallbackReason: 'stale_turn' });
  }

  const collector = new SseCollector();
  collector.onFirstSentence = onFirstSentence;
  const reqStub: any = { once: () => reqStub, on: () => reqStub, body: {}, headers: {} };

  let timedOut = false;
  const tSupervisor = Date.now();
  try {
    const { handleSupervisorV2Stream } = await import('../jarvis/supervisorLoop.js');
    const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');

    let workspacePath: string | undefined;
    try { workspacePath = getWorkspaceRoot(); } catch { workspacePath = undefined; }

    await Promise.race([
      handleSupervisorV2Stream(reqStub, collector as any, {
        conversationId,
        prompt,
        workspacePath,
        approvalPolicy: 'manual',
        operationId,
        inputChannel: 'voice',
        semanticContext,
        requiresAuthoritativeState: operational,
        onFirstSentence,
      }),
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, timeoutMs)),
    ]);
  } catch (err: any) {
    timings.supervisorMs = Date.now() - tSupervisor;
    logger.warn('[GroundedTurnBridge] supervisor turn failed', err?.message || err);
    return trace({ ...base, fallbackReason: `supervisor_error: ${err?.message || err}` });
  }
  timings.supervisorMs = Date.now() - tSupervisor;

  const spoken = toSpeakable(collector.text);
  const route = collector.done?.route || collector.intent?.route || (timedOut ? 'timeout' : 'supervisor_v2');
  const status = collector.done?.status || (timedOut ? 'timeout' : 'unknown');

  if (timedOut && !spoken) {
    return trace({ ...base, route, status, fallbackReason: 'supervisor_timeout' });
  }
  if (collector.errorEvent && !spoken) {
    return trace({ ...base, route, status, fallbackReason: `supervisor_error_event: ${collector.errorEvent?.error}` });
  }
  if (!spoken) {
    return trace({ ...base, route, status, fallbackReason: 'empty_supervisor_response' });
  }

  return trace({ ...base, handled: true, text: spoken, route, status });
}
