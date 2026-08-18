/**
 * neuralBlobState — pure derivation of the Jarvis NEURAL BLOB visual state and
 * node activation from REAL runtime signals ONLY. No timers pretend work:
 * every input is an actual runtime fact (orb state derived from mic/playback/
 * request state, node activity derived from live task/project/run signals).
 */

export type BlobVisualState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'ACTING'
  | 'SPEAKING'
  | 'COMPLETED'
  | 'ERROR';

export type NeuralNodeId =
  | 'MEMORY'
  | 'KNOWLEDGE'
  | 'PROJECTS'
  | 'HERMES'
  | 'RUNS'
  | 'ARTIFACTS'
  | 'VISION'
  | 'CODEX'
  | 'MAGNITUDE';

/** Existing orb-state vocabulary → the milestone's seven-state blob machine. */
export function toBlobVisualState(orbState: string): BlobVisualState {
  switch (orbState) {
    case 'listening':
      return 'LISTENING';
    case 'transcribing':
      return 'THINKING';
    case 'speaking':
      return 'SPEAKING';
    case 'reasoning':
    case 'understanding':
    case 'planning':
    case 'reviewing':
    case 'streaming':
    case 'paused':
    case 'approval_required':
      return 'THINKING';
    case 'executing':
    case 'delegated':
      return 'ACTING';
    case 'completed':
      return 'COMPLETED';
    case 'warning':
    case 'error':
    case 'offline':
      return 'ERROR';
    case 'idle':
    default:
      return 'IDLE';
  }
}

/**
 * Map the studio's real node-activity record (keys Memory/Projects/Knowledge/
 * Hermes/Runs/Artifacts/Vision, values 0..1) into the blob's node set.
 * Nodes with no real signal simply stay at their resting intensity (passive).
 */
export function nodePulse(activity: Partial<Record<string, number>> | undefined): Record<NeuralNodeId, number> {
  const out: Record<NeuralNodeId, number> = {
    MEMORY: 0, KNOWLEDGE: 0, PROJECTS: 0, HERMES: 0, RUNS: 0, ARTIFACTS: 0, VISION: 0, CODEX: 0, MAGNITUDE: 0,
  };
  const keyMap: Record<string, NeuralNodeId> = {
    Memory: 'MEMORY', Knowledge: 'KNOWLEDGE', Projects: 'PROJECTS',
    Hermes: 'HERMES', Runs: 'RUNS', Artifacts: 'ARTIFACTS', Vision: 'VISION',
    CodeX: 'CODEX', Magnitude: 'MAGNITUDE',
  };
  for (const [k, v] of Object.entries(activity || {})) {
    const node = keyMap[k];
    if (node && typeof v === 'number' && v > 0) out[node] = Math.min(1, Math.max(0, v));
  }
  return out;
}

/**
 * Pulse direction for a node — which way energy travels on an active
 * connection. Inbound = subsystem → Jarvis (retrieval/return); outbound =
 * Jarvis → subsystem (delegation/output). Direction is a static semantic
 * constant per node (real activity drives WHEN it pulses, not the arrow).
 */
export const NODE_DIRECTION: Record<NeuralNodeId, 'in' | 'out'> = {
  MEMORY: 'in',      // Jarvis retrieves memory → memory → jarvis
  KNOWLEDGE: 'in',   // knowledge/research retrieval → jarvis
  PROJECTS: 'in',    // project context read → jarvis
  HERMES: 'out',     // delegation → jarvis → hermes (return pulses on receipt)
  RUNS: 'out',       // active run activity flows outward
  ARTIFACTS: 'out',  // artifact created → jarvis → artifacts
  VISION: 'in',      // vision input → jarvis
  CODEX: 'out',      // delegation → jarvis → codex
  MAGNITUDE: 'out',  // browser/action delegation → jarvis → magnitude
};

/** Node → existing AgenticOS route (all destinations exist in App.tsx). */
export const NODE_ROUTES: Record<NeuralNodeId, string> = {
  MEMORY: '/memory',
  KNOWLEDGE: '/research',
  PROJECTS: '/mission-control',
  HERMES: '/agents',
  RUNS: '/runs',
  ARTIFACTS: '/builds',
  VISION: '/video',
  CODEX: '/codex',
  MAGNITUDE: '/magnitude',
};

/** Truthful model identity label: 'JARVIS' + `provider · model` (or '—'). */
export function modelLabel(provider: string | null | undefined, model: string | null | undefined): string {
  if (provider && model) return `${provider} · ${model}`;
  if (provider) return provider;
  return '—';
}
