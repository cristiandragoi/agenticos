import React, { useEffect, useMemo, useRef } from 'react';
import { mulberry32, Env, DESIGN_W, col } from './BaseAdapt';
import { viewTransform, JarvisViewWindow } from './JarvisView';
import { brainCorePosition } from './BrainCoreAnchor';
import { CognitiveController } from './CognitiveController';
import { MODE_ACCENT_HUE } from './CognitiveState';
import { buildCogAmbient, drawCogAmbient } from './NeuralParticles';
import { drawSignals } from './NeuralSignals';
import { drawNodes } from './DynamicNodes';

interface Props {
  controller: CognitiveController;
  view: JarvisViewWindow | null;
  width: number;
  height: number;
  hue?: number;
}

/** Overlay canvas — same transform as the humanoid frame; never touches it. */
export const CognitiveField: React.FC<Props> = ({ controller, view, width, height, hue = 197 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const ambient = useMemo(() => buildCogAmbient(mulberry32(4242)), []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      controller.tick(dt);
      const t = now / 1000, accent = MODE_ACCENT_HUE[controller.mode];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const vt = viewTransform(view, width, height);
      ctx.translate(vt.tx, vt.ty);
      ctx.scale(vt.s, vt.s);
      ctx.globalCompositeOperation = 'lighter';
      const env: Env = { t, hue };
      drawCogAmbient(ctx, ambient, env, controller.mode, accent, true);
      drawSignals(ctx, controller.nodes, env, t);
      drawNodes(ctx, controller.nodes, env, t);
      if (controller.mode === 'completed' && controller.modeT < 1400) {   // brief green completion ring
        const p = controller.modeT / 1400;
        ctx.strokeStyle = col(accent, 0.5 * (1 - p), 70);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(brainCorePosition.x, brainCorePosition.y, 18 + p * 70, 0, Math.PI * 2);
        ctx.stroke();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [controller, view, width, height, hue]);

  return (
    <canvas
      ref={ref}
      style={{ width, height, position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  );
};
