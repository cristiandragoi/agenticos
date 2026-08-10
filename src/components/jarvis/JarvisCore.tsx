import React, { useEffect, useRef } from 'react';

/* ── J.A.R.V.I.S holographic humanoid head ─────────────────────────────
 * Canvas 2D (no Three.js/WebGL — the spec's performance contract):
 * a translucent holographic HUMANOID HEAD / upper neural form:
 *   - recognizable head silhouette (cranium, tapered jaw, chin, neck)
 *   - left/right hemisphere midline + neural capability nodes
 *   - connected energy paths (JARVIS→HERMES/CODEX/RESEARCH/MEMORY/VISION)
 *   - eye slits + mouth output arc (listening / speaking reactivity)
 *
 * The visualization is FUNCTIONAL telemetry: every color/motion is driven
 * by the real runtime state + real mic/playback amplitude, never faked.
 * rAF cancelled on unmount; reduced-motion renders one static frame.
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

/** Capability nodes positioned inside the head (relative to head frame 0..1). */
const NODES = [
  { id: 'JARVIS',   x: 0.50, y: 0.46, r: 0.045 },  // center
  { id: 'HERMES',   x: 0.68, y: 0.30, r: 0.032 },
  { id: 'CODEX',    x: 0.74, y: 0.55, r: 0.032 },
  { id: 'RESEARCH', x: 0.32, y: 0.30, r: 0.032 },
  { id: 'MEMORY',   x: 0.26, y: 0.55, r: 0.032 },
  { id: 'VISION',   x: 0.44, y: 0.20, r: 0.026 },
  { id: 'ORACLE',   x: 0.56, y: 0.20, r: 0.026 },
] as const;

/** Energy-path edges (center node ↔ capability nodes). */
const EDGES: Array<[string, string]> = [
  ['JARVIS', 'HERMES'], ['JARVIS', 'CODEX'], ['JARVIS', 'RESEARCH'],
  ['JARVIS', 'MEMORY'], ['JARVIS', 'VISION'], ['JARVIS', 'ORACLE'],
  ['HERMES', 'CODEX'], ['RESEARCH', 'MEMORY'], ['VISION', 'ORACLE'],
];

function nodeById(id: string) { return NODES.find((n) => n.id === id)!; }

export function JarvisCore({
  state,
  inputLevel = 0,
  outputLevel = 0,
  reducedMotion = false,
  size = 340,
  testIdPrefix = 'jarvis-orb',
}: JarvisCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  const inputRef = useRef(inputLevel);
  const outputRef = useRef(outputLevel);
  const reducedRef = useRef(reducedMotion);
  stateRef.current = state;
  inputRef.current = inputLevel;
  outputRef.current = outputLevel;
  reducedRef.current = reducedMotion;

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

    // Head frame geometry (relative to canvas).
    const cx = size / 2;
    const cy = size * 0.46;              // head center slightly above mid
    const headW = size * 0.58;           // width of cranium
    const headH = size * 0.72;           // height incl. jaw
    const W = headW / 2;
    const H = headH / 2;

    let colMain = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].main);
    let colSoft = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].soft);
    let colRim = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].rim);

    const seed = Array.from({ length: 8 }, () => Math.random() * Math.PI * 2);
    const pulses: { edge: [string, string]; t: number }[] = [];

    let raf = 0;
    let t = 0;
    let last = performance.now();
    let running = true;

    const smooth = (a: number, b: number, k: number) => a + (b - a) * k;

    function headPath(g: CanvasRenderingContext2D, ox: number, oy: number, scaleX: number, scaleY: number) {
      // Humanoid head silhouette: cranium → temples → cheeks → jaw → chin.
      g.beginPath();
      g.moveTo(ox, oy - H * scaleY);
      g.bezierCurveTo(
        ox + W * 0.9 * scaleX, oy - H * 1.02 * scaleY,
        ox + W * 1.12 * scaleX, oy - H * 0.35 * scaleY,
        ox + W * 1.02 * scaleX, oy + H * 0.28 * scaleY
      );
      g.bezierCurveTo(
        ox + W * 0.95 * scaleX, oy + H * 0.62 * scaleY,
        ox + W * 0.55 * scaleX, oy + H * 0.92 * scaleY,
        ox, oy + H * 0.98 * scaleY
      );
      g.bezierCurveTo(
        ox - W * 0.55 * scaleX, oy + H * 0.92 * scaleY,
        ox - W * 0.95 * scaleX, oy + H * 0.62 * scaleY,
        ox - W * 1.02 * scaleX, oy + H * 0.28 * scaleY
      );
      g.bezierCurveTo(
        ox - W * 1.12 * scaleX, oy - H * 0.35 * scaleY,
        ox - W * 0.9 * scaleX, oy - H * 1.02 * scaleY,
        ox, oy - H * scaleY
      );
      g.closePath();
    }

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
      const breathe = 1 + Math.sin(t * 1.1) * 0.012;

      ctx.clearRect(0, 0, size, size);

      // ── Outer holographic halo ──
      const haloR = W * 1.75 * breathe;
      const halo = ctx.createRadialGradient(cx, cy, W * 0.2, cx, cy, haloR);
      const glowA = st === 'error' ? 0.22 : st === 'offline' ? 0.10 : 0.17;
      halo.addColorStop(0, rgba(colMain, glowA * (1 + ampOut * 0.7)));
      halo.addColorStop(0.5, rgba(colMain, glowA * 0.4));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // ── Neck + shoulders base (subtle holographic pedestal) ──
      const neckGrad = ctx.createLinearGradient(0, cy + H * 0.8, 0, size);
      neckGrad.addColorStop(0, rgba(colRim, 0.10));
      neckGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neckGrad;
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.32, cy + H * 0.82);
      ctx.bezierCurveTo(cx - W * 0.42, cy + H * 1.02, cx - W * 0.5, cy + H * 1.12, cx - W * 0.62, cy + H * 1.3);
      ctx.lineTo(cx + W * 0.62, cy + H * 1.3);
      ctx.bezierCurveTo(cx + W * 0.5, cy + H * 1.12, cx + W * 0.42, cy + H * 1.02, cx + W * 0.32, cy + H * 0.82);
      ctx.closePath();
      ctx.fill();

      // ── Translucent head membrane ──
      headPath(ctx, cx, cy, 1, 1);
      const headGrad = ctx.createRadialGradient(cx - W * 0.2, cy - H * 0.3, W * 0.1, cx, cy, W * 1.1);
      const bodyA = st === 'offline' ? 0.05 : 0.10 + ampOut * 0.05;
      headGrad.addColorStop(0, rgba(colSoft, bodyA * 1.6));
      headGrad.addColorStop(0.55, rgba(colMain, bodyA * 0.8));
      headGrad.addColorStop(1, rgba(colMain, bodyA * 0.25));
      ctx.fillStyle = headGrad;
      ctx.fill();
      // Rim light (the recognizable holographic edge).
      ctx.strokeStyle = rgba(colRim, (0.30 + ampIn * 0.15 + ampOut * 0.12));
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // Inner glow flicker.
      ctx.strokeStyle = rgba(colSoft, 0.08 + Math.sin(t * 1.6) * 0.03);
      ctx.lineWidth = 3;
      headPath(ctx, cx, cy, 0.96, 0.96);
      ctx.stroke();

      // ── Ear hint (subtle side nodes — audio/auditory regions) ──
      const earGlow = st === 'listening' ? 0.5 + ampIn * 0.5 : st === 'speaking' ? 0.2 : 0.06;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 1.06;
        const ey = cy + H * 0.05;
        const eg = ctx.createRadialGradient(ex, ey, 1, ex, ey, W * 0.14);
        eg.addColorStop(0, rgba(st === 'listening' ? [59, 130, 246] : colMain, earGlow));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(ex, ey, W * 0.14, 0, Math.PI * 2); ctx.fill();
      }

      // ── Midline (hemisphere divide) — faint vertical energy line ──
      ctx.strokeStyle = rgba(colSoft, 0.10 + (st === 'reasoning' || st === 'executing' ? 0.12 : 0));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - H * 0.9);
      ctx.quadraticCurveTo(cx + W * 0.04, cy, cx, cy + H * 0.88);
      ctx.stroke();

      // ── Neural capability nodes + energy paths ──
      const nodeXY = (n: typeof NODES[number]): [number, number] => [
        cx + (n.x - 0.5) * W * 2.0,
        cy + (n.y - 0.5) * H * 1.9,
      ];
      // Active node sets by state (functional telemetry, not decoration).
      const activeNodes = (): Set<string> => {
        const s = new Set<string>(['JARVIS']);
        if (st === 'listening') { s.add('VISION'); s.add('ORACLE'); }
        if (st === 'reasoning' || st === 'thinking' || st === 'transcribing') { s.add('VISION'); s.add('ORACLE'); s.add('MEMORY'); }
        if (st === 'executing') { s.add('HERMES'); s.add('CODEX'); s.add('RESEARCH'); }
        if (st === 'delegated') { s.add('HERMES'); s.add('CODEX'); s.add('RESEARCH'); }
        if (st === 'repairing') { s.add('MEMORY'); s.add('VISION'); }
        if (st === 'warning') { s.add('MEMORY'); }
        return s;
      };
      const active = activeNodes();

      // Energy pulses travel along edges (executing/delegated/reasoning).
      if (st === 'executing' || st === 'delegated' || st === 'reasoning' || st === 'repairing') {
        const rate = st === 'executing' ? 1.6 : st === 'delegated' ? 1.1 : 0.8;
        const life = st === 'delegated' ? 3.2 : 2.4;
        if (Math.random() < dt * rate && pulses.length < 8) {
          const edge = EDGES[Math.floor(Math.random() * EDGES.length)];
          pulses.push({ edge, t: 0 });
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.t += dt / life;
          if (p.t >= 1) { pulses.splice(i, 1); continue; }
          const a = nodeById(p.edge[0]), b = nodeById(p.edge[1]);
          const [ax, ay] = nodeXY(a), [bx, by] = nodeXY(b);
          const px = ax + (bx - ax) * p.t, py = ay + (by - ay) * p.t;
          const pulseColor = st === 'delegated' ? colMain : st === 'repairing' ? colMain : colRim;
          ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2);
          ctx.fillStyle = rgba(pulseColor, 0.75 * (1 - p.t));
          ctx.fill();
        }
      }

      // Draw edges (stronger when their endpoint nodes are active).
      for (const [ia, ib] of EDGES) {
        const a = nodeById(ia), b = nodeById(ib);
        const [ax, ay] = nodeXY(a), [bx, by] = nodeXY(b);
        const aActive = active.has(a.id) || a.id === 'JARVIS';
        const bActive = active.has(b.id);
        const edgeOn = aActive && (bActive || st === 'executing' || st === 'delegated');
        const alpha = edgeOn ? (0.22 + Math.sin(t * 2 + seed[0]) * 0.08) : 0.06;
        const grad = ctx.createLinearGradient(ax, ay, bx, by);
        grad.addColorStop(0, rgba(colMain, alpha));
        grad.addColorStop(1, rgba(colSoft, alpha * 0.7));
        ctx.strokeStyle = grad;
        ctx.lineWidth = edgeOn ? 1.2 : 0.7;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }

      // Draw nodes.
      for (const n of NODES) {
        const [nx, ny] = nodeXY(n);
        const isActive = active.has(n.id);
        const pulse = isActive ? 1 + Math.sin(t * 3 + seed[1] + n.x * 5) * 0.25 : 1;
        const r = n.r * W * 2.2 * pulse;
        const nodeColor = st === 'delegated' && (n.id === 'HERMES' || n.id === 'CODEX' || n.id === 'RESEARCH')
          ? colMain : isActive ? colSoft : colMain;
        const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * 2.2);
        ng.addColorStop(0, rgba(nodeColor, isActive ? 0.9 : 0.4));
        ng.addColorStop(0.4, rgba(nodeColor, isActive ? 0.35 : 0.12));
        ng.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ng;
        ctx.beginPath(); ctx.arc(nx, ny, r * 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(nx, ny, r * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = rgba(nodeColor, isActive ? 1 : 0.6);
        ctx.fill();
      }

      // ── Eye slits (face recognition) — brighten while listening ──
      const eyeY = cy - H * 0.18;
      const eyeGlow = st === 'listening' ? 0.8 + ampIn * 0.2 : st === 'error' ? 0.9 : 0.35 + (st === 'reasoning' ? 0.3 : 0);
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 0.34;
        const eyeGrad = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, W * 0.16);
        const eyeCol = st === 'listening' ? [59, 130, 246] : st === 'error' ? [239, 68, 68] : st === 'delegated' ? colMain : colSoft;
        eyeGrad.addColorStop(0, rgba(eyeCol as [number, number, number], eyeGlow));
        eyeGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eyeGrad;
        ctx.beginPath(); ctx.ellipse(ex, eyeY, W * 0.13, H * 0.05, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(ex, eyeY, W * 0.10, H * 0.028, 0, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(colSoft, 0.5 + eyeGlow * 0.4);
        ctx.lineWidth = 1; ctx.stroke();
      }

      // ── Mouth output arc — pulses while speaking (real playback level) ──
      const mouthY = cy + H * 0.42;
      const mouthOpen = st === 'speaking' ? 0.30 + ampOut * 0.5 : st === 'listening' ? 0.08 : 0.02;
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, W * 0.22, H * 0.03 + mouthOpen * H * 0.1, 0, 0, Math.PI);
      ctx.strokeStyle = rgba(st === 'speaking' ? colRim : colSoft, st === 'speaking' ? 0.7 + ampOut * 0.3 : 0.3);
      ctx.lineWidth = st === 'speaking' ? 1.6 + ampOut * 1.4 : 1;
      ctx.stroke();
      // Speech waveform dots below mouth.
      if (st === 'speaking') {
        for (let i = -2; i <= 2; i++) {
          const wx = cx + i * W * 0.09;
          const wy = mouthY + H * 0.14 + Math.sin(t * 8 + i) * H * 0.03 * (0.3 + ampOut);
          ctx.beginPath(); ctx.arc(wx, wy, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = rgba(colRim, 0.6 + ampOut * 0.4);
          ctx.fill();
        }
      }

      // ── Error / warning alert pulses ──
      if (st === 'error') {
        const pulseR = W * (0.9 + Math.sin(t * 2.2) * 0.08);
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([239, 68, 68], 0.35);
        ctx.lineWidth = 2; ctx.stroke();
      }
      if (st === 'warning') {
        const pulseR = W * (0.95 + Math.sin(t * 1.4) * 0.05);
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([245, 158, 11], 0.30);
        ctx.lineWidth = 1.5; ctx.stroke();
      }

      // ── Completed green pulse (decays toward idle automatically) ──
      if (st === 'completed') {
        const pulseR = W * (0.8 + Math.sin(t * 3) * 0.15);
        ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([34, 197, 94], 0.4);
        ctx.lineWidth = 2.4; ctx.stroke();
      }

      // ── Delegated path: bright line from JARVIS to active worker node ──
      if (st === 'delegated') {
        const jn = nodeXY(nodeById('JARVIS'));
        const wn = nodeXY(nodeById(seed[2] % 2 === 0 ? 'HERMES' : 'CODEX'));
        ctx.beginPath(); ctx.moveTo(jn[0], jn[1]); ctx.lineTo(wn[0], wn[1]);
        ctx.strokeStyle = rgba(colMain, 0.55 + Math.sin(t * 4) * 0.2);
        ctx.lineWidth = 2; ctx.stroke();
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
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      style={{ width: size, height: size, display: 'block' }}
      aria-hidden="true"
    />
  );
}

export default JarvisCore;
