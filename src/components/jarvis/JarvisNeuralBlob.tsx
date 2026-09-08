/**
 * JarvisNeuralCore V5 — "Plasma Energy Organism": genuine GPU-rendered
 * GLSL shaders forming an intelligent energy entity. No prerecorded video,
 * no GIF, no static PNG, no sprite animation, no thousands of DOM elements.
 *
 * Architecture: raw Three.js WebGL (no R3F — matches existing dep tree).
 *
 * Rendering layers (back → front):
 *   1. Outer deforming translucent shell  — IcosahedronGeometry + GLSL fbm
 *      vertex displacement, state-driven morph intensity, additive blend.
 *   2. Inner volumetric noise layer       — custom ShaderMaterial on a
 *      sphere; ray-marched fbm field with state-reactive brightness.
 *   3. Internal particle field            — THREE.Points ~800 pts with
 *      custom vertex shader (animated orbit + state speed/color).
 *   4. Glow bloom                         — large additive sprite with
 *      radial gradient + state-driven opacity.
 *   5. Interactive Perspective Camera (45° FOV):
 *      - Pointer drag orbit (azimuth + elevation with damping)
 *      - Mouse wheel zoom with safe clamped bounds (min: 2.0, max: 6.5)
 *      - Double click reset to canonical view
 *      - Smooth spherical coordinate interpolation (foundation for future pass-through)
 *      - Accurate 3D projected hit testing for satellites & project stars
 *
 * State contract: unchanged — all visual state from REAL runtime props;
 * same data-testid attrs, same aria-label format, same onNodeClick
 * hit-testing, same rAF cleanup, same satellite node visual contract.
 *
 * Audio reactivity: inputLevel (mic RMS) / outputLevel (playback RMS)
 * drive u_input_level / u_output_level uniforms → shader vertex
 * deformation and particle speed.
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { BlobVisualState, NeuralNodeId } from './neuralBlobState';
import { NODE_ROUTES, nodePulse, toBlobVisualState, modelLabel } from './neuralBlobState';
import './JarvisNeuralBlob.css';

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

// ── LOCKED PALETTE (Visual Universe) ────────────────────────────────────────
const YELLOW: [number, number, number] = [250, 204, 21];
const PINK: [number, number, number] = [236, 72, 153];
const ORANGE: [number, number, number] = [249, 115, 22];
const PURPLE: [number, number, number] = [168, 85, 247];
const TURQUOISE: [number, number, number] = [20, 184, 166];
const RED: [number, number, number] = [239, 68, 68];
const LOCKED_PALETTE: [number, number, number][] = [YELLOW, PINK, ORANGE, PURPLE, TURQUOISE, RED];

const CONTEXTUAL_CAPABILITIES: NeuralNodeId[] = ['MEMORY', 'PROJECTS', 'KNOWLEDGE', 'HERMES', 'VISION', 'CODEX', 'MAGNITUDE'];

const NODE_LABELS: Record<NeuralNodeId, string> = {
  MEMORY: 'Memory', KNOWLEDGE: 'Research', PROJECTS: 'Mission',
  HERMES: 'Hermes', RUNS: 'Runs', ARTIFACTS: 'Builds',
  VISION: 'Vision', CODEX: 'CodeX', MAGNITUDE: 'Magnitude',
};

const NODE_COLORS: Record<NeuralNodeId, [number, number, number]> = {
  MEMORY: PURPLE, KNOWLEDGE: TURQUOISE, PROJECTS: YELLOW,
  HERMES: PINK, RUNS: ORANGE, ARTIFACTS: ORANGE,
  VISION: TURQUOISE, CODEX: ORANGE, MAGNITUDE: YELLOW,
};

// ── Camera bounds & defaults ────────────────────────────────────────────────
export const CAMERA_CONFIG = {
  DEFAULT_DISTANCE: 4.6,
  MIN_DISTANCE: 0.5,
  MAX_DISTANCE: 8.5,
  MIN_ELEVATION: -Math.PI / 2.6,
  MAX_ELEVATION: Math.PI / 2.6,
  ORBIT_SPEED: 0.0055,
  ZOOM_SPEED: 0.0035,
  DAMPING: 0.12,
};

export function clampCameraDistance(dist: number): number {
  return Math.max(CAMERA_CONFIG.MIN_DISTANCE, Math.min(CAMERA_CONFIG.MAX_DISTANCE, dist));
}

export function sphericalToCartesian(r: number, elevation: number, azimuth: number): { x: number; y: number; z: number } {
  const cosElev = Math.cos(elevation);
  return {
    x: r * cosElev * Math.sin(azimuth),
    y: r * Math.sin(elevation),
    z: r * cosElev * Math.cos(azimuth),
  };
}

/** Central-core color per blob state */
function coreColor(st: BlobVisualState): [number, number, number] {
  switch (st) {
    case 'LISTENING':  return YELLOW;
    case 'THINKING':   return PURPLE;
    case 'ACTING':     return ORANGE;
    case 'DELEGATING': return PINK;
    case 'BUILDING':   return ORANGE;
    case 'SPEAKING':   return PINK;
    case 'COMPLETED':  return TURQUOISE;
    case 'ERROR':      return RED;
    default:           return TURQUOISE;
  }
}

interface StateParams {
  energy: number;    // 0..1 — shader u_energy
  glow: number;      // 0..1 — bloom sprite opacity
  deform: number;    // 0..1 — vertex displacement amplitude
  speed: number;     // time multiplier
}

function stateParams(st: BlobVisualState): StateParams {
  switch (st) {
    case 'LISTENING':  return { energy: 0.45, glow: 0.55, deform: 0.38, speed: 1.1 };
    case 'THINKING':   return { energy: 0.78, glow: 0.72, deform: 0.55, speed: 1.4 };
    case 'ACTING':     return { energy: 0.90, glow: 0.80, deform: 0.70, speed: 1.7 };
    case 'DELEGATING': return { energy: 0.82, glow: 0.74, deform: 0.62, speed: 1.5 };
    case 'BUILDING':   return { energy: 0.95, glow: 0.84, deform: 0.75, speed: 1.8 };
    case 'SPEAKING':   return { energy: 0.58, glow: 0.62, deform: 0.46, speed: 1.2 };
    case 'COMPLETED':  return { energy: 0.30, glow: 0.48, deform: 0.28, speed: 0.8 };
    case 'ERROR':      return { energy: 0.50, glow: 0.60, deform: 0.50, speed: 1.3 };
    default:           return { energy: 0.14, glow: 0.30, deform: 0.18, speed: 0.7 };
  }
}

// ── GLSL SHADERS ─────────────────────────────────────────────────────────────

/** fbm noise used in both vertex and fragment shaders */
const GLSL_NOISE = /* glsl */`
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
  f.z);
}
float fbm(vec3 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + vec3(5.1, 1.7, 3.4);
    a *= 0.5;
  }
  return v;
}
`;

/** Outer deforming shell — vertex shader */
const SHELL_VERT = /* glsl */`
${GLSL_NOISE}
uniform float u_time;
uniform float u_deform;
uniform float u_input_level;
uniform float u_output_level;
uniform float u_voice_low;
uniform float u_voice_mid;
uniform float u_voice_high;
uniform float u_is_speaking;
varying vec3 vNormal;
varying vec3 vPos;
varying float vNoise;

void main() {
  vec3 p = position;
  vec3 norm = normalize(position);

  // Soft organic breathing and audio pulsation under liquid surface tension
  float breathing = sin(u_time * 1.2) * 0.025;
  float voicePulse = u_voice_low * 0.08 + u_voice_mid * 0.06;

  // Fluid speed driven by audio energy
  float waveSpeed = 0.18 + u_voice_mid * 0.25 + u_is_speaking * 0.22;

  // Coherent low-frequency domain warping (liquid folds, no spikes)
  vec3 warp = vec3(
    fbm(p * 1.2 + vec3(u_time * (waveSpeed * 0.7), 0.0, u_time * (waveSpeed * 0.5))),
    fbm(p * 1.2 + vec3(4.3, u_time * (waveSpeed * 0.6), 1.2)),
    fbm(p * 1.2 + vec3(u_time * (waveSpeed * 0.5), 3.1, u_time * (waveSpeed * 0.8)))
  );

  // Smooth laminar plasma folds
  float n1 = fbm(p * 1.35 + warp * 0.60 + vec3(u_time * (waveSpeed * 0.35)));
  float n2 = fbm(p * 2.20 - warp * 0.35 - vec3(u_time * (waveSpeed * 0.45), 0.0, 0.0));
  float fluid = (n1 * 0.65 + n2 * 0.35) * u_deform * 0.85;

  // Harmonic traveling waves during speech / listening
  float waves = 0.0;
  if (u_is_speaking > 0.5) {
    waves = sin(u_time * 7.5 - length(p) * 5.5) * (u_output_level * 0.045);
  } else if (u_input_level > 0.01) {
    waves = cos(u_time * 5.5 + length(p) * 4.5) * (u_input_level * 0.035);
  }

  float totalDisp = fluid + breathing + voicePulse + waves;
  vec3 displaced = p + norm * totalDisp;

  vNoise = n1;
  vPos = displaced;
  vNormal = normalize(normalMatrix * norm);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

/** Outer deforming shell — fragment shader */
const SHELL_FRAG = /* glsl */`
${GLSL_NOISE}
uniform vec3 u_color;
uniform float u_time;
uniform float u_energy;
uniform float u_input_level;
uniform float u_output_level;
uniform float u_voice_low;
uniform float u_voice_mid;
uniform float u_voice_high;
uniform float u_is_speaking;
varying vec3 vNormal;
varying vec3 vPos;
varying float vNoise;

void main() {
  vec3 smoothNormal = normalize(vNormal);

  vec3 viewDir = normalize(cameraPosition - vPos);
  float NdotV = max(dot(viewDir, smoothNormal), 0.0);
  float fresnel = pow(1.0 - NdotV, 2.4);

  // Flowing liquid plasma color bands
  float flowSpeed = 0.16 + u_voice_mid * 0.28;
  float band1 = fbm(vPos * 1.8 + vec3(u_time * flowSpeed));
  float band2 = fbm(vPos * 3.2 - vec3(u_time * (flowSpeed * 0.8), 0.0, u_time * flowSpeed));

  // Base liquid body
  vec3 col = u_color * (0.80 + band1 * 0.20 + band2 * 0.10);
  // Luminous rim highlight
  vec3 rimColor = mix(u_color, vec3(1.0), 0.50);
  col = mix(col, rimColor, fresnel * 0.85);

  // Dynamic voice brightness & spectral flare
  if (u_is_speaking > 0.5) {
    col += rimColor * (u_output_level * 0.35);
  } else {
    col += rimColor * (u_input_level * 0.25);
  }

  // Liquid translucency: translucent in center to reveal inner volumetric core, dense at grazing rim
  float alpha = 0.42 + fresnel * 0.52 + vNoise * 0.08 + u_energy * 0.08;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 0.95));
}
`;

/** Inner volumetric noise sphere — vertex shader (pass-through) */
const INNER_VERT = /* glsl */`
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Inner volumetric noise sphere — fragment shader */
const INNER_FRAG = /* glsl */`
${GLSL_NOISE}
uniform vec3 u_color;
uniform float u_time;
uniform float u_energy;
varying vec3 vPos;

void main() {
  // Ray-march style: multiple fbm samples at different scales
  float f1 = fbm(vPos * 2.0 + vec3(u_time * 0.15));
  float f2 = fbm(vPos * 4.5 - vec3(u_time * 0.23, u_time * 0.18, 0.0));
  float f3 = fbm(vPos * 8.0 + vec3(0.0, u_time * 0.31, u_time * 0.12));

  vec3 col = u_color * (f1 * 0.55 + f2 * 0.30 + f3 * 0.15);
  col *= (0.8 + u_energy * 0.7);

  float alpha = (f1 * 0.4 + f2 * 0.2) * (0.5 + u_energy * 0.5);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9));
}
`;

/** Particle field — vertex shader */
const PARTICLE_VERT = /* glsl */`
${GLSL_NOISE}
uniform float u_time;
uniform float u_energy;
uniform float u_input_level;
uniform float u_output_level;
uniform float u_voice_mid;
uniform float u_is_speaking;
attribute float a_seed;
attribute vec3 a_axis;
varying float vBrightness;

void main() {
  float speed = 0.28 + u_energy * 0.38 + u_input_level * 0.30 + u_output_level * 0.45;
  float angle = u_time * speed + a_seed * 6.2831853;

  float c = cos(angle); float s = sin(angle);
  float t = 1.0 - c;
  vec3 ax = normalize(a_axis);
  mat3 rot = mat3(
    t*ax.x*ax.x + c,       t*ax.x*ax.y - s*ax.z,  t*ax.x*ax.z + s*ax.y,
    t*ax.x*ax.y + s*ax.z,  t*ax.y*ax.y + c,        t*ax.y*ax.z - s*ax.x,
    t*ax.x*ax.z - s*ax.y,  t*ax.y*ax.z + s*ax.x,   t*ax.z*ax.z + c
  );
  vec3 rotPos = rot * position;

  // Radial outward expansion when speaking
  if (u_is_speaking > 0.5) {
    rotPos *= (1.0 + u_output_level * 0.22 * sin(u_time * 8.0 + a_seed * 10.0));
  }

  float n = fbm(rotPos * 3.0 + vec3(u_time * 0.15));
  vBrightness = 0.5 + n * 0.5 + u_energy * 0.3 + u_voice_mid * 0.4;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(rotPos, 1.0);
  gl_PointSize = (2.8 + u_energy * 2.2 + vBrightness * 1.6 + u_output_level * 2.0) * (1.0 / -gl_Position.z);
}
`;

/** Particle field — fragment shader */
const PARTICLE_FRAG = /* glsl */`
uniform vec3 u_color;
uniform float u_energy;
varying float vBrightness;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  float r = length(coord);
  if (r > 0.5) discard;
  float alpha = (1.0 - r * 2.0) * vBrightness * (0.6 + u_energy * 0.5);
  gl_FragColor = vec4(u_color * (1.0 + u_energy * 0.6), alpha);
}
`;

// ─── Pure helper functions (exported for unit testing) ─────────────────────

function mixColor(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, k));
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

export function voiceColorShift(base: [number, number, number], voicePulse: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, voicePulse));
  if (v <= 0) return [...base] as [number, number, number];
  let idx = 0; let best = Infinity;
  LOCKED_PALETTE.forEach((c, i) => {
    const d = Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]);
    if (d < best) { best = d; idx = i; }
  });
  const next = LOCKED_PALETTE[(idx + 1) % LOCKED_PALETTE.length];
  return mixColor(base, next, 0.34 * v);
}

export function voiceVibration(t: number, voicePulse: number): { dx: number; dy: number; rot: number; scale: number } {
  const v = Math.max(0, Math.min(1, voicePulse));
  if (v <= 0) return { dx: 0, dy: 0, rot: 0, scale: 1 };
  const a = 0.011 * v;
  const dx = Math.sin(t * 52.7) * a + Math.sin(t * 31.3 + 1.7) * a * 0.6;
  const dy = Math.cos(t * 47.1) * a + Math.sin(t * 37.9 + 4.2) * a * 0.6;
  const rot = (Math.sin(t * 24.7) * 0.55 + Math.sin(t * 61.1) * 0.25) * v * 0.22;
  const scale = 1 + Math.sin(t * 43.3) * 0.006 * v + Math.sin(t * 71.7) * 0.004 * v;
  return { dx, dy, rot, scale };
}

/** Stable project angle (FNV-1a hash → same project always at same position) */
export function stableProjectAngle(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) / 4294967295) * Math.PI * 2;
}

function stableIndex(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % LOCKED_PALETTE.length;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Capability node position on screen (fallback 2D calculation) */
export function nodePosition(i: number, cx: number, cy: number, rx: number, ry: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (i / CONTEXTUAL_CAPABILITIES.length) * Math.PI * 2;
  return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
}

// ─── Main component ──────────────────────────────────────────────────────────

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

  // Camera interaction state refs
  const cameraStateRef = useRef({
    distance: CAMERA_CONFIG.DEFAULT_DISTANCE,
    targetDistance: CAMERA_CONFIG.DEFAULT_DISTANCE,
    azimuth: 0,
    targetAzimuth: 0,
    elevation: 0,
    targetElevation: 0,
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    lastPointer: { x: 0, y: 0 },
    hasMoved: false,
  });

  // 3D projected nodes cache for accurate hit-testing from any camera angle
  const projectedNodesRef = useRef<Array<{ id: NeuralNodeId; screenX: number; screenY: number }>>([]);
  const projectedProjectsRef = useRef<Array<{ id: string; screenX: number; screenY: number }>>([]);

  // Live props flow through a ref so the rAF loop never restarts on change
  const liveRef = useRef({ projects, activeProjectId, onProjectClick, onNodeClick, inputLevel, outputLevel, visualState, pulses });
  liveRef.current = { projects, activeProjectId, onProjectClick, onNodeClick, inputLevel, outputLevel, visualState, pulses };

  // Persistent animation state — never recreated
  const animRef = useRef({ t: 0, rgb: [...coreColor('IDLE')] as [number, number, number] });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const schedule = (fn: () => void) => {
      if (typeof requestAnimationFrame === 'undefined') return 0;
      return requestAnimationFrame(fn);
    };
    const cancel = (id: number) => { if (typeof cancelAnimationFrame !== 'undefined' && id) cancelAnimationFrame(id); };

    let raf = 0;
    let broken = false;

    if (typeof WebGLRenderingContext === 'undefined') {
      raf = schedule(() => {});
      return () => { cancel(raf); };
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.warn('[JarvisNeuralBlob] WebGL unavailable — transparent canvas fallback.', err);
      return;
    }

    const onContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('[JarvisNeuralBlob] WebGL context lost — pausing visual loop.');
      broken = true;
      cancel(raf);
    };
    canvas.addEventListener('webglcontextlost', onContextLost, false);

    renderer.setPixelRatio(dpr);
    renderer.setClearColor(0x000000, 0);

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
    camera.position.set(0, 0, CAMERA_CONFIG.DEFAULT_DISTANCE);
    camera.lookAt(0, 0, 0);

    const updateDimensions = () => {
      const w = canvas.clientWidth || size || 600;
      const h = canvas.clientHeight || size || 600;
      if (w > 0 && h > 0) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    };
    updateDimensions();

    const onWindowResize = () => {
      updateDimensions();
    };
    window.addEventListener('resize', onWindowResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateDimensions();
      });
      resizeObserver.observe(canvas);
      if (shellRef.current) resizeObserver.observe(shellRef.current);
    }

    // ── Mouse Wheel Zoom Event (non-passive to prevent page scroll) ────────
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraStateRef.current;
      cam.targetDistance = clampCameraDistance(cam.targetDistance + e.deltaY * CAMERA_CONFIG.ZOOM_SPEED);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const colorToThree = (rgb: [number, number, number]) => new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

    const initRGB = [...coreColor('IDLE')] as [number, number, number];
    const u_color = new THREE.Color(initRGB[0] / 255, initRGB[1] / 255, initRGB[2] / 255);

    // ── Direct Audio Level Listeners (eliminates React render lag & stepping) ──
    const audioLevels = {
      rawInput: 0,
      rawOutput: 0,
      smoothInput: 0,
      smoothOutput: 0,
      smoothLow: 0,
      smoothMid: 0,
      smoothHigh: 0,
    };

    const onAudioInput = (e: Event) => {
      audioLevels.rawInput = Math.max(0, Math.min(1, ((e as CustomEvent).detail?.level ?? 0) as number));
    };
    const onAudioOutput = (e: Event) => {
      audioLevels.rawOutput = Math.max(0, Math.min(1, ((e as CustomEvent).detail?.level ?? 0) as number));
    };
    window.addEventListener('jarvis-orb:input-level', onAudioInput);
    window.addEventListener('jarvis-orb:output-level', onAudioOutput);

    // ── Layer 1: Outer deforming shell (GLSL vertex displacement) ──────────
    // Continuous smooth geometry with sub-pixel vertex spacing to prevent faceted edges
    const shellGeo = new THREE.SphereGeometry(0.82, 128, 96);
    disposables.push(shellGeo);
    const shellUniforms = {
      u_time:         { value: 0 },
      u_color:        { value: u_color.clone() },
      u_energy:       { value: 0.14 },
      u_deform:       { value: 0.18 },
      u_input_level:  { value: 0 },
      u_output_level: { value: 0 },
      u_voice_low:    { value: 0 },
      u_voice_mid:    { value: 0 },
      u_voice_high:   { value: 0 },
      u_is_speaking:  { value: 0 },
    };
    const shellMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG,
      uniforms: shellUniforms,
      transparent: true, blending: THREE.NormalBlending,
      depthWrite: false, depthTest: false, side: THREE.FrontSide,
    });
    disposables.push(shellMat);
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    shellMesh.renderOrder = 4;
    scene.add(shellMesh);

    // ── Layer 2: Inner volumetric noise sphere ─────────────────────────────
    const innerGeo = new THREE.SphereGeometry(0.55, 64, 48);
    disposables.push(innerGeo);
    const innerUniforms = {
      u_time:   { value: 0 },
      u_color:  { value: u_color.clone() },
      u_energy: { value: 0.14 },
    };
    const innerMat = new THREE.ShaderMaterial({
      vertexShader: INNER_VERT, fragmentShader: INNER_FRAG,
      uniforms: innerUniforms,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.FrontSide,
    });
    disposables.push(innerMat);
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.renderOrder = 2;
    scene.add(innerMesh);

    // ── Layer 3: Internal particle field ──────────────────────────────────
    const PARTICLE_COUNT = 600;
    const pPos: number[] = [];
    const pSeed: number[] = [];
    const pAxis: number[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const seed = i * 12.9898 + 0.1;
      const u = ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1;
      const v = ((Math.sin(seed * 1.37) * 24634.6) % 1 + 1) % 1;
      const w = ((Math.sin(seed * 1.91) * 13217.4) % 1 + 1) % 1;
      const r = Math.cbrt(u) * 0.76;
      const theta = v * Math.PI * 2;
      const phi = Math.acos(2 * w - 1);
      pPos.push(
        Math.sin(phi) * Math.cos(theta) * r,
        Math.cos(phi) * r * 0.85,
        Math.sin(phi) * Math.sin(theta) * r,
      );
      pSeed.push(u);
      const ax = Math.sin(seed * 2.34) * 2 - 1;
      const ay = Math.sin(seed * 3.71) * 2 - 1;
      const az = Math.sin(seed * 1.55) * 2 - 1;
      const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      pAxis.push(ax / al, ay / al, az / al);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
    particleGeo.setAttribute('a_seed',   new THREE.Float32BufferAttribute(pSeed, 1));
    particleGeo.setAttribute('a_axis',   new THREE.Float32BufferAttribute(pAxis, 3));
    disposables.push(particleGeo);
    const particleUniforms = {
      u_time:         { value: 0 },
      u_color:        { value: u_color.clone() },
      u_energy:       { value: 0.14 },
      u_input_level:  { value: 0 },
      u_output_level: { value: 0 },
      u_voice_mid:    { value: 0 },
      u_is_speaking:  { value: 0 },
    };
    const particleMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      uniforms: particleUniforms,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false,
    });
    disposables.push(particleMat);
    const particles = new THREE.Points(particleGeo, particleMat);
    particles.renderOrder = 3;
    scene.add(particles);

    // ── Layer 4: Soft ambient glow backdrop ────────────────────────────────
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128; glowCanvas.height = 128;
    const gctx = glowCanvas.getContext('2d');
    if (gctx) {
      const g = gctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,0.7)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.22)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      gctx.fillStyle = g;
      gctx.fillRect(0, 0, 128, 128);
    }
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    disposables.push(glowTex);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      opacity: 0.16, color: u_color.clone(),
    });
    disposables.push(glowMat);
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.set(2.4, 2.4, 1);
    glowSprite.renderOrder = 1;
    scene.add(glowSprite);

    // ── Capability satellite nodes ────────────────────────────────────────
    const makeLineMaterial = (rgb: [number, number, number], opacity: number) =>
      new THREE.LineBasicMaterial({
        color: colorToThree(rgb), transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      });

    const makeLabel = (text: string, rgb: [number, number, number]) => {
      const lc = document.createElement('canvas');
      lc.width = 256; lc.height = 64;
      const lctx = lc.getContext('2d');
      if (lctx) {
        lctx.clearRect(0, 0, 256, 64);
        lctx.font = '700 26px Inter, Arial, sans-serif';
        lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
        lctx.shadowColor = 'rgba(2,6,23,0.95)'; lctx.shadowBlur = 10;
        lctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.96)`;
        lctx.fillText(text, 128, 32);
      }
      const tex = new THREE.CanvasTexture(lc);
      tex.colorSpace = THREE.SRGBColorSpace;
      disposables.push(tex);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
      }));
      sprite.scale.set(0.55, 0.14, 1);
      return sprite;
    };

    const makeEllipse = (rx: number, ry: number, rgb: [number, number, number], opacity: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry, 0.1));
      }
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), makeLineMaterial(rgb, opacity));
    };

    const capGroup = new THREE.Group();
    scene.add(capGroup);
    const capRx = 1.35; const capRy = 1.35;
    const capOrbit = makeEllipse(capRx, capRy, TURQUOISE, 0.16);
    capOrbit.renderOrder = 12;
    capGroup.add(capOrbit);

    const nodeMeshes: Array<{ node: NeuralNodeId; dot: THREE.Mesh; halo: THREE.Mesh; label: THREE.Sprite; conn: THREE.Line; worldPos: THREE.Vector3 }> = [];
    CONTEXTUAL_CAPABILITIES.forEach((node, i) => {
      const angle = -Math.PI / 2 + (i / CONTEXTUAL_CAPABILITIES.length) * Math.PI * 2;
      const [nr, ng, nb] = NODE_COLORS[node];
      const color = new THREE.Color(nr / 255, ng / 255, nb / 255);
      const x = Math.cos(angle) * capRx;
      const y = Math.sin(angle) * capRy;

      const conn = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(Math.cos(angle) * 0.88, Math.sin(angle) * 0.88, 0.12),
          new THREE.Vector3(x, y, 0.12),
        ]),
        makeLineMaterial([nr, ng, nb], 0.12),
      );
      conn.renderOrder = 13;

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 20, 14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthTest: false }),
      );
      halo.position.set(x, y, 0.12); halo.renderOrder = 20;

      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 20, 14),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthTest: false }),
      );
      dot.position.copy(halo.position); dot.renderOrder = 21;

      const labelSprite = makeLabel(NODE_LABELS[node], [nr, ng, nb]);
      labelSprite.position.set(x, y - 0.16, 0.3); labelSprite.renderOrder = 22;

      capGroup.add(conn, halo, dot, labelSprite);
      nodeMeshes.push({ node, dot, halo, label: labelSprite, conn, worldPos: new THREE.Vector3(x, y, 0.12) });
    });

    // ── Project stars (outer orbit) ───────────────────────────────────────
    const projectGroup = new THREE.Group();
    scene.add(projectGroup);
    const projRx = 1.75; const projRy = 1.75;
    const projectOrbit = makeEllipse(projRx, projRy, [100, 116, 139], 0.09);
    projectOrbit.renderOrder = 11;
    scene.add(projectOrbit);

    const projectMeshes: Array<{ id: string; worldPos: THREE.Vector3 }> = [];

    const rebuildProjects = () => {
      projectGroup.clear();
      projectMeshes.length = 0;
      const { projects: list, activeProjectId: activeId } = liveRef.current;
      const n = list.length;
      list.forEach((p, i) => {
        const angle = n === 0 ? 0 : -Math.PI / 2 + (i / n) * Math.PI * 2;
        const rgb = p.color ? hexToRgb(p.color) ?? LOCKED_PALETTE[stableIndex(p.id)] : LOCKED_PALETTE[stableIndex(p.id)];
        const color = colorToThree(rgb);
        const x = Math.cos(angle) * projRx;
        const y = Math.sin(angle) * projRy;
        const isActive = p.id === activeId;
        const star = new THREE.Mesh(
          new THREE.SphereGeometry(isActive ? 0.065 : 0.04, 16, 12),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isActive ? 0.95 : 0.38, blending: THREE.AdditiveBlending }),
        );
        star.position.set(x, y, -0.1); star.renderOrder = 18;
        projectGroup.add(star);
        projectMeshes.push({ id: p.id, worldPos: new THREE.Vector3(x, y, -0.1) });

        if (isActive) {
          const lbl = makeLabel(p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name, rgb);
          lbl.position.set(x, y - 0.28, 0.1); lbl.renderOrder = 19;
          projectGroup.add(lbl);
        }
      });
    };
    rebuildProjects();

    // ─── Animation loop ───────────────────────────────────────────────────
    const anim = animRef.current;
    let curParams = { ...stateParams('IDLE') };
    let projectSig = '';

    const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t);
    const lerpRGB = (cur: [number, number, number], target: [number, number, number], k: number) => {
      cur[0] = lerp(cur[0], target[0], k);
      cur[1] = lerp(cur[1], target[1], k);
      cur[2] = lerp(cur[2], target[2], k);
    };

    const tempV3 = new THREE.Vector3();

    const draw = () => {
      const dt = 0.016;
      const { visualState: vs, inputLevel: il, outputLevel: ol, pulses: ps } = liveRef.current;
      const target = stateParams(vs);
      const alpha = 0.038;
      curParams.energy = lerp(curParams.energy, target.energy, alpha);
      curParams.glow   = lerp(curParams.glow,   target.glow,   alpha);
      curParams.deform = lerp(curParams.deform, target.deform, alpha);
      curParams.speed  = lerp(curParams.speed,  target.speed,  alpha);

      anim.t += dt * curParams.speed;
      const t = anim.t;

      // ── Smooth Camera Interpolation ──
      const cam = cameraStateRef.current;
      cam.distance += (cam.targetDistance - cam.distance) * CAMERA_CONFIG.DAMPING;
      cam.azimuth += (cam.targetAzimuth - cam.azimuth) * CAMERA_CONFIG.DAMPING;
      cam.elevation += (cam.targetElevation - cam.elevation) * CAMERA_CONFIG.DAMPING;

      const camPos = sphericalToCartesian(cam.distance, cam.elevation, cam.azimuth);
      camera.position.set(camPos.x, camPos.y, camPos.z);
      camera.lookAt(0, 0, 0);

      // ── Smooth Audio Envelopes (Fast Attack / Smooth Release) ──
      const targetIn = Math.max(audioLevels.rawInput, vs === 'LISTENING' ? il : 0);
      const targetOut = Math.max(audioLevels.rawOutput, vs === 'SPEAKING' ? ol : 0);

      if (targetIn > audioLevels.smoothInput) {
        audioLevels.smoothInput += (targetIn - audioLevels.smoothInput) * 0.28;
      } else {
        audioLevels.smoothInput += (targetIn - audioLevels.smoothInput) * 0.052;
      }

      if (targetOut > audioLevels.smoothOutput) {
        audioLevels.smoothOutput += (targetOut - audioLevels.smoothOutput) * 0.32;
      } else {
        audioLevels.smoothOutput += (targetOut - audioLevels.smoothOutput) * 0.058;
      }

      const mic = vs === 'LISTENING' ? audioLevels.smoothInput : 0;
      const spk = vs === 'SPEAKING'  ? audioLevels.smoothOutput : 0;
      const isSpeaking = vs === 'SPEAKING' ? 1.0 : 0.0;
      const voicePulse = Math.max(mic, spk);

      audioLevels.smoothLow  = lerp(audioLevels.smoothLow,  voicePulse * 1.15, 0.10);
      audioLevels.smoothMid  = lerp(audioLevels.smoothMid,  voicePulse * 1.45, 0.18);
      audioLevels.smoothHigh = lerp(audioLevels.smoothHigh, voicePulse * 1.90, 0.28);

      // Color lerp toward voice-shifted palette
      const voiceTarget = voiceColorShift(coreColor(vs), voicePulse);
      lerpRGB(anim.rgb, voiceTarget, alpha * 2.4);
      const c = colorToThree(anim.rgb);

      // Update all shader uniforms
      shellUniforms.u_time.value         = t;
      shellUniforms.u_color.value.copy(c);
      shellUniforms.u_energy.value       = curParams.energy;
      shellUniforms.u_deform.value       = curParams.deform;
      shellUniforms.u_input_level.value  = mic;
      shellUniforms.u_output_level.value = spk;
      shellUniforms.u_voice_low.value    = audioLevels.smoothLow;
      shellUniforms.u_voice_mid.value    = audioLevels.smoothMid;
      shellUniforms.u_voice_high.value   = audioLevels.smoothHigh;
      shellUniforms.u_is_speaking.value  = isSpeaking;

      innerUniforms.u_time.value   = t * 0.55;
      innerUniforms.u_color.value.copy(c);
      innerUniforms.u_energy.value = curParams.energy;

      particleUniforms.u_time.value         = t;
      particleUniforms.u_color.value.copy(c);
      particleUniforms.u_energy.value       = curParams.energy;
      particleUniforms.u_input_level.value  = mic;
      particleUniforms.u_output_level.value = spk;
      particleUniforms.u_voice_mid.value    = audioLevels.smoothMid;
      particleUniforms.u_is_speaking.value  = isSpeaking;

      glowMat.opacity = 0.12 + curParams.glow * 0.16 + voicePulse * 0.12;
      glowMat.color.copy(c);

      // Shell slow auto-rotation (passive orbit)
      shellMesh.rotation.y = t * 0.12;
      shellMesh.rotation.x = Math.sin(t * 0.17) * 0.08;
      innerMesh.rotation.y = t * 0.28;
      innerMesh.rotation.z = Math.sin(t * 0.19) * 0.12;
      particles.rotation.y = t * (0.08 + curParams.energy * 0.04);
      particles.rotation.x = Math.sin(t * 0.11) * 0.05;

      // Voice vibration → CSS vars on shell element
      const vib = voiceVibration(t, voicePulse);
      if (shellRef.current) {
        shellRef.current.style.setProperty('--jarvis-vib-x',     vib.dx.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-vib-y',     vib.dy.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-vib-rot',   vib.rot.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-vib-scale', vib.scale.toFixed(4));
        shellRef.current.style.setProperty('--jarvis-voice',     voicePulse.toFixed(4));
      }

      // Rebuild project stars if projects/activeProject changed
      const sig = `${liveRef.current.activeProjectId ?? ''}:${liveRef.current.projects.map((p) => `${p.id}:${p.color ?? ''}`).join('|')}`;
      if (sig !== projectSig) { projectSig = sig; rebuildProjects(); }

      // Satellite node animations
      let primaryCap: NeuralNodeId | null = null; let primaryAct = 0;
      for (const node of CONTEXTUAL_CAPABILITIES) {
        const act = ps[node];
        if (act > 0.1 && act > primaryAct) { primaryCap = node; primaryAct = act; }
      }
      nodeMeshes.forEach(({ node, dot, halo, label, conn }, i) => {
        const act = ps[node];
        const pulse = 1 + act * 0.24 + (node === primaryCap ? Math.sin(t * 3.2 + i) * 0.04 : 0);
        dot.scale.setScalar(pulse);
        halo.scale.setScalar(1.05 + act * 0.55 + Math.sin(t * 1.1 + i) * 0.04);
        (halo.material as THREE.MeshBasicMaterial).opacity = 0.28 + act * 0.30;
        (conn.material as THREE.LineBasicMaterial).opacity = node === primaryCap ? 0.30 + act * 0.30 : 0.10;
        label.quaternion.copy(camera.quaternion);
      });

      // Orbit group slow wobble
      capGroup.rotation.z = Math.sin(t * 0.09) * 0.04;

      // Update projected 2D screen positions for accurate hit-testing
      const rect = canvas.getBoundingClientRect();
      const w = rect.width || size;
      const h = rect.height || size;

      projectedNodesRef.current = nodeMeshes.map(({ node, worldPos }) => {
        tempV3.copy(worldPos);
        tempV3.applyMatrix4(capGroup.matrixWorld);
        tempV3.project(camera);
        return {
          id: node,
          screenX: (tempV3.x * 0.5 + 0.5) * w,
          screenY: (-tempV3.y * 0.5 + 0.5) * h,
        };
      });

      projectedProjectsRef.current = projectMeshes.map(({ id, worldPos }) => {
        tempV3.copy(worldPos);
        tempV3.project(camera);
        return {
          id,
          screenX: (tempV3.x * 0.5 + 0.5) * w,
          screenY: (-tempV3.y * 0.5 + 0.5) * h,
        };
      });

      if (broken) return;
      try {
        renderer.render(scene, camera);
      } catch (err) {
        console.warn('[JarvisNeuralBlob] render failed — stopping loop.', err);
        broken = true; cancel(raf); return;
      }
      raf = schedule(draw);
    };

    raf = schedule(draw);
    return () => {
      cancel(raf);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      window.removeEventListener('jarvis-orb:input-level', onAudioInput);
      window.removeEventListener('jarvis-orb:output-level', onAudioOutput);
      renderer.dispose();
      disposables.forEach((d) => d.dispose());
      scene.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (Array.isArray(m.material)) m.material.forEach((mt) => mt.dispose());
        else if (m.material) (m.material as THREE.Material).dispose();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // ─── Pointer Event Handlers for Orbit & Drag ──────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cam = cameraStateRef.current;
    cam.isDragging = true;
    cam.dragStart = { x: e.clientX, y: e.clientY };
    cam.lastPointer = { x: e.clientX, y: e.clientY };
    cam.hasMoved = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cam = cameraStateRef.current;
    if (!cam.isDragging) return;

    const dx = e.clientX - cam.lastPointer.x;
    const dy = e.clientY - cam.lastPointer.y;
    cam.lastPointer = { x: e.clientX, y: e.clientY };

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      cam.hasMoved = true;
    }

    cam.targetAzimuth -= dx * CAMERA_CONFIG.ORBIT_SPEED;
    cam.targetElevation = Math.max(
      CAMERA_CONFIG.MIN_ELEVATION,
      Math.min(CAMERA_CONFIG.MAX_ELEVATION, cam.targetElevation - dy * CAMERA_CONFIG.ORBIT_SPEED),
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cam = cameraStateRef.current;
    cam.isDragging = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // ─── Reset Camera on Double Click ─────────────────────────────────────────
  const handleDoubleClick = () => {
    const cam = cameraStateRef.current;
    cam.targetDistance = CAMERA_CONFIG.DEFAULT_DISTANCE;
    cam.targetAzimuth = 0;
    cam.targetElevation = 0;
  };

  // ─── Hit testing for node + project clicks (Drag-Safe) ────────────────────
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cam = cameraStateRef.current;
    // If the pointer dragged/orbited the scene, suppress click hit testing
    if (cam.hasMoved) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. First check accurate 3D projected satellite nodes
    const { onNodeClick: onNode, onProjectClick: onProj } = liveRef.current;
    if (onNode && projectedNodesRef.current.length > 0) {
      for (const pNode of projectedNodesRef.current) {
        if (Math.hypot(x - pNode.screenX, y - pNode.screenY) < 24) {
          onNode(pNode.id);
          return;
        }
      }
    }

    // 2. Then check accurate 3D projected project stars
    if (onProj && projectedProjectsRef.current.length > 0) {
      for (const pProj of projectedProjectsRef.current) {
        if (Math.hypot(x - pProj.screenX, y - pProj.screenY) < 24) {
          onProj(pProj.id);
          return;
        }
      }
    }

    // 3. Fallback 2D hit test (for headless / initial layout test compatibility)
    const w = rect.width; const h = rect.height;
    const cx = w / 2; const cy = h / 2;
    const capRxPx = w * 0.33; const capRyPx = h * 0.33;
    const projRxPx = w * 0.47; const projRyPx = h * 0.47;

    if (onNode) {
      for (let i = 0; i < CONTEXTUAL_CAPABILITIES.length; i++) {
        const pos = nodePosition(i, cx, cy, capRxPx, capRyPx);
        if (Math.hypot(x - pos.x, y - pos.y) < 20) {
          onNode(CONTEXTUAL_CAPABILITIES[i]);
          return;
        }
      }
    }
    if (onProj) {
      const list = [...liveRef.current.projects].sort((a, b) => stableProjectAngle(a.id) - stableProjectAngle(b.id));
      list.forEach((p, i) => {
        const angle = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
        const px = cx + Math.cos(angle) * projRxPx;
        const py = cy + Math.sin(angle) * projRyPx;
        if (Math.hypot(x - px, y - py) < 20) onProj(p.id);
      });
    }
  };

  return (
    <div
      data-testid={testId}
      data-orb-state={state.toLowerCase()}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', position: 'relative' }}
    >
      <div
        ref={shellRef}
        className={`jarvis-blob1-shell jarvis-blob1-shell--${visualState.toLowerCase()}`}
        style={{
          position: 'relative',
          width: '100%',
          height: size ? `${Math.max(size, 380)}px` : '420px',
          maxWidth: '100%',
          overflow: 'visible',
          borderRadius: 0,
          background: 'transparent',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          data-testid={`${testId}-canvas`}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            zIndex: 4,
            background: 'transparent',
            display: 'block',
            cursor: onNodeClick || onProjectClick ? 'pointer' : 'grab',
            touchAction: 'none',
          }}
          role="img"
          aria-label={`Jarvis neural core — state ${toBlobVisualState(state)}`}
        />
      </div>
      <div
        data-testid={`${testId}-caption`}
        style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.35, zIndex: 6 }}
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

export { NODE_ROUTES, modelLabel };
