import { col, TAU, Env } from './BaseAdapt';
import type { RuntimeNode } from './CognitiveController';
import { PHASE_MS } from './CognitiveState';

/** Dynamic node rendering: DORMANT→MATERIALIZING→ACTIVE→RESOLVED→FADING. */
export function drawNodes(ctx: CanvasRenderingContext2D, nodes: RuntimeNode[], env: Env, t: number): void {
  for (const n of nodes) {
    let I = 1, coreR = 3.2, ringR = 10;
    if (n.phase === 'materializing') { const p = n.phaseT / PHASE_MS.materializing; I = p; coreR = 3 + 8 * (1 - p); ringR = 10 * p; }
    if (n.phase === 'resolved') { const q = n.phaseT / PHASE_MS.resolved; ringR = 10 + 10 * q; I = 1; }
    if (n.phase === 'fading') I = 1 - n.phaseT / PHASE_MS.fading;
    if (I <= 0.01) continue;
    const pulse = n.phase === 'active' ? 1 + 0.08 * Math.sin(t * 3 + n.seed) : 1;
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 20);
    g.addColorStop(0, col(n.accent, 0.3 * I, 70)); g.addColorStop(1, col(n.accent, 0, 60));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, 20, 0, TAU); ctx.fill();
    ctx.fillStyle = col(env.hue, 0.95 * I, 96); ctx.beginPath(); ctx.arc(n.x, n.y, coreR, 0, TAU); ctx.fill();
    ctx.strokeStyle = col(n.accent, 0.5 * I, 78); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, ringR * pulse, 0, TAU); ctx.stroke();
    for (let i = 0; i < 6; i++) {                                         // condensing/orbiting dots
      const a = (i / 6) * TAU + t * 0.6 + n.seed;
      const rr = n.phase === 'materializing' ? 26 * (1 - n.phaseT / PHASE_MS.materializing) + 14 : 15;
      ctx.fillStyle = col(i % 2 ? env.hue : n.accent, 0.4 * I, 80);
      ctx.beginPath(); ctx.arc(n.x + Math.cos(a) * rr, n.y + Math.sin(a) * rr, 1, 0, TAU); ctx.fill();
    }
    if (n.phase === 'active' || n.phase === 'resolved') {
      ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = col(n.accent, 0.4 * I, 80); ctx.fillText(n.label, n.x, n.y + 30);
    }
  }
}
