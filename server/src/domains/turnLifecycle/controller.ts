/**
 * turnLifecycle/controller.ts — TurnLifecycleController, the ONE owner of a request.
 *
 *   RECEIVED -> UNDERSTAND -> POLICY -> EXECUTE -> VERIFY -> OUTCOME -> RESPONSE -> TTS -> DONE
 *
 * Every transport (LiveKit voice, typed chat, Telegram, scheduler/routines,
 * certification, self-heal retries) calls submit(). No transport and no
 * handler may respond, speak or record an outcome on its own.
 */
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { conversationService } from '../conversations/service.js';
import { getBuildIdentity } from '../../services/buildIdentity.js';
import * as store from './store.js';
import { definePostcondition, understand } from './understand.js';
import { decidePolicy } from './policy.js';
import { executeLaunchApp, executeOpenUrl, executeTypeText } from './executors.js';
import { takeSnapshot, verify } from './verifier.js';
import { runLegacyHandler } from './legacyHandler.js';
import { decideOutcome, renderResponse } from './respond.js';
import { recoveryContextForRequest, runWithRecoveryContext } from '../selfHeal/recoveryContext.js';
import { runWithTurnOwnership } from '../jarvis/perception/turnOwnership.js';
import type {
  ExecutionReceipt, PreExecutionSnapshot, TurnGoal, TurnRecord, TurnRequest, TurnSink, TurnSource, VerificationResult,
} from './types.js';

export interface TurnSubmission {
  source: TurnSource;
  conversationId: string;
  text: string;
  externalTurnId?: string | number;
  sttConfidence?: number;
  audioRef?: string;
  attached?: TurnRequest['attached'];
  envelope?: unknown;
  /**
   * System-originated work that is already structured (scheduler/routines): the
   * goal is given instead of inferred, and `execute` is the existing worker chain.
   * The lifecycle still owns persistence, policy, verification, outcome and response.
   */
  structured?: {
    summary: string;
    execute: () => Promise<ExecutionReceipt>;
  };
}

export type SubmitResult =
  | { duplicate: false; record: TurnRecord }
  | { duplicate: true; duplicateOf: string; reason: string };

const EXECUTE_TIMEOUT_MS = Number(process.env.AGENTICOS_TURN_EXECUTE_TIMEOUT_MS || 90_000);

export function normalizeRequest(input: TurnSubmission): TurnRequest {
  let buildId = 'unknown';
  try { buildId = getBuildIdentity().buildId || 'unknown'; } catch { /* identity unavailable */ }
  return {
    requestId: `turn-${randomUUID()}`,
    externalTurnId: input.externalTurnId === undefined || input.externalTurnId === null ? undefined : String(input.externalTurnId),
    source: input.source,
    conversationId: input.conversationId,
    text: String(input.text || '').trim(),
    sttConfidence: typeof input.sttConfidence === 'number' ? input.sttConfidence : undefined,
    audioRef: input.audioRef,
    buildId,
    receivedAt: new Date().toISOString(),
    attached: input.attached,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export class TurnLifecycleController {
  /** conversationId -> requestId currently in flight (newest wins). */
  private active = new Map<string, string>();
  private superseded = new Set<string>();

  abortInFlightTurn(conversationId?: string | null): void {
    if (conversationId) {
      const activeReq = this.active.get(conversationId);
      if (activeReq) {
        this.superseded.add(activeReq);
        this.active.delete(conversationId);
      }
    } else {
      for (const req of this.active.values()) {
        this.superseded.add(req);
      }
      this.active.clear();
    }
  }

  async submit(input: TurnSubmission, sink: TurnSink = {}): Promise<SubmitResult> {
    const req = normalizeRequest(input);
    if (!req.text) throw new Error('TurnLifecycleController.submit: empty text');
    store.ensureTurnLifecycleTables();

    const claim = store.claim(req, 'pending');
    if (!claim.claimed) {
      logger.info('[TurnLifecycle] DUPLICATE_REJECTED', { source: req.source, conversationId: req.conversationId, duplicateOf: claim.duplicateOf, reason: claim.reason });
      // Audit trail: the rejected submission is recorded against the turn that owns the utterance.
      store.appendEvent(claim.duplicateOf, 'DUPLICATE_REJECTED', { rejectedRequestId: req.requestId, source: req.source, externalTurnId: req.externalTurnId ?? null, reason: claim.reason, at: req.receivedAt });
      return { duplicate: true, duplicateOf: claim.duplicateOf, reason: claim.reason };
    }

    const prior = this.active.get(req.conversationId);
    if (prior && prior !== req.requestId) {
      this.superseded.add(prior);
      store.markSuperseded(prior, req.requestId);
    }
    this.active.set(req.conversationId, req.requestId);

    const record: TurnRecord = { request: req, contextKey: 'pending', stage: 'RECEIVED' };
    const isStale = () => this.superseded.has(req.requestId);
    logger.info('[TurnLifecycle] RECEIVED', { requestId: req.requestId, source: req.source, conversationId: req.conversationId, buildId: req.buildId });

    // A self-heal retry is RECOVERY WORK: for the whole async extent of this turn (understand ->
    // execute -> verify -> respond) no failure path may open an incident, start a repair run or hand
    // off to a worker. Without this a retry that failed the way the original did was
    // indistinguishable from a new user failure and re-triggered Self-Heal, recursively.
    const recovery = recoveryContextForRequest(req);
    if (recovery) {
      logger.info('[TurnLifecycle] RECOVERY_WORK', { requestId: req.requestId, chainId: recovery.chainId, rootOperationId: recovery.rootOperationId, attempt: recovery.attempt });
    }

    try {
      const executeTurn = () => runWithTurnOwnership(
        {
          conversationId: req.conversationId,
          turnId: Date.now(),
          operationId: req.requestId,
          origin: 'user_turn',
        },
        () => this.run(record, sink, isStale, input.structured),
      );
      if (recovery) {
        await runWithRecoveryContext(recovery, executeTurn);
      } else {
        await executeTurn();
      }
    } catch (err: any) {
      logger.error('[TurnLifecycle] lifecycle error', { requestId: req.requestId, error: err?.message });
      record.error = err?.message || String(err);
      if (!record.outcome) {
        record.outcome = 'FAILED';
        record.outcomeReason = `internal lifecycle error: ${record.error}`;
        try { store.recordOutcome(req.requestId, 'FAILED', record.outcomeReason); } catch { /* already fixed */ }
        record.responseText = `I couldn't complete that because of an internal error: ${record.error}.`;
        store.recordResponse(req.requestId, record.responseText);
        await this.deliver(record, sink, isStale);
      }
      store.recordStage(req.requestId, 'DONE', { error: record.error });
    } finally {
      if (this.active.get(req.conversationId) === req.requestId) this.active.delete(req.conversationId);
      this.superseded.delete(req.requestId);
    }
    return { duplicate: false, record };
  }

  private async run(record: TurnRecord, sink: TurnSink, isStale: () => boolean, structured?: TurnSubmission['structured']): Promise<void> {
    const req = record.request;

    // ── UNDERSTAND ── goal + postcondition, before anything executes.
    const previous = store.previousTurn(req.conversationId, req.requestId);
    const isContinuing = Boolean(previous);

    // Fast local conversational replies (greeting, presence, identity)
    if (!structured) {
      const { detectLocalFastReply } = await import('../jarvis/fastLocalReplies.js');
      const localFast = detectLocalFastReply(req.text, { isContinuing });
      if (localFast) {
        const goal: TurnGoal = {
          kind: 'answer',
          summary: 'Direct conversational greeting or presence response',
          continuesPrevious: isContinuing,
          understoodBy: 'fallback',
        };
        record.contextKey = isContinuing && previous ? previous.contextKey : `ctx-${req.requestId}`;
        store.setContextKey(req.requestId, record.contextKey);
        record.goal = goal;
        record.postcondition = definePostcondition(goal);
        store.recordStage(req.requestId, 'UNDERSTAND', { goal, postcondition: record.postcondition });
        record.policy = { allowed: true, reason: 'conversational greeting or presence is always allowed' };
        store.recordStage(req.requestId, 'POLICY', { policy: record.policy });
        const t = new Date().toISOString();
        const receipt: ExecutionReceipt = {
          executor: 'lifecycle.fast_local_reply',
          attempted: true,
          completedWithoutError: true,
          startedAt: t,
          finishedAt: t,
          handlerText: localFast.reply,
          details: { matched: localFast.matched },
        };
        record.receipt = receipt;
        record.handler = receipt.executor;
        store.recordStage(req.requestId, 'EXECUTE', { receipt, handler: receipt.executor });
        record.verification = {
          verifier: 'TurnLifecycleVerifier',
          satisfied: true,
          observable: true,
          reason: 'answer delivered',
          evidence: [],
          checkedAt: t,
        };
        store.recordStage(req.requestId, 'VERIFY', { verification: record.verification });
        record.outcome = 'VERIFIED';
        record.outcomeReason = 'direct greeting or presence response';
        store.recordOutcome(req.requestId, 'VERIFIED', record.outcomeReason);
        record.responseText = localFast.reply;
        store.recordResponse(req.requestId, record.responseText);
        await this.deliver(record, sink, isStale);
        store.recordDone(req.requestId);
        record.stage = 'DONE';
        return;
      }
    }

    const goal: TurnGoal = structured
      ? { kind: 'action', summary: structured.summary, action: { type: 'other' }, continuesPrevious: false, understoodBy: 'structured_submission' }
      : await understand(req, previous);
    // Context is inherited ONLY when the request explicitly continues the previous one.
    record.contextKey = goal.continuesPrevious && previous ? previous.contextKey : `ctx-${req.requestId}`;
    store.setContextKey(req.requestId, record.contextKey);
    record.goal = goal;
    record.postcondition = definePostcondition(goal);
    store.recordStage(req.requestId, 'UNDERSTAND', { goal, postcondition: record.postcondition });
    sink.progress?.({ type: 'lifecycle_stage', stage: 'UNDERSTAND', requestId: req.requestId, goal: goal.summary });

    // ── POLICY ──
    record.policy = await decidePolicy(req, goal);
    store.recordStage(req.requestId, 'POLICY', { policy: record.policy });

    let receipt: ExecutionReceipt | undefined;
    let verification: VerificationResult | undefined;
    if (record.policy.allowed) {
      // Snapshot immediately before execution (native actions only).
      let snapshot: PreExecutionSnapshot | undefined;
      const pcKind = record.postcondition.kind;
      if (pcKind === 'window_of_app_newly_present_or_foregrounded' || pcKind === 'text_present_in_new_or_target_window'
        || pcKind === 'browser_tab_at_host_after_navigation') {
        try {
          snapshot = await takeSnapshot(record.postcondition);
        } catch (err: any) {
          snapshot = undefined;
          logger.warn('[TurnLifecycle] snapshot failed', { requestId: req.requestId, error: err?.message });
        }
        record.snapshot = snapshot;
        store.recordStage(req.requestId, 'EXECUTE', { snapshot: snapshot ?? { takenAt: new Date().toISOString() } });
      }

      // ── EXECUTE ── receipts only.
      sink.progress?.({ type: 'lifecycle_stage', stage: 'EXECUTE', requestId: req.requestId });
      const exec = structured ? structured.execute() : withTimeout(this.execute(record, goal, snapshot, sink, isStale), EXECUTE_TIMEOUT_MS, 'execution');
      receipt = await exec
        .catch((err: any): ExecutionReceipt => ({
          executor: 'lifecycle', attempted: true, completedWithoutError: false,
          startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
          error: err?.message || String(err), details: {},
        }));
      record.receipt = receipt;
      record.handler = receipt.executor;
      store.recordStage(req.requestId, 'EXECUTE', { receipt, handler: receipt.executor });

      // ── VERIFY ── independent, against the pre-defined postcondition.
      if (receipt.attempted) {
        verification = await verify(record.postcondition, snapshot, receipt).catch((err: any): VerificationResult => ({
          verifier: 'TurnLifecycleVerifier', satisfied: false, observable: false,
          reason: `verifier error: ${err?.message || err}`, evidence: [], checkedAt: new Date().toISOString(),
        }));
      } else {
        verification = {
          verifier: 'TurnLifecycleVerifier', satisfied: false, observable: false,
          reason: 'nothing was attempted', evidence: [], checkedAt: new Date().toISOString(),
        };
      }
      record.verification = verification;
      store.recordStage(req.requestId, 'VERIFY', { verification });
    }

    // ── OUTCOME ── exactly one.
    const { outcome, reason } = decideOutcome(goal, record.policy, receipt, verification);
    record.outcome = outcome;
    record.outcomeReason = reason;
    store.recordOutcome(req.requestId, outcome, reason);
    logger.info('[TurnLifecycle] OUTCOME', { requestId: req.requestId, outcome, reason, handler: record.handler });

    // ── RESPONSE ── rendered from the outcome only.
    record.responseText = renderResponse(goal, outcome, reason, receipt);
    store.recordResponse(req.requestId, record.responseText);

    await this.deliver(record, sink, isStale);
    store.recordDone(req.requestId);
    record.stage = 'DONE';
  }

  private async execute(
    record: TurnRecord, goal: TurnGoal, snapshot: PreExecutionSnapshot | undefined, sink: TurnSink, isStale: () => boolean,
  ): Promise<ExecutionReceipt> {
    if (goal.kind === 'control') {
      const cancelled: string[] = [];
      for (const [conv, reqId] of this.active.entries()) {
        if (conv === record.request.conversationId && reqId !== record.request.requestId) {
          this.superseded.add(reqId);
          store.markSuperseded(reqId, record.request.requestId);
          cancelled.push(reqId);
        }
      }
      sink.progress?.({ type: 'control', action: 'stop', requestId: record.request.requestId });
      const t = new Date().toISOString();
      return { executor: 'lifecycle.control', attempted: true, completedWithoutError: true, startedAt: t, finishedAt: t, details: { cancelled } };
    }
    if (goal.kind === 'action') {
      switch (goal.action?.type) {
        case 'launch_app': return executeLaunchApp(goal);
        case 'type_text': return executeTypeText(goal, snapshot);
        case 'open_url': return executeOpenUrl(goal);
        default: break;
      }
    }
    return runLegacyHandler(record, sink, isStale);
  }

  /** Persist the exchange to the user-facing conversation and speak it (single writer). */
  private async deliver(record: TurnRecord, sink: TurnSink, isStale: () => boolean): Promise<void> {
    const req = record.request;
    const text = record.responseText || '';
    try {
      if (!(await conversationService.getConversation(req.conversationId))) {
        await conversationService.createConversation(`${req.source} conversation`, undefined, 'jarvis', req.conversationId);
      }
      await conversationService.appendMessage({
        conversationId: req.conversationId, role: 'user', content: req.text,
        metadata: { requestId: req.requestId, source: req.source, sttConfidence: req.sttConfidence ?? null, audioRef: req.audioRef ?? null },
      });
      if (text) {
        await conversationService.appendMessage({
          conversationId: req.conversationId, role: 'agent', content: text, routedAgent: 'jarvis',
          metadata: { requestId: req.requestId, outcome: record.outcome, outcomeReason: record.outcomeReason, handler: record.handler ?? null, buildId: req.buildId },
        });
      }
    } catch (err: any) {
      logger.warn('[TurnLifecycle] conversation persistence failed', { requestId: req.requestId, error: err?.message });
    }

    // ── TTS ──
    if (!sink.speak) { store.recordSpoken(req.requestId, false, 'transport has no TTS'); return; }
    if (!text) { store.recordSpoken(req.requestId, false, 'empty response'); return; }
    if (isStale()) { store.recordSpoken(req.requestId, false, 'superseded by a newer request'); return; }
    try {
      await sink.speak(text, record);
      record.spoken = true;
      store.recordSpoken(req.requestId, true);
    } catch (err: any) {
      store.recordSpoken(req.requestId, false, `tts error: ${err?.message || err}`);
    }
  }
}

export const turnLifecycle = new TurnLifecycleController();
