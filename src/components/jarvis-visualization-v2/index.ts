/**
 * JarvisV2 — standalone high-detail programmatic humanoid (pre-integration).
 * Barrel exports. NOT wired to AgenticOS runtime; pending visual approval.
 */
export { JarvisVisualizationV2 } from './JarvisVisualizationV2';
export { JarvisHead } from './JarvisHead';
export { JarvisFace } from './JarvisFace';
export { JarvisEyes, JarvisEye } from './JarvisEyes';
export { JarvisBrain } from './JarvisBrain';
export { JarvisBrainNeurons } from './JarvisBrainNeurons';
export { JarvisFaceNeurons } from './JarvisFaceNeurons';
export { JarvisNeck } from './JarvisNeck';
export { JarvisTorso } from './JarvisTorso';
export { JarvisChestCore } from './JarvisChestCore';
export { NeuralField, scatterEllipse, buildConnections, makeRand } from './JarvisNeuralMesh';
export { JarvisParticles } from './JarvisParticles';
export { JarvisNeuralSystems, NEURAL_MODULES } from './JarvisNeuralSystems';
export { JarvisHumanoidStage, orbStateToV2 } from './JarvisHumanoidStage';
export { JarvisV2Demo } from './JarvisV2Demo';
export { useJarvisAnimationV2 } from './useJarvisAnimationV2';
export * from './JarvisStateV2';
