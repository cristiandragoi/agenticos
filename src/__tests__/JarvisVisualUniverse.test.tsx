import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { JarvisNeuralBlob } from '../components/jarvis/JarvisNeuralBlob';
import { toUniverseProjects, isAcceptanceArtifactProject } from '../lib/universeProjects';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no canvas context — stub it so the component renders.
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

describe('JarvisNeuralBlob — Visual Universe (Projects + locked palette)', () => {
  it('still renders the canvas, aria-label and truthful model label (contract preserved)', () => {
    render(<JarvisNeuralBlob state="reasoning" provider="ollama" model="qwen3.5:4b" size={280} />);
    expect(screen.getByTestId('jarvis-neural-canvas')).toBeTruthy();
    expect(screen.getByTestId('jarvis-neural-canvas').getAttribute('aria-label')).toContain('THINKING');
    expect(screen.getByTestId('jarvis-neural-model').textContent).toBe('ollama · qwen3.5:4b');
  });

  it('renders with persistent projects and no ProjectProvider dependency', () => {
    const projects = [
      { id: 'proj-a', name: 'Affiliate Pipeline' },
      { id: 'proj-b', name: 'Agentic OS' },
    ];
    render(<JarvisNeuralBlob state="idle" size={280} projects={projects} activeProjectId="proj-a" />);
    // Component must mount cleanly (no throw) with projects passed as props.
    expect(screen.getByTestId('jarvis-neural-canvas')).toBeTruthy();
    expect(screen.getByTestId('jarvis-neural-canvas').getAttribute('aria-label')).toContain('IDLE');
  });

  it('fires onProjectClick with the project id when a project node region is clicked', () => {
    const onProject = vi.fn();
    const projects = [{ id: 'proj-a', name: 'Alpha' }, { id: 'proj-b', name: 'Beta' }];
    const { container } = render(<JarvisNeuralBlob state="idle" size={280} projects={projects} onProjectClick={onProject} />);
    const canvas = container.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 280, height: 280, right: 280, bottom: 280, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    // Two projects → first sits at the top of the outer orbit (angle -π/2):
    // projRx = 280*0.44 = 123.2, so top project ≈ (140, 140-123.2*0.93…) — click
    // near the top-outer region within the 20px hit radius.
    fireEvent.click(canvas, { clientX: 140, clientY: 24 });
    expect(onProject).toHaveBeenCalledTimes(1);
    expect(onProject.mock.calls[0][0]).toBe('proj-a');
  });

  it('cleans up the animation frame on unmount (no leaks)', () => {
    const { unmount } = render(<JarvisNeuralBlob state="thinking" projects={[{ id: 'p1', name: 'One' }]} />);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('only fires onNodeClick for rendered contextual capabilities (Mission/Runs/Builds are NOT clickable satellites)', () => {
    const onClick = vi.fn();
    const { container } = render(<JarvisNeuralBlob state="idle" onNodeClick={onClick} size={280} />);
    const canvas = container.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 280, height: 280, right: 280, bottom: 280, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    // MEMORY remains at the top of the contextual orbit → click fires.
    fireEvent.click(canvas, { clientX: 140, clientY: 56 });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toBe('MEMORY');
    // A click on the old bottom-right orbit (where RUNS used to sit with the
    // 7-node layout) must NOT fire: RUNS is no longer a rendered satellite.
    // With 6 contextual nodes, RUNS' old position (140+~99, 140+~74) is empty.
    fireEvent.click(canvas, { clientX: 239, clientY: 214 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('universe projects exclude acceptance artifacts before reaching the blob', () => {
    const raw = [
      { id: 'proj-b41b7a3a', name: 'Hermes Smoke 1786906088448' },
      { id: 'proj-ac4c89f0', name: 'AgenticOS', color: '#00d4ff' },
      { id: 'proj-test-348046', name: 'Test' },
    ];
    const universe = toUniverseProjects(raw);
    expect(universe.map((p) => p.name)).toEqual(['AgenticOS']);
    expect(universe.some((p) => isAcceptanceArtifactProject(p))).toBe(false);
  });
});
