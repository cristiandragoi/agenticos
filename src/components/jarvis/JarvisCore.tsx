import React, { useEffect, useRef } from 'react';

/* ── J.A.R.V.I.S — HOLOGRAPHIC PRESENCE V3.1 ───────────────────────────
 * Visual-only iteration (human review): the head is the HERO.
 *   - LARGE humanoid head (~1.7x V3 area): cranial dome, temples, cheeks,
 *     jaw, chin, subtle neck + restrained shoulder suggestion — never a
 *     circular mask, never a realistic face
 *   - the INTELLIGENCE lives in the SKULL: bright reasoning core in the
 *     upper brain region, left/right hemisphere networks, branching
 *     pathways, moving signals, depth layers — the visual focal point
 *   - pedestal reduced ~60%: a faint holographic base, never competing
 *     with the head
 *   - agent constellation: idle = subtle points (labels subdued); delegated
 *     = real agent prominent + pink + signal from the neural core;
 *     executing = internal pathways activate
 *   - state colors illuminate INTERNAL neural structures (the membrane
 *     stays a dim holographic shell tinted by state)
 * Canvas 2D only; one rAF loop; bounded particles; reduced-motion static.
 * Runtime state source + color contract UNCHANGED.
 */

export type JarvisCoreState =
  | 'idle' | 'listening' | 'transcribing' | 'thinking'
  | 'speaking' | 'error' | 'offline'
  | 'reasoning' | 'executing' | 'delegated'
  | 'repairing' | 'warning' | 'completed';

interface JarvisCoreProps {
  state: JarvisCoreState;
  /** Real microphone amplitude 0..1 — only reactive while listening. */
  inputLevel?: number;
  /** Real playback amplitude 0..1 — only reactive while speaking. */
  outputLevel?: number;
  reducedMotion?: boolean;
  size?: number;
  testIdPrefix?: string;
  /** REAL delegated agent display name — drives the delegate path. */
  activeAgent?: string | null;
}

/** Semantic color language — one source of truth (unchanged contract). */
export const JARVIS_HEAD_COLORS: Record<JarvisCoreState, { main: string; soft: string; rim: string }> = {
  idle:         { main: '#67e8f9', soft: '#e2f9ff', rim: '#22d3ee' },
  listening:    { main: '#3b82f6', soft: '#93c5fd', rim: '#60a5fa' },
  transcribing: { main: '#22c55e', soft: '#86efac', rim: '#4ade80' },
  thinking:     { main: '#f5b50a', soft: '#fde68a', rim: '#fbbf24' },
  speaking:     { main: '#a855f7', soft: '#d8b4fe', rim: '#c084fc' },
  error:        { main: '#ef4444', soft: '#fca5a5', rim: '#f87171' },
  offline:      { main: '#7f1d1d', soft: '#991b1b', rim: '#b91c1c' },
  reasoning:    { main: '#e0f2fe', soft: '#ffffff', rim: '#7dd3fc' },  // cyan/white
  executing:    { main: '#00d4ff', soft: '#a5f3fc', rim: '#22d3ee' },  // strong cyan
  delegated:    { main: '#ec4899', soft: '#fbcfe8', rim: '#f472b6' },  // pink
  repairing:    { main: '#9333ea', soft: '#c4b5fd', rim: '#a855f7' },  // purple
  warning:      { main: '#f59e0b', soft: '#fde68a', rim: '#fbbf24' },  // yellow
  completed:    { main: '#22c55e', soft: '#bbf7d0', rim: '#4ade80' },  // green
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;

/* ── Real capability/agent constellation (mirror of the capability
 *    registry). JARVIS is the central core (the head itself); the others
 *    are subtle field points that illuminate on activity/delegation. */
const AGENTS = [
  { id: 'JARVIS',     x: 0.00, y: 0.00 },
  { id: 'HERMES',     x: 0.36, y: -0.26 },
  { id: 'CODEX',      x: 0.44, y: 0.10 },
  { id: 'TEAMS',      x: 0.36, y: 0.36 },
  { id: 'RESEARCH',   x: -0.36, y: -0.26 },
  { id: 'MEMORY',     x: -0.44, y: 0.10 },
  { id: 'AUTOMATION', x: -0.36, y: 0.36 },
  { id: 'VISION',     x: -0.15, y: -0.44 },
  { id: 'ORACLE',     x: 0.15, y: -0.44 },
] as const;

const AGENT_EDGES: Array<[string, string]> = [
  ['JARVIS', 'HERMES'], ['JARVIS', 'CODEX'], ['JARVIS', 'RESEARCH'],
  ['JARVIS', 'MEMORY'], ['JARVIS', 'VISION'], ['JARVIS', 'ORACLE'],
  ['JARVIS', 'TEAMS'], ['JARVIS', 'AUTOMATION'],
  ['HERMES', 'CODEX'], ['RESEARCH', 'MEMORY'], ['VISION', 'ORACLE'],
  ['HERMES', 'TEAMS'], ['RESEARCH', 'AUTOMATION'],
];

/** Runtime agent display name → constellation node id. Unknown → null. */
const AGENT_NODE_MAP: Record<string, string> = {
  Hermes: 'HERMES', CodeX: 'CODEX', Research: 'RESEARCH',
  'Agent Teams': 'TEAMS', Memory: 'MEMORY', Vision: 'VISION', Oracle: 'ORACLE',
  Jarvis: 'JARVIS',
};

/* ── Left/right hemisphere micro-networks (INSIDE the cranial volume) ── */
const HEMI_L = [
  { x: -0.40, y: -0.22 }, { x: -0.30, y: -0.38 }, { x: -0.16, y: -0.32 },
  { x: -0.28, y: -0.08 }, { x: -0.12, y: -0.12 }, { x: -0.05, y: -0.28 },
];
const HEMI_R = [
  { x: 0.40, y: -0.22 }, { x: 0.30, y: -0.38 }, { x: 0.16, y: -0.32 },
  { x: 0.28, y: -0.08 }, { x: 0.12, y: -0.12 }, { x: 0.05, y: -0.28 },
];
const HEMI_EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 5], [0, 3], [3, 4], [4, 5], [0, 2], [3, 5],
];
/** Branching dendrites from the brain core to the cranium rim. */
const DENDRITES = [
  { ax: 0.00, ay: -0.52 }, { ax: 0.26, ay: -0.48 }, { ax: -0.26, ay: -0.48 },
  { ax: 0.46, ay: -0.26 }, { ax: -0.46, ay: -0.26 }, { ax: 0.50, ay: 0.04 },
  { ax: -0.50, ay: 0.04 }, { ax: 0.34, ay: 0.40 }, { ax: -0.34, ay: 0.40 },
];

interface Mote { x: number; y: number; r: number; sp: number; ph: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; }
interface Pulse { from: [number, number]; to: [number, number]; c: [number, number, number]; t: number; life: number; }

export function JarvisCore({
  state,
  inputLevel = 0,
  outputLevel = 0,
  reducedMotion = false,
  size = 340,
  testIdPrefix = 'jarvis-orb',
  activeAgent = null,
}: JarvisCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const inputRef = useRef(inputLevel);
  const outputRef = useRef(outputLevel);
  const reducedRef = useRef(reducedMotion);
  const agentRef = useRef(activeAgent);
  stateRef.current = state;
  inputRef.current = inputLevel;
  outputRef.current = outputLevel;
  reducedRef.current = reducedMotion;
  agentRef.current = activeAgent;

  const staticMode = reducedMotion || state === 'offline';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    /* ── Geometry (derived from the actual canvas size S) ── */
    const S = size;
    const cx = S / 2;
    const cy = S * 0.30;                     // head center (cranium top ~1%)
    const W = S * 0.32;                      // half head width (head spans 18-82%)
    const H = S * 0.29;                      // half head height (head spans 1-59%)

    // Brain core position: the intelligence lives in the UPPER cranial region.
    const brainX = cx;
    const brainY = cy - H * 0.28;

    const agentPos = AGENTS.map((a) => ({
      id: a.id,
      x: cx + a.x * S,
      y: cy + a.y * S * 0.42,
      r: S * 0.008,
    }));
    const posOf = (id: string) => { const p = agentPos.find((q) => q.id === id)!; return [p.x, p.y] as [number, number]; };
    const agentEdgeCurve = AGENT_EDGES.map(([ia, ib]) => {
      const [ax, ay] = posOf(ia), [bx, by] = posOf(ib);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ox = -dy / len * W * 0.10, oy = dx / len * W * 0.10;
      return { pair: [ia, ib] as [string, string], a: [ax, ay] as [number, number], b: [bx, by] as [number, number], c: [mx + ox, my + oy] as [number, number] };
    });

    const hemiL = HEMI_L.map((n) => ({ x: brainX + n.x * W, y: brainY + n.y * H }));
    const hemiR = HEMI_R.map((n) => ({ x: brainX + n.x * W, y: brainY + n.y * H }));

    /* Humanoid head: wide cranial dome → temples → cheeks → jaw → chin. */
    function headPath(g: CanvasRenderingContext2D, ox: number, oy: number, sx = 1, sy = 1) {
      g.beginPath();
      g.moveTo(ox, oy - H * 1.0 * sy);
      g.bezierCurveTo(ox + W * 0.42 * sx, oy - H * 1.06 * sy, ox + W * 0.94 * sx, oy - H * 0.90 * sy, ox + W * 0.97 * sx, oy - H * 0.44 * sy);
      g.bezierCurveTo(ox + W * 0.99 * sx, oy - H * 0.24 * sy, ox + W * 0.88 * sx, oy - H * 0.04 * sy, ox + W * 0.79 * sx, oy + H * 0.10 * sy);
      g.bezierCurveTo(ox + W * 0.70 * sx, oy + H * 0.30 * sy, ox + W * 0.60 * sx, oy + H * 0.46 * sy, ox + W * 0.40 * sx, oy + H * 0.62 * sy);
      g.bezierCurveTo(ox + W * 0.22 * sx, oy + H * 0.80 * sy, ox + W * 0.09 * sx, oy + H * 0.92 * sy, ox, oy + H * 0.98 * sy);
      g.bezierCurveTo(ox - W * 0.09 * sx, oy + H * 0.92 * sy, ox - W * 0.22 * sx, oy + H * 0.80 * sy, ox - W * 0.40 * sx, oy + H * 0.62 * sy);
      g.bezierCurveTo(ox - W * 0.60 * sx, oy + H * 0.46 * sy, ox - W * 0.70 * sx, oy + H * 0.30 * sy, ox - W * 0.79 * sx, oy + H * 0.10 * sy);
      g.bezierCurveTo(ox - W * 0.88 * sx, oy - H * 0.04 * sy, ox - W * 0.99 * sx, oy - H * 0.24 * sy, ox - W * 0.97 * sx, oy - H * 0.44 * sy);
      g.bezierCurveTo(ox - W * 0.94 * sx, oy - H * 0.90 * sy, ox - W * 0.42 * sx, oy - H * 1.06 * sy, ox, oy - H * 1.0 * sy);
      g.closePath();
    }

    /* Reduced pedestal: subtle neck + shoulder suggestion only. */
    function bustPath(g: CanvasRenderingContext2D, ox: number, oy: number) {
      g.beginPath();
      g.moveTo(ox - W * 0.14, oy + H * 0.98);
      g.quadraticCurveTo(ox - W * 0.26, oy + H * 1.28, ox - W * 0.44, oy + H * 1.55);
      g.quadraticCurveTo(ox - W * 0.74, oy + H * 1.86, ox - W * 0.62, oy + H * 2.10);
      g.lineTo(ox + W * 0.62, oy + H * 2.10);
      g.quadraticCurveTo(ox + W * 0.74, oy + H * 1.86, ox + W * 0.44, oy + H * 1.55);
      g.quadraticCurveTo(ox + W * 0.26, oy + H * 1.28, ox + W * 0.14, oy + H * 0.98);
      g.closePath();
    }

    let colMain = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].main);
    let colSoft = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].soft);
    let colRim = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].rim);

    const seed = Array.from({ length: 14 }, () => Math.random() * Math.PI * 2);
    const pulses: Pulse[] = [];
    const sparks: Spark[] = [];
    const motes: Mote[] = Array.from({ length: 20 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.5 + Math.random() * 1.1,
      sp: 0.006 + Math.random() * 0.014,
      ph: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let t = 0;
    let last = performance.now();
    let running = true;

    const smooth = (a: number, b: number, k: number) => a + (b - a) * k;

    function drawFrame(dt: number) {
      if (!ctx) return;
      const target = JARVIS_HEAD_COLORS[stateRef.current];
      const k = Math.min(1, dt * 6);
      const tm = hexToRgb(target.main), ts = hexToRgb(target.soft), tr = hexToRgb(target.rim);
      colMain = [smooth(colMain[0], tm[0], k), smooth(colMain[1], tm[1], k), smooth(colMain[2], tm[2], k)] as [number, number, number];
      colSoft = [smooth(colSoft[0], ts[0], k), smooth(colSoft[1], ts[1], k), smooth(colSoft[2], ts[2], k)] as [number, number, number];
      colRim = [smooth(colRim[0], tr[0], k), smooth(colRim[1], tr[1], k), smooth(colRim[2], tr[2], k)] as [number, number, number];

      t += dt;
      const st = stateRef.current;
      const ampIn = st === 'listening' ? Math.min(1, Math.max(0, inputRef.current)) : 0;
      const ampOut = st === 'speaking' ? Math.min(1, Math.max(0, outputRef.current)) : 0;
      const breathe = 1 + Math.sin(t * 1.15) * 0.007;
      const activeAgentId = st === 'delegated' ? (AGENT_NODE_MAP[agentRef.current ?? ''] ?? null) : null;

      ctx.clearRect(0, 0, S, S);

      /* ═══ BACK — soft ambient field (deep, non-radar) ═══ */
      const haloR = W * 2.6 * breathe;
      const halo = ctx.createRadialGradient(cx, cy, W * 0.3, cx, cy, haloR);
      const glowA = st === 'error' ? 0.22 : st === 'offline' ? 0.09 : 0.15;
      halo.addColorStop(0, rgba(colMain, glowA * (1 + ampOut * 0.6)));
      halo.addColorStop(0.5, rgba(colMain, glowA * 0.34));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, S, S);

      // faint wide projection base at the bottom (pedestal, subtle)
      const baseY = S * 0.86;
      const baseGrad = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, W * 1.1);
      baseGrad.addColorStop(0, rgba(colRim, 0.10));
      baseGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = baseGrad;
      ctx.beginPath();
      ctx.ellipse(cx, baseY, W * 1.1, W * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();

      // drifting motes
      const moteA = st === 'reasoning' || st === 'executing' ? 0.30 : st === 'delegated' ? 0.22 : 0.13;
      for (const m of motes) {
        m.x += m.sp * dt * (st === 'reasoning' ? 2.0 : 1);
        m.y += Math.sin(t * 0.5 + m.ph) * 0.0001;
        if (m.x > 1.03) m.x = -0.03;
        const px = cx + (m.x - 0.5) * W * 2.4;
        const py = cy + (m.y - 0.5) * H * 3.0;
        ctx.beginPath();
        ctx.arc(px, py, m.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(colSoft, moteA * (0.5 + 0.5 * Math.sin(t * 1.3 + m.ph)));
        ctx.fill();
      }

      /* ═══ MID — reduced neck/shoulder pedestal ═══ */
      const neckGrad = ctx.createLinearGradient(0, cy + H * 0.9, 0, S * 0.82);
      neckGrad.addColorStop(0, rgba(colRim, 0.10));
      neckGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neckGrad;
      bustPath(ctx, cx, cy);
      ctx.fill();
      // shoulder hint line
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.46, cy + H * 1.58);
      ctx.quadraticCurveTo(cx, cy + H * 1.72, cx + W * 0.46, cy + H * 1.58);
      ctx.strokeStyle = rgba(colRim, 0.07);
      ctx.lineWidth = 1;
      ctx.stroke();

      /* ═══ MID — THE SKULL: brain depth layers + neural architecture ═══ */
      const brainA = st === 'reasoning' || st === 'executing' || st === 'thinking' || st === 'transcribing' ? 0.42 : st === 'repairing' ? 0.30 : st === 'idle' ? 0.18 : 0.26;
      for (let layer = 0; layer < 3; layer++) {
        const wob = 1 + Math.sin(t * 0.8 + layer * 1.9 + seed[layer]) * 0.05;
        const sxs = (0.86 - layer * 0.14) * wob;
        const sys = (0.78 - layer * 0.12) * wob;
        ctx.beginPath();
        ctx.ellipse(brainX, brainY, W * sxs * 0.72, H * sys * 0.62, Math.sin(t * 0.22 + layer) * 0.08, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(layer === 1 ? colSoft : colMain, brainA * (1 - layer * 0.22));
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // BRAIN CORE: the brightest element, in the upper cranial region
      const corePulse = 1 + Math.sin(t * (st === 'reasoning' ? 2.8 : st === 'executing' ? 2.2 : 1.5)) * (st === 'idle' ? 0.05 : 0.15);
      const coreR = W * 0.17 * corePulse;
      const coreGrad = ctx.createRadialGradient(brainX, brainY, 0, brainX, brainY, coreR * 2.4);
      const coreA = st === 'reasoning' ? 0.95 : st === 'executing' ? 0.88 : st === 'delegated' ? 0.7 : st === 'error' ? 0.9 : st === 'listening' ? 0.66 : 0.5 + ampOut * 0.15;
      coreGrad.addColorStop(0, rgba(colSoft, coreA));
      coreGrad.addColorStop(0.30, rgba(colMain, coreA * 0.62));
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(brainX, brainY, coreR * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(brainX, brainY, coreR * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = rgba(colSoft, coreA * 0.6);
      ctx.fill();
      ctx.strokeStyle = rgba(colRim, 0.55 + coreA * 0.4);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      // rotating core rings (brain activity)
      ctx.save();
      ctx.translate(brainX, brainY);
      ctx.rotate(t * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, 0, coreR * 1.05, coreR * 0.48, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(colSoft, 0.5 * coreA);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.rotate(1.4);
      ctx.beginPath();
      ctx.ellipse(0, 0, coreR * 0.85, coreR * 0.40, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(colMain, 0.42 * coreA);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.restore();

      // hemisphere micro-networks (left + right brain)
      const hemiOn = st === 'reasoning' || st === 'executing' || st === 'thinking' || st === 'listening' || st === 'speaking';
      const hemiA = hemiOn ? 0.62 : st === 'delegated' ? 0.45 : 0.26;
      for (const h of [hemiL, hemiR]) {
        for (const [ia, ib] of HEMI_EDGES) {
          const a = h[ia], b = h[ib];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + H * 0.05, b.x, b.y);
          ctx.strokeStyle = rgba(colMain, hemiA * 0.5);
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
      for (const h of [hemiL, hemiR]) {
        for (let i = 0; i < h.length; i++) {
          const n = h[i];
          const pulse = 1 + Math.sin(t * 2.6 + seed[4] + n.x * 6) * 0.35;
          ctx.beginPath();
          ctx.arc(n.x, n.y, 1.5 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = rgba(colSoft, hemiA * (0.7 + 0.3 * Math.sin(t * 2.2 + i)));
          ctx.fill();
        }
      }
      // branching dendrites from the brain core to the cranium rim
      ctx.strokeStyle = rgba(colMain, brainA * 0.6);
      ctx.lineWidth = 1;
      for (const d of DENDRITES) {
        ctx.beginPath();
        ctx.moveTo(brainX + d.ax * 0.05, brainY + d.ay * 0.08);
        ctx.quadraticCurveTo(brainX + d.ax * 0.55, brainY + d.ay * 0.55, brainX + d.ax, brainY + d.ay);
        ctx.stroke();
      }
      // signal pulses along hemisphere edges
      if (st === 'reasoning' || st === 'executing' || st === 'delegated' || st === 'thinking' || st === 'listening' || st === 'speaking') {
        const rate = st === 'reasoning' ? 2.4 : st === 'executing' ? 1.9 : st === 'listening' ? 1.5 : 1.1;
        if (Math.random() < dt * rate && pulses.length < 9) {
          const h = Math.random() < 0.5 ? hemiL : hemiR;
          const [ia, ib] = HEMI_EDGES[Math.floor(Math.random() * HEMI_EDGES.length)];
          pulses.push({ from: [h[ia].x, h[ia].y], to: [h[ib].x, h[ib].y], c: colRim, t: 0, life: 1.6 });
        }
        if (st === 'executing' || st === 'delegated') {
          const [ia, ib] = AGENT_EDGES[Math.floor(Math.random() * AGENT_EDGES.length)];
          const [ax, ay] = posOf(ia), [bx, by] = posOf(ib);
          pulses.push({ from: [ax, ay], to: [bx, by], c: st === 'delegated' ? colMain : colRim, t: 0, life: 2.0 });
        }
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += dt / p.life;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }
        const q = 1 - p.t;
        const px = q * q * p.from[0] + 2 * q * p.t * ((p.from[0] + p.to[0]) / 2) + p.t * p.t * p.to[0];
        const py = q * q * p.from[1] + 2 * q * p.t * ((p.from[1] + p.to[1]) / 2) + p.t * p.t * p.to[1];
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.c, 0.85 * (1 - p.t));
        ctx.fill();
      }

      /* ═══ FRONT — dim holographic head membrane (state-tinted, neutral) ═══ */
      headPath(ctx, cx, cy, breathe, breathe);
      const headGrad = ctx.createRadialGradient(cx - W * 0.2, cy - H * 0.3, W * 0.1, cx, cy, W * 1.25);
      const bodyA = st === 'offline' ? 0.04 : 0.10 + ampOut * 0.04;
      headGrad.addColorStop(0, rgba(colSoft, bodyA * 1.5));
      headGrad.addColorStop(0.55, rgba(colMain, bodyA * 0.8));
      headGrad.addColorStop(1, rgba(colMain, bodyA * 0.26));
      ctx.fillStyle = headGrad;
      ctx.fill();
      ctx.strokeStyle = rgba(colRim, 0.30 + ampIn * 0.14 + ampOut * 0.10);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // inner shell flicker
      ctx.strokeStyle = rgba(colSoft, 0.07 + Math.sin(t * 1.6) * 0.025);
      ctx.lineWidth = 3;
      headPath(ctx, cx, cy, 0.97, 0.97);
      ctx.stroke();

      /* ═══ FRONT — agent constellation: subtle by default, prominent when
       *  active / delegated. Labels hidden or extremely subdued at idle. ═══ */
      const delegatedAgentId = activeAgentId;
      const activeSet = new Set<string>(['JARVIS']);
      if (st === 'listening') { activeSet.add('VISION'); activeSet.add('ORACLE'); }
      if (st === 'reasoning' || st === 'thinking' || st === 'transcribing') { activeSet.add('VISION'); activeSet.add('ORACLE'); activeSet.add('MEMORY'); activeSet.add('AUTOMATION'); }
      if (st === 'executing') { activeSet.add('HERMES'); activeSet.add('CODEX'); activeSet.add('RESEARCH'); activeSet.add('TEAMS'); }
      if (st === 'delegated' && delegatedAgentId) activeSet.add(delegatedAgentId);
      if (st === 'repairing') { activeSet.add('MEMORY'); activeSet.add('VISION'); activeSet.add('TEAMS'); }

      for (const curve of agentEdgeCurve) {
        if (curve.pair[0] === 'JARVIS' || curve.pair[1] === 'JARVIS') continue;
        const aOn = activeSet.has(curve.pair[0]);
        const bOn = activeSet.has(curve.pair[1]);
        const on = (aOn && bOn) || st === 'executing' || st === 'delegated';
        ctx.strokeStyle = rgba(colMain, on ? 0.12 : 0.03);
        ctx.lineWidth = on ? 0.9 : 0.5;
        ctx.beginPath();
        ctx.moveTo(curve.a[0], curve.a[1]);
        ctx.quadraticCurveTo(curve.c[0], curve.c[1], curve.b[0], curve.b[1]);
        ctx.stroke();
      }
      // faint arcs from each agent node toward the head
      ctx.strokeStyle = rgba(colMain, 0.05);
      ctx.lineWidth = 0.6;
      for (const a of agentPos) {
        if (a.id === 'JARVIS') continue;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(cx + (a.x - cx) * 0.5, cy + (a.y - cy) * 0.5);
        ctx.stroke();
      }

      ctx.font = `600 ${Math.max(7, Math.round(S * 0.026))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const a of agentPos) {
        if (a.id === 'JARVIS') continue;
        const isDelegate = a.id === delegatedAgentId;
        const isActive = activeSet.has(a.id);
        if (!isActive && !isDelegate && st === 'idle') {
          // idle: extremely subdued points, no labels
          ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
          ctx.fillStyle = rgba(colMain, 0.22);
          ctx.fill();
          continue;
        }
        const pulse = isActive || isDelegate ? 1 + Math.sin(t * 3 + seed[5]) * 0.22 : 1;
        const r = a.r * (isDelegate ? 5.2 : isActive ? 3.4 : 2.2) * pulse;
        const nodeColor = isDelegate ? colMain : isActive ? colSoft : colMain;
        const ng = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r * 2.2);
        ng.addColorStop(0, rgba(nodeColor, isActive || isDelegate ? 0.95 : 0.35));
        ng.addColorStop(0.4, rgba(nodeColor, isActive || isDelegate ? 0.4 : 0.1));
        ng.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ng;
        ctx.beginPath(); ctx.arc(a.x, a.y, r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(a.x, a.y, r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = rgba(nodeColor, isActive || isDelegate ? 1 : 0.45);
        ctx.fill();
        if (isDelegate) {
          ctx.beginPath(); ctx.arc(a.x, a.y, r * 1.6, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(colMain, 0.65 + Math.sin(t * 4) * 0.3);
          ctx.lineWidth = 1.5; ctx.stroke();
        }
        // label: active/delegated prominent, otherwise subdued
        ctx.fillStyle = rgba(colSoft, isDelegate ? 1 : isActive ? 0.75 : 0.3);
        ctx.fillText(a.id, a.x, a.y + r * 3.0);
      }

      // delegate beam: brain core → real delegated agent (pink, traveling)
      if (delegatedAgentId && delegatedAgentId !== 'JARVIS') {
        const [bx, by] = [brainX, brainY];
        const [ax2, ay2] = posOf(delegatedAgentId);
        ctx.save();
        ctx.setLineDash([5, 8]);
        ctx.lineDashOffset = -t * 30;
        ctx.strokeStyle = rgba(colMain, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo((bx + ax2) / 2 + (ax2 - bx) * 0.10, (by + ay2) / 2 - H * 0.30, ax2, ay2);
        ctx.stroke();
        ctx.restore();
        const pr = (t * 0.45) % 1;
        const qx = bx + (ax2 - bx) * pr;
        const qy = by + (ay2 - by) * pr;
        ctx.beginPath(); ctx.arc(qx, qy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = rgba(colSoft, 0.9);
        ctx.fill();
      }

      /* ═══ FRONT — restrained facial geometry ═══ */
      const eyeY = cy + H * 0.16;
      const eyeGlow = st === 'listening' ? 0.9 + ampIn * 0.1 : st === 'error' ? 0.85 : st === 'reasoning' ? 0.6 : 0.42;
      const eyeCol = st === 'listening' ? [59, 130, 246] as [number, number, number]
        : st === 'error' ? [239, 68, 68] as [number, number, number]
        : st === 'delegated' ? colMain : colSoft;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 0.34;
        const eg = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, W * 0.10);
        eg.addColorStop(0, rgba(eyeCol, eyeGlow * 0.8));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.ellipse(ex, eyeY, W * 0.085, H * 0.035, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.rotate(side * 0.12);
        ctx.beginPath();
        ctx.moveTo(-W * 0.075, 0);
        ctx.quadraticCurveTo(0, -H * 0.02 * (0.5 + eyeGlow), W * 0.075, 0);
        ctx.strokeStyle = rgba(colSoft, 0.5 + eyeGlow * 0.4);
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
      }
      // brow / temple contours
      ctx.strokeStyle = rgba(colMain, 0.15 + (st === 'reasoning' ? 0.10 : 0));
      ctx.lineWidth = 0.9;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * W * 0.16, cy - H * 0.02);
        ctx.quadraticCurveTo(cx + side * W * 0.32, cy - H * 0.08, cx + side * W * 0.44, cy - H * 0.02);
        ctx.stroke();
      }
      // nasal bridge (thin, restrained)
      ctx.strokeStyle = rgba(colMain, 0.10);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(cx, cy + H * 0.06);
      ctx.lineTo(cx, cy + H * 0.42);
      ctx.stroke();
      // jaw / chin contour
      ctx.strokeStyle = rgba(colMain, 0.08);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.30, cy + H * 0.78);
      ctx.quadraticCurveTo(cx, cy + H * 0.92, cx + W * 0.30, cy + H * 0.78);
      ctx.stroke();
      // ear hints (audio regions)
      const earGlow = st === 'listening' ? 0.55 + ampIn * 0.35 : st === 'speaking' ? 0.22 : 0.06;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 0.97;
        const ey = cy + H * 0.05;
        const eg = ctx.createRadialGradient(ex, ey, 1, ex, ey, W * 0.10);
        eg.addColorStop(0, rgba(st === 'listening' ? [59, 130, 246] : colMain, earGlow));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(ex, ey, W * 0.10, 0, Math.PI * 2); ctx.fill();
      }

      /* ═══ ACCENT — mouth (small, subtle; output field when speaking) ═══ */
      const mouthY = cy + H * 0.70;
      const mouthOpen = st === 'speaking' ? 0.26 + ampOut * 0.4 : st === 'listening' ? 0.05 : 0.015;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, W * 0.11, H * 0.02 + mouthOpen * H * 0.06, 0, 0, Math.PI);
      ctx.strokeStyle = rgba(st === 'speaking' ? colRim : colSoft, st === 'speaking' ? 0.8 + ampOut * 0.2 : 0.22);
      ctx.lineWidth = st === 'speaking' ? 1.6 + ampOut * 1.2 : 0.9;
      ctx.stroke();
      if (st === 'speaking') {
        for (let i = -3; i <= 3; i++) {
          const wx = cx + i * W * 0.05;
          const wy = mouthY + H * 0.09 + Math.sin(t * 9 + i * 0.7) * H * 0.02 * (0.3 + ampOut);
          ctx.beginPath(); ctx.arc(wx, wy, 1.0, 0, Math.PI * 2);
          ctx.fillStyle = rgba(colRim, 0.55 + ampOut * 0.45);
          ctx.fill();
        }
        ctx.strokeStyle = rgba(colMain, 0.24 + ampOut * 0.26);
        ctx.lineWidth = 1;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + side * W * 0.10, mouthY + H * 0.07);
          ctx.quadraticCurveTo(cx + side * W * 0.18, mouthY + H * 0.16, cx + side * W * 0.24, mouthY + H * 0.22);
          ctx.stroke();
        }
      }

      /* ═══ ACCENT — listening inward signals (blue) ═══ */
      if (st === 'listening') {
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * Math.PI * 2 + t * 0.6;
          const ix = cx + Math.cos(ang) * W * 1.7;
          const iy = cy + Math.sin(ang) * H * 1.7;
          const px = cx + Math.cos(ang + Math.PI) * W * 1.25;
          const py = cy + Math.sin(ang + Math.PI) * H * 1.25;
          const pr = 0.5 + ((t * 0.7 + i * 0.33) % 1);
          const qx = ix + (px - ix) * pr;
          const qy = iy + (py - iy) * pr;
          ctx.beginPath(); ctx.arc(qx, qy, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = rgba([59, 130, 246], 0.75 * (1 - pr * 0.4));
          ctx.fill();
        }
        ctx.strokeStyle = rgba([59, 130, 246], 0.15);
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * Math.PI * 2 + t * 0.5;
          const ix = cx + Math.cos(ang) * W * 1.55;
          const iy = cy + Math.sin(ang) * H * 1.55;
          const ex = cx + Math.cos(ang + Math.PI) * W * 1.1;
          const ey = cy + Math.sin(ang + Math.PI) * H * 1.1;
          ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ex, ey); ctx.stroke();
        }
      }

      /* ═══ ACCENT — cranial sparks (neural computation) ═══ */
      if (st === 'reasoning' || st === 'executing' || st === 'thinking') {
        if (Math.random() < dt * (st === 'reasoning' ? 30 : 14) && sparks.length < 36) {
          const nx = brainX + (Math.random() - 0.5) * W * 1.5;
          const ny = brainY - H * 0.4 + Math.random() * H * 1.0;
          sparks.push({ x: nx, y: ny, vx: (Math.random() - 0.5) * 22, vy: -5 - Math.random() * 16, life: 1 });
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt * 1.6;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.0, 0, Math.PI * 2);
        ctx.fillStyle = rgba(colSoft, Math.min(1, s.life) * 0.9);
        ctx.fill();
      }

      /* ═══ ACCENT — state overlays (internal illumination focus) ═══ */
      if (st === 'repairing') {
        for (let i = 0; i < 4; i++) {
          const ang = t * 0.8 + (i * Math.PI) / 2;
          const r1 = W * 0.26 + Math.sin(t * 2 + i) * W * 0.05;
          ctx.beginPath();
          ctx.moveTo(brainX + Math.cos(ang) * r1, brainY + Math.sin(ang) * r1 * 0.7);
          ctx.lineTo(brainX + Math.cos(ang + 0.6) * r1 * 0.6, brainY + Math.sin(ang + 0.6) * r1 * 0.5);
          ctx.strokeStyle = rgba(colMain, 0.4 + 0.25 * Math.abs(Math.sin(t * 2 + i)));
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      }
      if (st === 'warning') {
        const pulseR = W * 0.85 + Math.sin(t * 1.4) * W * 0.04;
        ctx.beginPath(); ctx.arc(brainX, brainY, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([245, 158, 11], 0.3);
        ctx.lineWidth = 1.5; ctx.stroke();
        const [mx, my] = posOf('MEMORY');
        ctx.beginPath();
        ctx.moveTo(mx - W * 0.04, my - H * 0.05);
        ctx.lineTo(mx + W * 0.04, my - H * 0.05);
        ctx.lineTo(mx, my - H * 0.015);
        ctx.closePath();
        ctx.fillStyle = rgba([245, 158, 11], 0.7);
        ctx.fill();
      }
      if (st === 'completed') {
        const pulseR = W * 0.72 + Math.sin(t * 3) * W * 0.12;
        ctx.beginPath(); ctx.arc(brainX, brainY, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([34, 197, 94], 0.4);
        ctx.lineWidth = 2.2; ctx.stroke();
        ctx.beginPath(); ctx.arc(brainX, brainY, pulseR * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([34, 197, 94], 0.16);
        ctx.lineWidth = 1.1; ctx.stroke();
      }
      if (st === 'error') {
        const pulseR = W * 0.85 + Math.sin(t * 2.2) * W * 0.06;
        ctx.beginPath(); ctx.arc(brainX, brainY, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([239, 68, 68], 0.35);
        ctx.lineWidth = 2; ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const ang = seed[6 + i] + t * 1.4;
          const ex = brainX + Math.cos(ang) * W * 1.2;
          const ey = brainY + Math.sin(ang) * H * 1.2;
          ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(brainX + Math.cos(ang) * W * 0.5, brainY + Math.sin(ang) * H * 0.5);
          ctx.strokeStyle = rgba([239, 68, 68], 0.3);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    function loop(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      drawFrame(dt);
      raf = requestAnimationFrame(loop);
    }

    if (reducedRef.current) {
      drawFrame(0.016);
    } else {
      drawFrame(0.016);
      raf = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [size, staticMode]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={testIdPrefix}
      data-orb-state={state}
      data-active-agent={activeAgent ?? ''}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      style={{ width: size, height: size, display: 'block' }}
      aria-hidden="true"
    />
  );
}

export default JarvisCore;
