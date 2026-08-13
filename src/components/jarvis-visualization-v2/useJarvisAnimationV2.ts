import { useEffect, useMemo, useRef } from 'react';
import type { JarvisStateV2 } from './JarvisStateV2';

export interface JarvisAnimationFrameV2 {
  pulse: number;
  breath: number;
  scan: number;
  eye: number;
}

/** Single-rAF animation frame; regions subscribe. Same contract as v2. */
export function useJarvisAnimationV2(
  state: JarvisStateV2,
  speakingLevel: number,
  thinkingIntensity: number,
) {
  const frameRef = useRef<JarvisAnimationFrameV2>({ pulse: 0, breath: 0, scan: 0, eye: 0 });
  const listeners = useRef(new Set<(f: JarvisAnimationFrameV2) => void>());

  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const activeThinking = state === 'thinking' || state === 'researching' || state === 'executing';
      const activeSpeaking = state === 'speaking';
      frameRef.current = {
        pulse: 0.5 + 0.5 * Math.sin(t * (activeThinking ? 4.6 : 2.1)),
        breath: 0.5 + 0.5 * Math.sin(t * 1.15),
        scan: (t * 0.16) % 1,
        eye: Math.min(1, 0.2 + (activeThinking ? thinkingIntensity * 0.7 : 0) + (activeSpeaking ? speakingLevel * 0.8 : 0)),
      };
      listeners.current.forEach((fn) => fn(frameRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, speakingLevel, thinkingIntensity]);

  return useMemo(
    () => ({
      frameRef,
      subscribe(fn: (f: JarvisAnimationFrameV2) => void) {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
    }),
    // Stable identity across renders: both members are refs. Without this,
    // every parent render re-runs the subscriber effect and resets any
    // throttling inside the subscription (observed: 60fps React re-renders
    // that starved the event loop in jsdom and wasted GPU time in prod).
    [],
  );
}
