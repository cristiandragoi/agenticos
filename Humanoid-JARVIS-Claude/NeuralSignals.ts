import { col, TAU, Env } from './BaseAdapt';
import { brainCorePosition } from './BrainCoreAnchor';
import type { RuntimeNode } from './CognitiveController';

const ease = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

function ctrl(n: RuntimeNode) {
  return {
    x: (brainCorePosition.x + n.x) / 2 + (n.x < 500 ? -55 : 55),
    y: (brainCorePosition.y + n.y) / 2 - 45,
  };
}

function q(n: RuntimeNode, t: number) {
  const c = ctrl(n), mt = 1 - t;
  return {
    x: mt * mt * brainCorePosition.x + 2 * mt * t * c.x + t * t * n.x,
    y: mt * mt * brainCorePosition.y + 2 * mt * t * c.y + t * t * n.y,
  };
}

/** Information moving through space — no permanent lines, no branches. */
export function drawSignals(ctx: CanvasRenderingContext2D, nodes: RuntimeNode[], env: Env, t: number): void {
  for (const n of nodes) {
    const fade = n.phase === 'fading' ? 1 - n.phaseT / 850
      : n.phase === 'materializing' ? 0.4 + 0.6 * (n.phaseT / 950) : 1;
    const grown = n.phase === 'materializing' ? ease(n.phaseT / 950) : 1;
    if (grown <= 0.02) continue;
    for (let d = 0.04; d < grown; d += 0.06) {                            // dotted neural path
      const p = q(n, d);
      ctx.fillStyle = col(env.hue, 0.10 * fade, 78); ctx.beginPath(); ctx.arc(p.x, p.y, 0.8, 0, TAU); ctx.fill();
    }
    const out = n.phase !== 'resolved';
    for (let i = 0; i < 10; i++) {                                        // moving particles
      const prog = ((t * 0.55 + i / 10) % 1) * grown;
      const p = q(n, out ? prog : grown - prog);
      ctx.fillStyle = col(i % 4 === 0 ? n.accent : env.hue, 0.45 * fade, 82);
      ctx.beginPath(); ctx.arc(p.x, p.y, i % 4 === 0 ? 1.4 : 0.9, 0, TAU); ctx.fill();
    }
    for (const rt of [0.22, 0.44, 0.66, 0.84]) {                          // sequential relay illumination
      let flash = 0;
      for (let i = 0; i < 10; i++) {
        const prog = ((t * 0.55 + i / 10) % 1) * grown;
        flash = Math.max(flash, Math.exp(-Math.pow((prog - rt) * 22, 2)));
      }
      const p = q(n, rt);
      ctx.fillStyle = col(env.hue, (0.12 + 0.5 * flash) * fade, 86);
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, TAU); ctx.fill();
    }
    const pp = (t / 0.9) % 1;                                             // electrical pulse
    if (pp < grown) {
      const p = q(n, out ? pp : grown - pp);
      ctx.fillStyle = col(env.hue, 0.7 * (1 - pp) * fade, 95);
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, TAU); ctx.fill();
    }
  }
}
