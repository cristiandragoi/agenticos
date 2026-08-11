import React, { useEffect, useRef } from 'react';
import humanoidRef from '../../assets/jarvis-humanoid.png';

/* ── J.A.R.V.I.S — HUMANOID INTEGRATION V4 ────────────────────────────
 * PHASE 1+2+3 (gate checkpoint): the SUPPLIED humanoid reference asset is
 * the Layer-A base — drawn directly, NOT procedurally redrawn. State color
 * travels through canvas filters + a soft edge glow; the anatomy stays
 * exactly the reference. Phases 5-7 (mouth, neural, delegation) follow
 * after human visual approval.
 *
 * The reference (src/assets/jarvis-humanoid.png) is a front-facing
 * turquoise holographic bust: skull/cranium, forehead, temples, ears,
 * brows, eyes, nose, lips, cheeks, jaw, rounded chin, neck, clavicle,
 * shoulders, upper chest — drawn in fine wireframe/neural points.
 * ───────────────────────────────────────────────────────────────────── */

export type JarvisCoreState =
  | 'idle' | 'listening' | 'reasoning' | 'executing' | 'delegated'
  | 'repairing' | 'warning' | 'error' | 'completed' | 'speaking' | 'offline';

export interface JarvisCoreProps {
  state?: string;
  activeAgent?: string | null;
  outputLevel?: number; // REAL TTS playback amplitude (0..1) — phase 5 uses this
  inputLevel?: number;
  size?: number;
  reducedMotion?: boolean;
  testIdPrefix?: string;
  /** 0..1 per neural-node id — real runtime activity drives the pulse. */
  nodeActivity?: Record<string, number>;
}

/* Neural-universe nodes around the humanoid (Phase 3). Each node is a REAL
 * destination (route) with activity illumination driven by runtime state.
 * Positions are fractions of the canvas S (geometry contract) — the nodes
 * sit OUTSIDE the bust silhouette (head x≈0.20–0.80, y≈0.13–0.87). */
export interface NeuralNodeDef {
  id: string;
  label: string;
  route: string;
  icon: string;
  x: number; // fraction of S (canvas center cx=S/2)
  y: number; // fraction of S
}
export const NEURAL_NODES: NeuralNodeDef[] = [
  { id: 'memory',    label: 'Memory',    route: '#/memory',          icon: '◈', x: 0.125, y: 0.14 },
  { id: 'projects',  label: 'Projects',  route: '#/mission-control', icon: '▦', x: 0.875, y: 0.14 },
  { id: 'knowledge', label: 'Knowledge', route: '#/research',        icon: '❋', x: 0.05,  y: 0.44 },
  { id: 'hermes',    label: 'Hermes',    route: '#/hermes-studio',   icon: '⧉', x: 0.95,  y: 0.44 },
  { id: 'runs',      label: 'Runs',      route: '#/runs',            icon: '▶', x: 0.125, y: 0.74 },
  { id: 'artifacts', label: 'Artifacts', route: '#/builds',          icon: '◇', x: 0.875, y: 0.74 },
  { id: 'vision',    label: 'Vision',    route: '#/video',           icon: '◉', x: 0.50,  y: 0.94 },
];


/* Runtime state → color contract (spec §6). main = identity, soft = tint,
 * rim = edge. The base asset is turquoise; filters shift the whole
 * hologram per state without altering the anatomy. */
export const JARVIS_HEAD_COLORS: Record<string, { main: string; soft: string; rim: string }> = {
  idle:       { main: '#00e5ff', soft: '#7ff6ff', rim: '#00d9ff' },   // TURQUOISE — identity
  listening:  { main: '#3b82f6', soft: '#93c5fd', rim: '#60a5fa' },   // BLUE
  reasoning:  { main: '#e0f2fe', soft: '#ffffff', rim: '#7ff6ff' },   // CYAN-WHITE
  executing:  { main: '#00d4ff', soft: '#7ff6ff', rim: '#00ffff' },   // BRIGHT TURQUOISE
  delegated:  { main: '#ec4899', soft: '#f9a8d4', rim: '#f472b6' },   // PINK
  repairing:  { main: '#9333ea', soft: '#c084fc', rim: '#a855f7' },   // PURPLE
  warning:    { main: '#f59e0b', soft: '#fcd34d', rim: '#fbbf24' },   // YELLOW/AMBER
  error:      { main: '#ef4444', soft: '#fca5a5', rim: '#f87171' },   // RED
  completed:  { main: '#22c55e', soft: '#86efac', rim: '#4ade80' },   // GREEN (brief)
  transcribing: { main: '#22c55e', soft: '#86efac', rim: '#4ade80' }, // GREEN (STT)
  speaking:   { main: '#a855f7', soft: '#d8b4fe', rim: '#c084fc' },   // PURPLE (voice)
  offline:    { main: '#7f1d1d', soft: '#dc2626', rim: '#991b1b' },   // RED (off)
};

/* State → canvas filter target (hue-rotate relative to turquoise 180°).
 * Lerped each frame so color changes are smooth, never snapping. */
const STATE_FILTER: Record<string, { hue: number; sat: number; bright: number }> = {
  idle:       { hue: 0,    sat: 1.00, bright: 1.00 },
  listening:  { hue: 38,   sat: 1.30, bright: 1.10 },
  reasoning:  { hue: 4,    sat: 1.10, bright: 1.45 },
  executing:  { hue: -8,   sat: 1.25, bright: 1.45 },
  delegated:  { hue: 150,  sat: 1.55, bright: 1.22 },
  repairing:  { hue: 95,   sat: 1.45, bright: 1.18 },
  warning:    { hue: -138, sat: 1.65, bright: 1.22 },
  error:      { hue: -178, sat: 1.55, bright: 1.12 },
  completed:  { hue: -36,  sat: 1.25, bright: 1.28 },
  transcribing: { hue: -36, sat: 1.25, bright: 1.28 },
  speaking:   { hue: 88,   sat: 1.45, bright: 1.18 },
  offline:    { hue: -178, sat: 0.65, bright: 0.55 },
};

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function JarvisCore({
  state = 'idle',
  activeAgent = null,
  outputLevel = 0,
  inputLevel = 0,
  size = 220,
  reducedMotion = false,
  testIdPrefix = 'jarvis-orb',
  nodeActivity = {},
}: JarvisCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const agentRef = useRef(activeAgent);
  const outRef = useRef(outputLevel);
  const inRef = useRef(inputLevel);
  const motionRef = useRef(reducedMotion);
  const activityRef = useRef(nodeActivity);
  const hitRef = useRef<{ id: string; cx: number; cy: number; r: number }[]>([]);
  const hoverRef = useRef<string | null>(null);
  stateRef.current = state;
  agentRef.current = activeAgent;
  outRef.current = outputLevel;
  inRef.current = inputLevel;
  activityRef.current = nodeActivity;

  /* Load the reference humanoid asset once. */
  const [humanoid, setHumanoid] = React.useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let alive = true;
    const el = new Image();
    el.onload = () => { if (alive) setHumanoid(el); };
    el.src = humanoidRef;
    return () => { alive = false; el.onload = null; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const S = size;
    const cx = S / 2;
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let curHue = 0, curSat = 1, curBright = 1;

    const smooth = (a: number, b: number, k: number) => a + (b - a) * k;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

    function drawFrame(now: number) {
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;
      t += dt;
      const st = stateRef.current;
      const ampOut = clamp01(outRef.current);
      const ampIn = clamp01(inRef.current);
      const colors = JARVIS_HEAD_COLORS[st] || JARVIS_HEAD_COLORS.idle;
      const colSoft = hexToRgb(colors.soft);
      const colMain = hexToRgb(colors.main);
      const colRim = hexToRgb(colors.rim);

      /* smooth state color (filter targets) */
      const ft = STATE_FILTER[st] || STATE_FILTER.idle;
      const k = motionRef.current ? 1 : Math.min(1, dt * 5);
      curHue = smooth(curHue, ft.hue, k);
      curSat = smooth(curSat, ft.sat, k);
      curBright = smooth(curBright, ft.bright, k);

      ctx.clearRect(0, 0, S, S);

      /* ambient presence glow (state tint, kept subtle so the wireframe
         anatomy stays dominant) */
      const glowA = st === 'offline' ? 0.10 : 0.16 + ampOut * 0.06 + ampIn * 0.05;
      const glowR = S * 0.46;
      const g = ctx.createRadialGradient(cx, S * 0.42, S * 0.06, cx, S * 0.42, glowR);
      g.addColorStop(0, rgba(colSoft, glowA));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, S * 0.42, glowR, 0, Math.PI * 2);
      ctx.fill();
      /* string fill in the state color (edge-glow ellipse — keeps the
         hologram readable against the stage) */
      ctx.fillStyle = rgba(colMain, 0.06 + ampOut * 0.04);
      ctx.beginPath();
      ctx.ellipse(cx, S * 0.44, S * 0.36, S * 0.40, 0, 0, Math.PI * 2);
      ctx.fill();

      /* THE HUMAN (reference asset) — drawn directly, scaled to the stage */
      if (humanoid) {
        const aspect = humanoid.width / humanoid.height;
        const breathe = 1 + Math.sin(t * 1.3) * (motionRef.current ? 0 : 0.0045);
        const ih = S * 0.74 * breathe;          // ~74% of the hero height
        const iw = ih * aspect;                 // shoulders ≈ 61% of width
        const ix = cx - iw / 2;
        const iy = (S - ih) / 2;
        ctx.save();
        ctx.filter = `hue-rotate(${curHue.toFixed(1)}deg) saturate(${curSat.toFixed(2)}) brightness(${curBright.toFixed(2)})`;
        ctx.drawImage(humanoid, ix, iy, iw, ih);
        ctx.restore();
      }

      /* faint projection base under the bust */
      ctx.fillStyle = rgba(colRim, 0.10);
      ctx.beginPath();
      ctx.ellipse(cx, S * 0.90, S * 0.26, S * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();

      /* ── NEURAL-UNIVERSE NODES (Phase 3) — real destinations, activity-illuminated ── */
      const hits: { id: string; cx: number; cy: number; r: number }[] = [];
      const activity = activityRef.current || {};
      const nodeR = S * 0.030;
      for (let i = 0; i < NEURAL_NODES.length; i++) {
        const nd = NEURAL_NODES[i];
        const nx = nd.x * S;
        const ny = nd.y * S;
        const act = clamp01(activity[nd.id] || 0);
        const pulse = act > 0 ? 0.5 + 0.5 * Math.sin(t * 3 + i * 1.1) : 0;
        const alpha = 0.55 + act * 0.35 + pulse * 0.2 * act;
        /* connector (flowing neural path) toward the head core */
        ctx.save();
        ctx.strokeStyle = rgba(colRim, 0.10 + act * 0.25);
        ctx.lineWidth = Math.max(1, S * 0.004);
        ctx.setLineDash([S * 0.02, S * 0.016]);
        ctx.lineDashOffset = -t * S * 0.05;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.quadraticCurveTo((nx + cx) / 2, (ny + S * 0.42) / 2 - S * 0.05, cx, S * 0.42);
        ctx.stroke();
        ctx.restore();
        /* activity glow */
        if (act > 0.02) {
          const g = ctx.createRadialGradient(nx, ny, nodeR * 0.2, nx, ny, nodeR * 2.6);
          g.addColorStop(0, rgba(colSoft, 0.35 * act + pulse * 0.25 * act));
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(nx, ny, nodeR * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        /* chip */
        ctx.fillStyle = rgba(colMain, 0.10 + act * 0.35);
        ctx.strokeStyle = rgba(colRim, alpha);
        ctx.lineWidth = Math.max(1, S * 0.006);
        ctx.beginPath();
        ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        /* icon glyph */
        ctx.fillStyle = rgba(colSoft, 0.85 + act * 0.15);
        ctx.font = `${Math.round(S * 0.038)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(nd.icon, nx, ny);
        /* label */
        ctx.fillStyle = rgba(colSoft, 0.55 + act * 0.35);
        ctx.font = `${Math.round(S * 0.040)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(nd.label, nx, ny + nodeR + S * 0.010);
        hits.push({ id: nd.id, cx: nx, cy: ny, r: nodeR + S * 0.012 });
      }
      hitRef.current = hits;

      if (!reducedMotion) {
        raf = requestAnimationFrame(drawFrame);
      }
    }

    drawFrame(performance.now());
    if (!reducedMotion) {
      raf = requestAnimationFrame(drawFrame);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [size, reducedMotion, humanoid]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={testIdPrefix}
      data-orb-state={state}
      data-active-agent={activeAgent || ''}
      style={{ width: size, height: size, display: 'block', cursor: 'default' }}
      onPointerMove={(e) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = hitRef.current.find((h) => (x - h.cx) ** 2 + (y - h.cy) ** 2 <= h.r * h.r);
        hoverRef.current = hit ? hit.id : null;
        if (canvasRef.current) canvasRef.current.style.cursor = hit ? 'pointer' : 'default';
      }}
      onClick={(e) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = hitRef.current.find((h) => (x - h.cx) ** 2 + (y - h.cy) ** 2 <= h.r * h.r);
        if (hit) {
          const node = NEURAL_NODES.find((n) => n.id === hit.id);
          if (node) window.location.hash = node.route;
        }
      }}
    />
  );
}

export default JarvisCore;
