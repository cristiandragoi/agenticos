/**
 * Live execution state (PRIORITY 4/5/6) — the single feed for the Execution
 * Bar. Fed by JarvisChat (stream status) and JarvisStudio (active background
 * task progress). The STOP action is a registered callback so cancel
 * propagates to the right owner (stream abort / task cancel API).
 */
export interface ExecutionState {
  active: boolean;
  agent: string | null;
  provider: string | null;
  model: string | null;
  currentAction: string | null;
  stage: string | null;
  operationId: string | null;
  taskId: string | null;
  state: string | null;
  startedAt: number;
  lastActivityAt: number;
}

let state: ExecutionState = {
  active: false, agent: null, provider: null, model: null, currentAction: null,
  stage: null, operationId: null, taskId: null, state: null, startedAt: 0, lastActivityAt: 0,
};
const listeners = new Set<() => void>();
let stopHandler: (() => void) | null = null;

function publish(partial: Partial<ExecutionState>) {
  state = { ...state, ...partial, lastActivityAt: Date.now() };
  for (const fn of listeners) fn();
}

export const executionStore = {
  get(): ExecutionState { return state; },
  /** Activate from a stream/task status update. */
  setActive(partial: Partial<ExecutionState>): void {
    publish({ active: true, ...partial, startedAt: partial.startedAt || state.startedAt || Date.now() });
  },
  setIdle(): void {
    publish({ active: false, agent: null, provider: null, model: null, currentAction: null, stage: null, operationId: null, taskId: null, state: 'idle' });
  },
  registerStop(handler: (() => void) | null): void { stopHandler = handler; },
  stop(): boolean {
    if (!stopHandler) return false;
    stopHandler();
    return true;
  },
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
