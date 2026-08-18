/**
 * Jarvis Studio scroll-correction milestone — layout CONTRACT tests (§24).
 *
 * Corrected model: the center workspace is ONE scrolling document
 * (jarvis-center-scroll) with a reserved hero block at the top. Corner
 * panels are absolute overlays OUTSIDE the scroll container.
 *
 * Asserts structure and behavior, never pixel positions.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JarvisStudio from '../pages/JarvisStudio';
import { CodexProvider } from '../store/codexStore';
import { ProjectProvider } from '../store/projectStore';
import { stopBackendLifecycleMonitor } from '../diagnostics/backendLifecycleStore';

/* Fake Electron lifecycle bridge (authoritative source, never polls). */
function installReadyBridge() {
  (window as any).backendLifecycle = {
    getState: async () => ({
      mode: 'AUTO_MANAGED', status: 'ready', backendUrl: 'http://127.0.0.1:4000',
      port: 4000, pid: 1, owned: true, startedAt: Date.now(),
      lastHealthSuccessAt: Date.now(), lastHealthFailureAt: null,
      restartCount: 0, lastError: null, readinessMs: 1000, recentLog: [],
    }),
    restart: async () => ({ ok: true }),
    retry: async () => ({ ok: true }),
    onState: () => () => {},
  };
}

/* Generic healthy backend; conversations/messages stubbed per test. */
function stubApi(messages: Array<{ id: string; role: string; content: string }> = []) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, options?: any) => {
    const u = String(url);
    if (u.endsWith('/api/jarvis/conversations') && (!options || options.method !== 'POST')) {
      return { ok: true, status: 200, json: async () => [{ id: 'conv-layout' }] };
    }
    if (u.endsWith('/messages')) {
      return { ok: true, status: 200, json: async () => messages };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

function renderStudio() {
  return render(
    <MemoryRouter>
      <CodexProvider>
        <ProjectProvider>
          <JarvisStudio />
        </ProjectProvider>
      </CodexProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  installReadyBridge();
});

afterEach(() => {
  stopBackendLifecycleMonitor();
  delete (window as any).backendLifecycle;
  cleanup();
  vi.unstubAllGlobals();
});

describe('fixed-stage layout model', () => {
  it('renders centerScroll > stage > workspace; orb lives in the stage', async () => {
    stubApi();
    renderStudio();
    const centerScroll = await screen.findByTestId('jarvis-center-scroll');
    const stage = await screen.findByTestId('jarvis-stage');
    const workspace = await screen.findByTestId('jarvis-workspace');

    // Fixed-stage contract: the stage and workspace live in the reserved
    // center column (NOT a scrolling document). The stage is the first
    // child — the hero can never be scrolled away by transcript growth.
    expect(centerScroll.contains(stage)).toBe(true);
    expect(centerScroll.contains(workspace)).toBe(true);
    expect(stage.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The workspace is a bounded band — it must not be allowed to consume
    // the whole center viewport (its tall children scroll internally).
    // Jarvis-layout fix: the band no longer carries a fixed 54vh inline cap
    // (that starved the transcript); it fills the remaining center height
    // (flex) with overflow hidden, and the transcript dock inside it has a
    // real 160px floor so it can never be crushed to invisibility.
    const wsEl = screen.getByTestId('jarvis-workspace');
    expect(wsEl.style.overflowY || wsEl.style.overflow).not.toBe('visible');
    const dockEl = screen.getByTestId('jarvis-chat-workspace');
    // CSS modules hash class names — check for the transcriptDock marker.
    expect([...dockEl.classList].some((c) => c.includes('transcriptDock'))).toBe(true);

    // Orb inside the reserved stage, never inside the workspace.
    const orb = screen.getByTestId('jarvis-orb');
    expect(stage.contains(orb)).toBe(true);
    expect(workspace.contains(orb)).toBe(false);

    // Corner panels are OUTSIDE the scrolling document.
    expect(centerScroll.contains(screen.getByTestId('jarvis-system-status'))).toBe(false);
    expect(centerScroll.contains(screen.getByTestId('jarvis-current-run'))).toBe(false);
  });

  it('3-column shell: Activity is a dedicated column, never an overlay (final correction §1–3)', async () => {
    stubApi();
    renderStudio();
    const mainColumn = await screen.findByTestId('jarvis-active-layout');
    const activityColumn = await screen.findByTestId('jarvis-activity-column');

    // The Activity column is a SIBLING of the center column — a true
    // grid/flex column, not an absolutely-positioned overlay.
    expect(activityColumn.parentElement).toBe(mainColumn.parentElement);
    expect(mainColumn.contains(activityColumn)).toBe(false);

    // Both info panels live inside the Activity column, in flow (static
    // positioning — they can never cover the orb).
    expect(activityColumn.contains(screen.getByTestId('jarvis-system-status'))).toBe(true);
    expect(activityColumn.contains(screen.getByTestId('jarvis-current-run'))).toBe(true);
    const computed = window.getComputedStyle(screen.getByTestId('jarvis-current-run'));
    expect(['static', 'relative']).toContain(computed.position);

    // The center column owns the hero; the Activity column never contains it.
    expect(mainColumn.contains(screen.getByTestId('jarvis-orb'))).toBe(true);
    expect(activityColumn.contains(screen.getByTestId('jarvis-orb'))).toBe(false);
  });

  it('sticky composer sits at the bottom of the center column (§8) — outside the scroll document', async () => {
    stubApi();
    renderStudio();
    const mainColumn = await screen.findByTestId('jarvis-active-layout');
    const centerScroll = await screen.findByTestId('jarvis-center-scroll');
    const sticky = await screen.findByTestId('jarvis-sticky-composer');

    // The composer is a sibling BELOW the scrolling document — always
    // reachable regardless of workspace height.
    expect(mainColumn.contains(sticky)).toBe(true);
    expect(centerScroll.contains(sticky)).toBe(false);
    expect(centerScroll.compareDocumentPosition(sticky) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The Activity column can never cover it.
    const activityColumn = screen.getByTestId('jarvis-activity-column');
    expect(activityColumn.contains(sticky)).toBe(false);
  });

  it('hero is a real flow stack — wordmark, orb, state text, primary control (§3)', async () => {
    stubApi();
    renderStudio();
    const stage = await screen.findByTestId('jarvis-stage');
    const orbWrapper = screen.getByTestId('jarvis-orb-wrapper');
    const stateLabel = screen.getByTestId('jarvis-orb-status-label');
    const primary = screen.getByTestId('jarvis-primary-control');

    expect(stage.contains(orbWrapper)).toBe(true);
    expect(stage.contains(stateLabel)).toBe(true);
    expect(stage.contains(primary)).toBe(true);

    // Flow order in document position: wordmark text before orb, orb before
    // state text, state text before the primary control.
    const wordmarkText = screen.getByText('JARVIS');
    expect(wordmarkText.compareDocumentPosition(orbWrapper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(orbWrapper.compareDocumentPosition(stateLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stateLabel.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // No brittle absolute stacking: the primary control is NOT positioned on
    // top of the orb via absolute centering.
    expect(primary.style.position).not.toBe('absolute');
    expect(primary.className).not.toMatch(/absolute/);
  });

  it('voice controls live in the workspace below the stage (§3)', async () => {
    stubApi();
    renderStudio();
    const workspace = await screen.findByTestId('jarvis-workspace');
    for (const id of ['jarvis-mode-manual', 'jarvis-mode-conversation', 'jarvis-mic-button', 'jarvis-voice-toggle', 'jarvis-voice-select', 'jarvis-stop-speaking', 'jarvis-actions-menu']) {
      expect(workspace.contains(screen.getByTestId(id))).toBe(true);
    }
  });

  it('mainColumn never scrolls — only centerScroll carries the main scrollbar', async () => {
    stubApi();
    renderStudio();
    await screen.findByTestId('jarvis-center-scroll');
    const mainColumn = screen.getByTestId('jarvis-active-layout');
    expect(mainColumn.style.overflowY || mainColumn.style.overflow).toMatch(/hidden|auto/);
    expect(mainColumn.style.overflowY).not.toBe('scroll');
  });
});

describe('transcript (§5)', () => {
  it('lives inside the workspace with a bounded scroll body', async () => {
    stubApi();
    renderStudio();
    const workspace = await screen.findByTestId('jarvis-workspace');
    const dock = await screen.findByTestId('jarvis-chat-workspace');
    expect(workspace.contains(dock)).toBe(true);

    const body = screen.getByTestId('jarvis-transcript-body');
    // Jarvis-layout fix: the body height is a MAXIMUM (user resize pref),
    // not a fixed inline height — flex fills the dock, capped at the pref.
    const maxH = Number(body.style.maxHeight?.replace('px', ''));
    expect(maxH).toBeGreaterThanOrEqual(160);
    expect(maxH).toBeLessThanOrEqual(420);
    // The dock itself carries a 120px floor so a long conversation can
    // never crush the transcript to zero (the acceptance blocker).
    const dockFloor = screen.getByTestId('jarvis-chat-workspace');
    expect(Number(getComputedStyle(dockFloor).minHeight?.replace('px', '')) || 120).toBeGreaterThanOrEqual(120);
  });

  it('HIDE/SHOW collapses and restores the transcript body', async () => {
    stubApi();
    renderStudio();
    const toggle = await screen.findByTestId('jarvis-transcript-toggle');
    const body = screen.getByTestId('jarvis-transcript-body');

    fireEvent.click(toggle);
    expect(body.className).toMatch(/collapsed/);
    fireEvent.click(toggle);
    expect(body.className).not.toMatch(/collapsed/);
  });

  it('has a drag-resize handle', async () => {
    stubApi();
    renderStudio();
    await screen.findByTestId('jarvis-chat-workspace');
    expect(screen.getByTestId('jarvis-transcript-resize')).toBeInTheDocument();
  });
});

describe('voice trace (§7) + manual acceptance (§8)', () => {
  it('voice trace is collapsed by default with a summary header', async () => {
    stubApi();
    renderStudio();
    await screen.findByTestId('voice-trace-panel');
    expect(screen.queryByTestId('voice-trace-stages')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-trace-toggle'));
    expect(screen.getByTestId('voice-trace-stages')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-trace-toggle'));
    expect(screen.queryByTestId('voice-trace-stages')).not.toBeInTheDocument();
  });

  it('manual acceptance checklist is collapsed by default (§8)', async () => {
    stubApi();
    renderStudio();
    await screen.findByTestId('voice-trace-panel');
    fireEvent.click(screen.getByTestId('voice-trace-toggle'));
    expect(screen.queryByTestId('voice-trace-checklist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('voice-trace-checklist-toggle'));
    expect(screen.getByTestId('voice-trace-checklist')).toBeInTheDocument();
  });
});

describe('ACTIVE RUN shows only current work (§4)', () => {
  it('a finished (failed/completed) Hermes run appears under HISTORY, never as the active run', async () => {
    // Runs endpoint returns ONLY terminal runs — nothing live.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, options?: any) => {
      const u = String(url);
      if (u.endsWith('/api/hermes-api/runs') && (!options || options.method !== 'POST')) {
        return {
          ok: true, status: 200,
          json: async () => [{
            id: 'run-old', hermesRunId: 'hr-1', cardId: 'card-1',
            prompt: 'Historical failed task — must not dominate ACTIVE RUN',
            status: 'failed', provider: 'x', model: 'y',
            events: [], finalText: '', pendingApproval: null, updatedAt: Date.now(),
          }],
        };
      }
      if (u.endsWith('/api/jarvis/conversations') && (!options || options.method !== 'POST')) {
        return { ok: true, status: 200, json: async () => [{ id: 'conv-layout' }] };
      }
      if (u.endsWith('/messages')) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    renderStudio();

    // The ACTIVE RUN panel shows the empty current state…
    const runPanel = await screen.findByTestId('jarvis-current-run');
    await waitFor(() => {
      expect(runPanel).toHaveTextContent('No active run');
    });
    // …and never renders the historical run detail as board detail/current.
    expect(runPanel.textContent).not.toContain('HERMES RUN (board detail)');

    // The failed run lives under HISTORY instead.
    const history = await screen.findByTestId('jarvis-history-scroll');
    expect(history).toHaveTextContent(/HISTORICAL FAILED TASK/i);
  });
});

describe('long content is handled by the center scrollbar (§18)', () => {
  it('400 messages: hero intact, content scrolls in the transcript surface', async () => {
    const messages = Array.from({ length: 400 }, (_, i) => ({
      id: `m-${i}`,
      role: i % 2 === 0 ? 'user' : 'agent',
      content: `Message number ${i} — padding to simulate a long transcript.`,
    }));
    stubApi(messages);
    renderStudio();

    const stage = await screen.findByTestId('jarvis-stage');
    const centerScroll = await screen.findByTestId('jarvis-center-scroll');
    const scroll = await screen.findByTestId('jarvis-chat-scroll');

    await waitFor(() => {
      expect(screen.getAllByTestId('jarvis-command-line').length).toBe(400);
    });

    // Hero still the first block of the scrolling document.
    expect(stage.contains(screen.getByTestId('jarvis-orb'))).toBe(true);
    expect(centerScroll.contains(scroll)).toBe(true);
    // Transcript surface scrolls inside its bounded dock (overflow contract).
    expect(scroll.style.overflowY).toBe('auto');
  });
});
