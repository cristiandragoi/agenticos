/**
 * BaseAdapt — bridges the CognitiveField spec's canvas-base contracts to the
 * REAL locked base on this machine: src/components/jarvis-visualization-v2
 * (the frozen SVG humanoid). Anatomy files are byte-for-byte untouched.
 *
 * The spec imported canvas primitives (col/TAU/CX/Env/Particle/DESIGN_W,
 * BRAIN_ORIGIN, NeuralNodeKind, defaultJarvisState) from base modules that do
 * not exist here; this module provides those contracts against the real base:
 *   - DESIGN_W/H = the v2 SVG viewBox (1000x1250)
 *   - brainCorePosition = the measured reference brain core (REF.brainCore)
 *   - NeuralNodeKind = the runtime node kinds (JarvisNodeSystem does not exist)
 *   - mulberry32 = the base's deterministic PRNG
 */
import { mulberry32 } from '../src/components/jarvis-visualization-v2/JarvisStateV2';
import { REF } from '../src/components/jarvis-visualization-v2/referenceGeometry';

export { mulberry32 };
export { REF };

/** v2 SVG design space (viewBox 1000x1250). */
export const DESIGN_W = 1000;
export const DESIGN_H = 1250;

export const TAU = Math.PI * 2;
/** Design-space center x. */
export const CX = 500;

export interface Env {
  t: number;
  hue: number;
}

export interface Particle {
  x: number;
  y: number;
  r: number;
  a: number;
  ph: number;
  sp: number;
  white?: number;
}

/** hsla helper — the canvas-base color contract. */
export const col = (hue: number, alpha: number, light: number) =>
  `hsla(${hue}, 82%, ${light}%, ${Math.max(0, Math.min(1, alpha))})`;

/** The single cognitive origin (measured reference brain core). */
export const brainCorePosition = { x: REF.brainCore.x, y: REF.brainCore.y };

/** Runtime node kinds (spec's JarvisNodeSystem module does not exist here). */
export type NeuralNodeKind =
  | 'memory' | 'project' | 'knowledge' | 'hermes' | 'codex' | 'artifact';
