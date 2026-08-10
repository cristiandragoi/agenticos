/**
 * jarvisOrbState — pure derivation of the Jarvis orb visual state from REAL
 * runtime signals only. No timers, no fakes: every input is something that
 * actually happened (mic capture active, transcription pending, confirmed
 * playback start, request/task activity, runtime failure, backend outage).
 */

import type { JarvisVisualState } from './JarvisOrb';
import type { JarvisRuntimeState } from './JarvisChat';
import type { MicState } from './JarvisComposer';

/** Window event names used to broadcast real voice/playback signals. */
export const JARVIS_ORB_EVENTS = {
  /** detail: VoiceState string ('listening' | 'transcribing' | 'speaking' | ...) */
  voiceState: 'jarvis:voice-state',
  /** detail: { agentId } — fired ONLY after audio playback actually started. */
  playbackStarted: 'jarvis:playback-started',
  /** detail: { agentId } — fired when playback ends or fails. */
  playbackEnded: 'jarvis:playback-ended',
  /** detail: { level: number 0..1 } — real microphone amplitude. */
  inputLevel: 'jarvis:input-level',
  /** detail: { level: number 0..1, agentId } — real playback amplitude. */
  outputLevel: 'jarvis:output-level',
} as const;

export interface JarvisOrbStateInputs {
  /** Microphone UI state from the composer's real capture pipeline. */
  micState: MicState;
  /** True only after a real playback-start confirmation (never on text generation). */
  playbackActive: boolean;
  /** Jarvis runtime state from the live request/task pipeline. */
  runtimeState: JarvisRuntimeState;
  /** True when the backend health probe is unreachable / reports offline. */
  backendOffline: boolean;
}

const ACTIVE_RUNTIME_STATES: ReadonlySet<JarvisRuntimeState> = new Set([
  'thinking',
  'understanding',
  'planning',
  'delegating',
  'executing',
  'reviewing',
  'paused',
  'streaming',
  'approval_required',
]);

/**
 * Maps the semantic runtime-state strings from /api/jarvis/runtime-state
 * to the extended JarvisVisualState set. Used when the caller already has
 * a resolved runtime-state string from the backend.
 */
export function runtimeStateToOrbState(runtimeState: string): JarvisVisualState {
  switch (runtimeState) {
    case 'reasoning': return 'reasoning';
    case 'executing': return 'executing';
    case 'delegated': return 'delegated';
    case 'repairing': return 'repairing';
    case 'warning': return 'warning';
    case 'completed': return 'completed';
    case 'error': return 'error';
    case 'idle': return 'idle';
    default: return 'thinking';
  }
}

/**
 * Derive the orb visual state. Precedence reflects physical reality:
 * a backend outage dominates; an actively capturing microphone is a live
 * local signal; confirmed playback outranks request bookkeeping; runtime
 * failures outrank in-flight activity; then specific runtime states map to
 * semantic visual states (spec §10–11) rather than collapsing all to 'thinking'.
 */
export function deriveJarvisOrbState(inputs: JarvisOrbStateInputs): JarvisVisualState {
  const { micState, playbackActive, runtimeState, backendOffline } = inputs;

  if (backendOffline) return 'offline';
  if (micState === 'listening') return 'listening';
  if (micState === 'transcribing') return 'transcribing';
  // Speaking ONLY after real playback started — text generation/streaming
  // completion must never produce the speaking state.
  if (playbackActive) return 'speaking';
  if (runtimeState === 'error' || micState === 'error') return 'error';

  // Specific runtime → semantic visual state mappings (spec §10–11).
  // Each maps to the orb state whose color/motion matches operational meaning.
  switch (runtimeState) {
    case 'executing':    return 'executing';   // strong cyan — operational/running
    case 'delegating':  return 'delegated';    // pink — secondary agent active
    case 'completed':   return 'completed';    // green — success pulse then idle
    case 'approval_required':
    case 'paused':      return 'warning';      // yellow — attention/blocked
    case 'reviewing':   return 'repairing';    // purple — corrective/repair work
    case 'cancelled':   return 'idle';
    // thinking/planning/understanding/streaming → cyan/white reasoning state
    case 'thinking':
    case 'planning':
    case 'understanding':
    case 'streaming':   return 'reasoning';    // cyan/white — model reasoning
  }

  // Catch-all for any other active states: use reasoning (cyan/white) per spec
  if (ACTIVE_RUNTIME_STATES.has(runtimeState)) return 'reasoning';
  return 'idle';
}
