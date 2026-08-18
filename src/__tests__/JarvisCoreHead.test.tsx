/**
 * Programmatic humanoid contract tests (Humanoid-JARVIS v2).
 * Renders JarvisCore in each semantic state and asserts:
 *  - the wrapper carries data-orb-state
 *  - the CENTRAL HUMANOID is SVG regions (eyes/brain/chest/shell), NOT raster
 *  - no <img> is rendered anywhere in the visualization
 *  - every state renders without throwing
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { JarvisCore } from '../components/jarvis/JarvisCore';

const HUMAN_REGIONS = ['.jhv-humanoid', '.jhv-eyes', '.jhv-brain', '.jhv-chest', '.jhv-shell'];

describe('JarvisCore programmatic humanoid (v2)', () => {
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
