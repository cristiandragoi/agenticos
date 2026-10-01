/**
 * turnOwnership.ts — ambient turn identity for executors.
 *
 * WHY THIS EXISTS (P0 production enforcement gap)
 * `guardExternalSideEffect()` is only useful if the code that actually spawns a
 * process, launches an application, drives the browser or types into a window
 * can see WHICH turn it is working for. Most executors do not receive turn
 * identity in their signatures: `desktopExecutor.openApplication(appInput)` and
 * `terminalExecutor.runCommand({ command, cwd })` have no conversation or turn at
 * all, and they are called from several places with different context shapes.
 *
 * Threading turn identity through every executor signature would touch dozens of
 * call sites and still leave the unprotected ones. Instead the dispatcher
 * establishes ONE frame for the duration of a turn's async work, and the
 * executors read it at the OS boundary. AsyncLocalStorage keeps frames isolated
 * per async chain, so two concurrent conversations can never borrow each other's
 * identity.
 *
 * Fail-safe direction: the frame is only ever used to REFUSE work. No identity
 * means "cannot prove staleness", which is reported as `registered: false` and
 * allowed — see guardExternalSideEffect for that decision.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  beginBackgroundOperation,
  guardExternalSideEffect,
  guardResultPublication,
  type OperationOrigin,
  type SideEffectGate,
  type SideEffectPolicy,
} from './perceptionOperation.js';

export interface TurnOwnershipFrame {
  conversationId: string;
  turnId: number | string;
  operationId?: string;
  originTurnId?: number | string;
  capability?: string;
  /** Defaults to 'user_turn' — the only origin with desktop rights by default. */
  origin?: OperationOrigin;
  /** Required for background origins; user turns default to USER_TURN_POLICY. */
  policy?: SideEffectPolicy;
}

const storage = new AsyncLocalStorage<TurnOwnershipFrame>();

/** Run `fn` with this turn's identity visible to every nested executor call. */
export function runWithTurnOwnership<T>(frame: TurnOwnershipFrame, fn: () => Promise<T>): Promise<T> {
  return storage.run(frame, fn);
}

export function currentTurnOwnership(): TurnOwnershipFrame | undefined {
  return storage.getStore();
}

/**
 * Run `fn` as an explicitly authorized BACKGROUND operation.
 *
 * This is the only sanctioned way for non-user work to obtain the right to act:
 * the caller must name a background origin and an explicit policy, and the
 * operation is registered for audit with operationId / origin / capability /
 * timestamp / policy. Background work defaults to no desktop control.
 */
export function runWithBackgroundOwnership<T>(
  input: {
    origin: Exclude<OperationOrigin, 'user_turn'>;
    capability: string;
    policy: SideEffectPolicy;
    conversationId?: string;
    source?: string;
  },
  fn: (operationId: string) => Promise<T>,
): Promise<T> {
  const operation = beginBackgroundOperation({
    origin: input.origin,
    capability: input.capability,
    policy: input.policy,
    conversationId: input.conversationId,
    source: input.source,
  });
  const frame: TurnOwnershipFrame = {
    conversationId: operation.conversationId,
    turnId: operation.turnId,
    operationId: operation.operationId,
    originTurnId: operation.originTurnId,
    capability: input.capability,
    origin: input.origin,
    policy: input.policy,
  };
  return storage.run(frame, () => fn(operation.operationId));
}

/**
 * Called at the top of a side-effecting executor method. Returns false and logs
 * a structured rejection when the work belongs to a cancelled or superseded
 * turn; the caller must then return WITHOUT performing the side effect.
 */
export function assertSideEffectOwnership(
  capability: string,
  description: string,
): SideEffectGate & { capability: string; description: string } {
  const frame = storage.getStore();
  const gate = guardExternalSideEffect({
    conversationId: frame?.conversationId,
    turnId: frame?.turnId,
    capability,
    operationId: frame?.operationId,
    origin: frame?.origin,
    policy: frame?.policy,
  });
  return { ...gate, capability, description };
}

/**
 * Called immediately before publishing a result (speech, perception-focus
 * mutation, terminal output) when async work happened after dispatch.
 */
export function assertPublicationOwnership(
  capability: string,
  description: string,
): SideEffectGate & { capability: string; description: string } {
  const frame = storage.getStore();
  const gate = guardResultPublication({
    conversationId: frame?.conversationId,
    turnId: frame?.turnId,
    capability,
    operationId: frame?.operationId,
    origin: frame?.origin,
    policy: frame?.policy,
  });
  return { ...gate, capability, description };
}

/** Exposed for tests and diagnostics. */
export function __resetTurnOwnershipForTests(): void {
  // AsyncLocalStorage has no reset; frames are per-async-chain and simply expire.
}
