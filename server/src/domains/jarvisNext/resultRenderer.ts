/**
 * resultRenderer.ts — Canonical conversational expression layer for Jarvis.
 *
 * STRUCTURED EXECUTION RESULT  →  GUARDED NATURAL EXPRESSION  →  USER
 *
 * The structured result stays the single source of truth. This layer may change
 * wording, pronouns, sentence order and concision ONLY. It must never change:
 * whether an action happened, counts, blocker content, verification status,
 * target, or success/failure.
 *
 * Fidelity is enforced by reusing the V2 expression layer's own generic
 * validator (`validateNaturalResponse`, domains/jarvisV2/naturalRenderer.ts) —
 * imported dynamically so the canonical path takes on none of V2's state or LLM
 * module graph. If validation fails we fall back to the mechanical skeleton.
 *
 * Internal terminology (`verified=false`, `entityId`, `route`, `action_status`,
 * `confidence=`, `not revalidated in this turn`) is never user-facing.
 */

export interface OperationalResultFacts {
  kind: 'project_operate' | 'navigate' | 'read' | 'browser_search' | 'clarify';
  entityName?: string;
  /**
   * §Prerequisites: WHICH kind of work actually started. This is the fact that
   * used to be missing: an internal planning mission and a held authentication
   * prerequisite were both spoken as if they were running work.
   *
   *   waiting_for_auth   — nothing started; an external session is required.
   *   internal_planning  — internal planning only (NOT external execution).
   *   external_execution — real work against the live external account.
   *   none               — nothing started.
   */
  workMode?: 'waiting_for_auth' | 'internal_planning' | 'external_execution' | 'none';
  /** Safe-for-speech description of the missing external prerequisite. */
  authBlocker?: string;
  /** The user-facing action that clears the prerequisite. */
  authNextStep?: string;
  /** The user's ORIGINAL goal, preserved verbatim (never re-asked). */
  originalGoal?: string;
  /** True when this operate was the automatic resume after authentication. */
  resumedFromAuth?: boolean;
  /** Items held at the authentication step — registered, never running. */
  waitingForAuthTasks?: number;
  /** Evidence artifact produced by real external execution. */
  externalEvidencePath?: string;
  /** Project work counters, straight from ProjectController's verified state. */
  runningTasks?: number;
  queuedTasks?: number;
  blockedTasks?: number;
  /** Blocker content exactly as stored (never paraphrased into a new fact). */
  blocker?: string;
  /** ISO timestamp of the blocked-task record the blocker came from. */
  blockerRecordedAt?: string;
  /** True only when this turn revalidated the blocker against live state. */
  blockerRevalidated?: boolean;
  /** Browser search target. */
  target?: string;
  /**
   * PHASE F: the worker the work was actually assigned to (from the task record)
   * and the task title. Absent means NO assignment was recorded — the expression
   * layer must then never claim one.
   */
  worker?: string;
  taskTitle?: string;
  success?: boolean;
  verified?: boolean;
  /** Executor failure detail; may carry internal phrasing, which is stripped. */
  failureDetail?: string;
  /** Already-natural deterministic facts (e.g. ProjectStateContext directAnswer). */
  facts?: string;
}

const INTERNAL_TOKENS = [
  'not revalidated in this turn',
  'verified=false',
  'verified = false',
  'verified:false',
  'entityid',
  'action_status',
  'actionName',
  'confidence=',
  'no_verified_project_data',
  'no_ui_route',
  'navigation_not_verified',
  'unverified_internal_action',
  'undefined',
];

/** Strip internal terminology and machine artefacts from any inherited text. */
export function stripInternalTerminology(text: string): string {
  let out = (text || '').trim();
  // Drop trailing machine metadata parentheses, e.g. "(recorded 2026-09-11, 6 days old, not revalidated in this turn)".
  out = out.replace(/\s*\(recorded[^)]*\)\s*[.!]?\s*$/i, '');
  for (const token of INTERNAL_TOKENS) {
    out = out.split(token).join('');
  }
  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  return out;
}

/**
 * The expression layer must never speak an internal identifier. Entity ids are
 * lower-case separator-joined tokens ("proj-free-cash"); a spoken name has
 * capitals or spaces. When only an id is available, use a human stand-in.
 */
export function humaniseEntityName(name: string | undefined, fallback = 'that project'): string {
  const cleaned = stripInternalTerminology(name || '');
  if (!cleaned) return fallback;
  const looksLikeId =
    /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(cleaned) ||
    /^(?:proj|ent|conv|task|op|usr|blk|wrk)[-_][a-z0-9-]+$/i.test(cleaned);
  return looksLikeId ? fallback : cleaned;
}

/** "2026-09-11" → "September 11" (fact-preserving: same date, spoken form). */
export function spokenDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

/** Human display name for a worker kind (never an internal lane id). */
export function workerLabel(worker?: string): string {
  switch ((worker || '').toLowerCase()) {
    case 'codex': return 'Codex';
    case 'hermes': return 'Hermes';
    case 'revenue': return 'the Revenue Operator';
    case 'research': return 'the research worker';
    case 'team': return 'the team worker';
    case 'automation': return 'the automation worker';
    case 'antigravity': return 'the Antigravity builder';
    case 'magnitude': return 'the Magnitude worker';
    case 'self-heal': return 'the self-heal worker';
    default: return '';
  }
}

function countPhrase(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** Last path segment — a speakable, still-verifiable evidence handle. */
function evidenceLabel(p?: string): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * Work-mode sentences, shared VERBATIM by the mechanical skeleton and the
 * natural rendering. They encode the one fact that must never be lost in
 * rewriting: whether anything actually started, and whether what is running is
 * internal planning or real external execution.
 *
 * Only called for the three explicit work modes; the default 'none' path keeps
 * the pre-existing generic project_operate text.
 */
function workModeParts(
  f: OperationalResultFacts,
  name: string,
  mode: 'waiting_for_auth' | 'internal_planning' | 'external_execution',
  natural: boolean,
): string[] {
  const parts: string[] = [];
  if (mode === 'waiting_for_auth') {
    parts.push(natural
      ? `I haven't started anything on ${name}.`
      : `Nothing has started on ${name}.`);
    const blocker = stripInternalTerminology(f.authBlocker || '');
    if (blocker) parts.push(blocker);
    const next = stripInternalTerminology(f.authNextStep || '');
    if (next) parts.push(next);
    parts.push(natural
      ? "I've kept your original goal, so you won't have to repeat it."
      : 'The original goal is stored and resumes automatically.');
    const held = f.waitingForAuthTasks ?? 0;
    if (held > 0) {
      parts.push(countPhrase(held,
        natural ? '1 item is registered and waiting at the sign-in step — it is not running.' : '1 item is registered at the sign-in step and is not running.',
        natural ? `${held} items are registered and waiting at the sign-in step — they are not running.` : `${held} items are registered at the sign-in step and are not running.`));
    }
    return parts;
  }

  // A worker WAS assigned: the mode note keeps internal planning and external
  // execution from masquerading as each other.
  if (mode === 'internal_planning') {
    parts.push('That is internal planning, not external execution against the account.');
  } else {
    parts.push('A live session is verified, so that is real execution against the account.');
    const ev = evidenceLabel(f.externalEvidencePath);
    if (ev) parts.push(`The evidence artifact is ${ev}.`);
  }
  return parts;
}

/**
 * Mechanical skeleton: the plainest factual rendering. Used as the validation
 * baseline AND as the fallback when natural phrasing cannot be verified.
 */
export function buildSkeleton(f: OperationalResultFacts): string {
  const name = humaniseEntityName(f.entityName, 'the target');
  const parts: string[] = [];

  if (f.kind === 'project_operate') {
    // PREREQUISITE HELD is checked FIRST: "I could not start work" would hide
    // the reason, and the reason is the whole answer.
    if (f.workMode === 'waiting_for_auth') {
      parts.push(...workModeParts(f, name, 'waiting_for_auth', false));
    } else if (f.success === false) {
      parts.push(`I could not start work on ${name}.`);
    } else {
      // CLAIM GATE (Phase F §10): an assignment may only be spoken when a task
      // record with a worker exists. Otherwise stay with the neutral phrasing.
      const label = workerLabel(f.worker);
      if (label) {
        parts.push(`Started: I have assigned ${f.taskTitle ? `${f.taskTitle} ` : 'the next task '}to ${label}.`);
      } else {
        parts.push(`Started: I have started work on ${name}.`);
      }
      const mode = f.workMode === 'internal_planning' || f.workMode === 'external_execution' ? f.workMode : null;
      if (mode) parts.push(...workModeParts(f, name, mode, false));
      const running = f.runningTasks ?? 0;
      if (running > 0) parts.push(countPhrase(running, '1 task is running now.', 'tasks are running now.'));
      const queued = f.queuedTasks ?? 0;
      if (queued > 0) parts.push(countPhrase(queued, '1 task is queued and has not started yet.', 'tasks are queued and have not started yet.'));
      const blocked = f.blockedTasks ?? 0;
      if (blocked > 0) parts.push(countPhrase(blocked, '1 item is blocked.', 'items are blocked.'));
    }
  } else if (f.kind === 'navigate') {
    parts.push(f.verified
      ? `${name} is open.`
      : `${name} is now the active context, but the interface did not navigate successfully.`);
  } else if (f.kind === 'browser_search') {
    parts.push(f.verified && f.target
      ? `I have opened ${name} and searched for ${f.target}.`
      : `I could not complete the search on ${name}.`);
  } else {
    parts.push(stripInternalTerminology(f.facts || f.failureDetail || ''));
  }

  const blocker = stripInternalTerminology(f.blocker || '');
  // Stale blocker policy: an unrevalidated blocker is NOT current-state speech.
  // Runtime evidence (2026-09-23, playout #19): the spoken answer carried a
  // days-old "Hermes service is offline" blocker the user never asked about —
  // experienced as an irrelevant old-blocker dump. The count stays (it is
  // revalidated), the stale detail does not. GUI records keep the full text.
  if (blocker && (f.blockedTasks ?? 0) > 0 && f.blockerRevalidated) {
    parts.push(`The current blocker is ${blocker}.`);
  }

  return parts.filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Guarded natural phrasing. Facts are identical to the skeleton. */
export function buildNatural(f: OperationalResultFacts): string {
  const name = humaniseEntityName(f.entityName, 'the target');

  // PREREQUISITE HELD: the FIRST fact is that nothing started — checked before
  // the success guard, because a held prerequisite never reaches "started".
  if (f.kind === 'project_operate' && f.workMode === 'waiting_for_auth') {
    const blocked = f.blockedTasks ?? 0;
    const held = workModeParts(f, name, 'waiting_for_auth', true);
    const tail: string[] = [];
    if (blocked > 0) tail.push(blocked === 1 ? 'One item is still blocked.' : `${blocked} items are still blocked.`);
    const blocker = stripInternalTerminology(f.blocker || '');
    if (blocker && blocked > 0 && f.blockerRevalidated) {
      tail.push(`The current blocker is ${blocker}.`);
    }
    return [...held, ...tail].filter(Boolean).join(' ');
  }

  if (f.kind === 'project_operate' && f.success !== false) {
    const running = f.runningTasks ?? 0;
    const blocked = f.blockedTasks ?? 0;
    const queued = f.queuedTasks ?? 0;
    const label = workerLabel(f.worker);
    const sentences = [
      label
        ? `Started: I've assigned ${f.taskTitle ? `${f.taskTitle} ` : 'the next task '}to ${label}.`
        : `Started working on ${name}.`,
    ];
    const mode = f.workMode === 'internal_planning' || f.workMode === 'external_execution' ? f.workMode : null;
    if (mode) sentences.push(...workModeParts(f, name, mode, true));
    if (running === 1) sentences.push('One task is running now.');
    else if (running > 1) sentences.push(`${running} tasks are running now.`);
    // Counts are facts: they must survive the rewrite for validation to pass.
    if (queued > 0) sentences.push(queued === 1 ? 'One task is queued and has not started yet.' : `${queued} tasks are queued and have not started yet.`);
    if (blocked > 0) sentences.push(blocked === 1 ? 'One item is still blocked.' : `${blocked} items are still blocked.`);
    const blocker = stripInternalTerminology(f.blocker || '');
    // Runtime evidence (2026-09-23, playout #19, buildNatural path): an
    // unrevalidated September-20 blocker was narrated into a fresh answer the
    // user never asked about. Stale blocker detail stays in the GUI record.
    if (blocker && blocked > 0 && f.blockerRevalidated) {
      sentences.push(`The current blocker is ${blocker}.`);
    }
    return sentences.join(' ');
  }

  if (f.kind === 'navigate' && f.verified) return `${name} is open.`;
  if (f.kind === 'browser_search' && f.verified && f.target) return `I've opened ${name} and searched for ${f.target}.`;

  // Failure / partial paths keep the honest detail, just phrased naturally.
  if (f.kind === 'navigate' && !f.verified) {
    return `${name} is now the active context, but the interface did not navigate successfully.`;
  }
  if (f.kind === 'browser_search' && !f.verified) {
    return `I couldn't finish the search on ${name}.`;
  }
  return buildSkeleton(f);
}

/**
 * Render a structured execution result for speech. Validated against the
 * mechanical skeleton; falls back to the skeleton whenever fidelity cannot be
 * proven. Never async-throws: rendering failure must never break a turn.
 */
export async function renderOperationalResult(f: OperationalResultFacts): Promise<string> {
  const skeleton = buildSkeleton(f);
  const natural = buildNatural(f);
  if (!skeleton.trim()) return natural;

  try {
    const { validateNaturalResponse } = await import('../jarvisV2/naturalRenderer.js');
    if (validateNaturalResponse(natural, skeleton)) return natural;
  } catch {
    // Validator unavailable: only accept natural phrasing when it is the
    // skeleton plus style (same facts, same numbers).
    return skeleton;
  }
  return skeleton;
}
