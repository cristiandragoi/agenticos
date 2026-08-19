import type { NeuralNodeKind } from './BaseAdapt';

export type CognitiveMode =
  | 'idle' | 'listening' | 'thinking' | 'researching' | 'delegating'
  | 'speaking' | 'completed' | 'warning' | 'error';

export const MODE_ACCENT_HUE: Record<CognitiveMode, number> = {
  idle: 197, listening: 48, thinking: 275, researching: 255, delegating: 320,
  speaking: 197, completed: 140, warning: 48, error: 0,
};

export type NodePhase = 'dormant' | 'materializing' | 'active' | 'resolved' | 'fading';

export const PHASE_MS = { materializing: 950, resolved: 800, fading: 850 } as const;

/**
 * Space management: LEFT / RIGHT / ABOVE-DIAGONAL of head only.
 * Never over the face (|x-500|<150 band), never below the chest (y>620).
 */
export const NODE_SLOTS = [
  { x: 185, y: 285 }, { x: 815, y: 285 }, { x: 255, y: 150 }, { x: 745, y: 150 },
  { x: 150, y: 452 }, { x: 850, y: 452 }, { x: 352, y: 92 }, { x: 648, y: 92 },
];

/** Body stays cyan; modes only modulate localized intensity (no recolor). */
export function modeRegionMods(mode: CognitiveMode): Partial<Record<string, number>> {
  switch (mode) {
    case 'thinking': return { brain: 1.3, faceNeurons: 1.15 };
    case 'researching': return { brain: 1.2, faceNeurons: 1.1 };
    case 'speaking': return { face: 1.25, leftEye: 1.3, rightEye: 1.3 };
    case 'listening': return { head: 1.05 };
    default: return {};
  }
}

/** Re-export for consumers that referenced the spec's JarvisNodeSystem. */
export type { NeuralNodeKind };
