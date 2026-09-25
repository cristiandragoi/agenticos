/**
 * voiceRuntimeInvariants.ts — concrete, evidence-backed voice runtime invariants.
 *
 * A voice turn is a lifecycle. These invariants are the states that must NEVER
 * remain true, and each one is detectable from runtime facts alone — never from
 * speech content or confidence:
 *
 *   VOICE_TURN_STUCK           transcript committed, no terminal turn outcome
 *   VOICE_NOT_REARMED          previous turn terminal, listener not back to ready
 *   TTS_PREMATURE_TERMINATION  playout ended/cancelled without AUDIO_ENDED and
 *                              without a verified human barge-in
 *   VOICE_TURN_LATCH_LEAK      turn terminal but the processing/turn latch is held
 *   STT_TRUNCATION             the recorded audio contains materially more speech
 *                              than the committed final transcript
 *
 * Contract (the point of this module):
 *   A concrete invariant firing does NOT get written to a log and forgotten. It
 *   goes  runtime evidence → FailureDetector → Self-Heal incident → Supervisor →
 *   repair pipeline, with the FULL evidence pack the engineer needs, and the
 *   user's original goal is persisted for a single retry after repair.
 *
 * Deliberately NOT triggered by: low STT confidence, unclear speech, noise, or
 * an utterance the router simply could not classify. Those are conversation
 * problems, not runtime defects.
 */

import { logger } from '../../utils/logger.js';

export type VoiceInvariantId =
  | 'VOICE_TURN_STUCK'
  | 'VOICE_NOT_REARMED'
  | 'TTS_PREMATURE_TERMINATION'
  | 'VOICE_TURN_LATCH_LEAK'
  | 'STT_TRUNCATION'
  | 'ECHO_DROPPED_LEGITIMATE_SPEECH';

export interface VoiceTurnEvidence {
  turnId: number;
  conversationId?: string | null;
  transcript?: string;
  sttConfidence?: number;
  /** Epoch ms */
  committedAt?: number;
  sttBeginAt?: number;
  sttFinalAt?: number;
  rawAudioDurationMs?: number;
  wavPath?: string;
  vadStartMs?: number;
  vadEndMs?: number;
  endpointReason?: string;
  route?: string;
  executor?: string;
  executorCompleted?: boolean;
  finalResponseCreatedAt?: number;
  ttsState?: 'idle' | 'synthesizing' | 'speaking' | 'ended';
  ttsFramesPublished?: number;
  ttsStartedAt?: number;
  ttsEndedAt?: number;
  cancellationReason?: string;
  bargeInVerifiedHuman?: boolean;
  browserActionState?: string;
  isProcessingUserTurn?: boolean;
  isAccumulatingSpeech?: boolean;
  isSpeaking?: boolean;
  isListening?: boolean;
  ambientNoiseFloor?: number;
  droppedFramesWhileLatched?: number;
  droppedSpeechEstimateMs?: number;
  lastError?: string;
  echoDropped?: boolean;
  droppedAsEchoText?: string;
}

export interface FiredInvariant {
  id: VoiceInvariantId;
  /** One-line, human-readable statement of what was observed. */
  detail: string;
  evidence: VoiceTurnEvidence;
}

export interface VoiceInvariantInput {
  /** True when the turn reached COMPLETED / FAILED / CANCELLED / BLOCKED. */
  terminal: boolean;
  turn: VoiceTurnEvidence;
  /** Did a commit (new turn) arrive after the previous turn became terminal? */
  listenerRearmed?: boolean;
  /** Was the playout ended by a barge-in we verified as a human? */
  bareBargeInVerified?: boolean;
}

/**
 * Evaluate every invariant against one deterministic snapshot of voice state.
 * Pure function: no timers, no side effects — so the same snapshot always yields
 * the same verdict, and the regression tests can drive it directly.
 */
export function evaluateVoiceInvariants(input: VoiceInvariantInput): FiredInvariant[] {
  const { terminal, turn } = input;
  const fired: FiredInvariant[] = [];

  // ── VOICE_TURN_STUCK ────────────────────────────────────────────────────
  // A committed turn that never reached a terminal outcome while the mic stayed
  // latched. This is the failure that makes Jarvis permanently deaf.
  if (!terminal && turn.isProcessingUserTurn === true) {
    fired.push({
      id: 'VOICE_TURN_STUCK',
      detail:
        `turn ${turn.turnId} committed at ${fmt(turn.committedAt)} never reached a terminal outcome ` +
        `(route=${turn.route ?? 'none'}, executor=${turn.executor ?? 'none'}, ` +
        `executorCompleted=${turn.executorCompleted ?? 'unknown'}); ` +
        `the processing latch stayed held for ${dur(turn.committedAt, Date.now())}` +
        (turn.lastError ? `; last error: ${turn.lastError}` : ''),
      evidence: turn,
    });
  }

  // ── VOICE_TURN_LATCH_LEAK ───────────────────────────────────────────────
  // The turn IS terminal but the latch is still held. Distinct from STUCK: the
  // work finished, only the release was missed.
  if (terminal && turn.isProcessingUserTurn === true) {
    fired.push({
      id: 'VOICE_TURN_LATCH_LEAK',
      detail:
        `turn ${turn.turnId} reached a terminal outcome but the processing latch is still held ` +
        `(isSpeaking=${turn.isSpeaking}, isAccumulatingSpeech=${turn.isAccumulatingSpeech})`,
      evidence: turn,
    });
  }

  // ── VOICE_NOT_REARMED ───────────────────────────────────────────────────
  // Terminal, latch released, but the listener never returned to ready — so the
  // next wake word cannot be heard even though nothing is processing.
  if (terminal && turn.isProcessingUserTurn !== true && input.listenerRearmed === false) {
    fired.push({
      id: 'VOICE_NOT_REARMED',
      detail:
        `turn ${turn.turnId} is terminal and the latch is released, but the listener did not return to ready ` +
        `(isListening=${turn.isListening}, isSpeaking=${turn.isSpeaking}, isSynthesizing=${turn.ttsState === 'synthesizing'})`,
      evidence: turn,
    });
  }

  // ── TTS_PREMATURE_TERMINATION ───────────────────────────────────────────
  // Playout stopped without reaching its own end and without a VERIFIED human
  // barge-in. Jarvis's own speaker output cancelling Jarvis is the classic cause.
  const cancelled = turn.ttsState === 'ended' && Boolean(turn.cancellationReason);
  const reachedEnd = Boolean(turn.ttsEndedAt);
  if (cancelled && !reachedEnd && !input.bareBargeInVerified && turn.bargeInVerifiedHuman !== true) {
    fired.push({
      id: 'TTS_PREMATURE_TERMINATION',
      detail:
        `playout for turn ${turn.turnId} was cancelled by "${turn.cancellationReason}" after ` +
        `${dur(turn.ttsStartedAt, turn.ttsEndedAt ?? Date.now())} and ${turn.ttsFramesPublished ?? 0} frames published, ` +
        `without a verified human barge-in (bargeInVerifiedHuman=${turn.bargeInVerifiedHuman ?? false})`,
      evidence: turn,
    });
  }

  // ── STT_TRUNCATION ──────────────────────────────────────────────────────
  // The audio we captured contains materially more speech than the transcript we
  // committed. Derived from capture length vs transcript, NOT from a threshold
  // guess: compare the recorded duration against the words actually transcribed.
  const truncation = detectTruncation(turn);
  if (truncation) fired.push({ id: 'STT_TRUNCATION', detail: truncation, evidence: turn });

  // ── ECHO_DROPPED_LEGITIMATE_SPEECH ──────────────────────────────────────
  // The echo filter dropped a candidate transcript that contained legitimate user speech
  if (turn.echoDropped && turn.droppedAsEchoText) {
    const text = turn.droppedAsEchoText.trim();
    const isControl = /\b(?:stop|halt|cancel|shut\s*up|be\s*quiet|quiet|silence|pause|hold\s*on|start\s*working|stop\s*working)\b/i.test(text);
    const isQuestion = text.endsWith('?') || /^(?:what|how|why|who|when|where|which|can\s+you|could\s+you|tell\s+me)\b/i.test(text);
    if (isControl || isQuestion) {
      fired.push({
        id: 'ECHO_DROPPED_LEGITIMATE_SPEECH',
        detail: `turn ${turn.turnId} dropped candidate transcript "${text}" as echo despite containing ${isControl ? 'a control command' : 'a question'}`,
        evidence: turn,
      });
    }
  }

  return fired;
}

/**
 * Classify how much speech the captured audio implies versus what was committed.
 * Roughly 2.5 words/second is normal conversational pace; if the audio length
 * implies materially more words than the transcript holds, speech was lost.
 * Only fires on a clear gap so normal pauses and slow speech never trip it.
 */
export function detectTruncation(turn: VoiceTurnEvidence): string | null {
  const ms = turn.rawAudioDurationMs;
  const transcript = (turn.transcript || '').trim();
  if (!ms || ms <= 0) return null;

  // A click, a transient or a coughing fit is not speech we failed to transcribe.
  // Self-Heal is never opened on uncertain or trivial audio.
  const MIN_MEANINGFUL_AUDIO_MS = 1200;
  if (ms < MIN_MEANINGFUL_AUDIO_MS) return null;

  if (!transcript) {
    return `audio of ${ms}ms was captured but the committed transcript is empty`;
  }
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const expectedWords = (ms / 1000) * 2.5;
  // Material gap: the audio implies at least 2x the words the transcript holds,
  // and the absolute shortfall is large enough to be real speech (>= 8 words).
  if (expectedWords >= words * 2 && expectedWords - words >= 8) {
    return (
      `captured ${ms}ms of audio implies ~${Math.round(expectedWords)} words but only ` +
      `${words} were transcribed ("${transcript.slice(0, 80)}")`
    );
  }
  return null;
}

// ── Incident raising (the whole point) ──────────────────────────────────────

const INVARIANT_COMPONENT: Record<VoiceInvariantId, string> = {
  VOICE_TURN_STUCK: 'voice_turn_lifecycle',
  VOICE_NOT_REARMED: 'voice_listener_rearm',
  TTS_PREMATURE_TERMINATION: 'voice_tts_playout',
  VOICE_TURN_LATCH_LEAK: 'voice_turn_latch',
  STT_TRUNCATION: 'voice_stt_capture',
  ECHO_DROPPED_LEGITIMATE_SPEECH: 'voice_echo_filter',
};

/**
 * The evidence pack handed to Hermes engineering. It must be complete enough that
 * no engineer (human or model) has to guess what happened.
 */
export function buildEngineeringEvidencePack(
  invariant: FiredInvariant,
  extra: Record<string, unknown> = {},
): string {
  const e = invariant.evidence;
  return [
    `FAILING_INVARIANT=${invariant.id}`,
    `OBSERVED=${invariant.detail}`,
    `TURN_ID=${e.turnId}`,
    `CONVERSATION_ID=${e.conversationId ?? 'unknown'}`,
    `TRANSCRIPT=${e.transcript ?? ''}`,
    `STT_CONFIDENCE=${e.sttConfidence ?? 'unknown'}`,
    `STT_BEGIN_AT=${iso(e.sttBeginAt)}`,
    `STT_FINAL_AT=${iso(e.sttFinalAt)}`,
    `TURN_COMMITTED_AT=${iso(e.committedAt)}`,
    `RAW_AUDIO_DURATION_MS=${e.rawAudioDurationMs ?? 'unknown'}`,
    `VAD_START=${e.vadStartMs ?? 'unknown'}`,
    `VAD_END=${e.vadEndMs ?? 'unknown'}`,
    `ENDPOINT_REASON=${e.endpointReason ?? 'unknown'}`,
    `SAVED_WAV_PATH=${e.wavPath ?? 'unknown'}`,
    `ROUTE=${e.route ?? 'none'}`,
    `EXECUTOR=${e.executor ?? 'none'}`,
    `EXECUTOR_COMPLETED=${e.executorCompleted ?? 'unknown'}`,
    `FINAL_RESPONSE_CREATED_AT=${iso(e.finalResponseCreatedAt)}`,
    `TTS_STATE=${e.ttsState ?? 'unknown'}`,
    `TTS_STARTED_AT=${iso(e.ttsStartedAt)}`,
    `TTS_ENDED_AT=${iso(e.ttsEndedAt)}`,
    `TTS_FRAMES_PUBLISHED=${e.ttsFramesPublished ?? 'unknown'}`,
    `CANCELLATION_REASON=${e.cancellationReason ?? 'none'}`,
    `BARGE_IN_VERIFIED_HUMAN=${e.bargeInVerifiedHuman === true}`,
    `BROWSER_ACTION_STATE=${e.browserActionState ?? 'none'}`,
    `IS_PROCESSING_USER_TURN=${e.isProcessingUserTurn === true}`,
    `IS_ACCUMULATING_SPEECH=${e.isAccumulatingSpeech === true}`,
    `IS_SPEAKING=${e.isSpeaking === true}`,
    `IS_LISTENING=${e.isListening === true}`,
    `AMBIENT_NOISE_FLOOR=${e.ambientNoiseFloor ?? 'unknown'}`,
    `DROPPED_FRAMES_WHILE_LATCHED=${e.droppedFramesWhileLatched ?? 0}`,
    `DROPPED_SPEECH_ESTIMATE_MS=${e.droppedSpeechEstimateMs ?? 0}`,
    `LAST_ERROR=${e.lastError ?? 'none'}`,
    ...Object.entries(extra).map(([k, v]) => `${k.toUpperCase()}=${typeof v === 'string' ? v : JSON.stringify(v)}`),
  ].join('\n');
}

export interface VoiceIncidentResult {
  raised: boolean;
  incidentId?: string;
  error?: string;
}

/**
 * Raise a Self-Heal incident for a fired invariant and start the EXISTING repair
 * pipeline. Never merely logs: the user should not have to ask Hermes manually.
 */
export async function raiseVoiceInvariantIncident(
  invariant: FiredInvariant,
  extra: Record<string, unknown> = {},
): Promise<VoiceIncidentResult> {
  const component = INVARIANT_COMPONENT[invariant.id];
  const evidenceText = buildEngineeringEvidencePack(invariant, extra);

  try {
    const { failureDetector } = await import('../selfHeal/FailureDetector.js');
    const { selfHealSupervisor } = await import('../selfHeal/SelfHealSupervisor.js');

    const incidentId: string = await failureDetector.createManualIncident(
      component,
      invariant.detail,
      'voice' as any,
      'high',
      {
        source: 'voice_runtime_invariant',
        invariant: invariant.id,
        conversationId: invariant.evidence.conversationId ?? null,
        turnId: invariant.evidence.turnId,
        evidencePack: evidenceText,
        evidence: invariant.evidence as unknown as Record<string, unknown>,
        ...extra,
      },
    );

    console.log(`[JRT] VOICE_INVARIANT_FIRED id=${invariant.id} incident=${incidentId}`);
    console.log(`[JRT] VOICE_INVARIANT_EVIDENCE\n${evidenceText}`);
    logger.warn('[VoiceInvariants] Invariant fired — Self-Heal incident raised', {
      invariant: invariant.id, incidentId, component,
    });

    // Hand to the Supervisor asynchronously: a spoken turn must never block on
    // the repair pipeline.
    selfHealSupervisor.diagnoseIncident(incidentId).catch((err: any) => {
      logger.warn('[VoiceInvariants] Supervisor diagnosis error', {
        incidentId, error: err?.message || String(err),
      });
    });

    return { raised: true, incidentId };
  } catch (err: any) {
    logger.error('[VoiceInvariants] Failed to raise Self-Heal incident', {
      invariant: invariant.id, error: err?.message || String(err),
    });
    return { raised: false, error: err?.message || String(err) };
  }
}

// ── Original-goal persistence for a single safe retry (G) ───────────────────

const RETRY_SERVICE = 'voice-runtime-repair';

/**
 * Persist the user's original goal so it can be replayed exactly once after the
 * repair is deployed. Stored in the EXISTING durable goal registry, keyed to this
 * service so a retry can never be produced twice.
 */
export async function persistOriginalGoalForRetry(opts: {
  goal: string;
  conversationId?: string | null;
  incidentId?: string;
  turnId: number;
}): Promise<void> {
  const goal = (opts.goal || '').trim();
  if (!goal) return;
  try {
    const { setGoal } = await import('../../services/prerequisites/activeGoalRegistry.js');
    // The registry schema has no metadata column: the "already retried" state is
    // carried by the goal's own status (it is completed when taken), which is the
    // one writer that guarantees a single retry.
    const record = setGoal({
      originalGoal: goal,
      service: RETRY_SERVICE,
      conversationId: opts.conversationId ?? null,
    });
    logger.info('[VoiceInvariants] Original goal persisted for a single retry', {
      goal, goalId: record.id, incidentId: opts.incidentId, turnId: opts.turnId,
    });
  } catch (err: any) {
    logger.warn('[VoiceInvariants] Could not persist the original goal', { error: err?.message || String(err) });
  }
}

/**
 * Take the persisted goal for retry, exactly once. Returns null when there is
 * nothing to retry or it was already retried — this is what prevents a duplicate
 * action being sent after a repair.
 */
export async function takeOriginalGoalForRetry(): Promise<{ goal: string; goalRecordId: string } | null> {
  try {
    const mod: any = await import('../../services/prerequisites/activeGoalRegistry.js');
    const open: any = typeof mod.getOpenGoalForService === 'function' ? mod.getOpenGoalForService(RETRY_SERVICE) : null;
    if (!open || !open.originalGoal) return null;

    // Close it FIRST: if a second caller arrives it finds no open goal, so the
    // original action can never be dispatched twice.
    if (typeof mod.completeGoal === 'function') mod.completeGoal(open.id);
    return { goal: open.originalGoal, goalRecordId: open.id };
  } catch (err: any) {
    logger.warn('[VoiceInvariants] Could not read the persisted goal', { error: err?.message || String(err) });
    return null;
  }
}

// ── User-facing wording (F) ────────────────────────────────────────────────

/**
 * What Jarvis says when its own runtime is the thing that broke. Composed from
 * the fired invariant; no filler, and no claim that anything was repaired yet.
 */
export function voiceRecoveryAnnouncement(fired: FiredInvariant[], incidentIds: string[]): string {
  if (!fired.length) return '';
  const what =
    fired.some((f) => f.id === 'TTS_PREMATURE_TERMINATION') ? 'my speech output was cutting itself off'
    : fired.some((f) => f.id === 'VOICE_TURN_STUCK' || f.id === 'VOICE_TURN_LATCH_LEAK') ? 'a voice turn got stuck and stopped me hearing you'
    : fired.some((f) => f.id === 'STT_TRUNCATION') ? 'part of what you said was not captured'
    : fired.some((f) => f.id === 'ECHO_DROPPED_LEGITIMATE_SPEECH') ? 'I mistook your speech for my own echo'
    : 'my voice listener did not come back to ready';
  const handed = incidentIds.length
    ? `I've opened Self-Heal incident ${incidentIds.join(', ')} and handed the repair to Hermes.`
    : 'I could not open a Self-Heal incident, so this is not being repaired automatically.';
  return `I've hit a problem in my voice runtime — ${what}. I'm diagnosing it and handing the repair to Hermes. ${handed}`;
}

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(ts?: number): string {
  return ts ? new Date(ts).toISOString() : 'unknown';
}
function iso(ts?: number): string {
  return ts ? new Date(ts).toISOString() : 'none';
}
function dur(from?: number, to?: number): string {
  if (!from) return 'unknown';
  return `${(to ?? Date.now()) - from}ms`;
}

export const VOICE_INVARIANT_IDS: VoiceInvariantId[] = [
  'VOICE_TURN_STUCK',
  'VOICE_NOT_REARMED',
  'TTS_PREMATURE_TERMINATION',
  'VOICE_TURN_LATCH_LEAK',
  'STT_TRUNCATION',
  'ECHO_DROPPED_LEGITIMATE_SPEECH',
];

// ── Barge-in decision (the echo guard, as a pure function) ──────────────────

export interface BargeInDecisionInput {
  rms: number;
  /** ms since our own playout started */
  msSincePlayoutStart: number;
  ambientNoiseFloor: number;
  consecutiveFrames: number;
  graceMs: number;
  /** Floor that must be cleared while our own audio is playing. */
  playoutFloor: number;
  sustainFrames: number;
}

export type BargeInDecision = 'trigger' | 'sustain' | 'reject_echo' | 'reject_grace' | 'idle';

/**
 * Decide whether energy arriving during our own playout is a PERSON interrupting.
 * `reject_echo` is the case that matters: energy that clears the idle threshold
 * but not the playout floor is our own speaker output returning through the
 * microphone, and must never cancel Jarvis.
 */
export function decideBargeIn(input: BargeInDecisionInput): BargeInDecision {
  const dynamicFloor = Math.max(550, Math.min(1000, input.ambientNoiseFloor * 3.0 + 350));
  const floor = Math.max(dynamicFloor, input.playoutFloor);
  if (input.msSincePlayoutStart <= input.graceMs) {
    return input.rms > dynamicFloor ? 'reject_grace' : 'idle';
  }
  if (input.rms > floor) {
    return input.consecutiveFrames >= input.sustainFrames ? 'trigger' : 'sustain';
  }
  return input.rms > dynamicFloor ? 'reject_echo' : 'idle';
}
