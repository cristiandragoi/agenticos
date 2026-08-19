/**
 * JarvisNeuralCore V4 — "Visual Universe": JARVIS + persistent Projects +
 * contextual Capabilities.
 *
 * Architecture: Three.js WebGL scene rendered into the existing canvas.
 *
 * Rendering layers (back → front):
 *   1. 3D galaxy field    — tilted spiral dust, state-colored listening/thinking
 *   2. Persistent project ring — REAL projects (stable spatial memory) with
 *      curved persistent connections to the core
 *   3. Central core       — translucent 3D luminous galaxy/orb
 *   4. Nucleus            — restrained luminous center
 *   5. Seven contextual capability satellites — illuminate from REAL activity only
 *
 * Deliberate changes vs V4 (Visual Universe correction):
 *   - REMOVED the execution-graph look: Runs/Builds are no longer permanent
 *     satellites. Mission remains a contextual navigation anchor so the
 *     approved seven-node Jarvis orbit is preserved:
 *     Memory / Mission / Research / Hermes / Vision / CodeX / Magnitude.
 *   - CONNECTIONS are calm: the focused Project gets a primary curved
 *     connection; contextual capabilities keep faint orbit anchors and brighten
 *     only when real activity reaches them.
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
import * as THREE from 'three';
import blob1ReferenceUrl from '../../assets/jarvis-blob1-reference.png';
import type { BlobVisualState, NeuralNodeId } from './neuralBlobState';
import { NODE_ROUTES, nodePulse, toBlobVisualState, modelLabel } from './neuralBlobState';

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
// universe. Runs/Builds are execution views and must NOT become permanent
// universe stars. Mission remains a contextual navigation anchor to preserve
// the approved seven-node Jarvis orbit. CodeX + Magnitude are delegation
// capabilities and appear only when real runtime activity lights them. The
// full NeuralNodeId union (state module) keeps its routes for the
// click/navigation contract; only this contextual seven-node set is drawn.
const CONTEXTUAL_CAPABILITIES: NeuralNodeId[] = ['MEMORY', 'PROJECTS', 'KNOWLEDGE', 'HERMES', 'VISION', 'CODEX', 'MAGNITUDE'];

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
    case 'DELEGATING': return PINK;
    case 'BUILDING': return ORANGE;
    case 'SPEAKING': return PINK;
    case 'COMPLETED': return TURQUOISE;
    case 'ERROR': return RED;
    default: return TURQUOISE; // IDLE
  }
}

/**
 * Voice-reactive color shift (locked palette only): when the user is actually
 * talking (voicePulse > 0) the core color slides a little toward the next
 * palette color, so the nebula visibly CHANGES COLOR while the user speaks
 * without ever leaving the six approved accent colors. voicePulse is a
 * smoothed 0..1 level (real mic level in LISTENING, output level in
 * SPEAKING). Idle/zero voice → exact base color (existing contract).
 */
export function voiceColorShift(base: [number, number, number], voicePulse: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, voicePulse));
  if (v <= 0) return [...base] as [number, number, number];
  // Which palette entry the base color is closest to → step one entry toward
  // the next hue (wraps), blended by voice level.
  let idx = 0;
  let best = Infinity;
  LOCKED_PALETTE.forEach((c, i) => {
    const d = Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]);
    if (d < best) { best = d; idx = i; }
  });
  const next = LOCKED_PALETTE[(idx + 1) % LOCKED_PALETTE.length];
  return mixColor(base, next, 0.34 * v);
}

/**
 * Voice vibration profile (pure, deterministic — unit-tested). Returns the
 * per-frame jitter that makes the nebula physically VIBRATE while the user
 * talks. Amplitude scales with the real mic level; zero voice = zero jitter
 * (idle keeps only the calm breathing motion, handled by the draw loop).
 */
export function voiceVibration(t: number, voicePulse: number): { dx: number; dy: number; rot: number; scale: number } {
  const v = Math.max(0, Math.min(1, voicePulse));
  if (v <= 0) return { dx: 0, dy: 0, rot: 0, scale: 1 };
  const a = 0.011 * v;                                  // translation amplitude (px-ish units)
  const dx = Math.sin(t * 52.7) * a + Math.sin(t * 31.3 + 1.7) * a * 0.6;
  const dy = Math.cos(t * 47.1) * a + Math.sin(t * 37.9 + 4.2) * a * 0.6;
  const rot = (Math.sin(t * 24.7) * 0.55 + Math.sin(t * 61.1) * 0.25) * v * 0.22; // degrees
  const scale = 1 + Math.sin(t * 43.3) * 0.006 * v + Math.sin(t * 71.7) * 0.004 * v;
  return { dx, dy, rot, scale };
}

function mixColor(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, k));
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Per-state rendering parameters (calm, focus-based motion).
interface StateParams {
  breath: number;        // breathing amplitude
  energy: number;        // internal activity [0..1]
  glow: number;          // outer glow intensity
  nucleusPulse: number;  // nucleus visibility
}

function stateParams(st: BlobVisualState): StateParams {
  switch (st) {
    case 'LISTENING': return { breath: 0.05, energy: 0.45, glow: 0.55, nucleusPulse: 0.4 };
    case 'THINKING': return { breath: 0.045, energy: 0.78, glow: 0.72, nucleusPulse: 0.72 };
    case 'ACTING': return { breath: 0.06, energy: 0.9, glow: 0.8, nucleusPulse: 0.8 };
    case 'DELEGATING': return { breath: 0.065, energy: 0.82, glow: 0.74, nucleusPulse: 0.74 };
    case 'BUILDING': return { breath: 0.062, energy: 0.95, glow: 0.84, nucleusPulse: 0.82 };
    case 'SPEAKING': return { breath: 0.06, energy: 0.58, glow: 0.62, nucleusPulse: 0.55 };
    case 'COMPLETED': return { breath: 0.035, energy: 0.3, glow: 0.48, nucleusPulse: 0.32 };
    case 'ERROR': return { breath: 0.07, energy: 0.5, glow: 0.6, nucleusPulse: 0.5 };
    default: return { breath: 0.02, energy: 0.14, glow: 0.3, nucleusPulse: 0.18 };
  }
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
  const shellRef = useRef<HTMLDivElement | null>(null);
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
    initialized: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const schedule = (fn: () => void) => {
      if (typeof requestAnimationFrame === 'undefined') return 0;
      return requestAnimationFrame(fn);
    };
    const cancel = (id: number) => {
      if (typeof cancelAnimationFrame !== 'undefined' && id) cancelAnimationFrame(id);
    };

    let raf = 0;
    if (typeof WebGLRenderingContext === 'undefined') {
      raf = schedule(() => {});
      return () => { cancel(raf); };
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(dpr);
    // FREE FROM THE SQUARE: the canvas fills the (larger) shell — size the
    // WebGL buffer from the ACTUAL rendered canvas, not the fixed prop box.
    const canvasPx = Math.max(canvas.clientWidth || size, size);
    renderer.setSize(canvasPx, canvasPx, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Keep the WebGL buffer in sync when the shell resizes with the window
    // (the shell is sized in vmin — a window resize changes its px size).
    const onWindowResize = () => {
      const px = Math.max(canvas.clientWidth || size, size);
      renderer.setSize(px, px, false);
    };
    window.addEventListener('resize', onWindowResize);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 0.18, 9.2);
    camera.lookAt(0, 0, 0);

    const root = new THREE.Group();
    scene.add(root);
    scene.add(new THREE.AmbientLight(0x77fff0, 1.6));
    const key = new THREE.PointLight(0x9ffdf2, 4.2, 16);
    key.position.set(-2.5, 2.4, 5);
    scene.add(key);
    const rimLight = new THREE.PointLight(0xfacc15, 2.4, 18);
    rimLight.position.set(3.2, 0.7, 3);
    scene.add(rimLight);

    const colorToThree = (rgb: [number, number, number]) => new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    const disposableTextures: THREE.Texture[] = [];
    const makeLineMaterial = (rgb: [number, number, number], opacity: number) =>
      new THREE.LineBasicMaterial({
        color: colorToThree(rgb),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });

    const makeEllipse = (rx: number, ry: number, rgb: [number, number, number], opacity: number, z = 0, tilt = 0) => {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry, z));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), makeLineMaterial(rgb, opacity));
      line.rotation.x = tilt;
      return line;
    };

    const makeLabel = (text: string, rgb: [number, number, number], scale = 0.34) => {
      const labelCanvas = document.createElement('canvas');
      labelCanvas.width = 256;
      labelCanvas.height = 64;
      const ctx = labelCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 256, 64);
        ctx.font = '700 28px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(2,6,23,0.95)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.96)`;
        ctx.fillText(text, 128, 32);
      }
      const texture = new THREE.CanvasTexture(labelCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      disposableTextures.push(texture);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
      sprite.scale.set(1.9 * scale, 0.48 * scale, 1);
      return sprite;
    };

    const makeRadialGlowTexture = (inner: string, outer: string) => {
      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = 512;
      glowCanvas.height = 512;
      const ctx = glowCanvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createRadialGradient(256, 256, 8, 256, 256, 252);
        grad.addColorStop(0, inner);
        grad.addColorStop(0.32, 'rgba(170,255,245,0.42)');
        grad.addColorStop(0.72, 'rgba(20,184,166,0.16)');
        grad.addColorStop(1, outer);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
      }
      const texture = new THREE.CanvasTexture(glowCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      disposableTextures.push(texture);
      return texture;
    };

    const makeCoreTexture = () => {
      const textureCanvas = document.createElement('canvas');
      textureCanvas.width = 768;
      textureCanvas.height = 384;
      const ctx = textureCanvas.getContext('2d');
      if (ctx) {
        const bg = ctx.createLinearGradient(0, 0, 768, 384);
        bg.addColorStop(0, 'rgba(7,89,83,0.92)');
        bg.addColorStop(0.45, 'rgba(45,212,191,0.96)');
        bg.addColorStop(1, 'rgba(13,148,136,0.9)');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 768, 384);

        for (let band = 0; band < 28; band++) {
          const y = 40 + band * 11 + Math.sin(band * 1.7) * 7;
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x <= 768; x += 20) {
            ctx.lineTo(x, y + Math.sin(x * 0.022 + band) * 4);
          }
          ctx.strokeStyle = band % 3 === 0 ? 'rgba(204,251,241,0.26)' : 'rgba(94,234,212,0.16)';
          ctx.lineWidth = band % 3 === 0 ? 1.4 : 0.8;
          ctx.stroke();
        }

        for (let dot = 0; dot < 180; dot++) {
          const x = (dot * 139) % 768;
          const y = (dot * 97) % 384;
          const r = dot % 9 === 0 ? 1.5 : 0.75;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = dot % 5 === 0 ? 'rgba(255,255,255,0.38)' : 'rgba(153,246,228,0.26)';
          ctx.fill();
        }

        const shine = ctx.createRadialGradient(260, 120, 8, 260, 120, 220);
        shine.addColorStop(0, 'rgba(255,255,255,0.36)');
        shine.addColorStop(0.34, 'rgba(153,246,228,0.18)');
        shine.addColorStop(1, 'rgba(153,246,228,0)');
        ctx.fillStyle = shine;
        ctx.fillRect(0, 0, 768, 384);
      }
      const texture = new THREE.CanvasTexture(textureCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      disposableTextures.push(texture);
      return texture;
    };

    const makeOrganicSphere = (radius: number, widthSegments: number, heightSegments: number, amplitude: number) => {
      const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
      const position = geometry.attributes.position as THREE.BufferAttribute;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i);
        const n = vertex.clone().normalize();
        const wave =
          Math.sin(n.x * 4.7 + n.y * 2.1) * 0.42 +
          Math.sin(n.y * 5.3 - n.z * 3.4) * 0.34 +
          Math.sin((n.x + n.z) * 6.1) * 0.24;
        vertex.multiplyScalar(1 + amplitude * wave);
        position.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      return geometry;
    };

    const coreColorThree = colorToThree(animRef.current.rgb);
    const coreTexture = makeCoreTexture();
    const core = new THREE.Mesh(
      makeOrganicSphere(1.48, 72, 48, 0.075),
      new THREE.MeshPhysicalMaterial({
        map: coreTexture,
        emissiveMap: coreTexture,
        color: coreColorThree,
        emissive: coreColorThree,
        emissiveIntensity: 0.72,
        roughness: 0.34,
        metalness: 0.05,
        transmission: 0.16,
        transparent: true,
        opacity: 0.48,
        clearcoat: 1,
        depthWrite: false,
      }),
    );
    core.renderOrder = 3;
    root.add(core);

    const softShell = new THREE.Mesh(
      makeOrganicSphere(1.68, 48, 32, 0.1),
      new THREE.MeshBasicMaterial({
        color: colorToThree(TURQUOISE),
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    softShell.scale.set(1.02, 0.94, 1.08);
    softShell.renderOrder = 4;
    root.add(softShell);

    const edgeMist = new THREE.Mesh(
      makeOrganicSphere(1.9, 48, 32, 0.08),
      new THREE.MeshBasicMaterial({
        color: colorToThree(TURQUOISE),
        transparent: true,
        opacity: 0.065,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    edgeMist.scale.set(1.08, 0.88, 1);
    edgeMist.renderOrder = 2;
    root.add(edgeMist);

    const backGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRadialGlowTexture('rgba(204,251,241,0.78)', 'rgba(20,184,166,0)'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.14,
    }));
    backGlow.scale.set(6.1, 5.8, 1);
    backGlow.position.z = -0.5;
    backGlow.renderOrder = 0;
    root.add(backGlow);

    const nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xecfeff,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthTest: false,
      }),
    );
    nucleus.position.set(-0.08, 0.02, 0.9);
    nucleus.renderOrder = 8;
    root.add(nucleus);

    const dustLane = new THREE.Mesh(
      new THREE.RingGeometry(1.04, 2.35, 160),
      new THREE.MeshBasicMaterial({
        color: 0x020617,
        transparent: true,
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    dustLane.scale.y = 0.16;
    dustLane.rotation.z = -0.16;
    dustLane.position.z = 0.08;
    dustLane.renderOrder = 5;
    root.add(dustLane);

    const plasmaPositions: number[] = [];
    const plasmaColors: number[] = [];
    const plasmaColor = new THREE.Color();
    for (let i = 0; i < 520; i++) {
      const seed = i * 12.9898;
      const u = ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1;
      const v = ((Math.sin(seed * 1.37) * 24634.6345) % 1 + 1) % 1;
      const w = ((Math.sin(seed * 1.91) * 13217.419) % 1 + 1) % 1;
      const radius = Math.cbrt(u) * 1.32;
      const theta = v * Math.PI * 2;
      const phi = Math.acos(2 * w - 1);
      plasmaPositions.push(
        Math.sin(phi) * Math.cos(theta) * radius,
        Math.cos(phi) * radius * 0.82,
        Math.sin(phi) * Math.sin(theta) * radius,
      );
      const c = mixColor(TURQUOISE, LOCKED_PALETTE[i % LOCKED_PALETTE.length], 0.24 + (i % 7) * 0.035);
      plasmaColor.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
      plasmaColors.push(plasmaColor.r, plasmaColor.g, plasmaColor.b);
    }
    const plasmaGeometry = new THREE.BufferGeometry();
    plasmaGeometry.setAttribute('position', new THREE.Float32BufferAttribute(plasmaPositions, 3));
    plasmaGeometry.setAttribute('color', new THREE.Float32BufferAttribute(plasmaColors, 3));
    const plasmaCore = new THREE.Points(
      plasmaGeometry,
      new THREE.PointsMaterial({
        size: 0.048,
        vertexColors: true,
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    plasmaCore.renderOrder = 6;
    root.add(plasmaCore);

    const galaxyGroup = new THREE.Group();
    galaxyGroup.rotation.x = 1.12;
    root.add(galaxyGroup);

    const galaxyPositions: number[] = [];
    const galaxyColors: number[] = [];
    const galaxyColor = new THREE.Color();
    for (let arm = 0; arm < 4; arm++) {
      for (let i = 0; i < 300; i++) {
        const f = i / 299;
        const angle = (arm / 4) * Math.PI * 2 + f * Math.PI * 8.2;
        const radius = 0.22 + f * 3.4;
        const jitter = Math.sin(i * 12.989 + arm * 78.23) * 0.045;
        galaxyPositions.push(
          Math.cos(angle) * (radius + jitter),
          Math.sin(angle) * (radius + jitter),
          (Math.sin(i * 4.1 + arm) * 0.08),
        );
        const c = mixColor(TURQUOISE, LOCKED_PALETTE[(arm + i) % LOCKED_PALETTE.length], 0.34);
        galaxyColor.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
        galaxyColors.push(galaxyColor.r, galaxyColor.g, galaxyColor.b);
      }
    }
    const galaxyGeometry = new THREE.BufferGeometry();
    galaxyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(galaxyPositions, 3));
    galaxyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(galaxyColors, 3));
    const galaxyDust = new THREE.Points(
      galaxyGeometry,
      new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    galaxyDust.renderOrder = 6;
    galaxyGroup.add(galaxyDust);

    const armLines: THREE.Line[] = [];
    for (let arm = 0; arm < 4; arm++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 140; i++) {
        const f = i / 140;
        const angle = (arm / 4) * Math.PI * 2 + f * Math.PI * 7.2;
        const radius = 0.18 + f * 2.95;
        pts.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(f * Math.PI * 6) * 0.04));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), makeLineMaterial(LOCKED_PALETTE[arm], 0.2));
      line.renderOrder = 7;
      galaxyGroup.add(line);
      armLines.push(line);
    }

    const diskLines = [
      makeEllipse(3.75, 0.9, TURQUOISE, 0.28, 0, 0.04),
      makeEllipse(3.25, 0.72, YELLOW, 0.22, 0.02, -0.02),
      makeEllipse(2.65, 0.56, PINK, 0.18, -0.02, 0.02),
      makeEllipse(4.25, 1.08, ORANGE, 0.16, -0.04, 0),
    ];
    diskLines.forEach((line) => {
      line.renderOrder = 9;
      root.add(line);
    });

    const diskGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRadialGlowTexture('rgba(250,204,21,0.36)', 'rgba(20,184,166,0)'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.08,
    }));
    diskGlow.scale.set(7.05, 1.85, 1);
    diskGlow.rotation.z = -0.13;
    diskGlow.renderOrder = 2;
    root.add(diskGlow);

    const capabilityGroup = new THREE.Group();
    scene.add(capabilityGroup);
    const capRx = 2.42;
    const capRy = 1.95;
    const capOrbit = makeEllipse(capRx, capRy, TURQUOISE, 0.18, 0.1);
    capOrbit.renderOrder = 12;
    capabilityGroup.add(capOrbit);
    const projectOrbit = makeEllipse(4.2, 3.35, [148, 163, 184], 0.1, -0.08);
    projectOrbit.renderOrder = 11;
    capabilityGroup.add(projectOrbit);
    const nodeMeshes: Array<{ node: NeuralNodeId; mesh: THREE.Mesh; halo: THREE.Mesh; label: THREE.Sprite; connection: THREE.Line }> = [];
    CONTEXTUAL_CAPABILITIES.forEach((node, i) => {
      const angle = -Math.PI / 2 + (i / CONTEXTUAL_CAPABILITIES.length) * Math.PI * 2;
      const [nr, ng, nb] = NODE_COLORS[node];
      const color = new THREE.Color(nr / 255, ng / 255, nb / 255);
      const x = Math.cos(angle) * capRx;
      const y = -Math.sin(angle) * capRy;
      const connection = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(Math.cos(angle) * 1.42, -Math.sin(angle) * 1.1, 0.18),
          new THREE.Vector3(x, y, 0.22),
        ]),
        makeLineMaterial([nr, ng, nb], 0.12),
      );
      connection.renderOrder = 13;
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 28, 18),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthTest: false }),
      );
      halo.position.set(x, y, 0.22);
      halo.renderOrder = 20;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 28, 18),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthTest: false }),
      );
      mesh.position.copy(halo.position);
      mesh.renderOrder = 21;
      const labelSprite = makeLabel(NODE_LABELS[node], [nr, ng, nb], node === 'PROJECTS' ? 0.48 : 0.44);
      labelSprite.position.set(x, y - 0.27, 0.42);
      labelSprite.renderOrder = 22;
      capabilityGroup.add(connection, halo, mesh, labelSprite);
      nodeMeshes.push({ node, mesh, halo, label: labelSprite, connection });
    });

    const projectGroup = new THREE.Group();
    scene.add(projectGroup);
    const rebuildProjects = () => {
      projectGroup.clear();
      const list = [...liveRef.current.projects].sort((a, b) => stableProjectAngle(a.id) - stableProjectAngle(b.id));
      const n = list.length;
      list.forEach((p, i) => {
        const angle = n === 0 ? 0 : -Math.PI / 2 + (i / n) * Math.PI * 2;
        const rgb = p.color ? hexToRgb(p.color) ?? LOCKED_PALETTE[stableIndex(p.id)] : LOCKED_PALETTE[stableIndex(p.id)];
        const color = colorToThree(rgb);
        const x = Math.cos(angle) * 4.2;
        const y = -Math.sin(angle) * 3.35;
        const isActive = p.id === liveRef.current.activeProjectId;
        const star = new THREE.Mesh(
          new THREE.SphereGeometry(isActive ? 0.105 : 0.068, 20, 14),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isActive ? 0.95 : 0.38, blending: THREE.AdditiveBlending }),
        );
        star.position.set(x, y, -0.12);
        star.renderOrder = 18;
        const labelSprite = isActive ? makeLabel(p.name.length > 14 ? `${p.name.slice(0, 13)}...` : p.name, rgb, 0.43) : null;
        if (labelSprite) {
          labelSprite.position.set(x, y - 0.26, 0.15);
          labelSprite.renderOrder = 19;
          projectGroup.add(labelSprite);
        }
        projectGroup.add(star);
      });
    };
    rebuildProjects();

    const anim = animRef.current;
    if (!anim.initialized) {
      anim.initialized = true;
      anim.currentParams = { ...stateParams('IDLE') };
      anim.rgb = [...coreColor('IDLE')];
    }

    let projectSignature = '';
    const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);
    const lerpRGB = (cur: [number, number, number], target: [number, number, number], k: number) => {
      cur[0] = lerp(cur[0], target[0], k);
      cur[1] = lerp(cur[1], target[1], k);
      cur[2] = lerp(cur[2], target[2], k);
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
      sp.glow = lerp(sp.glow, target.glow, alpha);
      sp.nucleusPulse = lerp(sp.nucleusPulse, target.nucleusPulse, alpha);

      // ── Voice-reactive color: the core keeps lerping toward the state color
      //    (locked palette base), but while the user is actually TALKING it
      //    shifts toward a voice-derived palette neighbor → the nebula CHANGES
      //    COLOR with your voice. Idle/zero voice = exact state color. ──
      const mic = visualState === 'LISTENING' ? Math.max(0, Math.min(1, inputLevel)) : 0;
      const spk = visualState === 'SPEAKING' ? Math.max(0, Math.min(1, outputLevel)) : 0;
      const voicePulse = Math.max(mic, spk);
      const voiceTarget = voiceColorShift(coreColor(visualState), voicePulse);
      lerpRGB(anim.rgb, voiceTarget, alpha * 2.4);

      const signature = `${liveRef.current.activeProjectId ?? ''}:${liveRef.current.projects.map((p) => `${p.id}:${p.color ?? ''}`).join('|')}`;
      if (signature !== projectSignature) {
        projectSignature = signature;
        rebuildProjects();
      }

      const c = colorToThree(anim.rgb);
      (core.material as THREE.MeshPhysicalMaterial).color.copy(c);
      (core.material as THREE.MeshPhysicalMaterial).emissive.copy(c);
      (softShell.material as THREE.MeshBasicMaterial).color.copy(c);
      (edgeMist.material as THREE.MeshBasicMaterial).color.copy(c);

      // ── Voice vibration: real mic level drives a physical jitter on the
      //    whole nebula shell (CSS vars consumed by the shell transform) and
      //    boosts the core breathing. Zero voice → calm breathing only. ──
      const vib = voiceVibration(t, voicePulse);
      if (shellRef.current) {
        shellRef.current.style.setProperty('--jarvis-vib-x', vib.dx.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-vib-y', vib.dy.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-vib-rot', vib.rot.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-vib-scale', vib.scale.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-voice', voicePulse.toFixed(4));
      }
      const breath = 1 + sp.breath * Math.sin(t * 0.9) + mic * 0.16 + spk * 0.12 + vib.scale - 1;
      core.scale.setScalar(breath);
      core.rotation.y = t * 0.18;
      core.rotation.x = Math.sin(t * 0.22) * 0.08;
      softShell.scale.set(1.05 + sp.energy * 0.05, 0.96 + Math.sin(t * 0.8) * 0.025, 1.1 + Math.cos(t * 0.7) * 0.025);
      softShell.rotation.y = -t * 0.18;
      softShell.rotation.z = Math.sin(t * 0.28) * 0.12;
      edgeMist.scale.set(1.12 + sp.glow * 0.08, 0.92 + sp.glow * 0.04, 1.02);
      edgeMist.rotation.y = t * 0.08;
      dustLane.rotation.z = -0.16 + Math.sin(t * 0.18) * 0.03;
      backGlow.material.opacity = 0.14 + sp.glow * 0.11;
      diskGlow.material.opacity = 0.08 + sp.energy * 0.1;
      nucleus.scale.setScalar(1 + sp.nucleusPulse * 0.9 + Math.sin(t * 1.2) * 0.1);
      plasmaCore.rotation.y = t * (0.15 + sp.energy * 0.06);
      plasmaCore.rotation.x = Math.sin(t * 0.2) * 0.12;
      (plasmaCore.material as THREE.PointsMaterial).opacity = 0.38 + sp.energy * 0.22;

      galaxyGroup.rotation.z = t * (0.055 + sp.energy * 0.025);
      galaxyDust.rotation.z = -t * 0.035;
      armLines.forEach((line, i) => {
        line.rotation.z = t * (0.04 + i * 0.006);
        (line.material as THREE.LineBasicMaterial).opacity = 0.12 + sp.energy * 0.1;
      });
      diskLines.forEach((line, i) => {
        line.rotation.z = t * (0.08 + i * 0.018);
        line.scale.setScalar(1 + Math.sin(t * 0.7 + i) * 0.015);
      });

      let primaryCap: NeuralNodeId | null = null;
      let primaryAct = 0;
      for (const node of CONTEXTUAL_CAPABILITIES) {
        const act = pulses[node];
        if (act > 0.1 && act > primaryAct) { primaryCap = node; primaryAct = act; }
      }
      nodeMeshes.forEach(({ node, mesh, halo, label, connection }, i) => {
        const act = pulses[node];
        const pulse = 1 + act * 0.22 + (node === primaryCap ? Math.sin(t * 3.2 + i) * 0.03 : 0);
        mesh.scale.setScalar(pulse);
        halo.scale.setScalar(1.05 + act * 0.5 + Math.sin(t * 1.1 + i) * 0.04);
        (halo.material as THREE.MeshBasicMaterial).opacity = 0.3 + act * 0.28;
        (connection.material as THREE.LineBasicMaterial).opacity = node === primaryCap ? 0.28 + act * 0.28 : 0.1;
        label.quaternion.copy(camera.quaternion);
      });

      root.rotation.y = Math.sin(t * 0.16) * 0.18;
      root.rotation.x = -0.08 + Math.sin(t * 0.11) * 0.05;
      renderer.render(scene, camera);
      raf = schedule(draw);
    };

    raf = schedule(draw);
    return () => {
      cancel(raf);
      window.removeEventListener('resize', onWindowResize);
      renderer.dispose();
      disposableTextures.forEach((texture) => texture.dispose());
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh | THREE.Line | THREE.Points | THREE.Sprite;
        const geometry = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
        if (geometry) geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else if (material) material.dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, visualState, pulses, inputLevel, outputLevel]);

  // ─── Hit testing for node + project clicks ───
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    // The shell is no longer a fixed `size` square — hit-test in the REAL
    // rendered canvas coordinates so the universe stays clickable at any size.
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const capRx = w * 0.33;
    const capRy = h * 0.29;
    const projRx = w * 0.44;
    const projRy = h * 0.41;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

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

  const voicePulse = visualState === 'LISTENING'
    ? Math.max(0, Math.min(1, inputLevel))
    : visualState === 'SPEAKING'
      ? Math.max(0, Math.min(1, outputLevel))
      : 0;
  const pulseScale = 1.04 + voicePulse * 0.06;
  const pulseGlow = 0.24 + voicePulse * 0.28;

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <style>{`
        @keyframes jarvisBlob1Drift {
          0% { transform: translate3d(-2%, -1%, 0) rotate(0deg) scale(1.03); }
          50% { transform: translate3d(2%, 1.5%, 0) rotate(8deg) scale(1.08); }
          100% { transform: translate3d(-1%, 2%, 0) rotate(-6deg) scale(1.04); }
        }

        @keyframes jarvisBlob1Sweep {
          0% { transform: translateX(-72%) rotate(-18deg); opacity: 0; }
          18% { opacity: 0.34; }
          55% { opacity: 0.14; }
          100% { transform: translateX(72%) rotate(-18deg); opacity: 0; }
        }

        @keyframes jarvisBlob1Pulse {
          0%, 100% { opacity: 0.36; transform: scale(0.98); }
          50% { opacity: 0.62; transform: scale(1.04); }
        }

        @keyframes jarvisBlob1Orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .jarvis-blob1-shell {
          isolation: isolate;
          background: transparent;
          transform: translateZ(0);
        }

        .jarvis-blob1-universe {
          position: absolute;
          inset: -14%;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 22% 22%, rgba(20, 184, 166, 0.34), transparent 24%),
            radial-gradient(circle at 78% 68%, rgba(236, 72, 153, 0.22), transparent 23%),
            radial-gradient(circle at 50% 54%, rgba(250, 204, 21, 0.18), transparent 18%),
            radial-gradient(circle at 62% 24%, rgba(59, 130, 246, 0.22), transparent 22%),
            linear-gradient(145deg, rgba(2, 6, 23, 0.98), rgba(15, 23, 42, 0.96));
          filter: saturate(1.1) blur(1px);
          opacity: 0;
          animation: jarvisBlob1Drift 28s ease-in-out infinite alternate;
        }

        .jarvis-blob1-stars {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background-image:
            radial-gradient(circle, rgba(255,255,255,0.9) 0 1px, transparent 1.3px),
            radial-gradient(circle, rgba(94,234,212,0.72) 0 1px, transparent 1.4px),
            radial-gradient(circle, rgba(250,204,21,0.62) 0 1px, transparent 1.5px);
          background-size: 38px 38px, 56px 56px, 79px 79px;
          background-position: 7px 11px, 19px 3px, 4px 29px;
          mix-blend-mode: screen;
          opacity: 0.12;
          animation: jarvisBlob1Pulse 9s ease-in-out infinite;
        }

        .jarvis-blob1-aurora {
          position: absolute;
          inset: -24%;
          z-index: 3;
          pointer-events: none;
          background:
            conic-gradient(from 140deg at 50% 50%,
              transparent 0deg,
              rgba(20,184,166,0.18) 62deg,
              rgba(250,204,21,0.13) 120deg,
              rgba(236,72,153,0.16) 190deg,
              rgba(59,130,246,0.16) 260deg,
              transparent 360deg);
          filter: blur(18px) saturate(1.35);
          mix-blend-mode: screen;
          opacity: 0.12;
          animation: jarvisBlob1Orbit 42s linear infinite;
        }

        .jarvis-blob1-beam {
          position: absolute;
          top: -15%;
          bottom: -15%;
          left: 16%;
          z-index: 5;
          width: 16%;
          pointer-events: none;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), rgba(94,234,212,0.18), transparent);
          filter: blur(10px);
          mix-blend-mode: screen;
          opacity: 0;
          animation: none;
        }

        .jarvis-blob1-rim {
          position: absolute;
          inset: 6%;
          z-index: 6;
          pointer-events: none;
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 12px;
          box-shadow:
            inset 0 0 40px rgba(20,184,166,0.12),
            inset 0 0 96px rgba(15,23,42,0.8),
            0 0 26px rgba(20,184,166,0.12);
          mix-blend-mode: screen;
          opacity: 0;
        }

        .jarvis-blob1-photo {
          filter: saturate(1.08) contrast(1.04);
          transform: scale(1.04);
          transform-origin: center;
          opacity: 0.92;
          mix-blend-mode: screen;
          -webkit-mask-image: radial-gradient(ellipse 62% 54% at 50% 51%, #000 0 47%, rgba(0,0,0,0.82) 63%, transparent 86%);
          mask-image: radial-gradient(ellipse 62% 54% at 50% 51%, #000 0 47%, rgba(0,0,0,0.82) 63%, transparent 86%);
          transition: transform 90ms linear, filter 90ms linear, opacity 120ms linear;
        }

        .jarvis-blob1-shell--thinking .jarvis-blob1-stars,
        .jarvis-blob1-shell--reasoning .jarvis-blob1-stars,
        .jarvis-blob1-shell--executing .jarvis-blob1-stars,
        .jarvis-blob1-shell--speaking .jarvis-blob1-stars {
          opacity: 0.24;
        }

        .jarvis-blob1-shell--thinking .jarvis-blob1-aurora,
        .jarvis-blob1-shell--reasoning .jarvis-blob1-aurora,
        .jarvis-blob1-shell--executing .jarvis-blob1-aurora,
        .jarvis-blob1-shell--speaking .jarvis-blob1-aurora {
          opacity: 0.3;
          animation-duration: 24s;
        }

        .jarvis-blob1-shell--executing .jarvis-blob1-beam,
        .jarvis-blob1-shell--speaking .jarvis-blob1-beam {
          animation: jarvisBlob1Sweep 6.8s ease-in-out infinite;
        }

        .jarvis-blob1-shell--error .jarvis-blob1-rim,
        .jarvis-blob1-shell--offline .jarvis-blob1-rim {
          border-color: rgba(248, 113, 113, 0.36);
          box-shadow:
            inset 0 0 28px rgba(248,113,113,0.18),
            inset 0 0 72px rgba(15,23,42,0.72),
            0 0 22px rgba(248,113,113,0.16);
        }

        @media (prefers-reduced-motion: reduce) {
          .jarvis-blob1-universe,
          .jarvis-blob1-stars,
          .jarvis-blob1-aurora,
          .jarvis-blob1-beam {
            animation: none;
          }
        }
      `}</style>
      <div
        ref={shellRef}
        className={`jarvis-blob1-shell jarvis-blob1-shell--${visualState.toLowerCase()}`}
        style={{
          position: 'relative',
          // FREE FROM THE SQUARE: the nebula scales with the stage (vmin),
          // not a fixed 280–340px box, and the voice vibration vars move the
          // whole shell while the user talks.
          width: `min(74vmin, ${Math.max(size, 340)}px)`,
          height: 'auto',
          aspectRatio: '1 / 1',
          overflow: 'visible',
          borderRadius: 0,
          filter: 'drop-shadow(0 0 26px rgba(20,184,166,0.28))',
          transform: 'translate(calc(var(--jarvis-vib-x, 0px) * 1px), calc(var(--jarvis-vib-y, 0px) * 1px)) rotate(calc(var(--jarvis-vib-rot, 0deg) * 1deg)) scale(var(--jarvis-vib-scale, 1))',
          transition: 'transform 90ms linear',
        }}
      >
        <div aria-hidden="true" className="jarvis-blob1-universe" />
        <img
          className="jarvis-blob1-photo"
          src={blob1ReferenceUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            transform: `scale(${pulseScale})`,
            filter: `saturate(${1.08 + voicePulse * 0.18}) contrast(${1.04 + voicePulse * 0.05}) brightness(${1 + voicePulse * 0.08}) hue-rotate(calc(var(--jarvis-voice, 0) * 24deg))`,
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 1,
          }}
        />
        <div aria-hidden="true" className="jarvis-blob1-stars" />
        <div aria-hidden="true" className="jarvis-blob1-aurora" />
        <div aria-hidden="true" className="jarvis-blob1-beam" />
        <div aria-hidden="true" className="jarvis-blob1-rim" />
        <canvas
          ref={canvasRef}
          data-testid={`${testId}-canvas`}
          onClick={handleClick}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            opacity: 0.22 + voicePulse * 0.12,
            mixBlendMode: 'screen',
            zIndex: 4,
            filter: `drop-shadow(0 0 ${14 + voicePulse * 16}px rgba(94,234,212,${pulseGlow}))`,
            transform: `scale(${1 + voicePulse * 0.025})`,
            cursor: onNodeClick || onProjectClick ? 'pointer' : 'default',
          }}
          role="img"
          aria-label={`Jarvis neural core — state ${toBlobVisualState(state)}`}
        />
      </div>
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
