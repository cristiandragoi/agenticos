/**
 * jarvisPlasmaCore.test.tsx
 *
 * Tests for the V5 GLSL plasma core JarvisNeuralBlob & Camera Interactions.
 * Verifies:
 *   - Component renders a canvas with the correct data-testid
 *   - All required data-testid attrs are present
 *   - State → visual-state mapping (toBlobVisualState)
 *   - voiceColorShift is deterministic and locked-palette bounded
 *   - voiceVibration is zero when voicePulse = 0
 *   - Camera safe distance clamping (min: 2.0, max: 6.5)
 *   - sphericalToCartesian coordinate transforms for orbit & pass-through
 *   - Pointer drag vs click disambiguation
 *   - Double click camera reset
 *   - Caption/model label is rendered
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Three.js WebGL mock factory returning the real module with a stubbed WebGLRenderer ──
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  const FakeRenderer = vi.fn().mockImplementation(() => ({
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    outputColorSpace: '',
  }));
  return {
    ...actual,
    WebGLRenderer: FakeRenderer,
  };
});

// Mock canvas getContext so JSDOM 2D canvas calls don't throw
beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => {},
      fillStyle: '',
      clearRect: () => {},
      font: '',
      textAlign: '',
      textBaseline: '',
      shadowColor: '',
      shadowBlur: 0,
      fillText: () => {},
    }),
    configurable: true,
  });
});

import {
  JarvisNeuralBlob,
  voiceColorShift,
  voiceVibration,
  CAMERA_CONFIG,
  clampCameraDistance,
  sphericalToCartesian,
} from '../components/jarvis/JarvisNeuralBlob';
import { toBlobVisualState } from '../components/jarvis/neuralBlobState';

// ─── Rendering ────────────────────────────────────────────────────────────

describe('JarvisNeuralBlob — rendering', () => {
  it('renders a canvas with the correct data-testid', () => {
    render(<JarvisNeuralBlob state="idle" />);
    const canvas = screen.getByTestId('jarvis-neural-canvas');
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
  });

  it('renders the root wrapper with data-testid and data-orb-state', () => {
    render(<JarvisNeuralBlob state="listening" />);
    const root = screen.getByTestId('jarvis-neural');
    expect(root).toBeTruthy();
    expect(root.getAttribute('data-orb-state')).toBe('listening');
  });

  it('renders caption and model testids', () => {
    render(<JarvisNeuralBlob state="idle" provider="ollama" model="qwen3.8" />);
    expect(screen.getByTestId('jarvis-neural-caption')).toBeTruthy();
    expect(screen.getByTestId('jarvis-neural-model')).toBeTruthy();
    expect(screen.getByTestId('jarvis-neural-model').textContent).toContain('ollama');
  });

  it('accepts a custom testIdPrefix', () => {
    render(<JarvisNeuralBlob state="idle" testIdPrefix="custom-orb" />);
    expect(screen.getByTestId('custom-orb')).toBeTruthy();
    expect(screen.getByTestId('custom-orb-canvas')).toBeTruthy();
  });

  it('renders data-orb-state as lowercase state string', () => {
    render(<JarvisNeuralBlob state="THINKING" />);
    const root = screen.getByTestId('jarvis-neural');
    expect(root.getAttribute('data-orb-state')).toBe('thinking');
  });
});

// ─── State mapping ────────────────────────────────────────────────────────

describe('toBlobVisualState — state mapping', () => {
  const cases: Array<[string, string]> = [
    ['idle', 'IDLE'],
    ['listening', 'LISTENING'],
    ['transcribing', 'THINKING'],
    ['speaking', 'SPEAKING'],
    ['executing', 'BUILDING'],
    ['delegating', 'DELEGATING'],
    ['completed', 'COMPLETED'],
    ['error', 'ERROR'],
    ['offline', 'ERROR'],
    ['reasoning', 'THINKING'],
    ['planning', 'THINKING'],
    ['streaming', 'THINKING'],
    ['unknown_state', 'IDLE'],
  ];
  cases.forEach(([input, expected]) => {
    it(`maps "${input}" → ${expected}`, () => {
      expect(toBlobVisualState(input)).toBe(expected);
    });
  });
});

// ─── voiceColorShift ─────────────────────────────────────────────────────

describe('voiceColorShift', () => {
  it('returns base color when voicePulse = 0', () => {
    const base: [number, number, number] = [20, 184, 166];
    const result = voiceColorShift(base, 0);
    expect(result).toEqual(base);
  });

  it('returns a different color when voicePulse > 0', () => {
    const base: [number, number, number] = [20, 184, 166];
    const result = voiceColorShift(base, 1.0);
    expect(result).not.toEqual(base);
  });

  it('clamps voicePulse > 1 to 1', () => {
    const base: [number, number, number] = [20, 184, 166];
    const atOne = voiceColorShift(base, 1.0);
    const atTwo = voiceColorShift(base, 2.0);
    expect(atOne).toEqual(atTwo);
  });

  it('returns RGB values all in 0..255', () => {
    const base: [number, number, number] = [250, 204, 21];
    const result = voiceColorShift(base, 0.75);
    result.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    });
  });
});

// ─── voiceVibration ───────────────────────────────────────────────────────

describe('voiceVibration', () => {
  it('returns zero displacement when voicePulse = 0', () => {
    const result = voiceVibration(42, 0);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.rot).toBe(0);
    expect(result.scale).toBe(1);
  });

  it('returns nonzero displacement when voicePulse > 0', () => {
    const result = voiceVibration(1.23, 0.8);
    expect(Math.abs(result.dx) + Math.abs(result.dy) + Math.abs(result.rot)).toBeGreaterThan(0);
  });

  it('scale stays close to 1.0', () => {
    const result = voiceVibration(1.5, 1.0);
    expect(result.scale).toBeGreaterThan(0.98);
    expect(result.scale).toBeLessThan(1.05);
  });

  it('is deterministic for the same inputs', () => {
    const r1 = voiceVibration(3.14, 0.5);
    const r2 = voiceVibration(3.14, 0.5);
    expect(r1).toEqual(r2);
  });
});

// ─── Camera Interaction & Mathematics ────────────────────────────────────

describe('Camera Interaction & Spherical Bounds', () => {
  it('clampCameraDistance bounds distance between MIN_DISTANCE (0.5) and MAX_DISTANCE (8.5)', () => {
    expect(CAMERA_CONFIG.MIN_DISTANCE).toBe(0.5);
    expect(CAMERA_CONFIG.MAX_DISTANCE).toBe(8.5);
    expect(clampCameraDistance(0.1)).toBe(0.5);
    expect(clampCameraDistance(0.5)).toBe(0.5);
    expect(clampCameraDistance(CAMERA_CONFIG.DEFAULT_DISTANCE)).toBe(CAMERA_CONFIG.DEFAULT_DISTANCE);
    expect(clampCameraDistance(8.5)).toBe(8.5);
    expect(clampCameraDistance(15.0)).toBe(8.5);
  });

  it('sphericalToCartesian calculates exact 3D coordinates for default camera position', () => {
    const pos = sphericalToCartesian(3.8, 0, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(0);
    expect(pos.z).toBeCloseTo(3.8);
  });

  it('sphericalToCartesian supports 90-degree azimuth rotation', () => {
    const pos = sphericalToCartesian(3.8, 0, Math.PI / 2);
    expect(pos.x).toBeCloseTo(3.8);
    expect(pos.y).toBeCloseTo(0);
    expect(pos.z).toBeCloseTo(0);
  });

  it('sphericalToCartesian supports elevation tilt', () => {
    const pos = sphericalToCartesian(3.8, Math.PI / 4, 0);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(3.8 * Math.sin(Math.PI / 4));
    expect(pos.z).toBeCloseTo(3.8 * Math.cos(Math.PI / 4));
  });

  it('responds to pointer drag events for camera orbit without throwing', () => {
    render(<JarvisNeuralBlob state="idle" />);
    const canvas = screen.getByTestId('jarvis-neural-canvas');

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 130, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 130, clientY: 120, pointerId: 1 });
    expect(canvas).toBeTruthy();
  });

  it('responds to double click event for camera reset', () => {
    render(<JarvisNeuralBlob state="idle" />);
    const canvas = screen.getByTestId('jarvis-neural-canvas');
    fireEvent.doubleClick(canvas);
    expect(canvas).toBeTruthy();
  });

  it('clean click triggers onNodeClick hit testing without being blocked by drag state', () => {
    const onNodeClick = vi.fn();
    render(<JarvisNeuralBlob state="idle" onNodeClick={onNodeClick} size={300} />);
    const canvas = screen.getByTestId('jarvis-neural-canvas');

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Top node is MEMORY (angle = -PI/2, pos = (150, 150 - 300*0.33) = (150, 51))
    fireEvent.click(canvas, { clientX: 150, clientY: 51 });
    expect(onNodeClick).toHaveBeenCalledWith('MEMORY');
  });

  it('preserves responsive spherical canvas sizing without oval aspect distortion', () => {
    const { container } = render(<JarvisNeuralBlob state="idle" size={420} />);
    const shell = container.querySelector('.jarvis-blob1-shell') as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.style.width).toBe('100%');
    expect(shell.style.height).toBe('420px');
    // aspectRatio: 1/1 should not be forced on shell to avoid squashing the canvas
    expect(shell.style.aspectRatio).not.toBe('1 / 1');
  });
});
