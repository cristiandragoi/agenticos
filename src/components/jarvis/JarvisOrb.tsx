import React, { useEffect, useRef, useState } from 'react';

/**
 * JarvisOrb — the reactive orb for the Jarvis interface (V2 visual redesign).
 *
 * V2 replaces the rigid radar/dashed-ring look with an organic, fluid,
 * layered membrane:
 *   - A softly deforming silhouette (multi-harmonic radial distortion —
 *     smooth, asymmetrical, never polygonal, no dashed rings).
 *   - Three translucent internal layers over a dark central core, wrapped
 *     in a soft luminous halo, with subtle edge highlights that drift.
 *   - Per-state motion: idle breathes and drifts slowly; listening deforms
 *     with REAL microphone amplitude; transcribing rotates tightly inside;
 *     thinking orbits soft amber energy; speaking deforms with REAL playback
 *     amplitude; error pulses restrainedly; offline is nearly still.
 *   - Smooth ~300 ms state transitions (exponential smoothing of colour AND
 *     motion parameters — no snapping, no flashing).
 *
 * Contract (unchanged from V1):
 *  - The orb visualises ONLY real runtime states. It never fakes listening,
 *    thinking or speaking with timers or random motion.
 *  - `inputLevel`  = normalised microphone amplitude (0..1). Used ONLY in the
 *    `listening` state — membrane deformation + glow react to real mic data.
 *  - `outputLevel` = normalised playback amplitude (0..1). Used ONLY in the
 *    `speaking` state, which itself must only be entered after a real
 *    playback-start confirmation from the audio pipeline.
 *  - Supports `prefers-reduced-motion` (prop override or media query): the
 *    orb renders a static frame, no animation loop, no level-driven scaling.
 *  - Canvas 2D + one requestAnimationFrame loop. The loop and every listener
 *    are cancelled on unmount. Drawing is skipped safely when no 2D context
 *    is available (e.g. jsdom tests) — the DOM contract (state attribute,
 *    label, transform) still holds.
 *  - Animation state lives in a ref and is NOT re-created on state changes,
 *    so colour/motion transitions stay continuous across state switches and
 *    prop changes never restart the rAF loop (no extra React rerenders).
 */

export type JarvisVisualState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'offline'
  // Extended semantic states (spec §13)
  | 'reasoning'   // cyan/white — model processing/routing
  | 'executing'   // strong cyan — operational/running agent
  | 'delegated'   // pink — secondary agent active
  | 'repairing'   // purple (distinct from speaking) — corrective work
  | 'warning'     // yellow — diagnostic/attention
  | 'completed';  // green — success

export interface JarvisOrbProps {
  state: JarvisVisualState;
  /** Normalised microphone amplitude 0..1 (reactivity for `listening`). */
  inputLevel?: number;
  /** Normalised playback amplitude 0..1 (reactivity for `speaking`). */
  outputLevel?: number;
  /** Override the default readable label rendered below the orb. */
  label?: string;
  /** Explicit pixel size; fills the parent when omitted. */
  size?: number;
  /** Force reduced-motion rendering; otherwise prefers-reduced-motion is used. */
  reducedMotion?: boolean;
}

/** Readable state labels shown below the orb. */
export const JARVIS_ORB_LABELS: Record<JarvisVisualState, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Error',
  offline: 'Offline',
  reasoning: 'Reasoning…',
  executing: 'Executing…',
  delegated: 'Delegated…',
  repairing: 'Repairing…',
  warning: 'Warning',
  completed: 'Completed',
};

/** Colour contract (hex) for each visual state. */
export const JARVIS_ORB_COLORS: Record<JarvisVisualState, string> = {
  idle: '#00e5ff', // cyan / soft white core
  listening: '#3b82f6', // blue
  transcribing: '#22c55e', // green
  thinking: '#f5b50a', // yellow / amber
  speaking: '#a855f7', // purple
  error: '#ef4444', // red
  offline: '#7f1d1d', // dark red
  // Extended semantic states
  reasoning: '#e0f2fe', // cyan-white — model reasoning/processing
  executing: '#00d4ff', // strong cyan — operational/running
  delegated: '#ec4899', // pink — secondary agent activity
  repairing: '#9333ea', // deeper purple — corrective work
  warning: '#f59e0b', // amber/yellow — diagnostic attention
  completed: '#22c55e', // green — success
};

/* Per-state motion tuning. Everything is a deterministic function of time
   and the real level props — no fake randomness anywhere. */
interface MotionParams {
  /** Phase-drift speed of the membrane harmonics (rad/s). 0 ≈ still. */
  drift: number;
  /** Base membrane distortion amplitude (fraction of radius). */
  distort: number;
  /** Extra distortion per unit of the state's active real level. */
  levelGain: number;
  /** Breathing amplitude (fraction of radius). */
  breatheAmp: number;
  /** Breathing frequency (rad/s). */
  breatheFreq: number;
  /** Base halo glow alpha. */
  glowBase: number;
  /** Extra halo alpha per unit of active real level. */
  glowGain: number;
  /** Inner-layer spin multiplier (tight internal rotation when high). */
  innerSpin: number;
  /** Orbit speed of the drifting edge highlights. */
  highlightSpeed: number;
  /** 1 = show the slow orbiting energy bloom (thinking). */
  orbitEnergy: number;
  /** Central-core darkness alpha. */
  coreDark: number;
}

const MOTION: Record<JarvisVisualState, MotionParams> = {
  // Slow breathing + gentle fluid drift.
  idle: { drift: 0.22, distort: 0.05, levelGain: 0, breatheAmp: 0.045, breatheFreq: 0.9, glowBase: 0.3, glowGain: 0, innerSpin: 0.5, highlightSpeed: 0.16, orbitEnergy: 0, coreDark: 0.9 },
  // Blue surface deformation driven by real inputLevel.
  listening: { drift: 1.1, distort: 0.045, levelGain: 0.1, breatheAmp: 0.03, breatheFreq: 1.6, glowBase: 0.38, glowGain: 0.45, innerSpin: 0.9, highlightSpeed: 0.5, orbitEnergy: 0, coreDark: 0.88 },
  // Green, tighter internal rotation.
  transcribing: { drift: 0.8, distort: 0.04, levelGain: 0.02, breatheAmp: 0.02, breatheFreq: 2.4, glowBase: 0.42, glowGain: 0.1, innerSpin: 2.6, highlightSpeed: 0.85, orbitEnergy: 0, coreDark: 0.85 },
  // Yellow/amber slow orbiting energy.
  thinking: { drift: 0.5, distort: 0.05, levelGain: 0.03, breatheAmp: 0.03, breatheFreq: 1.2, glowBase: 0.44, glowGain: 0.06, innerSpin: 0.8, highlightSpeed: 0.32, orbitEnergy: 1, coreDark: 0.86 },
  // Purple deformation driven by real outputLevel.
  speaking: { drift: 1.4, distort: 0.05, levelGain: 0.12, breatheAmp: 0.035, breatheFreq: 2.0, glowBase: 0.4, glowGain: 0.5, innerSpin: 1.1, highlightSpeed: 0.55, orbitEnergy: 0, coreDark: 0.88 },
  // Red, restrained slow pulse — small amplitude, no rapid flashing.
  error: { drift: 0.12, distort: 0.025, levelGain: 0, breatheAmp: 0.025, breatheFreq: 2.2, glowBase: 0.34, glowGain: 0, innerSpin: 0.3, highlightSpeed: 0.08, orbitEnergy: 0, coreDark: 0.9 },
  // Dark red, nearly still.
  offline: { drift: 0.015, distort: 0.012, levelGain: 0, breatheAmp: 0.006, breatheFreq: 0.3, glowBase: 0.18, glowGain: 0, innerSpin: 0.05, highlightSpeed: 0.02, orbitEnergy: 0, coreDark: 0.92 },
  // Cyan-white — fast drift, orbiting energy, high inner spin (model reasoning).
  reasoning: { drift: 0.75, distort: 0.055, levelGain: 0, breatheAmp: 0.025, breatheFreq: 1.8, glowBase: 0.52, glowGain: 0.04, innerSpin: 1.6, highlightSpeed: 0.6, orbitEnergy: 0.8, coreDark: 0.82 },
  // Strong cyan — higher drift + distortion than idle, active inner spin (running).
  executing: { drift: 1.3, distort: 0.065, levelGain: 0.02, breatheAmp: 0.035, breatheFreq: 2.2, glowBase: 0.46, glowGain: 0.1, innerSpin: 2.0, highlightSpeed: 0.9, orbitEnergy: 0.4, coreDark: 0.84 },
  // Pink — moderate drift + visible glow pulse (secondary agent active).
  delegated: { drift: 0.9, distort: 0.05, levelGain: 0, breatheAmp: 0.04, breatheFreq: 1.5, glowBase: 0.45, glowGain: 0.08, innerSpin: 1.2, highlightSpeed: 0.45, orbitEnergy: 0.3, coreDark: 0.86 },
  // Deep purple — slow orbit energy, moderate spin (corrective/repair work).
  repairing: { drift: 0.6, distort: 0.045, levelGain: 0, breatheAmp: 0.03, breatheFreq: 1.1, glowBase: 0.42, glowGain: 0.05, innerSpin: 0.9, highlightSpeed: 0.35, orbitEnergy: 0.7, coreDark: 0.87 },
  // Yellow — slow pulse, gentle orbit (diagnostic/warning attention).
  warning: { drift: 0.4, distort: 0.04, levelGain: 0, breatheAmp: 0.035, breatheFreq: 1.0, glowBase: 0.4, glowGain: 0.04, innerSpin: 0.6, highlightSpeed: 0.25, orbitEnergy: 0.5, coreDark: 0.88 },
  // Green — brief bright flash then settles (success/completed).
  completed: { drift: 0.55, distort: 0.04, levelGain: 0, breatheAmp: 0.05, breatheFreq: 1.4, glowBase: 0.48, glowGain: 0.06, innerSpin: 1.4, highlightSpeed: 0.6, orbitEnergy: 0, coreDark: 0.84 },
};

/** Smoothing time constant (s): ~95 % settled in ~3τ ≈ 330–360 ms. */
const TRANSITION_TAU = 0.115;

const TAU = Math.PI * 2;
/** Samples along one membrane contour — dense enough to stay perfectly smooth. */
const MEMBRANE_POINTS = 96;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${clamp01(a).toFixed(3)})`;
}

function blend(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/**
 * Organic membrane radius: a constant seed-based asymmetry (never animated,
 * so the silhouette is organic in EVERY frame — it can never collapse into a
 * perfect circle) plus three drifting harmonics with independent phases that
 * morph the surface smoothly. Deterministic in (theta, phase) — never random.
 */
function membraneRadius(theta: number, R: number, distort: number, phase: number, seed: number): number {
  const a0 = distort * 0.7;
  const a1 = distort * 0.5;
  const a2 = distort * 0.32;
  const a3 = distort * 0.18;
  return R * (1
    + a0 * Math.sin(theta + seed * 2.6)
    + a1 * Math.sin(2 * theta + seed + phase * 0.9)
    + a2 * Math.sin(3 * theta - seed * 1.7 + phase * 1.6)
    + a3 * Math.sin(5 * theta + seed * 2.3 + phase * 2.3));
}

/** Trace a smooth closed membrane contour (midpoint quadratic smoothing). */
function traceMembrane(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  distort: number,
  phase: number,
  seed: number,
): void {
  const N = MEMBRANE_POINTS;
  const xs = new Float32Array(N);
  const ys = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * TAU;
    const rr = membraneRadius(th, R, distort, phase, seed);
    xs[i] = cx + Math.cos(th) * rr;
    ys[i] = cy + Math.sin(th) * rr;
  }
  ctx.beginPath();
  let mx = (xs[N - 1] + xs[0]) / 2;
  let my = (ys[N - 1] + ys[0]) / 2;
  ctx.moveTo(mx, my);
  for (let i = 0; i < N; i++) {
    const nx = (xs[i] + xs[(i + 1) % N]) / 2;
    const ny = (ys[i] + ys[(i + 1) % N]) / 2;
    ctx.quadraticCurveTo(xs[i], ys[i], nx, ny);
    mx = nx;
    my = ny;
  }
  ctx.closePath();
}

/**
 * A drifting edge highlight: an arc segment following the outer membrane,
 * faded smoothly at both ends (sin envelope) so it reads as light catching
 * the rim of the membrane — never as a hard or dashed ring segment.
 */
function strokeEdgeHighlight(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  distort: number,
  phase: number,
  seed: number,
  startAngle: number,
  span: number,
  color: [number, number, number],
  alphaPeak: number,
  lineWidth: number,
): void {
  const segs = 10;
  const sub = 3;
  ctx.lineWidth = lineWidth;
  for (let i = 0; i < segs; i++) {
    const tMid = (i + 0.5) / segs;
    const a = alphaPeak * Math.sin(Math.PI * tMid); // fade to zero at both ends
    if (a < 0.008) continue;
    ctx.strokeStyle = rgba(color, a);
    ctx.beginPath();
    for (let j = 0; j <= sub; j++) {
      const th = startAngle + ((i + j / sub) / segs) * span;
      const rr = membraneRadius(th, R, distort, phase, seed);
      const x = cx + Math.cos(th) * rr;
      const y = cy + Math.sin(th) * rr;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

interface DrawParams {
  state: JarvisVisualState;
  color: [number, number, number];
  /** Smoothed motion parameters (continuous across state changes). */
  p: MotionParams;
  /** Accumulated membrane drift phase. */
  phase: number;
  /** Accumulated inner-layer phase (tight rotation). */
  innerPhase: number;
  /** Accumulated edge-highlight orbit phase. */
  hlPhase: number;
  /** Current breathing offset (sin already applied). */
  breathe: number;
  /** The state's real level (mic for listening, playback for speaking). */
  level: number;
}

function drawOrb(ctx: CanvasRenderingContext2D, w: number, h: number, p: DrawParams): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = (Math.min(w, h) / 2) * 0.82;
  if (r <= 2) return;

  const { color } = p;
  const glowAlpha = clamp01(p.p.glowBase + p.p.glowGain * p.level);
  const distort = clamp01(p.p.distort + p.p.levelGain * p.level);

  // ── Layer 0: soft luminous outer halo ─────────────────────────────────
  const haloR = r * 1.45;
  const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, haloR);
  halo.addColorStop(0, rgba(color, glowAlpha * 0.5));
  halo.addColorStop(0.55, rgba(color, glowAlpha * 0.22));
  halo.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, TAU);
  ctx.fill();

  // ── Layer 1: outer translucent membrane (the organic silhouette) ──────
  const breatheScale = 1 + p.breathe;
  const Ro = r * 0.98 * breatheScale;
  traceMembrane(ctx, cx, cy, Ro, distort, p.phase, 0);
  const outer = ctx.createRadialGradient(cx, cy, 0, cx, cy, Ro * 1.06);
  outer.addColorStop(0, rgba(color, 0.04));
  outer.addColorStop(0.62, rgba(color, 0.08));
  outer.addColorStop(0.88, rgba(color, 0.3));
  outer.addColorStop(1, rgba(color, 0.14));
  ctx.fillStyle = outer;
  ctx.fill();

  // ── Layer 2: middle translucent membrane (offset phase → parallax) ────
  const Rm = r * 0.74 * breatheScale;
  traceMembrane(ctx, cx, cy, Rm, distort * 0.85, p.phase * 1.15, 2.4);
  const middle = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rm * 1.08);
  middle.addColorStop(0, rgba(color, 0.03));
  middle.addColorStop(0.68, rgba(color, 0.12));
  middle.addColorStop(1, rgba(color, 0.34));
  ctx.fillStyle = middle;
  ctx.fill();

  // ── Layer 3: inner membrane — tight internal rotation ────────────────
  const Ri = r * 0.52 * breatheScale;
  traceMembrane(ctx, cx, cy, Ri, distort * 0.7, p.innerPhase, 4.9);
  const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, Ri * 1.1);
  inner.addColorStop(0, rgba(color, 0.05));
  inner.addColorStop(0.6, rgba(color, 0.16));
  inner.addColorStop(1, rgba(color, 0.42));
  ctx.fillStyle = inner;
  ctx.fill();

  // ── Dark central core with soft edge ──────────────────────────────────
  const coreR = r * 0.3 * (1 + p.breathe * 0.6);
  const dark = blend([8, 10, 16], color, 0.1);
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, rgba(dark, p.p.coreDark));
  core.addColorStop(0.65, rgba(dark, p.p.coreDark * 0.8));
  core.addColorStop(1, rgba(color, 0.06));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, TAU);
  ctx.fill();

  // ── Thinking: slow orbiting energy bloom inside the membrane ──────────
  if (p.p.orbitEnergy > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ang = p.hlPhase * 2.4 + 0.7;
    const ox = cx + Math.cos(ang) * r * 0.6;
    const oy = cy + Math.sin(ang) * r * 0.6;
    const er = r * 0.13;
    const bloom = ctx.createRadialGradient(ox, oy, 0, ox, oy, er);
    bloom.addColorStop(0, rgba(color, 0.55 * p.p.orbitEnergy));
    bloom.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(ox, oy, er, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ── Subtle moving edge highlights along the outer membrane ────────────
  // Soft rim light, faded at both ends — reads as light catching the
  // membrane surface, never as a hard or dashed ring segment.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const hlPeak = 0.16 + p.level * 0.2;
  const segments: Array<[number, number]> = [
    [p.hlPhase, 1.15],
    [p.hlPhase + Math.PI * 1.15, 0.85],
  ];
  for (const [start, span] of segments) {
    strokeEdgeHighlight(ctx, cx, cy, Ro, distort, p.phase, 0, start, span, color, hlPeak, Math.max(1.5, r * 0.045));
  }
  ctx.restore();
}

interface AnimState {
  phase: number;
  innerPhase: number;
  hlPhase: number;
  breathePhase: number;
  color: [number, number, number];
  p: MotionParams;
  last: number;
}

function createAnim(state: JarvisVisualState): AnimState {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    phase: 0,
    innerPhase: 0,
    hlPhase: 0,
    breathePhase: 0,
    color: hexToRgb(JARVIS_ORB_COLORS[state]),
    p: { ...MOTION[state] },
    last: now,
  };
}

export const JarvisOrb: React.FC<JarvisOrbProps> = ({
  state,
  inputLevel = 0,
  outputLevel = 0,
  label,
  size,
  reducedMotion,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);

  // Live values read by the animation loop without restarting it.
  const liveRef = useRef({ state, input: clamp01(inputLevel), output: clamp01(outputLevel) });
  liveRef.current.state = state;
  liveRef.current.input = clamp01(inputLevel);
  liveRef.current.output = clamp01(outputLevel);

  // Persistent animation state — survives prop/state changes so colour and
  // motion transitions stay continuous and the rAF loop is never restarted.
  const animRef = useRef<AnimState | null>(null);

  // prefers-reduced-motion (guarded — matchMedia may be absent, e.g. jsdom).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(mq.matches);
    update();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    return undefined;
  }, []);

  const isReduced = reducedMotion ?? systemReducedMotion;

  // Keep the canvas backing store in sync with the laid-out size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const core = coreRef.current;
    if (!canvas || !core) return undefined;
    const resize = () => {
      const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
      const w = core.clientWidth;
      const h = core.clientHeight;
      if (w > 0 && h > 0) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(resize);
      ro.observe(core);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Animation loop — one persistent rAF chain, cancelled on unmount or when
  // reduced motion turns on. State/level changes flow through refs only.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas ? canvas.getContext('2d') : null;
    if (!animRef.current) animRef.current = createAnim(liveRef.current.state);
    const anim = animRef.current;

    const frame = (staticFrame: boolean) => {
      const live = liveRef.current;
      const targetP = MOTION[live.state];

      if (staticFrame) {
        // Reduced motion: snap to the target look, draw once, no motion.
        anim.color = hexToRgb(JARVIS_ORB_COLORS[live.state]);
        anim.p = { ...targetP };
        if (!canvas || !ctx) return;
        drawOrb(ctx, canvas.width, canvas.height, {
          state: live.state,
          color: anim.color,
          p: anim.p,
          phase: 0,
          innerPhase: 0,
          hlPhase: 0.6,
          breathe: 0,
          level: 0,
        });
        return;
      }

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = Math.min(0.1, (now - anim.last) / 1000);
      anim.last = now;

      // Smooth (~300 ms) convergence of colour AND every motion parameter —
      // no abrupt snapping between states.
      const k = 1 - Math.exp(-dt / TRANSITION_TAU);
      const targetC = hexToRgb(JARVIS_ORB_COLORS[live.state]);
      anim.color = blend(anim.color, targetC, k);
      const p = anim.p;
      p.drift += (targetP.drift - p.drift) * k;
      p.distort += (targetP.distort - p.distort) * k;
      p.levelGain += (targetP.levelGain - p.levelGain) * k;
      p.breatheAmp += (targetP.breatheAmp - p.breatheAmp) * k;
      p.breatheFreq += (targetP.breatheFreq - p.breatheFreq) * k;
      p.glowBase += (targetP.glowBase - p.glowBase) * k;
      p.glowGain += (targetP.glowGain - p.glowGain) * k;
      p.innerSpin += (targetP.innerSpin - p.innerSpin) * k;
      p.highlightSpeed += (targetP.highlightSpeed - p.highlightSpeed) * k;
      p.orbitEnergy += (targetP.orbitEnergy - p.orbitEnergy) * k;
      p.coreDark += (targetP.coreDark - p.coreDark) * k;

      // Accumulate phases.
      anim.phase += dt * p.drift;
      anim.innerPhase += dt * p.drift * p.innerSpin;
      anim.hlPhase += dt * p.highlightSpeed;
      anim.breathePhase += dt * p.breatheFreq;

      const level = live.state === 'listening' ? live.input : live.state === 'speaking' ? live.output : 0;
      const breathe = p.breatheAmp * Math.sin(anim.breathePhase);

      if (!canvas || !ctx) return;
      drawOrb(ctx, canvas.width, canvas.height, {
        state: live.state,
        color: anim.color,
        p,
        phase: anim.phase,
        innerPhase: anim.innerPhase,
        hlPhase: anim.hlPhase,
        breathe,
        level,
      });
    };

    if (isReduced) {
      frame(true); // single static frame, no loop, no rAF
      return undefined;
    }

    let raf: number | null = null;
    let disposed = false;
    const loop = () => {
      if (disposed) return;
      frame(false);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [isReduced]);

  // DOM-level reactivity (also observable without a canvas context):
  // listening scales with real mic amplitude, speaking with real playback amplitude.
  const activeLevel =
    state === 'listening' ? clamp01(inputLevel) : state === 'speaking' ? clamp01(outputLevel) : 0;
  const scale = isReduced ? 1 : 1 + activeLevel * 0.14;

  return (
    <div
      data-testid="jarvis-orb"
      data-orb-state={state}
      data-reduced-motion={isReduced ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        ref={coreRef}
        data-testid="jarvis-orb-core"
        style={{
          position: 'relative',
          width: size ? `${size}px` : '100%',
          height: size ? `${size}px` : '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: size ? '1 / 1' : undefined,
          transform: `scale(${scale.toFixed(3)})`,
          transition: isReduced ? 'none' : 'transform 120ms ease-out',
        }}
      >
        <canvas ref={canvasRef} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div
        data-testid="jarvis-orb-label"
        aria-live="polite"
        style={{
          fontFamily: 'monospace',
          fontSize: '0.8125rem',
          letterSpacing: '0.08em',
          color: JARVIS_ORB_COLORS[state],
          textTransform: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {label ?? JARVIS_ORB_LABELS[state]}
      </div>
    </div>
  );
};

export default JarvisOrb;
