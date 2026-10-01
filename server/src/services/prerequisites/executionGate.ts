/**
 * executionGate.ts — ONE gate that decides whether work for an external
 * service may start (PHASE C/D/E seam).
 *
 * Why this module exists: `projectController` used to create and dispatch a
 * "Revenue Operator: Free Cash Mission" unconditionally, and the adapter
 * immediately marked that task RUNNING — so Jarvis spoke "it is running now"
 * while no external FreeCash action had happened, and in fact none COULD happen
 * because the account had no authenticated browser session. Creating an
 * internal task is not evidence of external execution.
 *
 * The gate composes the two canonical pieces that already exist:
 *   - `prerequisiteService.checkPrerequisites`  → live external evidence only
 *   - `activeGoalRegistry`                      → the durable original goal
 *
 * Contract:
 *   allowed === true   → LIVE evidence proves the prerequisite is satisfied.
 *   allowed === false  → the ORIGINAL goal is persisted as
 *                        `blocked_waiting_for_auth` and NOTHING is dispatched.
 *
 * It deliberately does NOT import the FreeCash executor: the executor imports
 * this module's siblings and drives the live probe. Keeping the dependency
 * one-way means the gate can be used from the controller and the worker
 * adapters without a cycle.
 */
import {
  checkPrerequisites,
  describeService,
  type PrerequisiteState,
} from './prerequisiteService.js';
import {
  getOpenGoalForService,
  markBlockedWaitingForAuth,
  markResumePending,
  type ActiveGoalRecord,
} from './activeGoalRegistry.js';

export interface ExecutionGateInput {
  /** Service key as declared in prerequisiteService.SERVICE_DEFINITIONS. */
  service: string;
  /** The user's ORIGINAL goal, in their own terms — never a rewritten one. */
  originalGoal: string;
  projectId?: string | null;
  conversationId?: string | null;
  /** What happens automatically once authentication succeeds. */
  nextStep?: string;
}

export interface ExecutionGateResult {
  service: string;
  serviceLabel: string;
  /** True only when live external evidence satisfied the prerequisite. */
  allowed: boolean;
  /** True when the work is registered but deliberately NOT started. */
  waitingForAuth: boolean;
  /** Safe-for-speech blocker text (never contains credentials). */
  blocker: string | null;
  /** The action that clears the blocker, in user terms. */
  nextStep: string;
  state: PrerequisiteState;
  /** The durable goal row backing this decision. */
  goal: ActiveGoalRecord | null;
}

const DEFAULT_NEXT_STEP =
  'Sign in to the account in the managed browser window; the original goal resumes automatically once the session is detected.';

function blockerText(state: PrerequisiteState): string {
  const label = describeService(state.service);
  if (state.blocker) return state.blocker;
  return `${label} needs an authenticated session before any work can start. No live session verification exists yet.`;
}

/**
 * Evaluate the gate for a service and persist the outcome as a durable goal.
 *
 * Side effects (both intentional and both about the GOAL, not about work):
 *   - blocked path  → the original goal is stored as `blocked_waiting_for_auth`
 *   - allowed path  → any goal previously blocked on this service is flagged
 *                     `resume_pending`, so the resume pump can pick up the
 *                     ORIGINAL goal instead of asking the user again.
 */
export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateResult {
  const state = checkPrerequisites(input.service);
  const label = describeService(input.service);
  const nextStep = input.nextStep || DEFAULT_NEXT_STEP;

  if (state.satisfied) {
    // Live evidence exists. Only arm a resume when the goal was actually
    // blocked — a healthy session must not create a spurious resume.
    const open = getOpenGoalForService(input.service);
    let goal = open;
    if (open && open.status === 'blocked_waiting_for_auth') {
      goal = markResumePending(input.service) || open;
    }
    return {
      service: input.service,
      serviceLabel: label,
      allowed: true,
      waitingForAuth: false,
      blocker: null,
      nextStep,
      state,
      goal,
    };
  }

  const blocker = blockerText(state);
  const goal = markBlockedWaitingForAuth({
    originalGoal: input.originalGoal,
    projectId: input.projectId ?? null,
    service: input.service,
    conversationId: input.conversationId ?? null,
    blocker,
    nextStep,
  });

  return {
    service: input.service,
    serviceLabel: label,
    allowed: false,
    waitingForAuth: true,
    blocker,
    nextStep,
    state,
    goal,
  };
}

/** Convenience wrapper for the FreeCash service key. */
export function isFreeCashServiceKey(service: string): boolean {
  return service === 'freecash';
}
