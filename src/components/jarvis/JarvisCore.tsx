import React, { useEffect, useMemo, useRef } from 'react';

/* ── J.A.R.V.I.S command-center core ─────────────────────────────────────
 * Visual replacement for the dashboard orb ON THE /jarvis page only.
 * Canvas 2D (no Three.js/WebGL): deep central core, soft radial blue
 * energy, three moving translucent plasma layers, subtle rotating rings,
 * a restrained radar sweep, fluid asymmetrical movement, and a 40–60
 * particle processing burst during thinking — with smooth recovery.
 *
 * Contract preserved: driven ONLY by real signals (state + real mic/playback
 * amplitude), no fake movement, rAF cancelled on unmount, reduced-motion
 * renders one static frame.
 */

export type JarvisCoreState =
  | 'idle' | 'listening' | 'transcribing' | 'thinking'
  | 'speaking' | 'error' | 'offline';

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

const STATE_COLORS: Record<JarvisCoreState, { main: string; soft: string }> = {
  idle:         { main: '#67e8f9', soft: '#e2f9ff' },
  listening:    { main: '#3b82f6', soft: '#93c5fd' },
  transcribing: { main: '#22c55e', soft: '#86efac' },
  thinking:     { main: '#f5b50a', soft: '#fde68a' },
  speaking:     { main: '#a855f7', soft: '#d8b4fe' },
  error:        { main: '#ef4444', soft: '#fca5a5' },
  offline:      { main: '#7f1d1d', soft: '#991b1b' },
};

/** Motion parameters per state — smoothed continuously (no snapping). */
interface MotionParams {
  drift: number;        // plasma layer rotation speed
  wobble: number;       // membrane distortion amplitude (fraction of R)
  glow: number;         // halo intensity 0..1
  sweep: number;        // radar sweep speed
  innerSpin: number;    // inner rotation (transcribing)
  particleTarget: number; // active particle count target
  pulse: number;        // breathing pulse speed
}

const MOTION: Record<JarvisCoreState, MotionParams> = {
  idle:         { drift: 0.10, wobble: 0.045, glow: 0.55, sweep: 0.12, innerSpin: 0.05, particleTarget: 0, pulse: 0.9 },
  listening:    { drift: 0.22, wobble: 0.06,  glow: 0.70, sweep: 0.16, innerSpin: 0.10, particleTarget: 0, pulse: 1.4 },
  transcribing: { drift: 0.30, wobble: 0.05,  glow: 0.65, sweep: 0.14, innerSpin: 2.4,  particleTarget: 0, pulse: 1.6 },
  thinking:     { drift: 0.26, wobble: 0.055, glow: 0.75, sweep: 0.20, innerSpin: 0.4,  particleTarget: 50, pulse: 1.2 },
  speaking:     { drift: 0.24, wobble: 0.06,  glow: 0.80, sweep: 0.14, innerSpin: 0.12, particleTarget: 0, pulse: 1.5 },
  error:        { drift: 0.06, wobble: 0.03,  glow: 0.45, sweep: 0.05, innerSpin: 0.03, particleTarget: 0, pulse: 2.2 },
  offline:      { drift: 0.012, wobble: 0.012, glow: 0.22, sweep: 0.01, innerSpin: 0.01, particleTarget: 0, pulse: 0.3 },
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

interface Particle {
  angle: number; radius: number; speed: number; life: number; maxLife: number; size: number;
}

export function JarvisCore({
  state,
  inputLevel = 0,
  outputLevel = 0,
  reducedMotion = false,
  size = 340,
  testIdPrefix = 'jarvis-orb',
}: JarvisCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Animation state lives in refs — the rAF loop is never restarted by props.
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

    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.30; // membrane base radius

    // Smoothed parameters (exponential convergence ≈ 300 ms).
    const cur: MotionParams = { ...MOTION[stateRef.current] };
    let colMain = hexToRgb(STATE_COLORS[stateRef.current].main);
    let colSoft = hexToRgb(STATE_COLORS[stateRef.current].soft);
    // Seed asymmetry phases — constant per mount, never a perfect circle.
    const seed = useMemoSeed();
    const particles: Particle[] = [];

    let raf = 0;
    let t = 0;
    let last = performance.now();
    let running = true;

    function useMemoSeed() {
      const s: number[] = [];
      for (let i = 0; i < 8; i++) s.push(Math.random() * Math.PI * 2);
      return s;
    }

    const smooth = (a: number, b: number, k: number) => a + (b - a) * k;

    function drawFrame(dt: number) {
      if (!ctx) return;
      const target = MOTION[stateRef.current];
      const colors = STATE_COLORS[stateRef.current];
      const k = Math.min(1, dt * 6); // ~160 ms time constant → ~95 % in 0.5 s
      cur.drift = smooth(cur.drift, target.drift, k);
      cur.wobble = smooth(cur.wobble, target.wobble, k);
      cur.glow = smooth(cur.glow, target.glow, k);
      cur.sweep = smooth(cur.sweep, target.sweep, k);
      cur.innerSpin = smooth(cur.innerSpin, target.innerSpin, k);
      cur.particleTarget = smooth(cur.particleTarget, target.particleTarget, k);
      cur.pulse = smooth(cur.pulse, target.pulse, k);
      const tm = hexToRgb(colors.main);
      const ts = hexToRgb(colors.soft);
      colMain = [smooth(colMain[0], tm[0], k), smooth(colMain[1], tm[1], k), smooth(colMain[2], tm[2], k)] as [number, number, number];
      colSoft = [smooth(colSoft[0], ts[0], k), smooth(colSoft[1], ts[1], k), smooth(colSoft[2], ts[2], k)] as [number, number, number];

      t += dt;

      // Real amplitude reactivity — listening: mic drives distortion;
      // speaking: playback drives glow + distortion. Never outside those states.
      const ampIn = stateRef.current === 'listening' ? Math.min(1, Math.max(0, inputRef.current)) : 0;
      const ampOut = stateRef.current === 'speaking' ? Math.min(1, Math.max(0, outputRef.current)) : 0;

      const breathe = 1 + Math.sin(t * cur.pulse) * 0.018;
      const wobble = cur.wobble * (1 + ampIn * 1.6 + ampOut * 1.4);

      ctx.clearRect(0, 0, size, size);

      // ── Soft outer halo (radial energy field) ──
      const haloR = R * (1.75 + Math.sin(t * cur.pulse) * 0.03 + ampOut * 0.12);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, haloR);
      const glowA = 0.16 * cur.glow * (1 + ampOut * 0.6);
      halo.addColorStop(0, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},${glowA.toFixed(3)})`);
      halo.addColorStop(0.55, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},${(glowA * 0.45).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // ── Restrained radar sweep (low-alpha rotating wedge) ──
      const sweepA = t * cur.sweep;
      let sweepGrad: CanvasGradient | null = null;
      try {
        sweepGrad = (ctx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient })
          .createConicGradient?.(sweepA, cx, cy) ?? null;
      } catch { /* older canvas implementations render without the sweep */ }
      if (sweepGrad) {
        const alpha = 0.10 * cur.glow;
        sweepGrad.addColorStop(0, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},${alpha.toFixed(3)})`);
        sweepGrad.addColorStop(0.12, 'rgba(0,0,0,0)');
        sweepGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.45, 0, Math.PI * 2);
        ctx.fillStyle = sweepGrad;
        ctx.fill();
        ctx.restore();
      }

      // ── Three moving translucent plasma layers (fluid asymmetry) ──
      for (let layer = 0; layer < 3; layer++) {
        const lr = R * (1.0 - layer * 0.16) * breathe;
        const spin = t * cur.drift * (layer % 2 === 0 ? 1 : -1) * (1 + layer * 0.35)
          + (stateRef.current === 'transcribing' ? t * cur.innerSpin * 0.35 * (layer === 2 ? 1 : 0.3) : 0);
        ctx.beginPath();
        const steps = 72;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          // Multi-harmonic organic distortion — smooth, never polygonal.
          const d =
            Math.sin(a * 3 + seed[layer] + spin * 1.7) * 0.5 +
            Math.sin(a * 5 - seed[layer + 3] + t * cur.drift * 2.2) * 0.3 +
            Math.sin(a * 2 + seed[layer + 1] - spin) * 0.45;
          const rr = lr * (1 + d * wobble);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const la = (0.16 - layer * 0.035) * (0.6 + cur.glow * 0.7);
        const grad = ctx.createRadialGradient(cx - lr * 0.25, cy - lr * 0.3, lr * 0.1, cx, cy, lr);
        grad.addColorStop(0, `rgba(${colSoft[0] | 0},${colSoft[1] | 0},${colSoft[2] | 0},${(la * 1.4).toFixed(3)})`);
        grad.addColorStop(0.6, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},${la.toFixed(3)})`);
        grad.addColorStop(1, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},${(la * 0.35).toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fill();
        // Subtle moving edge highlight (smooth rim light, no dashes).
        ctx.strokeStyle = `rgba(${colSoft[0] | 0},${colSoft[1] | 0},${colSoft[2] | 0},${(0.10 + ampIn * 0.15 + ampOut * 0.12).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      // ── Subtle rotating rings (thin, faded arcs — not dashed) ──
      for (let rIdx = 0; rIdx < 2; rIdx++) {
        const ringR = R * (1.28 + rIdx * 0.14);
        const rot = t * (0.12 + rIdx * 0.05) * (rIdx % 2 === 0 ? 1 : -1) + seed[rIdx + 5];
        const span = Math.PI * (0.55 + 0.2 * Math.sin(t * 0.3 + rIdx));
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, rot, rot + span);
        ctx.strokeStyle = `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},${(0.16 * cur.glow).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // ── Deep central core + radial blue energy ──
      const coreR = R * 0.52 * (1 + ampOut * 0.08);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, '#020617');
      coreGrad.addColorStop(0.62, '#040a1c');
      coreGrad.addColorStop(0.88, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},0.28)`);
      coreGrad.addColorStop(1, `rgba(${colMain[0] | 0},${colMain[1] | 0},${colMain[2] | 0},0.05)`);
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = coreGrad;
      ctx.fill();
      // Inner energy shimmer.
      const shimmer = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 0.8);
      const sh = (0.10 + 0.10 * Math.sin(t * cur.pulse * 1.3) + ampIn * 0.22 + ampOut * 0.25) * cur.glow;
      shimmer.addColorStop(0, `rgba(${colSoft[0] | 0},${colSoft[1] | 0},${colSoft[2] | 0},${sh.toFixed(3)})`);
      shimmer.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shimmer;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 0.8, 0, Math.PI * 2);
      ctx.fill();

      // ── Processing burst: 40–60 thin particles (thinking only) ──
      const targetCount = Math.round(cur.particleTarget);
      while (particles.length < targetCount) {
        particles.push({
          angle: Math.random() * Math.PI * 2,
          radius: coreR * (0.6 + Math.random() * 0.5),
          speed: 0.25 + Math.random() * 0.55,
          life: 0,
          maxLife: 1.6 + Math.random() * 1.8,
          size: 0.6 + Math.random() * 1.1,
        });
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        p.radius += p.speed * dt * R * 0.35;
        p.angle += dt * 0.4;
        if (p.life > p.maxLife || p.radius > R * 1.55 || particles.length > targetCount + 12) {
          if (particles.length > targetCount) { particles.splice(i, 1); continue; }
          // recycle while burst is wanted
          p.life = 0; p.radius = coreR * (0.6 + Math.random() * 0.5);
          p.angle = Math.random() * Math.PI * 2;
          p.maxLife = 1.6 + Math.random() * 1.8;
        }
        const fade = Math.sin(Math.min(1, p.life / p.maxLife) * Math.PI);
        const x = cx + Math.cos(p.angle) * p.radius;
        const y = cy + Math.sin(p.angle) * p.radius;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colSoft[0] | 0},${colSoft[1] | 0},${colSoft[2] | 0},${(0.5 * fade).toFixed(3)})`;
        ctx.fill();
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
      // Reduced motion: ONE static frame, zero animation frames.
      drawFrame(0.016);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // size is stable for the lifetime of the mount; state/levels flow via refs.
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
