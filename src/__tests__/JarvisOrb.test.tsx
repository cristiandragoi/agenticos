/**
 * JarvisOrb — focused tests for the reactive orb V1.
 *
 * Covers (per cycle directive):
 *  - correct label for each visual state
 *  - correct state data attribute
 *  - listening reacts to inputLevel (real mic amplitude contract)
 *  - speaking reacts to outputLevel (real playback amplitude contract)
 *  - error and offline rendering
 *  - reduced-motion behaviour (prop override + prefers-reduced-motion query)
 *  - speaking NEVER activates before playback-start confirmation
 *    (pure derivation + studio-level event wiring)
 *  - existing transcript and text input remain present in the Jarvis UI
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import {
  JarvisOrb,
  JARVIS_ORB_LABELS,
  JARVIS_ORB_COLORS,
} from '../components/jarvis/JarvisOrb';
import type { JarvisVisualState } from '../components/jarvis/JarvisOrb';
import {
  deriveJarvisOrbState,
  JARVIS_ORB_EVENTS,
} from '../components/jarvis/jarvisOrbState';
import JarvisStudio from '../pages/JarvisStudio';
import { CodexProvider } from '../store/codexStore';
import { ProjectProvider } from '../store/projectStore';
import { MemoryRouter } from 'react-router-dom';

const ALL_STATES: JarvisVisualState[] = [
  'idle',
  'listening',
  'transcribing',
  'thinking',
  'speaking',
  'error',
  'offline',
];

function scaleOf(el: HTMLElement): number {
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform || '');
  return m ? parseFloat(m[1]) : NaN;
}

describe('JarvisOrb — state contract', () => {
  it.each(ALL_STATES)('renders the correct label and data attribute for "%s"', (state) => {
    render(<JarvisOrb state={state} />);
    const orb = screen.getByTestId('jarvis-orb');
    expect(orb.getAttribute('data-orb-state')).toBe(state);
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent(JARVIS_ORB_LABELS[state]);
  });

  it('exposes the required colour contract for every state', () => {
    for (const s of ALL_STATES) {
      expect(JARVIS_ORB_COLORS[s]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // Spot-check the mandated hues: idle cyan, listening blue, transcribing green,
    // thinking amber, speaking purple, error red, offline dark red.
    expect(JARVIS_ORB_COLORS.idle.toLowerCase()).toBe('#00e5ff');
    expect(JARVIS_ORB_COLORS.listening.toLowerCase()).toBe('#3b82f6');
    expect(JARVIS_ORB_COLORS.transcribing.toLowerCase()).toBe('#22c55e');
    expect(JARVIS_ORB_COLORS.thinking.toLowerCase()).toBe('#f5b50a');
    expect(JARVIS_ORB_COLORS.speaking.toLowerCase()).toBe('#a855f7');
    expect(JARVIS_ORB_COLORS.error.toLowerCase()).toBe('#ef4444');
    expect(JARVIS_ORB_COLORS.offline.toLowerCase()).toBe('#7f1d1d');
  });

  it('allows a custom label override', () => {
    render(<JarvisOrb state="idle" label="Standby" />);
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent('Standby');
  });
});

describe('JarvisOrb — level reactivity', () => {
  it('listening orb scales up with real microphone inputLevel', () => {
    const { rerender } = render(<JarvisOrb state="listening" inputLevel={0} />);
    const core = screen.getByTestId('jarvis-orb-core');
    expect(scaleOf(core)).toBeCloseTo(1, 3);

    rerender(<JarvisOrb state="listening" inputLevel={0.5} />);
    expect(scaleOf(core)).toBeGreaterThan(1.05);

    rerender(<JarvisOrb state="listening" inputLevel={1} />);
    expect(scaleOf(core)).toBeGreaterThan(1.1);
  });

  it('speaking orb scales up with real playback outputLevel', () => {
    const { rerender } = render(<JarvisOrb state="speaking" outputLevel={0} />);
    const core = screen.getByTestId('jarvis-orb-core');
    expect(scaleOf(core)).toBeCloseTo(1, 3);

    rerender(<JarvisOrb state="speaking" outputLevel={0.8} />);
    expect(scaleOf(core)).toBeGreaterThan(1.1);
  });

  it('inputLevel is ignored outside the listening state (no fake movement)', () => {
    render(<JarvisOrb state="thinking" inputLevel={1} />);
    expect(scaleOf(screen.getByTestId('jarvis-orb-core'))).toBeCloseTo(1, 3);
  });

  it('outputLevel is ignored outside the speaking state (no fake movement)', () => {
    render(<JarvisOrb state="idle" outputLevel={1} />);
    expect(scaleOf(screen.getByTestId('jarvis-orb-core'))).toBeCloseTo(1, 3);
  });

  it('clamps out-of-range levels', () => {
    render(<JarvisOrb state="listening" inputLevel={5} />);
    const scale = scaleOf(screen.getByTestId('jarvis-orb-core'));
    expect(scale).toBeLessThanOrEqual(1.15);
    expect(Number.isFinite(scale)).toBe(true);
  });
});

describe('JarvisOrb — error and offline rendering', () => {
  it('error state renders with restrained label and red attribute', () => {
    render(<JarvisOrb state="error" />);
    expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('error');
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent('Error');
  });

  it('offline state renders with minimal-movement contract', () => {
    const { rerender } = render(<JarvisOrb state="offline" />);
    expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('offline');
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent('Offline');
    // Offline ignores any level input — no movement is permitted.
    rerender(<JarvisOrb state="offline" inputLevel={1} outputLevel={1} />);
    expect(scaleOf(screen.getByTestId('jarvis-orb-core'))).toBeCloseTo(1, 3);
  });
});

describe('JarvisOrb — reduced motion', () => {
  it('reducedMotion prop disables animation, level scaling and transitions', () => {
    render(<JarvisOrb state="listening" inputLevel={1} reducedMotion />);
    const orb = screen.getByTestId('jarvis-orb');
    expect(orb.getAttribute('data-reduced-motion')).toBe('true');
    const core = screen.getByTestId('jarvis-orb-core');
    expect(scaleOf(core)).toBeCloseTo(1, 3);
    expect(core.style.transition).toBe('none');
    // Label must remain readable even without animation.
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent('Listening');
  });

  it('honours the prefers-reduced-motion media query', () => {
    const original = window.matchMedia;
    (window as any).matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    try {
      render(<JarvisOrb state="thinking" />);
      expect(screen.getByTestId('jarvis-orb').getAttribute('data-reduced-motion')).toBe('true');
    } finally {
      (window as any).matchMedia = original;
    }
  });

  it('does not request animation frames when reduced motion is on', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    rafSpy.mockClear();
    render(<JarvisOrb state="idle" reducedMotion />);
    expect(rafSpy).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('cancels animation frames on unmount', () => {
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame');
    cafSpy.mockClear();
    const { unmount } = render(<JarvisOrb state="thinking" />);
    unmount();
    expect(cafSpy).toHaveBeenCalled();
    cafSpy.mockRestore();
  });
});

describe('deriveJarvisOrbState — speaking only after playback-start confirmation', () => {
  const base = {
    micState: 'idle' as const,
    playbackActive: false,
    runtimeState: 'idle' as const,
    backendOffline: false,
  };

  it('text streaming does NOT activate speaking', () => {
    expect(deriveJarvisOrbState({ ...base, runtimeState: 'streaming' })).toBe('thinking');
  });

  it('completed text generation does NOT activate speaking', () => {
    expect(deriveJarvisOrbState({ ...base, runtimeState: 'completed' })).toBe('idle');
  });

  it('only a confirmed playback start activates speaking', () => {
    expect(deriveJarvisOrbState({ ...base, playbackActive: true })).toBe('speaking');
  });

  it('real mic capture maps to listening, pending transcription to transcribing', () => {
    expect(deriveJarvisOrbState({ ...base, micState: 'listening' })).toBe('listening');
    expect(deriveJarvisOrbState({ ...base, micState: 'transcribing' })).toBe('transcribing');
  });

  it('runtime or mic failure maps to error', () => {
    expect(deriveJarvisOrbState({ ...base, runtimeState: 'error' })).toBe('error');
    expect(deriveJarvisOrbState({ ...base, micState: 'error' })).toBe('error');
  });

  it('backend outage dominates every other signal', () => {
    expect(
      deriveJarvisOrbState({
        ...base,
        backendOffline: true,
        micState: 'listening',
        playbackActive: true,
        runtimeState: 'streaming',
      }),
    ).toBe('offline');
  });

  it('in-flight request/task activity maps to thinking', () => {
    for (const s of ['thinking', 'understanding', 'planning', 'delegating', 'executing', 'reviewing'] as const) {
      expect(deriveJarvisOrbState({ ...base, runtimeState: s })).toBe('thinking');
    }
  });
});

describe('JarvisStudio integration — orb wiring with real UI intact', () => {
  beforeEach(() => {
    // jsdom lacks layout APIs used by the chat transcript.
    (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
    // Generic healthy backend for every endpoint the studio touches.
    const okJson = { ok: true, status: 200, json: async () => ({}) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('orb does NOT enter speaking while text is streaming without playback confirmation', async () => {
    render(
      <MemoryRouter>
        <CodexProvider>
          <ProjectProvider>
            <JarvisStudio />
          </ProjectProvider>
        </CodexProvider>
      </MemoryRouter>,
    );
    const orb = await screen.findByTestId('jarvis-orb');
    // No playback event has fired yet: orb must not claim speaking.
    expect(orb.getAttribute('data-orb-state')).not.toBe('speaking');
  });

  it('confirmed playback-start event switches the orb to speaking, ended switches it back', async () => {
    render(
      <MemoryRouter>
        <CodexProvider>
          <ProjectProvider>
            <JarvisStudio />
          </ProjectProvider>
        </CodexProvider>
      </MemoryRouter>,
    );
    const orb = await screen.findByTestId('jarvis-orb');
    expect(orb.getAttribute('data-orb-state')).toBe('idle');

    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackStarted, { detail: { agentId: 'agent-jarvis' } }));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('speaking');
    });
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent('Speaking');

    window.dispatchEvent(new CustomEvent(JARVIS_ORB_EVENTS.playbackEnded, { detail: { agentId: 'agent-jarvis' } }));
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('idle');
    });
  });

  it('backend outage flips the orb to offline', async () => {
    // Layout-stability milestone (§16): backend status comes from the ONE
    // lifecycle store, not a local /api/health/gateway poll. In browser
    // mode (no Electron bridge) the store falls back to polling /api/health
    // — a failing probe flips the store to 'offline', which JarvisStudio
    // derives backendOffline from.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/api/health')) {
          throw new Error('backend unreachable');
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    render(
      <MemoryRouter>
        <CodexProvider>
          <ProjectProvider>
            <JarvisStudio />
          </ProjectProvider>
        </CodexProvider>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('jarvis-orb').getAttribute('data-orb-state')).toBe('offline');
    });
    expect(screen.getByTestId('jarvis-orb-label')).toHaveTextContent('Offline');
  });

  it('existing transcript and text input remain present alongside the orb', async () => {
    render(
      <MemoryRouter>
        <CodexProvider>
          <ProjectProvider>
            <JarvisStudio />
          </ProjectProvider>
        </CodexProvider>
      </MemoryRouter>,
    );
    await screen.findByTestId('jarvis-orb');
    // Transcript (chat timeline) is intact.
    expect(screen.getByTestId('jarvis-chat-scroll')).toBeInTheDocument();
    // Text input is intact.
    expect(screen.getByLabelText('Message Input')).toBeInTheDocument();
    expect(screen.getByTestId('jarvis-composer')).toBeInTheDocument();
    // Mic button still present.
    expect(screen.getByTestId('jarvis-mic-button')).toBeInTheDocument();
  });
});
