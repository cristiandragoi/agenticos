/**
 * Humanoid-JARVIS-Claude — CognitiveField architecture (standalone).
 *
 * The LOCKED base is src/components/jarvis-visualization-v2 (frozen SVG
 * humanoid; anatomy files byte-for-byte untouched). This package adds the
 * cognitive overlay architecture around it. NOT integrated into AgenticOS.
 */
export { BUST_VIEW, viewTransform, toPixel, type JarvisViewWindow, type ViewTransform } from './JarvisView';
export { brainCorePosition } from './BrainCoreAnchor';
export {
  MODE_ACCENT_HUE, PHASE_MS, NODE_SLOTS, modeRegionMods,
  type CognitiveMode, type NodePhase,
} from './CognitiveState';
export { CognitiveController, type RuntimeNode } from './CognitiveController';
export { buildCogAmbient, drawCogAmbient, type CogAmbient } from './NeuralParticles';
export { drawSignals } from './NeuralSignals';
export { drawNodes } from './DynamicNodes';
export { CognitiveField } from './CognitiveField';
export { JarvisStage } from './JarvisStage';
export { CognitiveDemo } from './CognitiveDemo';
export { col, TAU, CX, DESIGN_W, DESIGN_H, mulberry32, brainCorePosition as brainCore, type Env, type Particle, type NeuralNodeKind } from './BaseAdapt';
