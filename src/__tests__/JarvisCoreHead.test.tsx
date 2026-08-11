/**
 * Holographic head color/state contract tests.
 * Renders JarvisCore in each semantic state and asserts:
 *  - the canvas carries data-orb-state
 *  - the draw runs without throwing (non-blank canvas)
 *  - semantic state → color mapping matches the spec (§10)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { JarvisCore, JARVIS_HEAD_COLORS } from '../components/jarvis/JarvisCore';

// jsdom has no real canvas — stub getContext with a recording context.
function stubCanvas() {
  const calls: string[] = [];
  const ctx: any = {
    calls,
    clearRect: vi.fn(), createRadialGradient: () => ({ addColorStop: vi.fn() }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    bezierCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), ellipse: vi.fn(), quadraticCurveTo: vi.fn(), scale: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    setLineDash: vi.fn(),
    createConicGradient: undefined,
  };
  const canvas = document.createElement('canvas');
  canvas.getContext = vi.fn(() => ctx) as any;
  canvas.width = 300; canvas.height = 300;
  document.createElement = new Proxy(document.createElement, {
    apply(target, thisArg, args) {
      const el = Reflect.apply(target, thisArg, args);
      if (args[0] === 'canvas') return canvas;
      return el;
    },
  });
  return { ctx, canvas };
}

describe('JarvisCore holographic head', () => {
  let stub: ReturnType<typeof stubCanvas>;
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('maps every semantic state to a spec color and renders without throwing', () => {
    stub = stubCanvas();
    const states: Array<[string, string]> = [
      ['idle', '#67e8f9'], ['listening', '#3b82f6'], ['reasoning', '#e0f2fe'],
      ['executing', '#00d4ff'], ['delegated', '#ec4899'], ['repairing', '#9333ea'],
      ['warning', '#f59e0b'], ['error', '#ef4444'], ['completed', '#22c55e'],
      ['speaking', '#a855f7'],
    ];
    for (const [state, expectMain] of states) {
      const colors = JARVIS_HEAD_COLORS[state as keyof typeof JARVIS_HEAD_COLORS];
      expect(colors.main.toLowerCase()).toBe(expectMain);
      const { container } = render(<JarvisCore state={state as any} size={120} />);
      const canvas = container.querySelector('canvas');
      expect(canvas).toBeTruthy();
      expect(canvas?.getAttribute('data-orb-state')).toBe(state);
      // The draw ran (clearRect + at least one fill) — no throw.
      expect(stub.ctx.clearRect).toHaveBeenCalled();
      expect(stub.ctx.fill).toHaveBeenCalled();
      cleanup();
    }
  });

  it('does not crash on reduced motion', () => {
    stub = stubCanvas();
    expect(() => render(<JarvisCore state="idle" size={120} reducedMotion />)).not.toThrow();
  });
});
