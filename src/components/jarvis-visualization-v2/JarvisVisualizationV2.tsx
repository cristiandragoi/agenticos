import React from 'react';
import { useJarvisAnimationV2 } from './useJarvisAnimationV2';
import { CHANNELS_V2, STATE_LABELS, type JarvisStateV2, type Severity } from './JarvisStateV2';
import { JarvisHead } from './JarvisHead';
import { JarvisFace } from './JarvisFace';
import { JarvisEyes } from './JarvisEyes';
import { JarvisBrain } from './JarvisBrain';
import { JarvisBrainNeurons } from './JarvisBrainNeurons';
import { JarvisFaceNeurons } from './JarvisFaceNeurons';
import { JarvisNeck } from './JarvisNeck';
import { JarvisTorso } from './JarvisTorso';
import { JarvisChestCore } from './JarvisChestCore';
import { JarvisParticles } from './JarvisParticles';
import './JarvisVisualizationV2.css';

export interface JarvisVisualizationV2Props {
  state: JarvisStateV2;
  severity?: Severity;
  speakingLevel?: number;
  thinkingIntensity?: number;
  className?: string;
}

/**
 * ONE central programmatic humanoid (standalone, pre-integration).
 * All regions share the SAME figure; state changes region colors locally.
 */
export const JarvisVisualizationV2: React.FC<JarvisVisualizationV2Props> = ({
  state,
  severity = 'none',
  speakingLevel = 0,
  thinkingIntensity = 0,
  className = '',
}) => {
  const animation = useJarvisAnimationV2(state, speakingLevel, thinkingIntensity);
  const [frame, setFrame] = React.useState({ pulse: 0, breath: 0, scan: 0, eye: 0 });
  React.useEffect(() => {
    const unsubscribe = animation.subscribe(setFrame);
    return () => { unsubscribe(); };
  }, [animation]);
  const { pulse, breath } = frame;

  const identity = CHANNELS_V2.cyan;
  const err = severity === 'critical' || severity === 'high';

  return (
    <div
      className={`jv2-root ${className}`}
      data-jarvis-state={state}
      style={{ ['--jv2-color' as any]: identity }}
    >
      <svg className="jv2-svg" viewBox="0 0 1000 1250" role="img" aria-label={`Jarvis ${STATE_LABELS[state]}`}>
        <defs>
          <radialGradient id="jv2-bg" cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor={err ? 'rgba(255,77,95,0.06)' : 'rgba(0,234,255,0.07)'} />
            <stop offset="55%" stopColor="rgba(0,168,204,0.02)" />
            <stop offset="100%" stopColor={CHANNELS_V2.bg} />
          </radialGradient>
          <filter id="jv2-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="jv2-glow-soft" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect width="1000" height="1250" fill="url(#jv2-bg)" />

        <JarvisParticles color={identity} layer="bg" />

        {/* depth: faint skull halo behind */}
        <ellipse cx="500" cy="400" rx="190" ry="250" fill="none" stroke={identity} strokeWidth="0.4" opacity="0.07" />

        <JarvisHead state={state} />
        <JarvisBrainNeurons state={state} pulse={pulse} />
        <JarvisBrain state={state} pulse={pulse} />
        <JarvisFace state={state} mouthOpen={state === 'speaking' ? speakingLevel : 0} />
        <JarvisEyes state={state} />
        <JarvisFaceNeurons state={state} pulse={pulse} />
        <JarvisNeck state={state} />
        <JarvisTorso state={state} />
        <JarvisChestCore state={state} pulse={pulse} breath={breath} />

        <JarvisParticles color={identity} layer="fg" />
      </svg>

      <div className="jv2-status">
        <span className="jv2-dot" />
        <strong>{STATE_LABELS[state]}</strong>
      </div>
    </div>
  );
};

export default JarvisVisualizationV2;
