/**
 * selfHeal/recoveryContext.ts — ambient "this work is a recovery of an earlier failure".
 *
 * WHY THIS EXISTS (recursive SELFHEAL redispatch)
 * A self-heal retry is a brand-new lifecycle request. Nothing marked it as the
 * retry of an earlier failure, so when the retry failed in the same way the
 * failure path could not tell it from a fresh user failure: it raised a NEW
 * incident, which handed off to a worker again, which retried again, forever.
 *
 * The identity of a recovery is therefore carried in an AsyncLocalStorage frame
 * (like turnOwnership.ts) for the whole async extent of the retried work, and it
 * is also written into `TurnRequest.attached` so it survives process boundaries
 * that ALS cannot cross (background tasks, restarts).
 *
 * Rule enforced by recoveryChain.ts: work running inside this frame may RECORD a
 * failure against its chain, but may never open an incident, start a repair run or
 * hand off to an engineering worker of its own accord.
 *
 * This file is dependency-free on purpose (no DB, no logger) so the turn lifecycle
 * can import it without creating a cycle.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type RecoveryOrigin = 'self_heal_retry' | 'engineering_repair' | 'recovery_task';

export interface RecoveryContext {
  /** Registry chain this work belongs to (or an `orphan-retry:` id when none was supplied). */
  chainId: string;
  /** The ORIGINAL user operation this recovery is trying to fix. */
  rootOperationId: string;
  incidentId?: string;
  /** 1-based retry attempt inside the chain. */
  attempt: number;
  origin: RecoveryOrigin;
}

const storage = new AsyncLocalStorage<RecoveryContext>();

/** Run `fn` as recovery work: every nested failure path can see it and must not escalate. */
export function runWithRecoveryContext<T>(ctx: RecoveryContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentRecoveryContext(): RecoveryContext | undefined {
  return storage.getStore();
}

export function isRecoveryWork(): boolean {
  return storage.getStore() !== undefined;
}

/** Subset of a lifecycle request needed to decide whether it is recovery work. */
export interface RecoveryRequestShape {
  requestId: string;
  source: string;
  attached?: {
    retryOfRequestId?: string;
    goalId?: string;
    incidentId?: string;
    recoveryChainId?: string;
    rootOperationId?: string;
    retryAttempt?: number;
  };
}

/**
 * A request is recovery work when its SOURCE is a self-heal retry, or when it
 * carries a recovery chain id. This is decided from request identity, never from
 * the request text. Fail-closed: a self-heal retry that arrives with no chain id
 * still runs in a recovery frame (as an orphan) so it cannot escalate.
 */
export function recoveryContextForRequest(req: RecoveryRequestShape): RecoveryContext | undefined {
  const a = req.attached;
  if (req.source !== 'self_heal_retry' && !a?.recoveryChainId) return undefined;
  return {
    chainId: a?.recoveryChainId || `orphan-retry:${req.requestId}`,
    rootOperationId: a?.rootOperationId || a?.retryOfRequestId || req.requestId,
    incidentId: a?.incidentId,
    attempt: typeof a?.retryAttempt === 'number' && a.retryAttempt > 0 ? a.retryAttempt : 1,
    origin: 'self_heal_retry',
  };
}
