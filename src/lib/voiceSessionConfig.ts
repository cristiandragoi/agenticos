/**
 * voiceSessionConfig — ONE authoritative TTS voice configuration per
 * active voice session (Phase 15, Failure B: voice-identity pinning).
 *
 * Jarvis must not unexpectedly change voices. Every TTS synthesis call for
 * the session resolves through this single configuration, captured at
 * voice-session creation and immutable for the session:
 *
 *   - provider:  deepgram (the only configured TTS provider today)
 *   - model:     aura model ID (voiceId) — resolved once, never per-chunk
 *   - fallback:  explicit and RECORDED — the only fallback is the browser
 *                speechSynthesis path, and it must be surfaced truthfully
 *                (voiceTrace + timeline) instead of silently swapping voices.
 *
 * Nothing in the renderer may independently choose another default; a retry
 * must reuse the SAME model; a provider failure must preserve the resolved
 * config and record the fallback reason.
 */

/** Per-agent default Deepgram Aura voice mapping (unchanged from useVoiceIO). */
export const AGENT_VOICE_DEFAULTS: Record<string, string> = {
  'agent-jarvis': 'aura-helios-en', // Deep British male (approved Jarvis voice)
  'agent-hermes': 'aura-orion-en',  // Natural male — distinct from Jarvis
};

export interface VoiceSessionConfig {
  /** TTS provider (deepgram). */
  provider: 'deepgram';
  /** Full Deepgram Aura model id, e.g. aura-helios-en. */
  model: string;
  /** Short voice id (same as model for Deepgram). */
  voiceId: string;
  /** Optional renderer-level override (user picked a voice in the UI). */
  override: string | null;
}

/**
 * Resolve the authoritative voice configuration for a voice session.
 * Priority: explicit user override > per-agent default > global fallback.
 * Deterministic and stable — call once at session creation, reuse forever.
 */
export function resolveVoiceSessionConfig(
  agentId: string,
  override: string | null,
  fallbackVoice = 'aura-helios-en',
): VoiceSessionConfig {
  const model = override || AGENT_VOICE_DEFAULTS[agentId] || fallbackVoice;
  return {
    provider: 'deepgram',
    model,
    voiceId: model,
    override,
  };
}

/**
 * Describe a synthesis request for instrumentation:
 *   voiceSessionId, turnId, ttsProvider, ttsModel, voiceId, fallbackReason
 * Used by the CDP gate and the human test to prove 10 consecutive turns
 * synthesize with the SAME intended voice.
 */
export interface VoiceSynthesisRecord {
  voiceSessionId: string | null;
  turnId: number | null;
  ttsProvider: string;
  ttsModel: string;
  voiceId: string;
  fallbackReason: string | null;
  at: number;
}

const synthesisLog: VoiceSynthesisRecord[] = [];
const SYNTH_LOG_LIMIT = 200;

/** Record one synthesis attempt (truthful instrumentation, no secrets). */
export function recordVoiceSynthesis(
  rec: VoiceSynthesisRecord,
): void {
  synthesisLog.push(rec);
  if (synthesisLog.length > SYNTH_LOG_LIMIT) synthesisLog.shift();
}

/** Last N synthesis records (CDP gate proof: same voice across turns). */
export function voiceSynthesisLog(limit = 50): VoiceSynthesisRecord[] {
  return synthesisLog.slice(-limit);
}

/** Distinct voices used in the last N records — must be 1 for a stable session. */
export function distinctVoicesInLog(limit = 50): string[] {
  return [...new Set(synthesisLog.slice(-limit).map((r) => r.voiceId))];
}

// Expose a read-only snapshot on window so CDP gate scripts can prove the
// voice-identity invariant (10 consecutive turns, same intended voice) on the
// packaged app without instrumenting the page.
export function installVoiceSynthesisProbe() {
  if (typeof window === 'undefined') return;
  try {
    (window as any).__voiceSynthesisLog = () => voiceSynthesisLog(50);
    (window as any).__voiceDistinctVoices = () => distinctVoicesInLog(50);
  } catch { /* best effort */ }
}
if (typeof window !== 'undefined') installVoiceSynthesisProbe();
