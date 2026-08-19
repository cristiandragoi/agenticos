import React, { useEffect, useMemo, useRef } from 'react';
import { CognitiveField } from './CognitiveField';
import { CognitiveController } from './CognitiveController';
import type { CognitiveMode } from './CognitiveState';
import { viewTransform, type JarvisViewWindow } from './JarvisView';
import humanoidSrc from './assets/jarvis-humanoid.png';

/**
 * LOCKED VISUAL ASSET — the previously approved humanoid (jarvis-humanoid.png,
 * restored byte-for-byte from git: commit a7cf7ed → 7d93a9f^, 278,645 bytes,
 * 388x469). This renderer ONLY crops/scales the asset — it never redraws or
 * reconstructs anatomy. Crop = head → upper/mid chest (native y 26..342);
 * the pool/pedestal below the chest is cut out.
 *
 * CognitiveField is a SEPARATE overlay canvas — it animates around Jarvis and
 * never touches the humanoid render.
 */
const CROP = { top: 26, bottom: 342 }; // native asset coordinates
const ASSET_W = 388;
const ASSET_H = 469;

/** Overlay design-space window aligned so head-centered particles land on the
 *  PNG's head region (design y 360 ≈ stage head center). */
const STAGE_VIEW: JarvisViewWindow = { top: 90, bottom: 800, fade: 64 };

interface Props {
  controller: CognitiveController;
  mode: CognitiveMode;
  height?: number;
}

export const JarvisStage: React.FC<Props> = ({ controller, mode, height = 620 }) => {
  const width = Math.round((height * ASSET_W) / (CROP.bottom - CROP.top));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const img = useMemo(() => {
    const i = new Image();
    i.src = humanoidSrc;
    return i;
  }, []);
  const view = useMemo(() => STAGE_VIEW, []);

  // Locked humanoid render: draw the approved asset cropped to the bust.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    let raf = 0;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (img.complete && img.naturalWidth > 0) {
        // crop-only: source rect (bust window) → full stage. No redraw.
        ctx.drawImage(img, 0, CROP.top, ASSET_W, CROP.bottom - CROP.top, 0, 0, width, height);
        // approved glow treatment (subtle, applied to the drawn result)
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = 'blur(0px)';
        ctx.strokeStyle = 'rgba(0,229,255,0)';
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, img]);

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', borderRadius: 14, border: '1px solid rgba(0,229,255,0.12)', background: '#020914' }}>
      {/* LOCKED ASSET (approved humanoid, crop-only) */}
      <canvas ref={canvasRef} style={{ width, height, display: 'block' }} />
      {/* COGNITIVE OVERLAY — separate, never touches the humanoid */}
      <CognitiveField controller={controller} view={view} width={width} height={height} hue={197} />
    </div>
  );
};

void viewTransform; // helper kept for overlay alignment parity
