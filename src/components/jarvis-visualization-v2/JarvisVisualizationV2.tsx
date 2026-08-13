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
  /** Stage mode: omit the dark background rect so an outer neural layer can
   *  sit behind the figure (JarvisHumanoidStage). Default false (demo keeps
   *  the full backdrop). */
  transparentBackground?: boolean;
  /** Stage mode: hide the built-in status strip (the page owns the label). */
  showStatus?: boolean;
}

/**
 * ONE central programmatic humanoid (standalone, pre-integration).
 * All regions share the SAME figure; state changes region colors locally.
 */
export const JarvisVisualizationV2: React.FC<JarvisVisualizationV2Props> = React.memo(
  function JarvisVisualizationV2Inner({
    state,
    severity = 'none',
    speakingLevel = 0,
    thinkingIntensity = 0,
    className = '',
    transparentBackground = false,
    showStatus = true,
  }: JarvisVisualizationV2Props) {
  const animation = useJarvisAnimationV2(state, speakingLevel, thinkingIntensity);
  const [frame, setFrame] = React.useState({ pulse: 0.5, breath: 0.5, scan: 0.25, eye: 0.35 });
  React.useEffect(() => {
    // Animate ONLY while the window has focus. The visuals are slow sine
    // drifts (1.3s–6.3s periods); flushing React state every rAF would
    // re-render the whole SVG subtree at 60fps — pure waste on integrated
    // GPUs and it starves the event loop in jsdom tests (which never focus).
    // When focused, flush ~3fps (motion indistinguishable; cost ~20x lower);
    // the continuous feel comes from SMIL/CSS inside the SVG.
    let unsub: (() => void) | null = null;
    let last = 0;
    const start = () => {
      if (unsub) return;
      unsub = animation.subscribe((f) => {
        const now = performance.now();
        if (now - last < 330) return;
        last = now;
        setFrame(f);
      });
    };
    const stop = () => {
      unsub?.();
      unsub = null;
    };
    if (typeof document !== 'undefined' && document.hasFocus()) start();
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', stop);
      stop();
    };
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

        {!transparentBackground && (
          <rect width="1000" height="1250" fill="url(#jv2-bg)" />
        )}

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

      <div className="jv2-status" style={showStatus ? undefined : { display: 'none' }}>
        <span className="jv2-dot" />
        <strong>{STATE_LABELS[state]}</strong>
      </div>
    </div>
  );
});

export default JarvisVisualizationV2;
