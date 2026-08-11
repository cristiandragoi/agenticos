/**
 * Programmatic humanoid contract tests (Slice 0 correction).
 * Renders JarvisCore in each semantic state and asserts:
 *  - the wrapper carries data-orb-state
 *  - the CENTRAL HUMANOID is SVG regions (face/eyes/brain/chest/halo), NOT raster
 *  - no <img> is rendered anywhere in the visualization
 *  - every state renders without throwing
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { JarvisCore } from '../components/jarvis/JarvisCore';

const HUMAN_REGIONS = ['#face-path', '#eye-left', '#eye-right', '#brain-glow', '#chest-glow', '#halo-ring'];

describe('JarvisCore programmatic humanoid', () => {
  afterEach(() => { cleanup(); });

  it('renders a programmatic SVG humanoid (no raster) for every state', () => {
    const states = [
      'idle', 'listening', 'reasoning', 'executing', 'delegated',
      'repairing', 'warning', 'error', 'completed', 'speaking', 'offline',
    ];
    for (const state of states) {
      const { container } = render(<JarvisCore state={state} size={120} />);
      const wrap = container.querySelector('[data-testid="jarvis-orb"]');
      expect(wrap).toBeTruthy();
      expect(wrap?.getAttribute('data-orb-state')).toBe(state);
      // Central humanoid = SVG regions (independent, controllable layers).
      for (const sel of HUMAN_REGIONS) {
        expect(container.querySelector(sel)).toBeTruthy();
      }
      // Absolutely no raster <img> in the visualization.
      expect(container.querySelector('img')).toBeNull();
      cleanup();
    }
  });

  it('does not crash on reduced motion', () => {
    expect(() => render(<JarvisCore state="idle" size={120} reducedMotion />)).not.toThrow();
  });
});
