import React, { useEffect, useRef } from 'react';

/* ── J.A.R.V.I.S — HOLOGRAPHIC HUMANoid AI PRESENCE ─────────────────────
 * Canvas 2D (no Three.js/WebGL — performance contract): a semi-transparent
 * holographic head/bust whose INTERNAL SYSTEM is the subject:
 *   - layered depth contours (cortex folds) inside the cranium
 *   - a luminous core (the "heart" of Jarvis) with breathing illumination
 *   - a cranial neural web: real capability nodes + flowing signal paths
 *   - subtle technological facial geometry (angled eye slits, brow arcs,
 *     nasal bridge, lower-face mouth energy) — never a cartoon face
 *   - drifting motes + cranial sparks (bounded, recycled — no particle storm)
 *   - state-driven color/motion from REAL runtime signals only
 *
 * One rAF loop, cached geometry per size, paused when unmounted; reduced
 * motion renders a single static frame. Never decorative: every color and
 * motion maps to real AgenticOS runtime state.
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
  /** REAL delegated agent display name (e.g. "Hermes") — drives the
   *  delegate path. Null/unknown → no fake delegation is drawn. */
  activeAgent?: string | null;
}

/** Semantic color language (spec §10) — one source of truth. */
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

/* ── Real capability nodes (mirror the capability registry: jarvis, hermes,
 *    codex, research, agent_teams, memory, automations + vision/oracle) ── */
const NODES = [
  { id: 'JARVIS',     x: 0.50, y: 0.46, r: 0.050 },  // central intelligence
  { id: 'HERMES',     x: 0.70, y: 0.28, r: 0.030 },
  { id: 'CODEX',      x: 0.76, y: 0.52, r: 0.030 },
  { id: 'RESEARCH',   x: 0.30, y: 0.28, r: 0.030 },
  { id: 'MEMORY',     x: 0.24, y: 0.52, r: 0.030 },
  { id: 'VISION',     x: 0.42, y: 0.18, r: 0.024 },
  { id: 'ORACLE',     x: 0.58, y: 0.18, r: 0.024 },
  { id: 'TEAMS',      x: 0.82, y: 0.34, r: 0.024 },
  { id: 'AUTOMATION', x: 0.18, y: 0.34, r: 0.024 },
] as const;

const EDGES: Array<[string, string]> = [
  ['JARVIS', 'HERMES'], ['JARVIS', 'CODEX'], ['JARVIS', 'RESEARCH'],
  ['JARVIS', 'MEMORY'], ['JARVIS', 'VISION'], ['JARVIS', 'ORACLE'],
  ['JARVIS', 'TEAMS'], ['JARVIS', 'AUTOMATION'],
  ['HERMES', 'CODEX'], ['RESEARCH', 'MEMORY'], ['VISION', 'ORACLE'],
  ['HERMES', 'TEAMS'], ['RESEARCH', 'AUTOMATION'],
];

/** Runtime agent display name → node id. Unknown → null (no fake delegation). */
const AGENT_NODE_MAP: Record<string, string> = {
  Hermes: 'HERMES', CodeX: 'CODEX', Research: 'RESEARCH',
  'Agent Teams': 'TEAMS', Memory: 'MEMORY', Vision: 'VISION', Oracle: 'ORACLE',
  Jarvis: 'JARVIS',
};

function nodeById(id: string) { return NODES.find((n) => n.id === id)!; }

interface Mote { x: number; y: number; r: number; sp: number; ph: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; }

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

    /* ── Cached geometry (computed once per size) ── */
    const cx = size / 2;
    const cy = size * 0.45;              // head center slightly above mid
    const headW = size * 0.60;
    const headH = size * 0.74;
    const W = headW / 2;
    const H = headH / 2;

    const nodeXY = (n: typeof NODES[number]): [number, number] => [
      cx + (n.x - 0.5) * W * 2.05,
      cy + (n.y - 0.5) * H * 1.95,
    ];
    const nodePos = NODES.map((n) => ({ id: n.id, x: nodeXY(n)[0], y: nodeXY(n)[1], r: n.r * W * 2.3 }));
    const posOf = (id: string) => { const p = nodePos.find((q) => q.id === id)!; return [p.x, p.y] as [number, number]; };
    // Edge control points: slight outward bulge for organic curves.
    const edgeCurve = EDGES.map(([ia, ib]) => {
      const [ax, ay] = posOf(ia), [bx, by] = posOf(ib);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ox = -dy / len * W * 0.12, oy = dx / len * W * 0.12;
      return { pair: [ia, ib] as [string, string], a: [ax, ay] as [number, number], b: [bx, by] as [number, number], c: [mx + ox, my + oy] as [number, number] };
    });

    // Humanoid silhouette: cranium dome → temples → cheeks → jaw → chin.
    function headPath(g: CanvasRenderingContext2D, ox: number, oy: number, sx: number, sy: number) {
      g.beginPath();
      g.moveTo(ox, oy - H * 1.0 * sy);
      g.bezierCurveTo(ox + W * 0.85 * sx, oy - H * 1.08 * sy, ox + W * 1.14 * sx, oy - H * 0.38 * sy, ox + W * 1.04 * sx, oy + H * 0.26 * sy);
      g.bezierCurveTo(ox + W * 0.97 * sx, oy + H * 0.60 * sy, ox + W * 0.58 * sx, oy + H * 0.94 * sy, ox, oy + H * 1.0 * sy);
      g.bezierCurveTo(ox - W * 0.58 * sx, oy + H * 0.94 * sy, ox - W * 0.97 * sx, oy + H * 0.60 * sy, ox - W * 1.04 * sx, oy + H * 0.26 * sy);
      g.bezierCurveTo(ox - W * 1.14 * sx, oy - H * 0.38 * sy, ox - W * 0.85 * sx, oy - H * 1.08 * sy, ox, oy - H * 1.0 * sy);
      g.closePath();
    }
    // Bust / shoulders pedestal.
    function bustPath(g: CanvasRenderingContext2D, ox: number, oy: number) {
      g.beginPath();
      g.moveTo(ox - W * 0.30, oy + H * 0.86);
      g.bezierCurveTo(ox - W * 0.46, oy + H * 1.10, ox - W * 0.60, oy + H * 1.22, ox - W * 0.86, oy + H * 1.42);
      g.lineTo(ox + W * 0.86, oy + H * 1.42);
      g.bezierCurveTo(ox + W * 0.60, oy + H * 1.22, ox + W * 0.46, oy + H * 1.10, ox + W * 0.30, oy + H * 0.86);
      g.closePath();
    }

    let colMain = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].main);
    let colSoft = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].soft);
    let colRim = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].rim);

    const seed = Array.from({ length: 12 }, () => Math.random() * Math.PI * 2);
    const pulses: { edge: [string, string]; t: number }[] = [];

    // Bounded particles — never a particle storm.
    const motes: Mote[] = Array.from({ length: 26 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.5 + Math.random() * 1.1,
      sp: 0.008 + Math.random() * 0.02,
      ph: Math.random() * Math.PI * 2,
    }));
    const sparks: Spark[] = [];

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
      const breathe = 1 + Math.sin(t * 1.15) * 0.014;

      ctx.clearRect(0, 0, size, size);

      /* ── LAYER 1: ambient holographic field ── */
      const haloR = W * 1.95 * breathe;
      const halo = ctx.createRadialGradient(cx, cy, W * 0.2, cx, cy, haloR);
      const glowA = st === 'error' ? 0.24 : st === 'offline' ? 0.10 : 0.16;
      halo.addColorStop(0, rgba(colMain, glowA * (1 + ampOut * 0.7)));
      halo.addColorStop(0.5, rgba(colMain, glowA * 0.4));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      /* ── LAYER 2: drifting motes (quiet ambient data) ── */
      const moteA = st === 'reasoning' || st === 'executing' ? 0.30 : st === 'delegated' ? 0.22 : 0.14;
      for (const m of motes) {
        m.x += m.sp * dt * (st === 'reasoning' ? 2.2 : 1);
        m.y += Math.sin(t * 0.6 + m.ph) * 0.00012;
        if (m.x > 1.02) m.x = -0.02;
        const px = cx + (m.x - 0.5) * W * 2.6;
        const py = cy + (m.y - 0.5) * H * 2.9;
        ctx.beginPath();
        ctx.arc(px, py, m.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(colSoft, moteA * (0.5 + 0.5 * Math.sin(t * 1.4 + m.ph)));
        ctx.fill();
      }

      /* ── LAYER 3: bust / shoulders pedestal ── */
      const neckGrad = ctx.createLinearGradient(0, cy + H * 0.8, 0, size);
      neckGrad.addColorStop(0, rgba(colRim, 0.14));
      neckGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neckGrad;
      bustPath(ctx, cx, cy);
      ctx.fill();

      /* ── LAYER 4: head membrane (semi-transparent holographic shell) ── */
      headPath(ctx, cx, cy, 1, 1);
      const headGrad = ctx.createRadialGradient(cx - W * 0.2, cy - H * 0.3, W * 0.1, cx, cy, W * 1.15);
      const bodyA = st === 'offline' ? 0.05 : 0.11 + ampOut * 0.05;
      headGrad.addColorStop(0, rgba(colSoft, bodyA * 1.7));
      headGrad.addColorStop(0.55, rgba(colMain, bodyA * 0.85));
      headGrad.addColorStop(1, rgba(colMain, bodyA * 0.28));
      ctx.fillStyle = headGrad;
      ctx.fill();
      ctx.strokeStyle = rgba(colRim, 0.32 + ampIn * 0.16 + ampOut * 0.12);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // inner glow flicker
      ctx.strokeStyle = rgba(colSoft, 0.08 + Math.sin(t * 1.6) * 0.03);
      ctx.lineWidth = 3;
      headPath(ctx, cx, cy, 0.97, 0.97);
      ctx.stroke();

      /* ── LAYER 5: layered cortical contours (depth) ── */
      const cortexActive = st === 'reasoning' || st === 'executing' || st === 'thinking' || st === 'transcribing';
      const cortexA = cortexActive ? 0.34 : st === 'repairing' ? 0.22 : 0.13;
      for (let layer = 0; layer < 3; layer++) {
        const wob = 1 + Math.sin(t * 0.9 + layer * 1.7 + seed[layer]) * 0.05;
        const sx = (0.78 - layer * 0.13) * wob;
        const sy = (0.80 - layer * 0.12) * wob;
        ctx.beginPath();
        ctx.ellipse(cx, cy - H * 0.08, W * sx, H * sy, Math.sin(t * 0.25 + layer) * 0.10, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(layer === 1 ? colSoft : colMain, cortexA * (1 - layer * 0.22));
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      // cranial midline
      ctx.strokeStyle = rgba(colSoft, cortexA * 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - H * 0.92);
      ctx.quadraticCurveTo(cx + W * 0.05, cy, cx, cy + H * 0.86);
      ctx.stroke();

      /* ── LAYER 6: internal core illumination (the heart of Jarvis) ── */
      const corePulse = 1 + Math.sin(t * (st === 'reasoning' ? 2.6 : 1.6)) * (st === 'idle' ? 0.05 : 0.14);
      const coreR = W * 0.20 * corePulse;
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
      const coreA = st === 'reasoning' ? 0.85 : st === 'executing' ? 0.75 : st === 'delegated' ? 0.5 : st === 'error' ? 0.8 : 0.38 + ampOut * 0.2;
      core.addColorStop(0, rgba(colSoft, coreA));
      core.addColorStop(0.35, rgba(colMain, coreA * 0.55));
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 2.4, 0, Math.PI * 2);
      ctx.fill();
      // core shell
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(colRim, 0.5 + coreA * 0.4);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      /* ── LAYER 7: cranial neural web (edges + pulses + nodes) ── */
      const activeNodes = (): Set<string> => {
        const s = new Set<string>(['JARVIS']);
        if (st === 'listening') { s.add('VISION'); s.add('ORACLE'); }
        if (st === 'reasoning' || st === 'thinking' || st === 'transcribing') { s.add('VISION'); s.add('ORACLE'); s.add('MEMORY'); s.add('AUTOMATION'); }
        if (st === 'executing') { s.add('HERMES'); s.add('CODEX'); s.add('RESEARCH'); s.add('TEAMS'); }
        if (st === 'delegated') {
          const agentId = AGENT_NODE_MAP[agentRef.current ?? ''] ?? null;
          if (agentId && agentId !== 'JARVIS') s.add(agentId);
        }
        if (st === 'repairing') { s.add('MEMORY'); s.add('VISION'); s.add('TEAMS'); }
        if (st === 'warning') { s.add('MEMORY'); s.add('AUTOMATION'); }
        return s;
      };
      const active = activeNodes();

      // flowing signal pulses along edges (executing/delegated/reasoning/repairing)
      if (st === 'executing' || st === 'delegated' || st === 'reasoning' || st === 'repairing' || st === 'speaking') {
        const rate = st === 'executing' ? 1.7 : st === 'reasoning' ? 1.2 : st === 'speaking' ? 1.0 : 0.9;
        const life = st === 'delegated' ? 3.0 : 2.2;
        if (Math.random() < dt * rate && pulses.length < 10) {
          const edge = EDGES[Math.floor(Math.random() * EDGES.length)];
          pulses.push({ edge, t: 0 });
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.t += dt / life;
          if (p.t >= 1) { pulses.splice(i, 1); continue; }
          const curve = edgeCurve.find((c) => (c.a[0] === posOf(p.edge[0])[0] && c.a[1] === posOf(p.edge[0])[1]))!;
          const q = 1 - p.t;
          const px = q * q * curve.a[0] + 2 * q * p.t * curve.c[0] + p.t * p.t * curve.b[0];
          const py = q * q * curve.a[1] + 2 * q * p.t * curve.c[1] + p.t * p.t * curve.b[1];
          const pulseColor = st === 'delegated' ? colMain : st === 'repairing' ? colMain : colRim;
          ctx.beginPath(); ctx.arc(px, py, 1.7, 0, Math.PI * 2);
          ctx.fillStyle = rgba(pulseColor, 0.8 * (1 - p.t));
          ctx.fill();
        }
      }

      // delegate beam: JARVIS → real delegated agent (only when one exists)
      const delegatedAgentId = st === 'delegated' ? (AGENT_NODE_MAP[agentRef.current ?? ''] ?? null) : null;
      if (delegatedAgentId && delegatedAgentId !== 'JARVIS') {
        const [jx, jy] = posOf('JARVIS');
        const [ax2, ay2] = posOf(delegatedAgentId);
        ctx.save();
        ctx.setLineDash([4, 7]);
        ctx.lineDashOffset = -t * 26;
        ctx.strokeStyle = rgba(colMain, 0.7);
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(jx, jy);
        ctx.quadraticCurveTo((jx + ax2) / 2 + (ax2 - jx) * 0.1, (jy + ay2) / 2 - H * 0.16, ax2, ay2);
        ctx.stroke();
        ctx.restore();
      }

      // repair arcs: reconnecting structures (purple)
      if (st === 'repairing') {
        for (let i = 0; i < 3; i++) {
          const n1 = NODES[(i * 2) % NODES.length], n2 = NODES[(i * 2 + 3) % NODES.length];
          const [p1x, p1y] = posOf(n1.id), [p2x, p2y] = posOf(n2.id);
          const mid = 0.5 + Math.sin(t * 2 + i) * 0.3;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.quadraticCurveTo((p1x + p2x) / 2, (p1y + p2y) / 2 + H * 0.24 * Math.sin(t * 1.6 + i), p2x, p2y);
          ctx.strokeStyle = rgba(colMain, 0.35 + 0.2 * Math.abs(Math.sin(t * 2 + i)));
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p1x + (p2x - p1x) * mid, p1y + (p2y - p1y) * mid + H * 0.24 * Math.sin(t * 1.6 + i) * (1 - Math.abs(0.5 - mid) * 2), 1.5, 0, Math.PI * 2);
          ctx.fillStyle = rgba(colSoft, 0.8);
          ctx.fill();
        }
      }

      // edges (drawn under nodes)
      for (const curve of edgeCurve) {
        const aOn = active.has(curve.pair[0]);
        const bOn = active.has(curve.pair[1]);
        const edgeOn = (aOn && bOn) || st === 'executing' || st === 'delegated';
        const alpha = edgeOn ? 0.20 + Math.sin(t * 2 + seed[0]) * 0.07 : 0.05;
        ctx.strokeStyle = rgba(colMain, alpha);
        ctx.lineWidth = edgeOn ? 1.2 : 0.6;
        ctx.beginPath();
        ctx.moveTo(curve.a[0], curve.a[1]);
        ctx.quadraticCurveTo(curve.c[0], curve.c[1], curve.b[0], curve.b[1]);
        ctx.stroke();
      }

      // nodes
      for (const n of nodePos) {
        const isActive = active.has(n.id);
        const isDelegate = n.id === delegatedAgentId;
        const pulse = isActive ? 1 + Math.sin(t * 3 + seed[1] + n.x * 5) * 0.25 : 1;
        const r = n.r * pulse;
        const nodeColor = isDelegate ? colMain : isActive ? colSoft : colMain;
        const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 2.2);
        ng.addColorStop(0, rgba(nodeColor, isActive || isDelegate ? 0.95 : 0.4));
        ng.addColorStop(0.4, rgba(nodeColor, isActive || isDelegate ? 0.4 : 0.12));
        ng.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ng;
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = rgba(nodeColor, isActive || isDelegate ? 1 : 0.55);
        ctx.fill();
        if (isDelegate) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 1.6, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(colMain, 0.6 + Math.sin(t * 4) * 0.3);
          ctx.lineWidth = 1.4; ctx.stroke();
        }
      }

      /* ── LAYER 8: cranial sparks (neural computation) ── */
      if (st === 'reasoning' || st === 'executing' || st === 'thinking') {
        if (Math.random() < dt * (st === 'reasoning' ? 34 : 16) && sparks.length < 42) {
          const nx = cx + (Math.random() - 0.5) * W * 1.5;
          const ny = cy - H * 0.4 + Math.random() * H * 1.05;
          sparks.push({ x: nx, y: ny, vx: (Math.random() - 0.5) * 26, vy: -6 - Math.random() * 20, life: 1 });
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

      /* ── LAYER 9: subtle technological facial geometry ── */
      const eyeY = cy - H * 0.16;
      const eyeGlow = st === 'listening' ? 0.85 + ampIn * 0.15 : st === 'error' ? 0.9 : 0.4 + (st === 'reasoning' ? 0.3 : 0);
      const eyeCol = st === 'listening' ? [59, 130, 246] as [number, number, number]
        : st === 'error' ? [239, 68, 68] as [number, number, number]
        : st === 'delegated' ? colMain : colSoft;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 0.34;
        const eg = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, W * 0.15);
        eg.addColorStop(0, rgba(eyeCol, eyeGlow));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.ellipse(ex, eyeY, W * 0.13, H * 0.05, 0, 0, Math.PI * 2); ctx.fill();
        // angled luminous slit (technological, not cartoon)
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.rotate(side * 0.16);
        ctx.beginPath();
        ctx.moveTo(-W * 0.115, 0);
        ctx.quadraticCurveTo(0, -H * 0.028 * (0.5 + eyeGlow), W * 0.115, 0);
        ctx.strokeStyle = rgba(colSoft, 0.55 + eyeGlow * 0.45);
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.restore();
      }
      // brow arcs
      ctx.strokeStyle = rgba(colMain, 0.16 + (st === 'reasoning' ? 0.12 : 0));
      ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * W * 0.22, cy - H * 0.28);
        ctx.quadraticCurveTo(cx + side * W * 0.36, cy - H * 0.33, cx + side * W * 0.46, cy - H * 0.27);
        ctx.stroke();
      }
      // nasal bridge
      ctx.strokeStyle = rgba(colMain, 0.10);
      ctx.beginPath();
      ctx.moveTo(cx, cy - H * 0.20);
      ctx.lineTo(cx, cy + H * 0.10);
      ctx.stroke();
      // ear hints (audio regions)
      const earGlow = st === 'listening' ? 0.55 + ampIn * 0.45 : st === 'speaking' ? 0.22 : 0.06;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 1.05;
        const ey = cy + H * 0.03;
        const eg = ctx.createRadialGradient(ex, ey, 1, ex, ey, W * 0.15);
        eg.addColorStop(0, rgba(st === 'listening' ? [59, 130, 246] : colMain, earGlow));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(ex, ey, W * 0.15, 0, Math.PI * 2); ctx.fill();
      }

      /* ── LAYER 10: mouth / lower-face energy (speaking) ── */
      const mouthY = cy + H * 0.40;
      const mouthOpen = st === 'speaking' ? 0.34 + ampOut * 0.55 : st === 'listening' ? 0.08 : 0.02;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, W * 0.22, H * 0.03 + mouthOpen * H * 0.11, 0, 0, Math.PI);
      ctx.strokeStyle = rgba(st === 'speaking' ? colRim : colSoft, st === 'speaking' ? 0.75 + ampOut * 0.25 : 0.3);
      ctx.lineWidth = st === 'speaking' ? 1.8 + ampOut * 1.6 : 1;
      ctx.stroke();
      // speech waveform dots + lower-face arcs
      if (st === 'speaking') {
        for (let i = -3; i <= 3; i++) {
          const wx = cx + i * W * 0.085;
          const wy = mouthY + H * 0.15 + Math.sin(t * 9 + i * 0.7) * H * 0.035 * (0.3 + ampOut);
          ctx.beginPath(); ctx.arc(wx, wy, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = rgba(colRim, 0.55 + ampOut * 0.45);
          ctx.fill();
        }
        // lower-face energy arcs (visibly different from repairing purple)
        ctx.strokeStyle = rgba(colMain, 0.28 + ampOut * 0.3);
        ctx.lineWidth = 1.1;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + side * W * 0.20, mouthY + H * 0.10);
          ctx.quadraticCurveTo(cx + side * W * 0.34, mouthY + H * 0.22, cx + side * W * 0.42, mouthY + H * 0.30);
          ctx.stroke();
        }
      }

      /* ── LAYER 11: listening incoming signal arcs ── */
      if (st === 'listening') {
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI * 2 + t * 0.6;
          const ix = cx + Math.cos(ang) * W * 1.7;
          const iy = cy + Math.sin(ang) * H * 1.7;
          const px = cx + Math.cos(ang + Math.PI) * W * 1.25;
          const py = cy + Math.sin(ang + Math.PI) * H * 1.25;
          const pr = 0.5 + ((t * 0.7 + i * 0.33) % 1);
          const qx = ix + (px - ix) * pr;
          const qy = iy + (py - iy) * pr;
          ctx.beginPath(); ctx.arc(qx, qy, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = rgba([59, 130, 246], 0.7 * (1 - pr * 0.4));
          ctx.fill();
        }
        ctx.strokeStyle = rgba([59, 130, 246], 0.16);
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          const ang = (i / 3) * Math.PI * 2 + t * 0.5;
          const ix = cx + Math.cos(ang) * W * 1.55;
          const iy = cy + Math.sin(ang) * H * 1.55;
          const ex = cx + Math.cos(ang + Math.PI) * W * 1.1;
          const ey = cy + Math.sin(ang + Math.PI) * H * 1.1;
          ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ex, ey); ctx.stroke();
        }
      }

      /* ── LAYER 12: state overlays ── */
      if (st === 'error') {
        const pulseR = W * (0.9 + Math.sin(t * 2.2) * 0.08);
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([239, 68, 68], 0.35);
        ctx.lineWidth = 2; ctx.stroke();
      }
      if (st === 'warning') {
        const pulseR = W * (0.96 + Math.sin(t * 1.4) * 0.05);
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([245, 158, 11], 0.30);
        ctx.lineWidth = 1.5; ctx.stroke();
        // attention chevron near memory region (subsystem attention, not catastrophe)
        const [mx, my] = posOf('MEMORY');
        ctx.beginPath();
        ctx.moveTo(mx - W * 0.05, my - H * 0.06);
        ctx.lineTo(mx + W * 0.05, my - H * 0.06);
        ctx.lineTo(mx, my - H * 0.02);
        ctx.closePath();
        ctx.fillStyle = rgba([245, 158, 11], 0.7);
        ctx.fill();
      }
      if (st === 'completed') {
        const pulseR = W * (0.78 + Math.sin(t * 3) * 0.15);
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([34, 197, 94], 0.4);
        ctx.lineWidth = 2.4; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, pulseR * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([34, 197, 94], 0.18);
        ctx.lineWidth = 1.2; ctx.stroke();
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
      // Draw one frame synchronously at mount so the head is NEVER blank,
      // even when rAF is throttled/blocked (hidden window, backgrounded
      // Electron renderer). The rAF loop then continues animating.
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
