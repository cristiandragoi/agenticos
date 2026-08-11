/**
 * Jarvis Humanoid Visualization — Humanoid Core (SVG)
 * Programmatic vector reconstruction of the reference image.
 * No raster images. Fully controllable layers.
 */

import React, { useRef, useEffect } from 'react';
import { getChannelColor } from './useJarvisAnimator';
import type { AnimatorState } from './useJarvisAnimator';
import type { VisualChannel, LayerId } from './JarvisState';

interface HumanoidCoreProps {
  animator: React.MutableRefObject<AnimatorState>;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const HumanoidCore: React.FC<HumanoidCoreProps> = ({ animator, width, height, centerX, centerY }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const update = () => {
      const a = animator.current;
      const ch = a.activeChannel;
      const baseColor = getChannelColor(ch, 1);
      const glowColor = getChannelColor(ch, a.layerIntensities.brain * a.glowPhase);
      const chestGlow = getChannelColor(ch, a.layerIntensities.chest * 0.8);
      const faceGlow = getChannelColor(ch, a.layerIntensities.face * 0.7);
      const eyeColor = getChannelColor(
        a.severityFlash > 0.5 ? 'yellow' : ch,
        a.layerIntensities.eyes * a.eyeOpen * a.connectionPulse
      );

      // Update brain glow
      const brainGlow = svg.querySelector('#brain-glow') as SVGFEFloodElement;
      if (brainGlow) {
        brainGlow.setAttribute('flood-color', baseColor);
      }
      const brainBlur = svg.querySelector('#brain-blur') as SVGFEGaussianBlurElement;
      if (brainBlur) {
        brainBlur.setAttribute('stdDeviation', String(8 + a.layerIntensities.brain * 12));
      }

      // Update chest glow
      const chestGlowEl = svg.querySelector('#chest-glow') as SVGFEFloodElement;
      if (chestGlowEl) {
        chestGlowEl.setAttribute('flood-color', baseColor);
      }
      const chestBlur = svg.querySelector('#chest-blur') as SVGFEGaussianBlurElement;
      if (chestBlur) {
        chestBlur.setAttribute('stdDeviation', String(6 + a.layerIntensities.chest * 10));
      }

      // Update face stroke
      const facePath = svg.querySelector('#face-path') as SVGPathElement;
      if (facePath) {
        facePath.setAttribute('stroke', faceGlow);
        facePath.setAttribute('stroke-width', String(0.5 + a.layerIntensities.face * 1.5));
      }

      // Update eyes
      const leftEye = svg.querySelector('#eye-left') as SVGCircleElement;
      const rightEye = svg.querySelector('#eye-right') as SVGCircleElement;
      if (leftEye && rightEye) {
        const eyeRadius = 2.5 * a.eyeOpen;
        leftEye.setAttribute('r', String(eyeRadius));
        rightEye.setAttribute('r', String(eyeRadius));
        leftEye.setAttribute('fill', eyeColor);
        rightEye.setAttribute('fill', eyeColor);
      }

      // Update halo
      const halo = svg.querySelector('#halo-ring') as SVGCircleElement;
      if (halo) {
        const haloOpacity = a.layerIntensities.halo * (0.3 + 0.7 * a.glowPhase);
        halo.setAttribute('stroke', getChannelColor(ch, haloOpacity));
        halo.setAttribute('stroke-width', String(0.5 + a.layerIntensities.halo * 2));
      }

      // Update severity overlay
      const severityOverlay = svg.querySelector('#severity-overlay') as SVGCircleElement;
      if (severityOverlay) {
        if (a.severityFlash > 0.3) {
          severityOverlay.setAttribute('fill', getChannelColor('red', a.severityFlash * 0.15));
        } else {
          severityOverlay.setAttribute('fill', 'transparent');
        }
      }

      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameRef.current);
  }, [animator]);

  const scale = Math.min(width, height) / 500;
  const sx = centerX;
  const sy = centerY;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      <defs>
        {/* Brain Glow Filter */}
        <filter id="brain-glow-filter" x="-50%" y="-50%" width="200%" height="200%">
          <feFlood id="brain-glow" floodColor="#00e5ff" result="color" />
          <feGaussianBlur id="brain-blur" in="color" stdDeviation="12" result="blur" />
          <feComposite in="blur" in2="SourceGraphic" operator="over" />
        </filter>

        {/* Chest Glow Filter */}
        <filter id="chest-glow-filter" x="-50%" y="-50%" width="200%" height="200%">
          <feFlood id="chest-glow" floodColor="#00e5ff" result="color" />
          <feGaussianBlur id="chest-blur" in="color" stdDeviation="10" result="blur" />
          <feComposite in="blur" in2="SourceGraphic" operator="over" />
        </filter>

        {/* Dot Pattern for particle texture */}
        <pattern id="dot-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.5" fill="currentColor" opacity="0.3" />
        </pattern>

        {/* Gradient for body */}
        <radialGradient id="body-gradient" cx="50%" cy="30%" r="60%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g transform={`translate(${sx}, ${sy}) scale(${scale})`}>
        {/* ── HALO / NEURAL FIELD ── */}
        <circle
          id="halo-ring"
          cx="0"
          cy="-80"
          r="140"
          fill="none"
          stroke="#00e5ff"
          strokeWidth="1"
          strokeDasharray="4 8"
          opacity="0.3"
        />
        <circle
          cx="0"
          cy="-80"
          r="160"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="2 12"
          opacity="0.15"
        />

        {/* ── SHOULDER / BODY OUTLINE ── */}
        <path
          d="M -90 20 Q -110 40 -100 80 Q -80 120 -40 140 L 40 140 Q 80 120 100 80 Q 110 40 90 20 Q 70 0 50 -10 L -50 -10 Q -70 0 -90 20"
          fill="url(#body-gradient)"
          stroke="currentColor"
          strokeWidth="0.8"
          opacity="0.4"
        />

        {/* ── NECK ── */}
        <path
          d="M -15 -10 L -12 30 L 12 30 L 15 -10"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          opacity="0.5"
        />

        {/* ── HEAD / FACE ── */}
        <g id="head-group">
          {/* Head outline */}
          <ellipse
            cx="0"
            cy="-60"
            rx="45"
            ry="55"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.8"
            opacity="0.5"
          />

          {/* Face contour (programmatic reconstruction) */}
          <path
            id="face-path"
            d="M -30 -75 Q 0 -85 30 -75 Q 35 -60 32 -45 Q 30 -30 20 -20 Q 10 -10 0 -8 Q -10 -10 -20 -20 Q -30 -30 -32 -45 Q -35 -60 -30 -75"
            fill="none"
            stroke="#00e5ff"
            strokeWidth="0.8"
            opacity="0.7"
          />

          {/* Jaw line */}
          <path
            d="M -20 -20 Q -15 5 0 10 Q 15 5 20 -20"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.4"
          />

          {/* Nose bridge */}
          <path
            d="M 0 -45 L 0 -25"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.4"
            opacity="0.35"
          />

          {/* Mouth */}
          <path
            d="M -8 -5 Q 0 -2 8 -5"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.4"
          />

          {/* ── EYES ── */}
          <circle id="eye-left" cx="-18" cy="-38" r="2.5" fill="#00e5ff" opacity="0.9" />
          <circle id="eye-right" cx="18" cy="-38" r="2.5" fill="#00e5ff" opacity="0.9" />

          {/* Eyebrow guides */}
          <path d="M -28 -48 Q -18 -52 -8 -48" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.3" />
          <path d="M 8 -48 Q 18 -52 28 -48" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.3" />
        </g>

        {/* ── BRAIN / CORE ── */}
        <g filter="url(#brain-glow-filter)">
          <circle cx="0" cy="-80" r="8" fill="#00e5ff" opacity="0.8" />
          <circle cx="0" cy="-80" r="4" fill="#ffffff" opacity="0.9" />
        </g>
        {/* Brain radiating lines */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line
            key={angle}
            x1={Math.cos((angle * Math.PI) / 180) * 10}
            y1={-80 + Math.sin((angle * Math.PI) / 180) * 10}
            x2={Math.cos((angle * Math.PI) / 180) * 22}
            y2={-80 + Math.sin((angle * Math.PI) / 180) * 22}
            stroke="currentColor"
            strokeWidth="0.6"
            opacity="0.5"
          />
        ))}

        {/* ── CHEST / CORE ── */}
        <g filter="url(#chest-glow-filter)">
          <circle cx="0" cy="50" r="12" fill="#00e5ff" opacity="0.6" />
          <circle cx="0" cy="50" r="6" fill="#ffffff" opacity="0.8" />
        </g>
        {/* Chest radiating lines */}
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <line
            key={`chest-${angle}`}
            x1={Math.cos((angle * Math.PI) / 180) * 15}
            y1={50 + Math.sin((angle * Math.PI) / 180) * 15}
            x2={Math.cos((angle * Math.PI) / 180) * 28}
            y2={50 + Math.sin((angle * Math.PI) / 180) * 28}
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.4"
          />
        ))}

        {/* ── VERTICAL SPINE / CONNECTION ── */}
        <line
          x1="0"
          y1="-30"
          x2="0"
          y2="38"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeDasharray="3 3"
          opacity="0.5"
        />

        {/* ── SEVERITY OVERLAY ── */}
        <circle
          id="severity-overlay"
          cx="0"
          cy="-20"
          r="100"
          fill="transparent"
          pointerEvents="none"
        />
      </g>
    </svg>
  );
};

export default React.memo(HumanoidCore);
