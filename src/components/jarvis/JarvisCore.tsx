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
}

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
}: JarvisCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const agentRef = useRef(activeAgent);
  const outRef = useRef(outputLevel);
  const inRef = useRef(inputLevel);
  const motionRef = useRef(reducedMotion);
  stateRef.current = state;
  agentRef.current = activeAgent;
  outRef.current = outputLevel;
  inRef.current = inputLevel;

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
      style={{ width: size, height: size, display: 'block' }}
    />
  );
}

export default JarvisCore;
