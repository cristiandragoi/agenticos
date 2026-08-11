/**
 * Jarvis programmatic visualization — barrel exports.
 * Matches the supplied package contract:
 *   import { JarvisVisualization } from '.../jarvis-visualization';
 */
export { default as JarvisVisualization } from './JarvisVisualization';
export { default as HumanoidCore } from './HumanoidCore';
export { default as NeuralNetwork } from './NeuralNetwork';
export { default as SystemNodes } from './SystemNodes';
export { default as ParticleField } from './ParticleField';
export { default as JarvisDemo } from './JarvisDemo';

export { useJarvisAnimator, getChannelColor, getSeverityColor, lerp, clamp01 } from './useJarvisAnimator';
export type { AnimatorState, AnimatorOptions, Particle } from './useJarvisAnimator';

export {
  CHANNEL_COLORS,
  STATE_CHANNEL_MAP,
  STATE_LAYER_PRESETS,
  SYSTEM_NODE_CONFIG,
  ANIMATION_CONFIG,
} from './JarvisState';
export type {
  VisualChannel,
  JarvisState,
  SystemNode,
  LayerId,
  Severity,
  JarvisVisualizationProps,
  NodeConfig,
} from './JarvisState';
