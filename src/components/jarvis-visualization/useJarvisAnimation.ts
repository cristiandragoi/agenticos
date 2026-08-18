import { useEffect, useRef } from 'react';
import type { JarvisState } from './JarvisTypes';

export interface JarvisAnimationFrame {
  pulse: number;
  breath: number;
  scan: number;
  eye: number;
}

export function useJarvisAnimation(
  state: JarvisState,
  speakingLevel: number,
  thinkingIntensity: number
) {
  const frameRef = useRef<JarvisAnimationFrame>({
    pulse: 0,
    breath: 0,
    scan: 0,
    eye: 0,
  });

  const listeners = useRef(new Set<(f: JarvisAnimationFrame) => void>());

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

      listeners.current.forEach(fn => fn(frameRef.current));
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, speakingLevel, thinkingIntensity]);

  return {
    frameRef,
    subscribe(fn: (f: JarvisAnimationFrame) => void) {
      listeners.current.add(fn);
      return () => listeners.current.delete(fn);
    }
  };
}
