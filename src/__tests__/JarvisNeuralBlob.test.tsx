import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JarvisNeuralBlob } from '../components/jarvis/JarvisNeuralBlob';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no canvas context — stub the 2D context so the component renders.
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
  // jsdom lacks requestAnimationFrame — stub to a no-op so no loop runs in tests.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

describe('JarvisNeuralBlob', () => {
  it('renders the canvas, state aria-label and truthful model label', () => {
    render(<JarvisNeuralBlob state="reasoning" provider="ollama" model="qwen3.5:4b" size={280} />);
    expect(screen.getByTestId('jarvis-neural-canvas')).toBeTruthy();
    expect(screen.getByTestId('jarvis-neural-canvas').getAttribute('aria-label')).toContain('THINKING');
    expect(screen.getByTestId('jarvis-neural-model').textContent).toBe('ollama · qwen3.5:4b');
  });

  it('reflects error state truthfully', () => {
    render(<JarvisNeuralBlob state="error" provider="ollama" model="qwen3.5:4b" />);
    expect(screen.getByTestId('jarvis-neural-canvas').getAttribute('aria-label')).toContain('ERROR');
  });

  it('fires onNodeClick with the node id when a node region is clicked', () => {
    const onClick = vi.fn();
    const { container } = render(<JarvisNeuralBlob state="idle" onNodeClick={onClick} size={280} />);
    const canvas = container.querySelector('canvas')!;
    // jsdom reports no layout — provide the size the handler needs.
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 280, height: 280, right: 280, bottom: 280, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    // The MEMORY node sits at the top of the orbit ellipse. V3 uses orbRy = size*0.36 so
    // the precise position is (140, ~39), but clicking at (140, 56) is within the 20px
    // hit radius and still registers the click.
    fireEvent.click(canvas, { clientX: 140, clientY: 56 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('cleans up the animation frame on unmount (no leaks)', () => {
    const { unmount } = render(<JarvisNeuralBlob state="thinking" />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
});
