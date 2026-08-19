/**
 * Jarvis Humanoid Visualization — Animation Engine
 * Custom hook managing all time-based visual state.
 * Designed for 60fps continuous operation in Electron.
 */

import { useRef, useEffect, useCallback } from 'react';
import {
  JarvisState,
  VisualChannel,
  LayerId,
  SystemNode,
  Severity,
  STATE_CHANNEL_MAP,
  STATE_LAYER_PRESETS,
  CHANNEL_COLORS,
  ANIMATION_CONFIG,
} from './JarvisState';

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  layer: LayerId;
}

export interface AnimatorState {
  time: number;
  particles: Particle[];
  glowPhase: number;        // 0–1 sine wave for glow pulsing
  neuralPhase: number;      // 0–1 for neural traffic
  eyeOpen: number;          // 0–1 (1 = fully open)
  isBlinking: boolean;
  severityFlash: number;    // 0–1 for error/warning flashing
  connectionPulse: number;  // 0–1 for connection heartbeat
  nodePulses: Record<SystemNode, number>;
  layerIntensities: Record<LayerId, number>;
  activeChannel: VisualChannel;
}

export interface AnimatorOptions {
  state: JarvisState;
  activeNode: SystemNode | null;
  severity: Severity;
  speakingLevel: number;
  thinkingIntensity: number;
  isConnected: boolean;
  nodeActivity: Partial<Record<SystemNode, number>>;
  layerOverrides?: Partial<Record<LayerId, { color?: VisualChannel; intensity?: number }>>;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 229, 255];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function useJarvisAnimator(options: AnimatorOptions) {
  const {
    state,
    activeNode,
    severity,
    speakingLevel,
    thinkingIntensity,
    isConnected,
    nodeActivity,
    layerOverrides,
  } = options;

  const stateRef = useRef(options);
  stateRef.current = options;

  const animStateRef = useRef<AnimatorState>({
    time: 0,
    particles: [],
    glowPhase: 0,
    neuralPhase: 0,
    eyeOpen: 1,
    isBlinking: false,
    severityFlash: 0,
    connectionPulse: 1,
    nodePulses: {
      Memory: 0, Projects: 0, Knowledge: 0,
      Hermes: 0, CodeX: 0, Runs: 0,
      Artifacts: 0, Vision: 0, Oracle: 0,
    },
    layerIntensities: {
      face: 0.3, head: 0.3, eyes: 0.5,
      brain: 0.2, neuralPathways: 0.1,
      chest: 0.2, halo: 0.15, systemNodes: 0.1,
    },
    activeChannel: 'cyan',
  });

  const rafRef = useRef<number>(0);
  const lastBlinkRef = useRef<number>(0);
  const blinkStartRef = useRef<number>(0);

  // Initialize particles
  useEffect(() => {
    const particles: Particle[] = [];
    for (let i = 0; i < ANIMATION_CONFIG.particleCount; i++) {
      particles.push(createParticle(i));
    }
    animStateRef.current.particles = particles;
  }, []);

  function createParticle(id: number): Particle {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 120;
    const layers: LayerId[] = ['brain', 'neuralPathways', 'chest', 'halo'];
    return {
      id,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist - 30,
      vx: (Math.random() - 0.5) * ANIMATION_CONFIG.particleSpeedVar,
      vy: (Math.random() - 0.5) * ANIMATION_CONFIG.particleSpeedVar,
      life: Math.random() * 100,
      maxLife: 60 + Math.random() * 120,
      size: 1 + Math.random() * 2.5,
      layer: layers[Math.floor(Math.random() * layers.length)],
    };
  }

  const tick = useCallback((timestamp: number) => {
    const s = stateRef.current;
    const a = animStateRef.current;
    const dt = 16.67;
    a.time += dt;

    // ── Glow Phase (sine wave) ──
    a.glowPhase = (Math.sin(a.time / (ANIMATION_CONFIG.glowPulsePeriod / (2 * Math.PI))) + 1) / 2;

    // ── Neural Traffic Phase ──
    a.neuralPhase = (a.time % ANIMATION_CONFIG.neuralTrafficPeriod) / ANIMATION_CONFIG.neuralTrafficPeriod;

    // ── Eye Blink Logic ──
    if (!a.isBlinking && timestamp - lastBlinkRef.current > ANIMATION_CONFIG.eyeBlinkInterval + Math.random() * 2000) {
      a.isBlinking = true;
      blinkStartRef.current = timestamp;
      lastBlinkRef.current = timestamp;
    }
    if (a.isBlinking) {
      const blinkElapsed = timestamp - blinkStartRef.current;
      if (blinkElapsed < ANIMATION_CONFIG.eyeBlinkDuration / 2) {
        a.eyeOpen = 1 - (blinkElapsed / (ANIMATION_CONFIG.eyeBlinkDuration / 2));
      } else if (blinkElapsed < ANIMATION_CONFIG.eyeBlinkDuration) {
        a.eyeOpen = (blinkElapsed - ANIMATION_CONFIG.eyeBlinkDuration / 2) / (ANIMATION_CONFIG.eyeBlinkDuration / 2);
      } else {
        a.eyeOpen = 1;
        a.isBlinking = false;
      }
    }

    // ── Severity Flash ──
    if (s.severity !== 'none' && s.severity !== 'low') {
      a.severityFlash = (Math.sin(a.time / (ANIMATION_CONFIG.severityFlashPeriod / (2 * Math.PI))) + 1) / 2;
    } else {
      a.severityFlash = 0;
    }

    // ── Connection Pulse ──
    a.connectionPulse = s.isConnected
      ? 0.7 + 0.3 * Math.sin(a.time / 1000)
      : 0.2 + 0.1 * Math.sin(a.time / 300);

    // ── Active Channel ──
    const overrideChannel = s.layerOverrides?.brain?.color || s.layerOverrides?.face?.color;
    a.activeChannel = overrideChannel || STATE_CHANNEL_MAP[s.state];

    // ── Layer Intensities (with smoothing) ──
    const targetPresets = STATE_LAYER_PRESETS[s.state];
    const intensityBoost = s.thinkingIntensity * 0.3 + s.speakingLevel * 0.2;
    (Object.keys(a.layerIntensities) as LayerId[]).forEach((layer) => {
      const target = (targetPresets[layer] || a.layerIntensities[layer]) + intensityBoost;
      const override = s.layerOverrides?.[layer]?.intensity;
      const finalTarget = override !== undefined ? override : clamp01(target);
      a.layerIntensities[layer] = lerp(a.layerIntensities[layer], finalTarget, 0.08);
    });

    // ── Node Pulses ──
    (Object.keys(a.nodePulses) as SystemNode[]).forEach((node) => {
      const activity = s.nodeActivity[node] || 0;
      const isActive = s.activeNode === node;
      const target = isActive ? 1 : activity * 0.6;
      a.nodePulses[node] = lerp(a.nodePulses[node], target, 0.06);
    });

    // ── Particle Update ──
    a.particles.forEach((p) => {
      p.x += p.vx * (1 + s.thinkingIntensity);
      p.y += p.vy * (1 + s.thinkingIntensity * 0.5);
      p.life += 1;

      if (p.life > p.maxLife) {
        const newP = createParticle(p.id);
        p.x = newP.x;
        p.y = newP.y;
        p.vx = newP.vx;
        p.vy = newP.vy;
        p.life = 0;
        p.maxLife = newP.maxLife;
        p.size = newP.size;
        p.layer = newP.layer;
      }
    });

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  return animStateRef;
}

export function getChannelColor(channel: VisualChannel, alpha = 1): string {
  const hex = CHANNEL_COLORS[channel];
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getSeverityColor(severity: Severity): VisualChannel {
  switch (severity) {
    case 'critical': return 'red';
    case 'high': return 'red';
    case 'medium': return 'yellow';
    case 'low': return 'yellow';
    default: return 'cyan';
  }
}
