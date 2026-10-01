/**
 * perceptionIntent.ts — ONE authoritative early perception decision layer.
 *
 * WHY THIS EXISTS (P0 audit DEFECT-1 / DEFECT-3 / DEFECT-4 / DEFECT-7)
 * Screen reads, camera reads, follow-ups and runtime diagnostics were decided in
 * six different places (turnRouter foreground block, ControlPlaneTurnHandler,
 * canonicalTurnExecutionService camera + desktop, buildProjectStateContext via
 * OPERATIONAL_TERMS, detectSystemIntrospection). Which one won depended on the
 * phrasing, so "What do you see?" could be answered with an AgenticOS runtime
 * dump and "Can you read the text?" had no referent at all.
 *
 * This module makes ONE decision, in a fixed order, and returns an explicit
 * terminal claim:
 *
 *   1. stop / cancel
 *   2. active perception continuation   (uses perceptionFocus)
 *   3. explicit new camera perception
 *   4. explicit new foreground-screen perception
 *   (7. runtime diagnostics — only when the turn explicitly asks for them)
 *
 * The decision is token/shape based, not a phrase list: no application names, no
 * per-capability utterance tables.
 */

import {
  detectForegroundScreenIntent,
  type ForegroundScreenIntent,
} from '../execution/foregroundScreenIntent.js';
import type { PerceptionFocus, PerceptionTarget } from './perceptionFocus.js';

/* ── vocabulary ─────────────────────────────────────────────────────────── */

/** The surface the user is looking at (a screen read, not a camera read). */
const SURFACE_NOUNS = new Set([
  'screen', 'monitor', 'display', 'desktop', 'window', 'page', 'tab',
  'document', 'pdf', 'browser', 'view', 'content', 'workspace',
  // de-DE
  'bildschirm', 'fenster', 'seite',
]);

/** Referring expressions that can bind to the active perception target. */
const DEICTIC_REF = new Set([
  'it', 'its', 'that', 'this', 'them', 'those', 'these', 'there',
  // de-DE
  'es', 'das', 'dies', 'diese', 'dort',
]);

/** Nouns that name a part of the active target ("the text on it"). */
const REFERENT_NOUNS = new Set([
  'text', 'content', 'contents', 'page', 'document', 'screenshot', 'word',
  'words', 'message', 'messages', 'name', 'names', 'number', 'numbers',
  'title', 'line', 'lines', 'label', 'labels', 'code', 'heading', 'paragraph',
]);

const PERCEPTION_VERBS = new Set([
  'read', 'reading', 'say', 'says', 'said', 'saying', 'tell', 'show', 'look',
  'see', 'describe', 'explain', 'inspect', 'repeat', 'extract', 'summarize',
  'summarise', 'check', 'try',
  // de-DE
  'lies', 'vorlesen', 'sag', 'sagt', 'zeig', 'zeige', 'beschreib', 'schau',
]);

const CAMERA_NOUNS = new Set([
  'camera', 'webcam', 'photo', 'photograph', 'picture', 'image', 'lens',
  'kamera', 'foto', 'bild',
]);

const SELF_PRESENCE_RE = /\b(?:see|seeing|look\s+at|looking\s+at|watch|watching|observe|observing)\s+me\b/i;
const HOLDING_RE = /\b(?:holding|hold|have\s+in\s+my\s+hand|in\s+my\s+hand|carrying|wearing)\b/i;

/** Explicit stop vocabulary (bare forms only — never "stop the server"). */
const STOP_RE =
  /^\s*(?:please\s+|jarvis[,\s]+|hey\s+jarvis[,\s]+)?(?:stop(?:\s+(?:it|that|this|now))?|cancel(?:\s+(?:it|that|this))?|never\s*mind|forget\s+(?:it|that)|move\s+on|abort|halt|quiet|be\s+quiet)\s*[.!]?\s*$/i;

/* ── D-1: explicit runtime intent ───────────────────────────────────────── */

/** Things the user can ask about that belong to the runtime, not to perception. */
const RUNTIME_SUBJECT_RE =
  /\b(?:agenticos|agentic\s+os|runtime|backend|back-?end|server|service|services|system|infrastructure|hermes|codex|supervisor|worker|worker\s+slot|api|database|db|pipeline)\b/i;

/** Second-person self reference — "are YOU healthy" is a runtime question. */
const SELF_REF_RE = /\b(?:you|your|yourself|jarvis)\b/i;

/** Probe vocabulary that asks for a state/health/model answer. */
const RUNTIME_PROBE_RE =
  /\b(?:status|health|healthy|unhealthy|healthcheck|health-?check|online|offline|alive|reachable|up|down|diagnose|diagnostic|diagnostics|state|version|uptime|load|running|operational|degraded|incident|incidents|check|inspect)\b/i;

/** "what/which model …" is a runtime question even without a probe verb. */
const MODEL_PROBE_RE = /\b(?:what|which)\s+model\b|\bmodel\s+(?:are|is)\s+(?:you|jarvis)\b/i;

export interface RuntimeIntent {
  explicit: boolean;
  reason: string;
}

/**
 * D-1: runtime diagnostics execute ONLY when the turn explicitly refers to
 * AgenticOS / the system / a service / a model. Frustration, correction or
 * perception vocabulary alone never qualifies — there is deliberately no
 * frustration word list here, because none is needed: without an explicit
 * runtime subject the turn simply is not a runtime question.
 */
export function hasExplicitRuntimeIntent(text: string): RuntimeIntent {
  const t = (text || '').trim();
  if (!t) return { explicit: false, reason: 'empty' };

  const hasSubject = RUNTIME_SUBJECT_RE.test(t);
  const hasSelfRef = SELF_REF_RE.test(t);
  const hasProbe = RUNTIME_PROBE_RE.test(t);
  const hasModelProbe = MODEL_PROBE_RE.test(t);

  if (!(hasSubject || hasSelfRef)) {
    return { explicit: false, reason: 'no runtime subject referenced' };
  }
  if (!(hasProbe || hasModelProbe)) {
    return { explicit: false, reason: 'no runtime state probe in the turn' };
  }
  return {
    explicit: true,
    reason: `${hasSubject ? 'runtime subject' : 'self reference'} + ${hasModelProbe ? 'model probe' : 'state probe'}`,
  };
}

/* ── stop ───────────────────────────────────────────────────────────────── */

export function isStopCommand(text: string): boolean {
  return STOP_RE.test(text || '');
}

/* ── camera intent ──────────────────────────────────────────────────────── */

export interface CameraIntent {
  isCameraPerception: boolean;
  confidence: number;
  reason: string;
}

/**
 * Compositional camera detection: camera vocabulary, a presence request
 * ("can you see me"), or a held-object question. An explicit screen surface
 * without camera vocabulary is NOT camera.
 */
export function detectCameraPerceptionIntent(raw: string): CameraIntent {
  const text = (raw || '').toLowerCase();
  const tokens = text.replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return { isCameraPerception: false, confidence: 0, reason: 'empty input' };

  const mentionsCamera = tokens.some((t) => CAMERA_NOUNS.has(t));
  const isPresence = SELF_PRESENCE_RE.test(text);
  const isHolding = HOLDING_RE.test(text);
  const mentionsSurface = tokens.some((t) => SURFACE_NOUNS.has(t));

  if (mentionsCamera && !mentionsSurface) {
    return { isCameraPerception: true, confidence: 0.9, reason: 'camera vocabulary' };
  }
  if (isPresence && !mentionsSurface) {
    return { isCameraPerception: true, confidence: 0.85, reason: 'presence request ("see me")' };
  }
  if (isHolding) {
    return { isCameraPerception: true, confidence: 0.85, reason: 'held-object question' };
  }
  return { isCameraPerception: false, confidence: 0, reason: 'no camera/presence intent' };
}

/* ── follow-up referent resolution ──────────────────────────────────────── */

export interface PerceptionContinuation {
  isContinuation: boolean;
  capability?: string;
  target?: PerceptionTarget;
  referent?: string;
  confidence: number;
  reason: string;
}

/**
 * Decide whether a turn continues the ACTIVE perception goal.
 *
 * A referring expression (it / that / this / the text / again) resolves against
 * the active focus ONLY when exactly one unambiguous perception context exists.
 * A turn that names a screen surface itself is a NEW intent, not a continuation,
 * and a bare "read" with no context is never mapped here.
 */
export function resolvePerceptionContinuation(
  raw: string,
  focus: PerceptionFocus | undefined,
): PerceptionContinuation {
  const notContinuation = (reason: string): PerceptionContinuation => ({
    isContinuation: false,
    confidence: 0,
    reason,
  });

  if (!focus) return notContinuation('no active perception context');

  const text = (raw || '').toLowerCase();
  const tokens = text.replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return notContinuation('empty input');

  if (hasExplicitRuntimeIntent(raw).explicit) {
    return notContinuation('explicit runtime question, not a perception follow-up');
  }

  const hasSurface = tokens.some((t) => SURFACE_NOUNS.has(t));
  const hasDeictic = tokens.some((t) => DEICTIC_REF.has(t));
  const hasReferentNoun = tokens.some((t) => REFERENT_NOUNS.has(t));
  const asksAgain = /\b(?:again|once\s+more|one\s+more\s+time|nochmal|noch\s+mal|wieder)\b/.test(text);
  const hasPerceptionVerb = tokens.some((t) => PERCEPTION_VERBS.has(t));
  const mentionsCamera = tokens.some((t) => CAMERA_NOUNS.has(t));
  const isHolding = HOLDING_RE.test(text);
  const isPresence = SELF_PRESENCE_RE.test(text);

  // A turn that names its own surface is a NEW goal for that surface.
  if (hasSurface && !hasDeictic && !hasReferentNoun && !asksAgain) {
    return notContinuation('names a new surface target');
  }

  // Camera vocabulary continues (or refreshes) a camera goal.
  if ((mentionsCamera || isHolding || isPresence) && focus.capability === 'camera_perception') {
    return {
      isContinuation: true,
      capability: focus.capability,
      target: focus.target,
      referent: mentionsCamera ? 'camera' : isHolding ? 'held object' : 'user presence',
      confidence: 0.85,
      reason: 'camera vocabulary while a camera perception goal is active',
    };
  }

  const hasReferringExpression = hasDeictic || hasReferentNoun || asksAgain;

  // Implicit perception question with NO named object resolves against the active
  // goal: "What do you see?" / "What can you see?" while a camera goal is active
  // continues that goal instead of starting an unrelated screen read. A turn with
  // any real object token ("show me the calendar") is NOT implicit and is left to
  // the normal routers.
  const GLUE = new Set([
    'the', 'a', 'an', 'my', 'your', 'our', 'me', 'i', 'you', 'is', 'are', 'was',
    'on', 'in', 'at', 'of', 'to', 'for', 'and', 'or', 'right', 'now', 'up',
    'please', 'jarvis', 'can', 'could', 'would', 'do', 'does', 'what', 'whats',
    'which', 'where', 'there', 'here', 'be', 'am', 'currently', 'current',
    'visible', 'foreground', 'active', 'yeah', 'ok', 'okay', 'so', 'just', 'well',
  ]);
  const objectTokens = tokens.filter(
    (t) => !GLUE.has(t) && !PERCEPTION_VERBS.has(t) && !DEICTIC_REF.has(t),
  );
  if (hasPerceptionVerb && !hasSurface && !mentionsCamera && !isHolding && !isPresence && objectTokens.length === 0) {
    return {
      isContinuation: true,
      capability: focus.capability,
      target: focus.target,
      referent: 'active perception target',
      confidence: 0.75,
      reason: `implicit perception question resolved against the active ${focus.capability} goal`,
    };
  }

  if (!hasReferringExpression) return notContinuation('no referring expression');
  if (!hasPerceptionVerb && !asksAgain) return notContinuation('no perception intent in the turn');

  const referent = hasReferentNoun
    ? tokens.find((t) => REFERENT_NOUNS.has(t))
    : hasDeictic
      ? tokens.find((t) => DEICTIC_REF.has(t))
      : 'previous target';

  return {
    isContinuation: true,
    capability: focus.capability,
    target: focus.target,
    referent,
    confidence: hasDeictic && hasPerceptionVerb ? 0.8 : 0.7,
    reason: `referring expression "${referent}" bound to the active ${focus.capability} goal`,
  };
}

/* ── the single decision ────────────────────────────────────────────────── */

export type PerceptionDecisionKind =
  | 'stop'
  | 'continuation'
  | 'new_intent'
  | 'none';

export interface PerceptionDecision {
  /** True when this layer has TERMINALLY claimed the turn. Downstream routers
   *  must not reclassify a claimed turn. */
  claimed: boolean;
  kind: PerceptionDecisionKind;
  capability?: 'camera_perception' | 'read_foreground_screen' | string;
  target?: PerceptionTarget;
  referent?: string;
  confidence: number;
  reason: string;
  originTurnId?: number | string;
  /** Step 7 gate: runtime diagnostics may run ONLY when this is true. */
  runtimeIntentExplicit: boolean;
  runtimeIntentReason: string;
  /** Diagnostics of the sub-decisions, for logging/tests. */
  foreground?: ForegroundScreenIntent;
  camera?: CameraIntent;
  continuation?: PerceptionContinuation;
}

export interface DecidePerceptionInput {
  prompt: string;
  conversationId: string;
  turnId: number | string;
  /** Injected for tests; production passes undefined so the store is consulted. */
  focus?: PerceptionFocus;
}

/**
 * The authoritative early decision. Order is fixed:
 *   stop → continuation → new camera → new screen.
 * Runtime diagnostics are reported (not claimed) so the caller can gate its
 * existing introspection path.
 */
export function decidePerceptionTurn(input: DecidePerceptionInput): PerceptionDecision {
  const { prompt } = input;
  const runtime = hasExplicitRuntimeIntent(prompt);
  const base = {
    runtimeIntentExplicit: runtime.explicit,
    runtimeIntentReason: runtime.reason,
  };

  if (isStopCommand(prompt)) {
    return {
      ...base,
      claimed: true,
      kind: 'stop',
      confidence: 0.98,
      reason: 'explicit stop/cancel command',
    };
  }

  const focus = input.focus;
  const continuation = resolvePerceptionContinuation(prompt, focus);
  if (continuation.isContinuation && continuation.capability) {
    return {
      ...base,
      claimed: true,
      kind: 'continuation',
      capability: continuation.capability,
      target: continuation.target,
      referent: continuation.referent,
      confidence: continuation.confidence,
      reason: continuation.reason,
      originTurnId: focus?.originTurnId,
      continuation,
    };
  }

  const camera = detectCameraPerceptionIntent(prompt);
  if (camera.isCameraPerception) {
    return {
      ...base,
      claimed: true,
      kind: 'new_intent',
      capability: 'camera_perception',
      target: { type: 'camera_frame', description: 'current camera frame' },
      confidence: camera.confidence,
      reason: camera.reason,
      camera,
      continuation,
    };
  }

  const foreground = detectForegroundScreenIntent(prompt);
  if (foreground.isReadForegroundScreen && !runtime.explicit) {
    return {
      ...base,
      claimed: true,
      kind: 'new_intent',
      capability: 'read_foreground_screen',
      target: { type: 'foreground_window', description: 'currently active foreground window' },
      confidence: foreground.confidence,
      reason: foreground.reason,
      foreground,
      continuation,
    };
  }

  return {
    ...base,
    claimed: false,
    kind: 'none',
    confidence: 0,
    reason: focus ? 'no perception continuation and no new perception intent' : 'no perception intent',
    foreground,
    camera,
    continuation,
  };
}

/* ── terminal failure wording (never a runtime dump) ────────────────────── */

export const SCREEN_UNREADABLE_TEXT =
  "I can identify the foreground window, but I couldn't reliably read its contents.";
export const CAMERA_UNAVAILABLE_TEXT =
  "I couldn't get a reliable camera frame.";
