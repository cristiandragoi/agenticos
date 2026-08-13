/**
 * JarvisHumanoidStage — production Jarvis visualization (Task 1 overnight build).
 *
 * Replaces the organic blob (JarvisNeuralBlob) with the reference-geometry
 * humanoid (JarvisVisualizationV2) plus the seven semantic neural modules
 * (JarvisNeuralSystems). Same prop contract as the blob, so JarvisStudio only
 * swaps the import. ALL state is real: orb state derived from mic/playback/
 * runtime signals, node activity from real runtime signals. Never fakes work.
 *
 * Layering: one 1000x1250 viewBox — neural systems behind, humanoid in front
 * (transparent background, no built-in status). The humanoid itself is not
 * interactive; module nodes carry the clicks (pointer-events pass through the
 * humanoid wrapper).
 */
import React from 'react';
import { JarvisVisualizationV2 } from './JarvisVisualizationV2';
import { JarvisNeuralSystems } from './JarvisNeuralSystems';
import type { JarvisStateV2 } from './JarvisStateV2';
import type { NeuralNodeId } from '../jarvis/neuralBlobState';
import { nodePulse, NODE_ROUTES, modelLabel } from '../jarvis/neuralBlobState';

/** Existing orb-state vocabulary → the humanoid's localized state machine. */
export function orbStateToV2(state: string): JarvisStateV2 {
  switch (state) {
    case 'listening': return 'listening';
    case 'transcribing': return 'transcribing';
    case 'speaking': return 'speaking';
    case 'reasoning':
    case 'understanding':
    case 'planning':
    case 'streaming': return 'thinking';
    case 'executing': return 'executing';
    case 'delegated': return 'delegating';
    case 'repairing':
    case 'reviewing': return 'researching';
    case 'warning':
    case 'paused':
    case 'approval_required': return 'warning';
    case 'completed': return 'completed';
    case 'error': return 'error';
    case 'offline': return 'idle';
    case 'idle':
    default: return 'idle';
  }
}

export interface JarvisHumanoidStageProps {
  /** Existing orb-state vocabulary (real runtime derivation). */
  state: string;
  /** Real microphone amplitude 0..1 (drives speaking-level-like energy). */
  inputLevel?: number;
  /** Real playback amplitude 0..1 (drives the speaking state). */
  outputLevel?: number;
  /** Real subsystem activity (keys Memory/Knowledge/... — see nodePulse). */
  nodeActivity?: Partial<Record<string, number>>;
  provider?: string | null;
  model?: string | null;
  /** Stage width in px (viewBox is 1000:1250 tall). */
  size?: number;
  testIdPrefix?: string;
  onNodeClick?: (node: NeuralNodeId) => void;
}

export const JarvisHumanoidStage = React.memo(function JarvisHumanoidStageInner({
  state,
  inputLevel = 0,
  outputLevel = 0,
  nodeActivity,
  provider,
  model,
  size = 340,
  testIdPrefix = 'jarvis-neural',
  onNodeClick,
}: JarvisHumanoidStageProps) {
  const v2: JarvisStateV2 = orbStateToV2(state);
  const testId = testIdPrefix;
  const pulses = React.useMemo(() => nodePulse(nodeActivity), [nodeActivity]);
  const label = modelLabel(provider, model);
  const speaking = state === 'speaking' ? outputLevel : 0;
  const thinking = v2 === 'thinking' || v2 === 'researching' ? (state === 'executing' ? 0.5 : 0.8) : v2 === 'executing' ? 0.45 : inputLevel > 0 ? inputLevel * 0.5 : 0;

  return (
    <div
      data-testid={testId}
      data-orb-state={state}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: size, maxWidth: '100%' }}
    >
      <div
        data-testid={`${testId}-stage`}
        style={{ position: 'relative', width: '100%', aspectRatio: '1000 / 1250' }}
      >
        {/* Neural systems layer (behind the figure) */}
        <JarvisNeuralSystems state={v2} pulses={pulses} onNodeClick={onNodeClick} />
        {/* Humanoid figure (transparent background; clicks pass through) */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <JarvisVisualizationV2
            state={v2}
            speakingLevel={speaking}
            thinkingIntensity={thinking}
            transparentBackground
            showStatus={false}
          />
        </div>
      </div>
      <div data-testid={`${testId}-label`} style={{ textAlign: 'center', marginTop: 2, lineHeight: 1.35 }} aria-label="Jarvis">
        <div data-testid={`${testId}-model`} style={{ fontSize: 11, color: 'rgba(226,232,240,0.9)', fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {label}
        </div>
      </div>
    </div>
  );
});

export { NODE_ROUTES, modelLabel };
export default JarvisHumanoidStage;
