/**
 * JarvisNeuralCore V4 — "Visual Universe": JARVIS + persistent Projects +
 * contextual Capabilities.
 *
 * Architecture: Canvas 2D (no WebGL/Three.js — no new deps).
 *
 * Rendering layers (back → front):
 *   1. Outer energy field  — translucent halo, slow organic deformation
 *   2. Persistent project ring — REAL projects (stable spatial memory) with
 *      curved persistent connections to the core
 *   3. Central core        — organic deforming sphere (calm, focus-driven)
 *   4. Nucleus             — restrained luminous center
 *   5. Contextual capability satellites — illuminate from REAL activity only
 *
 * Deliberate changes vs V4 (Visual Universe correction):
 *   - REMOVED the execution-graph look: Mission/Runs/Builds (PROJECTS/RUNS/
 *     ARTIFACTS) are no longer permanent satellites — they are execution
 *     views, not universe objects. Only CONTEXTUAL capabilities render:
 *     Memory / Research / Hermes / Vision / CodeX / Magnitude.
 *   - CONNECTIONS are calm: only the focused Project gets a primary curved
 *     connection; at most ONE contextual capability connection appears (the
 *     most-active one); every other node is a subtle ring with no line. No
 *     all-node spoke fan from the center.
 *   - Project stars come PRE-FILTERED (src/lib/universeProjects.ts): only
 *     canonical persisted user projects reach this component. Acceptance/
 *     test artifacts never become stars.
 *   - LOCKED palette: yellow / pink / orange / purple / turquoise / red only.
 *   - Calm focus-based motion: slower breathing, reduced particle drift,
 *     no random impulse bursts.
 *
 * State contract: unchanged — all visual state from REAL runtime props; no
 * timers pretend work. Test contract unchanged: same data-testid attrs, same
 * aria-label format, same onNodeClick hit-testing, same rAF cleanup.
 */
import { useEffect, useRef } from 'react';
import type { BlobVisualState, NeuralNodeId } from './neuralBlobState';
import { NODE_DIRECTION, NODE_ROUTES, nodePulse, toBlobVisualState, modelLabel } from './neuralBlobState';

export interface ProjectNode {
  id: string;
  name: string;
  color?: string | null;
}

export interface JarvisNeuralBlobProps {
  state: string;
  inputLevel?: number;
  outputLevel?: number;
  nodeActivity?: Partial<Record<string, number>>;
  provider?: string | null;
  model?: string | null;
  size?: number;
  testIdPrefix?: string;
  onNodeClick?: (node: NeuralNodeId) => void;
  /** Persistent projects (Visual Universe). Rendered at stable positions. */
  projects?: ProjectNode[];
  activeProjectId?: string | null;
  onProjectClick?: (projectId: string) => void;
}

// Contextual capability satellites — the ONLY satellites rendered in the
// universe. Mission/Runs/Builds (PROJECTS/RUNS/ARTIFACTS) are execution views
// and must NOT become permanent universe stars. CodeX + Magnitude are
// delegation capabilities and appear only when real runtime activity lights
// them. The full NeuralNodeId union (state module) keeps its routes for the
// click/navigation contract; only this contextual set is drawn.
const CONTEXTUAL_CAPABILITIES: NeuralNodeId[] = ['MEMORY', 'KNOWLEDGE', 'HERMES', 'VISION', 'CODEX', 'MAGNITUDE'];

const NODE_LABELS: Record<NeuralNodeId, string> = {
  MEMORY: 'Memory',
  KNOWLEDGE: 'Research',
  PROJECTS: 'Mission',
  HERMES: 'Hermes',
  RUNS: 'Runs',
  ARTIFACTS: 'Builds',
  VISION: 'Vision',
  CODEX: 'CodeX',
  MAGNITUDE: 'Magnitude',
};

// ── LOCKED PALETTE (Visual Universe) ────────────────────────────────────────
// yellow / pink / orange / purple / turquoise / red — the ONLY accent colors.
// Everything else (halo, depth) is derived from these six, never arbitrary.
const YELLOW: [number, number, number] = [250, 204, 21];   // #FACC15
const PINK: [number, number, number] = [236, 72, 153];     // #EC4899
const ORANGE: [number, number, number] = [249, 115, 22];   // #F97316
const PURPLE: [number, number, number] = [168, 85, 247];   // #A855F7
const TURQUOISE: [number, number, number] = [20, 184, 166]; // #14B8A6
const RED: [number, number, number] = [239, 68, 68];       // #EF4444

const LOCKED_PALETTE: [number, number, number][] = [YELLOW, PINK, ORANGE, PURPLE, TURQUOISE, RED];

/** Capability satellites — each maps to one locked-palette color. */
const NODE_COLORS: Record<NeuralNodeId, [number, number, number]> = {
  MEMORY: PURPLE,
  KNOWLEDGE: TURQUOISE,
  PROJECTS: YELLOW,
  HERMES: PINK,
  RUNS: ORANGE,
  ARTIFACTS: ORANGE,
  VISION: TURQUOISE,
  CODEX: ORANGE,
  MAGNITUDE: YELLOW,
};

/** Central-core color per blob state — locked palette only. */
function coreColor(st: BlobVisualState): [number, number, number] {
  switch (st) {
    case 'LISTENING': return YELLOW;
    case 'THINKING': return PURPLE;
    case 'ACTING': return ORANGE;
    case 'SPEAKING': return PINK;
    case 'COMPLETED': return TURQUOISE;
    case 'ERROR': return RED;
    default: return TURQUOISE; // IDLE
  }
}

// Per-state rendering parameters (calm, focus-based motion).
interface StateParams {
  breath: number;        // breathing amplitude
  energy: number;        // internal activity [0..1]
  noiseAmp: number;      // outer deformation amplitude
  glow: number;          // outer glow intensity
  particleSpeed: number; // internal particle drift (calm)
  nucleusPulse: number;  // nucleus visibility
  fieldRadius: number;   // outer energy field radius multiplier
}

function stateParams(st: BlobVisualState): StateParams {
  switch (st) {
    case 'LISTENING': return { breath: 0.05, energy: 0.45, noiseAmp: 0.05, glow: 0.55, particleSpeed: 0.5, nucleusPulse: 0.4, fieldRadius: 1.16 };
    case 'THINKING': return { breath: 0.045, energy: 0.78, noiseAmp: 0.075, glow: 0.72, particleSpeed: 0.9, nucleusPulse: 0.72, fieldRadius: 1.2 };
    case 'ACTING': return { breath: 0.06, energy: 0.9, noiseAmp: 0.085, glow: 0.8, particleSpeed: 1.1, nucleusPulse: 0.8, fieldRadius: 1.22 };
    case 'SPEAKING': return { breath: 0.06, energy: 0.58, noiseAmp: 0.07, glow: 0.62, particleSpeed: 0.7, nucleusPulse: 0.55, fieldRadius: 1.18 };
    case 'COMPLETED': return { breath: 0.035, energy: 0.3, noiseAmp: 0.035, glow: 0.48, particleSpeed: 0.35, nucleusPulse: 0.32, fieldRadius: 1.13 };
    case 'ERROR': return { breath: 0.07, energy: 0.5, noiseAmp: 0.1, glow: 0.6, particleSpeed: 0.6, nucleusPulse: 0.5, fieldRadius: 1.15 };
    default: return { breath: 0.02, energy: 0.14, noiseAmp: 0.025, glow: 0.3, particleSpeed: 0.22, nucleusPulse: 0.18, fieldRadius: 1.1 };
  }
}

// Smooth noise (simplified fbm) for organic deformation.
function noise(x: number, y: number, t: number): number {
  return Math.sin(x * 1.7 + t * 0.7) * 0.5 +
         Math.sin(y * 2.1 + t * 0.5 + 1.3) * 0.3 +
         Math.sin((x + y) * 1.3 + t * 0.9 + 2.7) * 0.2;
}

function organicRadius(baseRadius: number, angle: number, t: number, noiseAmp: number, energy: number): number {
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const n1 = noise(nx, ny, t * 0.35) * noiseAmp;
  const n2 = noise(nx * 2.1, ny * 1.8, t * 0.6 + 1.4) * (noiseAmp * 0.5);
  const n3 = energy * 0.012 * Math.sin(t * 2.6 + angle * 4.7);
  return baseRadius * (1 + n1 + n2 + n3);
}

/** Capability node position on the INNER orbit ellipse. */
function nodePosition(i: number, cx: number, cy: number, rx: number, ry: number): { x: number; y: number; angle: number } {
  const angle = -Math.PI / 2 + (i / CONTEXTUAL_CAPABILITIES.length) * Math.PI * 2;
  return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, angle };
}

/**
 * Stable spatial memory for projects: a project's orbit angle is a pure
 * function of its id (FNV-1a hash). The same project ALWAYS lands at the same
 * place, across sessions, restarts, and reordering — no stored state to drift.
 */
function stableProjectAngle(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967295) * Math.PI * 2;
}

export function JarvisNeuralBlob({
  state, inputLevel = 0, outputLevel = 0, nodeActivity, provider, model,
  size = 280, testIdPrefix = 'jarvis-neural', onNodeClick,
  projects = [], activeProjectId = null, onProjectClick,
}: JarvisNeuralBlobProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visualState: BlobVisualState = toBlobVisualState(state);
  const pulses = nodePulse(nodeActivity);
  const label = modelLabel(provider, model);
  const testId = testIdPrefix;

  // Live props (projects / active project / click) flow through a ref so the
  // rAF loop never restarts on a projects-array identity change.
  const liveRef = useRef({ projects, activeProjectId, onProjectClick });
  liveRef.current = { projects, activeProjectId, onProjectClick };

  // All animation state lives in a ref — never recreated on prop change.
  const animRef = useRef({
    t: 0,
    currentParams: stateParams('IDLE') as StateParams,
    // Smoothed core RGB (locked-palette color, lerped per frame).
    rgb: [...coreColor('IDLE')] as [number, number, number],
    particles: [] as Array<{ x: number; y: number; z: number; vx: number; vy: number; s: number; op: number }>,
    nucleusPhase: Math.random() * Math.PI * 2,
    initialized: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = size;
    canvas.width = S * dpr;
    canvas.height = S * dpr;
    ctx.scale(dpr, dpr);

    const cx = S / 2;
    const cy = S / 2;
    const coreRadius = S * 0.22;
    // Capability orbit (inner ring).
    const capRx = S * 0.30;
    const capRy = S * 0.27;
    // Project orbit (outer ring) — persistent Projects live here.
    const projRx = S * 0.44;
    const projRy = S * 0.41;

    const anim = animRef.current;

    if (!anim.initialized) {
      anim.initialized = true;
      anim.currentParams = { ...stateParams('IDLE') };
      anim.rgb = [...coreColor('IDLE')];
      // Depth particles — calm, sparse.
      anim.particles = [];
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const elevation = (Math.random() - 0.5) * Math.PI;
        const dist = 0.2 + Math.random() * 0.7;
        const r = dist * coreRadius;
        const z = 0.3 + Math.random() * 0.7;
        anim.particles.push({
          x: cx + Math.cos(angle) * Math.cos(elevation) * r,
          y: cy + Math.sin(elevation) * r * 0.7,
          z,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.18,
          s: 0.8 + Math.random() * 1.6,
          op: 0.12 + Math.random() * 0.35,
        });
      }
    }

    const schedule = (fn: () => void) => {
      if (typeof requestAnimationFrame === 'undefined') return 0;
      return requestAnimationFrame(fn);
    };
    const cancel = (id: number) => {
      if (typeof cancelAnimationFrame !== 'undefined' && id) cancelAnimationFrame(id);
    };

    let raf = 0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);
    const lerpRGB = (cur: [number, number, number], target: [number, number, number], k: number) => {
      cur[0] = lerp(cur[0], target[0], k);
      cur[1] = lerp(cur[1], target[1], k);
      cur[2] = lerp(cur[2], target[2], k);
    };
    const rgba = (c: [number, number, number], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

    // Compute the STABLE project layout once per projects-set (not per frame):
    // sorted by hash angle → evenly spaced slots (collision-free, deterministic).
    const projectLayout = () => {
      const list = [...liveRef.current.projects].sort((a, b) => stableProjectAngle(a.id) - stableProjectAngle(b.id));
      const n = list.length;
      return list.map((p, i) => {
        const angle = n === 0 ? 0 : -Math.PI / 2 + (i / n) * Math.PI * 2;
        return {
          project: p,
          x: cx + Math.cos(angle) * projRx,
          y: cy + Math.sin(angle) * projRy,
          angle,
          color: p.color ? hexToRgb(p.color) ?? LOCKED_PALETTE[stableIndex(p.id)] : LOCKED_PALETTE[stableIndex(p.id)],
        };
      });
    };

    const draw = () => {
      const dt = 0.016;
      anim.t += dt;
      const t = anim.t;

      const target = stateParams(visualState);
      const sp = anim.currentParams;
      const alpha = 0.035;
      sp.breath = lerp(sp.breath, target.breath, alpha);
      sp.energy = lerp(sp.energy, target.energy, alpha);
      sp.noiseAmp = lerp(sp.noiseAmp, target.noiseAmp, alpha);
      sp.glow = lerp(sp.glow, target.glow, alpha);
      sp.particleSpeed = lerp(sp.particleSpeed, target.particleSpeed, alpha);
      sp.nucleusPulse = lerp(sp.nucleusPulse, target.nucleusPulse, alpha);
      sp.fieldRadius = lerp(sp.fieldRadius, target.fieldRadius, alpha);
      lerpRGB(anim.rgb, coreColor(visualState), alpha * 2);

      const mic = visualState === 'LISTENING' ? inputLevel : 0;
      const spk = visualState === 'SPEAKING' ? outputLevel : 0;
      const [r, g, b] = anim.rgb;

      ctx.clearRect(0, 0, S, S);

      const breathing = 1 + sp.breath * Math.sin(t * 0.9) + mic * 0.05 + spk * 0.04;
      const baseR = coreRadius * breathing;

      // ── LAYER 1: Outer energy field (calm halo) ──
      ctx.save();
      const fieldR = baseR * sp.fieldRadius;
      const fieldPts: { x: number; y: number }[] = [];
      const NF = 32;
      for (let k = 0; k < NF; k++) {
        const a = (k / NF) * Math.PI * 2;
        const rr = organicRadius(fieldR, a, t * 0.12, 0.035, sp.energy * 0.25);
        fieldPts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.88 });
      }
      ctx.beginPath();
      for (let k = 0; k < NF; k++) {
        const p0 = fieldPts[(k - 1 + NF) % NF];
        const p1 = fieldPts[k];
        const p2 = fieldPts[(k + 1) % NF];
        const p3 = fieldPts[(k + 2) % NF];
        if (k === 0) ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
      }
      ctx.closePath();
      const fieldGrad = ctx.createRadialGradient(cx, cy, baseR * 0.7, cx, cy, fieldR * 1.1);
      fieldGrad.addColorStop(0, rgba(anim.rgb, 0.0));
      fieldGrad.addColorStop(0.5, rgba(anim.rgb, 0.04 + sp.glow * 0.05));
      fieldGrad.addColorStop(1, rgba(anim.rgb, 0.0));
      ctx.fillStyle = fieldGrad;
      ctx.fill();
      ctx.restore();

      // ── LAYER 2: Persistent project ring + curved persistent connections ──
      const projects = projectLayout();
      const activeProj = liveRef.current.activeProjectId;
      ctx.save();
      for (const p of projects) {
        const isActive = p.project.id === activeProj;
        // PRIMARY CONNECTION: only the focused project gets a calm curved
        // connection from the core. Non-focused projects are persistent
        // nodes with NO line — no all-node spoke fan from the center.
        if (isActive) {
          const edgeAngle = Math.atan2(p.y - cy, p.x - cx);
          const ex = cx + Math.cos(edgeAngle) * baseR * 0.98;
          const ey = cy + Math.sin(edgeAngle) * baseR * 0.94;
          const midX = (ex + p.x) * 0.5 + Math.cos(p.angle) * baseR * 0.35;
          const midY = (ey + p.y) * 0.5 + Math.sin(p.angle) * baseR * 0.28;
          // Soft breathing intensity — PERSISTENT (never drops to zero).
          const breathe = 0.5 + 0.5 * Math.sin(t * 0.5 + p.angle);
          const connAlpha = 0.5 + 0.2 * breathe;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.quadraticCurveTo(midX, midY, p.x, p.y);
          ctx.strokeStyle = rgba(p.color, connAlpha);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        // Project node (persistent, stable).
        const outerR = isActive ? 7.5 : 5.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, outerR, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(p.color, isActive ? 0.5 : 0.2);
        ctx.lineWidth = 1;
        ctx.stroke();
        const coreR = isActive ? 4.5 : 3.2;
        const nodeGrad = ctx.createRadialGradient(p.x - 1, p.y - 1, 0.5, p.x, p.y, coreR);
        nodeGrad.addColorStop(0, rgba(p.color, isActive ? 0.95 : 0.45));
        nodeGrad.addColorStop(1, rgba(p.color, isActive ? 0.4 : 0.16));
        ctx.beginPath();
        ctx.arc(p.x, p.y, coreR, 0, Math.PI * 2);
        ctx.shadowColor = rgba(p.color, isActive ? 0.7 : 0.1);
        ctx.shadowBlur = isActive ? 12 : 3;
        ctx.fillStyle = nodeGrad;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Label (truncated, persistent).
        const labelY = p.y + outerR + 9;
        ctx.font = `${isActive ? '600' : '400'} 8.5px Inter, ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const name = p.project.name.length > 14 ? `${p.project.name.slice(0, 13)}…` : p.project.name;
        ctx.fillStyle = isActive ? rgba(p.color, 0.95) : 'rgba(148,163,184,0.5)';
        ctx.fillText(name, p.x, labelY);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();

      // ── LAYER 3: Central core (organic, calm) ──
      const N = 20;
      const corePts: { x: number; y: number }[] = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const rr = organicRadius(baseR, a, t, sp.noiseAmp, sp.energy);
        corePts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.93 });
      }
      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const p0 = corePts[(k - 1 + N) % N];
        const p1 = corePts[k];
        const p2 = corePts[(k + 1) % N];
        const p3 = corePts[(k + 2) % N];
        if (k === 0) ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
      }
      ctx.closePath();

      // Deep radial gradient (locked color).
      const coreGrad = ctx.createRadialGradient(cx - baseR * 0.25, cy - baseR * 0.28, baseR * 0.05, cx, cy, baseR * 1.05);
      coreGrad.addColorStop(0, `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)},0.72)`);
      coreGrad.addColorStop(0.5, `rgba(${r},${g},${b},0.9)`);
      coreGrad.addColorStop(1, `rgba(${Math.max(0, r - 40)},${Math.max(0, g - 40)},${Math.max(0, b - 40)},0.8)`);

      ctx.shadowColor = rgba(anim.rgb, sp.glow);
      ctx.shadowBlur = 16 + sp.glow * 18 + spk * 12;
      ctx.fillStyle = coreGrad;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Inner specular highlight (drifting, calm).
      const hiX = cx - baseR * (0.24 + Math.sin(t * 0.32) * 0.05);
      const hiY = cy - baseR * (0.28 + Math.cos(t * 0.28) * 0.04);
      const hiGrad = ctx.createRadialGradient(hiX, hiY, 1, hiX, hiY, baseR * 0.5);
      hiGrad.addColorStop(0, 'rgba(255,255,255,0.26)');
      hiGrad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
      hiGrad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hiGrad;
      ctx.beginPath();
      ctx.ellipse(hiX, hiY, baseR * 0.46, baseR * 0.36, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Depth particles (calm drift).
      for (const p of anim.particles) {
        const drift = sp.particleSpeed * dt;
        p.x += p.vx * drift;
        p.y += p.vy * drift;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = baseR * (0.55 + p.z * 0.3);
        if (dist > maxDist) {
          const ang = Math.atan2(dy, dx) + Math.PI;
          p.x = cx + Math.cos(ang) * maxDist * 0.95;
          p.y = cy + Math.sin(ang) * maxDist * 0.95;
        }
      }
      for (const p of [...anim.particles].sort((a, b) => a.z - b.z)) {
        const depthScale = 0.4 + p.z * 0.6;
        const radius = p.s * depthScale * (0.7 + sp.energy * 0.4);
        const opacity = p.op * depthScale * (0.35 + sp.energy * 0.45);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = rgba(anim.rgb, opacity);
        ctx.fill();
      }

      // ── LAYER 4: Nucleus ──
      anim.nucleusPhase += dt * (0.6 + sp.nucleusPulse * 0.9);
      const nucleusR = baseR * (0.1 + sp.nucleusPulse * 0.07 * (1 + 0.3 * Math.sin(anim.nucleusPhase)));
      const nucleusGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusR * 1.6);
      nucleusGrad.addColorStop(0, `rgba(255,255,255,${0.5 + sp.nucleusPulse * 0.35})`);
      nucleusGrad.addColorStop(1, rgba(anim.rgb, 0));
      ctx.fillStyle = nucleusGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusR * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // ── LAYER 5: Contextual capability satellites ──
      // At most ONE contextual capability connection: the most-active
      // capability (act > 0.1) may draw a single calm curved connection.
      // All other capabilities render as subtle rings only — no spoke fan.
      let primaryCap: NeuralNodeId | null = null;
      let primaryAct = 0;
      for (const node of CONTEXTUAL_CAPABILITIES) {
        const act = pulses[node];
        if (act > 0.1 && act > primaryAct) { primaryCap = node; primaryAct = act; }
      }

      CONTEXTUAL_CAPABILITIES.forEach((node, i) => {
        const { x, y } = nodePosition(i, cx, cy, capRx, capRy);
        const act = pulses[node];
        const [nr, ng, nb] = NODE_COLORS[node];
        const dim = 0.2 + act * 0.8;

        // Optional SINGLE contextual connection (most-active capability only).
        if (node === primaryCap) {
          const edgeAngle = Math.atan2(y - cy, x - cx);
          const ex = cx + Math.cos(edgeAngle) * baseR * 0.98;
          const ey = cy + Math.sin(edgeAngle) * baseR * 0.94;
          const midX = (ex + x) * 0.5 + Math.sin(t * 0.4 + i * 1.9) * 4;
          const midY = (ey + y) * 0.5 + Math.cos(t * 0.35 + i * 1.7) * 3;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.quadraticCurveTo(midX, midY, x, y);
          ctx.strokeStyle = `rgba(${nr},${ng},${nb},${0.14 + act * 0.2})`;
          ctx.lineWidth = 0.7 + act * 0.4;
          ctx.stroke();
        }

        // Node rings + core.
        const outerR = 7 + act * 4;
        ctx.beginPath();
        ctx.arc(x, y, outerR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${nr},${ng},${nb},${0.1 + act * 0.3})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        const coreR = 3.5 + act * 2.2;
        const nodeGrad = ctx.createRadialGradient(x - 1, y - 1, 0.5, x, y, coreR);
        nodeGrad.addColorStop(0, `rgba(${Math.min(255, nr + 55)},${Math.min(255, ng + 55)},${Math.min(255, nb + 55)},${dim})`);
        nodeGrad.addColorStop(1, `rgba(${nr},${ng},${nb},${dim * 0.5})`);
        ctx.beginPath();
        ctx.arc(x, y, coreR, 0, Math.PI * 2);
        ctx.shadowColor = `rgba(${nr},${ng},${nb},${act > 0.1 ? 0.8 : 0.12})`;
        ctx.shadowBlur = act > 0.1 ? 12 + act * 8 : 3;
        ctx.fillStyle = nodeGrad;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (act > 0.05) {
          const haloR = outerR + 4 + act * 5 * (0.7 + 0.3 * Math.sin(t * 2.2 + i));
          ctx.beginPath();
          ctx.arc(x, y, haloR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${nr},${ng},${nb},${act * 0.2})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        const labelY = y + outerR + 10;
        ctx.font = `${act > 0.15 ? '600' : '400'} 8.5px Inter, ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        if (act > 0.2) {
          ctx.shadowColor = `rgba(${nr},${ng},${nb},0.7)`;
          ctx.shadowBlur = 6;
        }
        ctx.fillStyle = act > 0.15
          ? `rgba(${Math.min(255, nr + 40)},${Math.min(255, ng + 40)},${Math.min(255, nb + 40)},0.95)`
          : 'rgba(148,163,184,0.45)';
        ctx.fillText(NODE_LABELS[node], x, labelY);
        ctx.shadowBlur = 0;
        ctx.textBaseline = 'alphabetic';
      });

      // LISTENING: inward ripples (locked yellow).
      if (visualState === 'LISTENING' && mic > 0.05) {
        for (let ring = 0; ring < 3; ring++) {
          const rProgress = ((t * 0.7 + ring * 0.33) % 1);
          const rR = baseR * (1.5 - rProgress * 0.6);
          ctx.beginPath();
          ctx.arc(cx, cy, rR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${YELLOW[0]},${YELLOW[1]},${YELLOW[2]},${rProgress * mic * 0.35 * (1 - rProgress)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }

      // SPEAKING: outward waves.
      if (visualState === 'SPEAKING') {
        for (let ring = 0; ring < 4; ring++) {
          const rProgress = ((t * 0.9 + ring * 0.25) % 1);
          const rR = baseR * (1 + rProgress * 0.85);
          ctx.beginPath();
          ctx.arc(cx, cy, rR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - rProgress) * (0.14 + spk * 0.22)})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }

      // COMPLETED: single coherent pulse.
      if (visualState === 'COMPLETED') {
        const pR = baseR * (1 + ((t * 0.6) % 1) * 1.1);
        const pA = (1 - ((t * 0.6) % 1)) * 0.4;
        ctx.beginPath();
        ctx.arc(cx, cy, pR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${TURQUOISE[0]},${TURQUOISE[1]},${TURQUOISE[2]},${pA})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      raf = schedule(draw);
    };

    raf = schedule(draw);
    return () => { cancel(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, visualState, pulses, inputLevel, outputLevel]);

  // ─── Hit testing for node + project clicks ───
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const y = ((e.clientY - rect.top) / rect.height) * size;
    const cx = size / 2;
    const cy = size / 2;
    const capRx = size * 0.30;
    const capRy = size * 0.27;
    const projRx = size * 0.44;
    const projRy = size * 0.41;

    // Capability nodes first (preserves the existing onNodeClick contract).
    if (onNodeClick) {
      for (let i = 0; i < CONTEXTUAL_CAPABILITIES.length; i++) {
        const pos = nodePosition(i, cx, cy, capRx, capRy);
        if (Math.hypot(x - pos.x, y - pos.y) < 20) {
          onNodeClick(CONTEXTUAL_CAPABILITIES[i]);
          return;
        }
      }
    }
    // Project nodes.
    if (onProjectClick) {
      const list = [...liveRef.current.projects].sort((a, b) => stableProjectAngle(a.id) - stableProjectAngle(b.id));
      list.forEach((p, i) => {
        const angle = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
        const px = cx + Math.cos(angle) * projRx;
        const py = cy + Math.sin(angle) * projRy;
        if (Math.hypot(x - px, y - py) < 20) onProjectClick(p.id);
      });
    }
  };

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <canvas
        ref={canvasRef}
        data-testid={`${testId}-canvas`}
        onClick={handleClick}
        style={{ width: size, height: size, cursor: onNodeClick || onProjectClick ? 'pointer' : 'default' }}
        role="img"
        aria-label={`Jarvis neural core — state ${toBlobVisualState(state)}`}
      />
      <div
        data-testid={`${testId}-label`}
        style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.35 }}
        aria-label="Jarvis"
      >
        <div
          data-testid={`${testId}-model`}
          style={{ fontSize: 11, color: 'rgba(226,232,240,0.9)', fontFamily: 'ui-monospace, Menlo, monospace' }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

function stableIndex(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % LOCKED_PALETTE.length;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export { NODE_ROUTES, modelLabel };
