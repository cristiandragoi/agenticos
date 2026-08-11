import React, { useEffect, useRef } from 'react';

/* ── J.A.R.V.I.S — HUMAN FORM CHECKPOINT V3.2 ─────────────────────────
 * ITERATION GATE: silhouette FIRST, technology SECOND.
 * This checkpoint renders ONLY:
 *   - a recognizable front-facing HUMAN head: rounded cranium, forehead,
 *     temples, cheekbones, cheeks, jaw taper, rounded chin
 *   - restrained face landmarks: eyes, brows, nose bridge, mouth, jaw/chin
 *   - visible neck + subtle shoulders/upper bust
 *   - basic translucent holographic rendering (dim shell, face shading,
 *     state-color tint)
 * NO neural core, NO hemisphere networks, NO agent constellation, NO
 * delegate beam, NO particles, NO state overlay rings — those return only
 * after the human form is approved.
 * State source + color contract unchanged; reduced-motion static frame;
 * one rAF loop; Canvas 2D only.
 */

export type JarvisCoreState =
  | 'idle' | 'listening' | 'transcribing' | 'thinking'
  | 'speaking' | 'error' | 'offline'
  | 'reasoning' | 'executing' | 'delegated'
  | 'repairing' | 'warning' | 'completed';

interface JarvisCoreProps {
  state: JarvisCoreState;
  inputLevel?: number;
  outputLevel?: number;
  reducedMotion?: boolean;
  size?: number;
  testIdPrefix?: string;
  /** REAL delegated agent display name — kept on the attribute (no visual yet). */
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

    /* ── GEOMETRY MATCHING THE REFERENCE (image 5): a LARGE front-facing
     * humanoid head (head ≈ 83% of the figure height), high-set eyes,
     * nose midline, low mouth near the chin, short neck/shoulders. ── */
    const S = size;
    const cx = S / 2;
    const cy = S * 0.40;                     // head center (cranium top ~2%)
    const W = S * 0.28;                      // half head width (head spans 22-78%)
    const H = S * 0.38;                      // half head height (head spans 2-78%)

    /* Human head silhouette: rounded cranium → forehead → temples →
     * cheekbones → cheeks → jaw taper → rounded chin. */
    function headPath(g: CanvasRenderingContext2D, ox: number, oy: number, sx = 1, sy = 1) {
      g.beginPath();
      g.moveTo(ox, oy - H * 1.0 * sy);
      // crown → upper cranium (widest point of the head)
      g.bezierCurveTo(ox + W * 0.30 * sx, oy - H * 1.02 * sy, ox + W * 0.62 * sx, oy - H * 0.98 * sy, ox + W * 0.80 * sx, oy - H * 0.82 * sy);
      g.bezierCurveTo(ox + W * 0.92 * sx, oy - H * 0.66 * sy, ox + W * 0.96 * sx, oy - H * 0.50 * sy, ox + W * 0.94 * sx, oy - H * 0.36 * sy);
      // temple inset
      g.bezierCurveTo(ox + W * 0.90 * sx, oy - H * 0.20 * sy, ox + W * 0.80 * sx, oy - H * 0.08 * sy, ox + W * 0.76 * sx, oy);
      // cheekbone (face widest) → cheek
      g.bezierCurveTo(ox + W * 0.83 * sx, oy + H * 0.10 * sy, ox + W * 0.86 * sx, oy + H * 0.22 * sy, ox + W * 0.79 * sx, oy + H * 0.32 * sy);
      g.bezierCurveTo(ox + W * 0.70 * sx, oy + H * 0.44 * sy, ox + W * 0.60 * sx, oy + H * 0.54 * sy, ox + W * 0.52 * sx, oy + H * 0.64 * sy);
      // jaw taper → rounded chin
      g.bezierCurveTo(ox + W * 0.42 * sx, oy + H * 0.76 * sy, ox + W * 0.30 * sx, oy + H * 0.86 * sy, ox + W * 0.18 * sx, oy + H * 0.92 * sy);
      g.bezierCurveTo(ox + W * 0.09 * sx, oy + H * 0.96 * sy, ox + W * 0.03 * sx, oy + H * 0.98 * sy, ox, oy + H * 0.98 * sy);
      // mirror left
      g.bezierCurveTo(ox - W * 0.03 * sx, oy + H * 0.98 * sy, ox - W * 0.09 * sx, oy + H * 0.96 * sy, ox - W * 0.18 * sx, oy + H * 0.92 * sy);
      g.bezierCurveTo(ox - W * 0.30 * sx, oy + H * 0.86 * sy, ox - W * 0.42 * sx, oy + H * 0.76 * sy, ox - W * 0.52 * sx, oy + H * 0.64 * sy);
      g.bezierCurveTo(ox - W * 0.60 * sx, oy + H * 0.54 * sy, ox - W * 0.70 * sx, oy + H * 0.44 * sy, ox - W * 0.79 * sx, oy + H * 0.32 * sy);
      g.bezierCurveTo(ox - W * 0.86 * sx, oy + H * 0.22 * sy, ox - W * 0.83 * sx, oy + H * 0.10 * sy, ox - W * 0.76 * sx, oy);
      g.bezierCurveTo(ox - W * 0.80 * sx, oy - H * 0.08 * sy, ox - W * 0.90 * sx, oy - H * 0.20 * sy, ox - W * 0.94 * sx, oy - H * 0.36 * sy);
      g.bezierCurveTo(ox - W * 0.96 * sx, oy - H * 0.50 * sy, ox - W * 0.92 * sx, oy - H * 0.66 * sy, ox - W * 0.80 * sx, oy - H * 0.82 * sy);
      g.bezierCurveTo(ox - W * 0.62 * sx, oy - H * 0.98 * sy, ox - W * 0.30 * sx, oy - H * 1.02 * sy, ox, oy - H * 1.0 * sy);
      g.closePath();
    }

    /* Short neck + subtle shoulders (17% of the figure — reference scale). */
    function bustPath(g: CanvasRenderingContext2D, ox: number, oy: number) {
      g.beginPath();
      g.moveTo(ox - W * 0.10, oy + H * 0.96);
      g.quadraticCurveTo(ox - W * 0.17, oy + H * 1.12, ox - W * 0.24, oy + H * 1.22);
      g.quadraticCurveTo(ox - W * 0.52, oy + H * 1.34, ox - W * 0.78, oy + H * 1.42);
      g.quadraticCurveTo(ox - W * 0.86, oy + H * 1.45, ox - W * 0.80, oy + H * 1.48);
      g.lineTo(ox + W * 0.80, oy + H * 1.48);
      g.quadraticCurveTo(ox + W * 0.86, oy + H * 1.45, ox + W * 0.78, oy + H * 1.42);
      g.quadraticCurveTo(ox + W * 0.52, oy + H * 1.34, ox + W * 0.24, oy + H * 1.22);
      g.quadraticCurveTo(ox + W * 0.17, oy + H * 1.12, ox + W * 0.10, oy + H * 0.96);
      g.closePath();
    }

    let colMain = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].main);
    let colSoft = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].soft);
    let colRim = hexToRgb(JARVIS_HEAD_COLORS[stateRef.current].rim);

    let raf = 0;
    let t = 0;
    let last = performance.now();
    let running = true;
    /** Mouth opening 0..1 — follows the REAL playback amplitude (lip sync). */
    let mouthOpen = 0;

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
      const breathe = 1 + Math.sin(t * 1.1) * 0.006;

      ctx.clearRect(0, 0, S, S);

      /* ── soft ambient holographic light (state-tinted) ── */
      const haloR = W * 2.4 * breathe;
      const halo = ctx.createRadialGradient(cx, cy, W * 0.3, cx, cy, haloR);
      const glowA = st === 'error' ? 0.20 : st === 'offline' ? 0.08 : 0.14;
      halo.addColorStop(0, rgba(colMain, glowA * (1 + ampOut * 0.5)));
      halo.addColorStop(0.55, rgba(colMain, glowA * 0.30));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, S, S);

      /* ── translucent neck + shoulders ── */
      const neckGrad = ctx.createLinearGradient(0, cy + H * 0.9, 0, S * 0.98);
      neckGrad.addColorStop(0, rgba(colRim, 0.12));
      neckGrad.addColorStop(0.55, rgba(colMain, 0.07));
      neckGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neckGrad;
      bustPath(ctx, cx, cy);
      ctx.fill();
      // shoulder suggestion line
      ctx.strokeStyle = rgba(colRim, 0.10);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.78, cy + H * 1.42);
      ctx.quadraticCurveTo(cx, cy + H * 1.47, cx + W * 0.78, cy + H * 1.42);
      ctx.stroke();
      // neck midline hint
      ctx.strokeStyle = rgba(colSoft, 0.10);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy + H * 0.98);
      ctx.quadraticCurveTo(cx + W * 0.05, cy + H * 1.2, cx, cy + H * 1.40);
      ctx.stroke();

      /* ── translucent holographic head shell ── */
      headPath(ctx, cx, cy, breathe, breathe);
      const headGrad = ctx.createRadialGradient(cx - W * 0.2, cy - H * 0.3, W * 0.1, cx, cy, W * 1.3);
      const bodyA = st === 'offline' ? 0.06 : 0.18 + ampOut * 0.04;
      headGrad.addColorStop(0, rgba(colSoft, bodyA * 1.7));
      headGrad.addColorStop(0.55, rgba(colMain, bodyA * 0.95));
      headGrad.addColorStop(1, rgba(colMain, bodyA * 0.34));
      ctx.fillStyle = headGrad;
      ctx.fill();
      // luminous FACE mass (like the reference: the face is the brightest
      // part of the head — a soft bright glow over the facial plane)
      const faceGlow = ctx.createRadialGradient(cx, cy - H * 0.15, W * 0.05, cx, cy - H * 0.15, W * 0.85);
      const faceA = st === 'offline' ? 0.06 : 0.24 + ampOut * 0.08 + ampIn * 0.05;
      faceGlow.addColorStop(0, rgba(colSoft, faceA));
      faceGlow.addColorStop(0.5, rgba(colMain, faceA * 0.55));
      faceGlow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = faceGlow;
      ctx.beginPath();
      ctx.ellipse(cx, cy - H * 0.15, W * 0.88, H * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
      // crisp human rim
      ctx.strokeStyle = rgba(colRim, 0.38 + ampIn * 0.14 + ampOut * 0.10);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // inner shell glow
      ctx.strokeStyle = rgba(colSoft, 0.09 + Math.sin(t * 1.5) * 0.025);
      ctx.lineWidth = 3;
      headPath(ctx, cx, cy, 0.97, 0.97);
      ctx.stroke();

      /* ── face volume shading (translucent planes, state color) ── */
      // forehead plane
      ctx.fillStyle = rgba(colSoft, 0.055);
      ctx.beginPath();
      ctx.ellipse(cx, cy - H * 0.66, W * 0.52, H * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // cheek planes
      for (const side of [-1, 1]) {
        ctx.fillStyle = rgba(colMain, 0.06);
        ctx.beginPath();
        ctx.ellipse(cx + side * W * 0.44, cy + H * 0.02, W * 0.28, H * 0.20, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // jaw/chin plane
      ctx.fillStyle = rgba(colMain, 0.05);
      ctx.beginPath();
      ctx.ellipse(cx, cy + H * 0.55, W * 0.32, H * 0.20, 0, 0, Math.PI * 2);
      ctx.fill();

      /* ── HUMAN FACE FEATURES: eyes, nose, mouth — positioned like the
       *  reference (high-set eyes, nose midline, low mouth near the chin). ── */
      const eyeY = cy - H * 0.42;                  // HIGH eye line (reference)
      const eyeGlow = st === 'listening' ? 0.95 + ampIn * 0.05 : st === 'error' ? 0.9 : st === 'reasoning' ? 0.7 : 0.55;
      const eyeCol = st === 'listening' ? [59, 130, 246] as [number, number, number]
        : st === 'error' ? [239, 68, 68] as [number, number, number]
        : st === 'delegated' ? colMain : colSoft;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 0.40;
        // eye socket shadow (depth behind the eye)
        ctx.fillStyle = rgba([2, 8, 20], 0.18);
        ctx.beginPath(); ctx.ellipse(ex, eyeY, W * 0.13, H * 0.05, 0, 0, Math.PI * 2); ctx.fill();
        // eye glow plane
        const eg = ctx.createRadialGradient(ex, eyeY, 0, ex, eyeY, W * 0.11);
        eg.addColorStop(0, rgba(eyeCol, eyeGlow * 0.8));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.ellipse(ex, eyeY, W * 0.11, H * 0.045, 0, 0, Math.PI * 2); ctx.fill();
        // eye slit — clearly visible, gentle angle (human position)
        ctx.save();
        ctx.translate(ex, eyeY);
        ctx.rotate(side * 0.10);
        ctx.beginPath();
        ctx.moveTo(-W * 0.085, 0);
        ctx.quadraticCurveTo(0, -H * 0.020 * (0.5 + eyeGlow), W * 0.085, 0);
        ctx.strokeStyle = rgba(colSoft, 0.7 + eyeGlow * 0.3);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
        // iris core (bright point of the eye)
        ctx.beginPath();
        ctx.arc(ex + side * W * 0.015, eyeY, Math.max(1, W * 0.020), 0, Math.PI * 2);
        ctx.fillStyle = rgba(colSoft, 0.55 + eyeGlow * 0.45);
        ctx.fill();
      }
      // brows / brow ridge — just above the high eye line
      ctx.strokeStyle = rgba(colMain, 0.34 + (st === 'reasoning' ? 0.10 : 0));
      ctx.lineWidth = 1.2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * W * 0.24, cy - H * 0.52);
        ctx.quadraticCurveTo(cx + side * W * 0.40, cy - H * 0.58, cx + side * W * 0.52, cy - H * 0.51);
        ctx.stroke();
      }
      // NOSE — bridge from between the eyes to the tip, defined tip + nostrils
      ctx.strokeStyle = rgba(colMain, 0.30);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - H * 0.30);
      ctx.quadraticCurveTo(cx + W * 0.02, cy - H * 0.05, cx, cy + H * 0.26);
      ctx.stroke();
      // nose tip + wings
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.055, cy + H * 0.24);
      ctx.quadraticCurveTo(cx, cy + H * 0.31, cx + W * 0.055, cy + H * 0.24);
      ctx.stroke();
      // nostrils (two small angled hints)
      ctx.strokeStyle = rgba(colMain, 0.20);
      ctx.lineWidth = 0.9;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + side * W * 0.045, cy + H * 0.27);
        ctx.quadraticCurveTo(cx + side * W * 0.085, cy + H * 0.29, cx + side * W * 0.075, cy + H * 0.315);
        ctx.stroke();
      }
      // shadow under the nose (face depth)
      ctx.fillStyle = rgba([2, 8, 20], 0.10);
      ctx.beginPath();
      ctx.ellipse(cx, cy + H * 0.36, W * 0.09, H * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      // mouth (human position, low on the face like the reference) —
      // LIP-SYNC: opening follows the REAL playback amplitude (outputLevel)
      // while speaking; calm line otherwise.
      const mouthY = cy + H * 0.62;
      const mouthTarget = st === 'speaking' ? 0.22 + ampOut * 0.6 : 0.015;
      mouthOpen = smooth(mouthOpen, mouthTarget, Math.min(1, dt * 16));
      if (mouthOpen > 0.03) {
        // mouth cavity (dark interior that opens with the audio)
        ctx.beginPath();
        ctx.ellipse(cx, mouthY, W * 0.16, H * 0.015 + mouthOpen * H * 0.12, 0, 0, Math.PI);
        ctx.fillStyle = rgba([2, 8, 20], 0.6);
        ctx.fill();
      }
      // upper lip
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, W * 0.16, H * 0.015 + mouthOpen * H * 0.12, 0, 0, Math.PI);
      ctx.strokeStyle = rgba(st === 'speaking' ? colRim : colSoft, st === 'speaking' ? 0.75 + mouthOpen * 0.25 : 0.42);
      ctx.lineWidth = st === 'speaking' ? 1.3 + mouthOpen * 2.2 : 1;
      ctx.stroke();
      // lower lip hint
      ctx.beginPath();
      ctx.ellipse(cx, mouthY, W * 0.16, H * 0.008 + mouthOpen * H * 0.09, 0, Math.PI, Math.PI * 2);
      ctx.strokeStyle = rgba(colMain, st === 'speaking' ? 0.35 + mouthOpen * 0.3 : 0.08);
      ctx.lineWidth = 1;
      ctx.stroke();
      // speaking glow under the mouth (output energy)
      if (st === 'speaking' && mouthOpen > 0.02) {
        const mg = ctx.createRadialGradient(cx, mouthY + H * 0.07, 0, cx, mouthY + H * 0.07, W * 0.26);
        mg.addColorStop(0, rgba(colRim, 0.28 + ampOut * 0.4));
        mg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = mg;
        ctx.beginPath(); ctx.arc(cx, mouthY + H * 0.07, W * 0.26, 0, Math.PI * 2); ctx.fill();
      }
      // jaw / chin contour
      ctx.strokeStyle = rgba(colMain, 0.10);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(cx - W * 0.30, cy + H * 0.82);
      ctx.quadraticCurveTo(cx, cy + H * 0.92, cx + W * 0.30, cy + H * 0.82);
      ctx.stroke();
      // ear hints (audio regions, at human ear height)
      const earGlow = st === 'listening' ? 0.5 + ampIn * 0.35 : st === 'speaking' ? 0.20 : 0.06;
      for (const side of [-1, 1]) {
        const ex = cx + side * W * 0.95;
        const ey = cy - H * 0.30;
        const eg = ctx.createRadialGradient(ex, ey, 1, ex, ey, W * 0.10);
        eg.addColorStop(0, rgba(st === 'listening' ? [59, 130, 246] : colMain, earGlow));
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath(); ctx.arc(ex, ey, W * 0.10, 0, Math.PI * 2); ctx.fill();
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
