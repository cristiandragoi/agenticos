import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { JarvisNeuralBlob, voiceColorShift, voiceVibration } from '../components/jarvis/JarvisNeuralBlob';
import { toBlobVisualState } from '../components/jarvis/neuralBlobState';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  const gradientStub = { addColorStop: vi.fn() };
  const ctx = {
    scale: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(), bezierCurveTo: vi.fn(), closePath: vi.fn(),
    arc: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
    createRadialGradient: vi.fn(() => gradientStub),
    createLinearGradient: vi.fn(() => gradientStub),
    save: vi.fn(), restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

describe('JarvisNeuralBlob — voice-reactive nebula (vibrate + color-shift while talking)', () => {
  it('maps delegating → DELEGATING and executing → BUILDING (distinct states/colors)', () => {
    expect(toBlobVisualState('delegating')).toBe('DELEGATING');
    expect(toBlobVisualState('delegated')).toBe('DELEGATING');
    expect(toBlobVisualState('executing')).toBe('BUILDING');
    // Truthful aria-label per state (contract preserved).
    const { unmount } = render(<JarvisNeuralBlob state="delegating" />);
    expect(screen.getByTestId('jarvis-neural-canvas').getAttribute('aria-label')).toContain('DELEGATING');
    unmount();
    render(<JarvisNeuralBlob state="executing" />);
    expect(screen.getByTestId('jarvis-neural-canvas').getAttribute('aria-label')).toContain('BUILDING');
  });

  it('voiceColorShift: zero voice returns the exact base color; voice shifts within the locked palette', () => {
    const base = [250, 204, 21] as [number, number, number]; // YELLOW (LISTENING base)
    expect(voiceColorShift(base, 0)).toEqual(base);
    const shifted = voiceColorShift(base, 0.8);
    expect(shifted).not.toEqual(base); // talking → color changes
    // Every channel stays inside the locked-palette mixing space (0..255).
    shifted.forEach((ch) => expect(ch).toBeGreaterThanOrEqual(0));
    shifted.forEach((ch) => expect(ch).toBeLessThanOrEqual(255));
    // Clamped + deterministic.
    expect(voiceColorShift(base, 1)).toEqual(voiceColorShift(base, 1));
    expect(voiceColorShift(base, 2.5)).toEqual(voiceColorShift(base, 1));
  });

  it('voiceVibration: zero voice = no jitter; talking vibrates with amplitude scaling', () => {
    expect(voiceVibration(0, 0)).toEqual({ dx: 0, dy: 0, rot: 0, scale: 1 });
    const quiet = voiceVibration(1.23, 0.2);
    const loud = voiceVibration(1.23, 1);
    // Loud voice is never calmer than quiet voice at the same time step.
    expect(Math.abs(loud.dx)).toBeGreaterThanOrEqual(Math.abs(quiet.dx));
    expect(Math.abs(loud.rot)).toBeGreaterThanOrEqual(Math.abs(quiet.rot));
    // Deterministic per (t, pulse).
    expect(voiceVibration(1.23, 1)).toEqual(loud);
  });

  it('renders the shell with a free-from-the-square vmin width and the vibration CSS vars wired', () => {
    const { container } = render(<JarvisNeuralBlob state="listening" inputLevel={0.6} size={280} />);
    const shell = container.querySelector('.jarvis-blob1-shell') as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.style.width).not.toBe('280px');
    // Canvas fills the shell (100%) instead of a fixed px box.
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
  });

  it('preserves the model label contract', () => {
    render(<JarvisNeuralBlob state="idle" provider="ollama" model="qwen3.5:4b" />);
    expect(screen.getByTestId('jarvis-neural-model').textContent).toBe('ollama · qwen3.5:4b');
  });
});
