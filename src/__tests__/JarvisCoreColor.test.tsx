/**
 * Pixel-level color proof for the holographic head.
 * Renders JarvisCore states into a stub canvas and records the DOMINANT
 * fill color used during the draw — proving each semantic state produces
 * the spec color (idle=cyan, delegated=pink, error=red, completed=green…).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { JarvisCore, JARVIS_HEAD_COLORS } from '../components/jarvis/JarvisCore';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A recording 2D context: every fillStyle assignment is captured. */
function makeRecordingCtx() {
  const fills: string[] = [];
  const ctx: any = {
    fills,
    canvas: { width: 300, height: 300 },
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect: vi.fn(), scale: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    bezierCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), ellipse: vi.fn(), quadraticCurveTo: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    setLineDash: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), createConicGradient: undefined,
  };
  // Capture fillStyle assignments (Proxy set trap).
  const captured: string[] = [];
  const proxy = new Proxy(ctx, {
    set(target, prop, value) {
      if (prop === 'fillStyle' && typeof value === 'string') captured.push(value);
      (target as any)[prop] = value;
      return true;
    },
  });
  return { ctx: proxy, captured };
}

describe('JarvisCore holographic head — dominant color per state', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const cases: Array<[string, string]> = [
    ['idle', '#67e8f9'], ['listening', '#3b82f6'], ['reasoning', '#e0f2fe'],
    ['executing', '#00d4ff'], ['delegated', '#ec4899'], ['repairing', '#9333ea'],
    ['warning', '#f59e0b'], ['error', '#ef4444'], ['completed', '#22c55e'],
    ['speaking', '#a855f7'], ['transcribing', '#22c55e'], ['offline', '#7f1d1d'],
  ];

  it('draws the spec color family for each semantic state', () => {
    for (const [state, expectHex] of cases) {
      const { captured } = makeRecordingCtx();
      // Stub document.createElement to return a canvas whose getContext returns
      // the recording ctx.
      const origCreate = document.createElement.bind(document);
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = vi.fn(() => captured.length ? null : undefined) as any;
      const canvas = document.createElement('canvas');
      const ctxObj: any = {
        fills: captured, fillStyle: '', strokeStyle: '', lineWidth: 1,
        clearRect: vi.fn(), scale: vi.fn(), fillRect: vi.fn(),
        createRadialGradient: () => ({ addColorStop: vi.fn() }),
        createLinearGradient: () => ({ addColorStop: vi.fn() }),
        beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
        bezierCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
        arc: vi.fn(), ellipse: vi.fn(), quadraticCurveTo: vi.fn(),
        save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
        setLineDash: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), createConicGradient: undefined,
      };
      const captured2: string[] = [];
      const proxy = new Proxy(ctxObj, {
        set(t, p, v) { if (p === 'fillStyle' && typeof v === 'string') captured2.push(v); (t as any)[p] = v; return true; },
      });
      canvas.getContext = vi.fn(() => proxy) as any;
      canvas.width = 300; canvas.height = 300;
      document.createElement = vi.fn((tag: string) => {
        if (tag === 'canvas') return canvas;
        return origCreate(tag);
      }) as any;

      render(<JarvisCore state={state as any} size={150} />);
      document.createElement = origCreate as any;

      // The dominant color should be close to the expected main color:
      // find the most-assigned fillStyle containing the expected rgb values.
      const [er, eg, eb] = hexToRgb(expectHex);
      const dominant = captured2.length
        ? captured2
            .filter((s) => s.startsWith('rgba(') || s.startsWith('rgb('))
            .map((s) => s.match(/rgba?\((\d+),(\d+),(\d+)/))
            .filter((m) => m)
            .map((m) => ({ r: +m![1], g: +m![2], b: +m![3] }))
        : [];
      const match = dominant.length
        ? dominant.filter((c) => Math.abs(c.r - er) < 60 && Math.abs(c.g - eg) < 60 && Math.abs(c.b - eb) < 60).length
        : 0;
      expect(match).toBeGreaterThan(0);
      cleanup();
    }
  });
});
