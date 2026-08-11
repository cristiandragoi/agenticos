/**
 * Jarvis Humanoid Visualization — Particle Field (Canvas 2D)
 * High-performance particle system for ambient neural dust.
 * Runs on a separate canvas layer for GPU-composited performance.
 */

import React, { useRef, useEffect } from 'react';
import { getChannelColor } from './useJarvisAnimator';
import type { AnimatorState } from './useJarvisAnimator';

interface ParticleFieldProps {
  animator: React.MutableRefObject<AnimatorState>;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const ParticleField: React.FC<ParticleFieldProps> = ({ animator, width, height, centerX, centerY }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      const a = animator.current;
      const ch = a.activeChannel;
      const intensity = a.layerIntensities.neuralPathways;

      ctx.clearRect(0, 0, width, height);

      // Draw particles
      a.particles.forEach((p) => {
        const px = centerX + p.x;
        const py = centerY + p.y;
        const alpha = (1 - p.life / p.maxLife) * intensity * 0.8;

        if (alpha <= 0.01) return;

        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = getChannelColor(ch, alpha);
        ctx.fill();

        // Subtle glow for larger particles
        if (p.size > 2 && intensity > 0.4) {
          ctx.beginPath();
          ctx.arc(px, py, p.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = getChannelColor(ch, alpha * 0.15);
          ctx.fill();
        }
      });

      // Draw connection web for nearby particles (when thinking)
      if (intensity > 0.5) {
        const particles = a.particles;
        const maxDist = 60;
        ctx.lineWidth = 0.3;

        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < maxDist) {
              const alpha = (1 - dist / maxDist) * intensity * 0.2;
              ctx.beginPath();
              ctx.moveTo(centerX + particles[i].x, centerY + particles[i].y);
              ctx.lineTo(centerX + particles[j].x, centerY + particles[j].y);
              ctx.strokeStyle = getChannelColor(ch, alpha);
              ctx.stroke();
            }
          }
        }
      }

      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameRef.current);
  }, [animator, width, height, centerX, centerY]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
      }}
    />
  );
};

export default React.memo(ParticleField);
