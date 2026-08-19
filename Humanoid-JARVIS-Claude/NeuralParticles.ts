import { col, mulberry32, TAU, CX, Env, Particle } from './BaseAdapt';
import { brainCorePosition } from './BrainCoreAnchor';
import type { CognitiveMode } from './CognitiveState';

export interface CogAmbient { dust: Particle[]; }

export function buildCogAmbient(rng: () => number): CogAmbient {
  const dust: Particle[] = [];
  for (let i = 0; i < 64; i++) {
    const a = rng() * TAU, r = 150 + rng() * 280;
    const x = CX + Math.cos(a) * r, y = 360 + Math.sin(a) * r * 0.85;
    if (Math.abs(x - CX) < 150 && y > 200 && y < 580) continue;          // never over face
    dust.push({ x, y, r: 0.5 + rng() * 0.9, a: 0.05 + rng() * 0.15, ph: rng() * TAU, sp: 0.4 + rng(), white: 0 });
  }
  return { dust };
}

export function drawCogAmbient(
  ctx: CanvasRenderingContext2D, d: CogAmbient, env: Env, mode: CognitiveMode,
  accent: number, tw: boolean,
): void {
  for (const p of d.dust) {
    const a = p.a * (tw ? 0.7 + 0.3 * Math.sin(env.t * p.sp + p.ph) : 1);
    ctx.fillStyle = col(env.hue, a, 74);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  if (mode === 'thinking' || mode === 'researching') {                    // circulating neuron clusters
    for (let c = 0; c < 3; c++) {
      const base = env.t * 0.25 + c * 2.1, R = 175 + c * 32;
      const cx = CX + Math.cos(base) * R, cy = 360 + Math.sin(base) * R * 0.85;
      for (let i = 0; i < 9; i++) {
        const ox = Math.cos(i * 2.4 + env.t * 0.7) * (4 + (i % 3) * 3);
        const oy = Math.sin(i * 1.7 + env.t * 0.6) * 4;
        ctx.fillStyle = col(i % 3 === 0 ? accent : env.hue, 0.22, i % 3 === 0 ? 70 : 76);
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, 0.9, 0, TAU); ctx.fill();
      }
    }
  }
  if (mode === 'listening')                                               // localized yellow at ears
    for (const s of [-1, 1])
      for (let i = 0; i < 5; i++) {
        const a = 0.12 + 0.2 * Math.max(0, Math.sin(env.t * 6 + i * 1.3 + s));
        ctx.fillStyle = col(accent, a, 70); ctx.beginPath();
        ctx.arc(CX + s * (118 + (i % 3) * 6), 396 + (i * 5) - 10, 1, 0, TAU); ctx.fill();
      }
  if (mode === 'warning' || mode === 'error')                             // localized only
    for (let i = 0; i < 6; i++) {
      const a = 0.1 + 0.25 * Math.max(0, Math.sin(env.t * 9 + i * 2.2));
      ctx.fillStyle = col(accent, a, 66); ctx.beginPath();
      ctx.arc(
        brainCorePosition.x + Math.cos(i * 1.05) * (16 + (i % 3) * 7),
        brainCorePosition.y + Math.sin(i * 1.05) * 12, 1, 0, TAU,
      ); ctx.fill();
    }
}
