import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import LeftRail from '../components/layout/LeftRail';
import JarvisStudio from '../pages/JarvisStudio';
import { AppProvider } from '../store/appStore';
import { DataProvider } from '../store/dataStore';
import { CodexProvider } from '../store/codexStore';
import { ProjectProvider } from '../store/projectStore';

/* ── Navigation restoration cycle ──────────────────────────────────────────
 * /jarvis must render the compact navigation rail alongside the dominant
 * command center; all entries navigate to the EXISTING routes; Jarvis
 * conversation session survives route round-trips; exactly one voice owner
 * remains mounted. No duplicate pages, no duplicate Jarvis instances.
 */

const RAIL_KEY = 'agenticos-rail-collapsed';
const CONV_KEY = 'jarvis-active-conversation';

/* Mock the registry data source — the shell needs loaded registry data to
 * render past the "Connecting to backend..." gate (same pattern as
 * AppShell.test.tsx). */
vi.mock('../store/dataStore', async () => {
  const actual = await vi.importActual('../store/dataStore');
  return {
    ...actual as any,
    useData: () => ({
      isLoading: false,
      error: null,
      agents: [{ id: 'agent-jarvis', name: 'Jarvis' }],
      providers: [],
      runs: [],
      memoryScopes: [],
      memoryEntries: [],
      artifacts: [],
      runtimes: [],
      boards: [],
      tools: []
    })
  };
});

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'ERROR', json: async () => body };
}

/* Generic healthy backend for every endpoint the shell/pages touch. */
function routeFetch(url: any, options?: any) {
  const u = String(url);
  if (u.endsWith('/api/jarvis/conversations') && !options) {
    // Server contract: listConversations() orders by updatedAt DESC —
    // data[0] is the most recently active conversation.
    return jsonResponse([
      { id: 'conv-B', title: 'Newest', updatedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'conv-A', title: 'Older', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
  }
  if (u.includes('/api/jarvis/conversations/') && u.endsWith('/messages')) return jsonResponse([]);
  if (u.endsWith('/api/health/gateway')) return jsonResponse({ status: 'healthy' });
  if (u.endsWith('/api/health/system')) return jsonResponse({ host: 'TESTHOST', cpuLoadPct: 1, ramUsedMb: 1, ramTotalMb: 2, gpu: null });
  if (u.endsWith('/api/hermes-api/status')) return jsonResponse({ profile: 'p', url: 'u', gateway: { reachable: true, detail: 'ok' }, stt: { configured: true, provider: 'deepgram' }, tts: { configured: true, provider: 'deepgram' } });
  if (u.endsWith('/api/hermes-api/runs')) return jsonResponse([]);
  if (u.endsWith('/api/workspace/detect')) return jsonResponse({ isValid: true, cwd: 'B:\\AgenticOS', gitRoots: ['B:\\AgenticOS'] });
  if (u.endsWith('/api/jarvis/diagnostics')) return jsonResponse({ summary: {}, services: {} });
  return jsonResponse({});
}

/* ── Harness 1: shell + real rail + stub pages (navigation structure) ── */
function renderShell(initial = '/jarvis') {
  return render(
    <DataProvider>
      <AppProvider>
        <CodexProvider>
          <ProjectProvider>
          <MemoryRouter initialEntries={[initial]}>
            <Routes>
              <Route path="/" element={<AppShell />}>
                <Route path="jarvis" element={<div data-testid="page-jarvis" />} />
                <Route path="hermes-studio" element={<div data-testid="page-hermes" />} />
                <Route path="codex" element={<div data-testid="page-codex" />} />
                <Route path="mission-control" element={<div data-testid="page-mission-control" />} />
                <Route path="boards" element={<div data-testid="page-boards" />} />
                <Route path="research" element={<div data-testid="page-research" />} />
                <Route path="files" element={<div data-testid="page-files" />} />
                <Route path="memory" element={<div data-testid="page-memory" />} />
                <Route path="models" element={<div data-testid="page-models" />} />
                <Route path="automations" element={<div data-testid="page-automations" />} />
                <Route path="settings" element={<div data-testid="page-settings" />} />
                <Route path="teams" element={<div data-testid="page-teams" />} />
              </Route>
            </Routes>
          </MemoryRouter>
          </ProjectProvider>
        </CodexProvider>
      </AppProvider>
    </DataProvider>
  );
}

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* ignore */ }
  // jsdom lacks layout APIs used by the chat transcript.
  (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(routeFetch));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Navigation rail restored on /jarvis', () => {
  it('renders the navigation rail on /jarvis (not hidden)', async () => {
    renderShell('/jarvis');
    expect(await screen.findByTestId('nav-rail')).toBeInTheDocument();
    expect(screen.getByTestId('page-jarvis')).toBeInTheDocument();
  });

  it('contains every required entry', async () => {
    renderShell('/jarvis');
    await screen.findByTestId('nav-rail');
    const entries = [
      'nav-jarvis', 'nav-hermes', 'nav-codex', 'nav-teams',
      'nav-mission-control', 'nav-boards', 'nav-research', 'nav-files',
      'nav-memory', 'nav-models', 'nav-automations', 'nav-settings',
    ];
    for (const id of entries) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    // Expanded mode shows labels
    expect(screen.getByText('JARVIS')).toBeInTheDocument();
    expect(screen.getByText('MISSION CONTROL')).toBeInTheDocument();
    expect(screen.getByText('MODELS & PROVIDERS')).toBeInTheDocument();
  });

  it('marks Jarvis as the active entry on /jarvis', async () => {
    renderShell('/jarvis');
    await screen.findByTestId('nav-rail');
    expect(screen.getByTestId('nav-jarvis').className).toContain('active');
  });

  it('navigates to the existing Hermes route', async () => {
    renderShell('/jarvis');
    await screen.findByTestId('nav-rail');
    fireEvent.click(screen.getByTestId('nav-hermes'));
    expect(await screen.findByTestId('page-hermes')).toBeInTheDocument();
    expect(screen.queryByTestId('page-jarvis')).not.toBeInTheDocument();
  });

  it('navigates to the existing CodeX route', async () => {
    renderShell('/jarvis');
    await screen.findByTestId('nav-rail');
    fireEvent.click(screen.getByTestId('nav-codex'));
    expect(await screen.findByTestId('page-codex')).toBeInTheDocument();
  });

  it('Ctrl+1/2/3 switch Jarvis, Hermes, CodeX', async () => {
    renderShell('/codex');
    await screen.findByTestId('page-codex');
    fireEvent.keyDown(window, { key: '1', ctrlKey: true });
    expect(await screen.findByTestId('page-jarvis')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2', ctrlKey: true });
    expect(await screen.findByTestId('page-hermes')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    expect(await screen.findByTestId('page-codex')).toBeInTheDocument();
  });

  it('returning to /jarvis re-renders Jarvis (same route component, no duplicate page)', async () => {
    renderShell('/jarvis');
    await screen.findByTestId('nav-rail');
    fireEvent.click(screen.getByTestId('nav-hermes'));
    await screen.findByTestId('page-hermes');
    fireEvent.click(screen.getByTestId('nav-jarvis'));
    expect(await screen.findByTestId('page-jarvis')).toBeInTheDocument();
    // Exactly one Jarvis page instance mounted at any time
    expect(screen.getAllByTestId('page-jarvis')).toHaveLength(1);
  });
});

describe('Rail collapse mode', () => {
  it('collapses to icon-only and persists for the session', async () => {
    renderShell('/jarvis');
    const rail = await screen.findByTestId('nav-rail');
    expect(rail.getAttribute('data-collapsed')).toBe('false');

    fireEvent.click(screen.getByTestId('nav-collapse-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('nav-rail').getAttribute('data-collapsed')).toBe('true');
    });
    // Labels hidden in collapsed mode
    expect(screen.queryByText('MISSION CONTROL')).not.toBeInTheDocument();
    // Entry still present (icon-only) and functional
    expect(screen.getByTestId('nav-hermes')).toBeInTheDocument();
    // Session persistence
    expect(sessionStorage.getItem(RAIL_KEY)).toBe('1');

    fireEvent.click(screen.getByTestId('nav-hermes'));
    expect(await screen.findByTestId('page-hermes')).toBeInTheDocument();
  });

  it('restores collapsed state from sessionStorage on mount', async () => {
    try { sessionStorage.setItem(RAIL_KEY, '1'); } catch { /* ignore */ }
    renderShell('/jarvis');
    const rail = await screen.findByTestId('nav-rail');
    expect(rail.getAttribute('data-collapsed')).toBe('true');
    expect(screen.queryByText('MISSION CONTROL')).not.toBeInTheDocument();
  });
});

describe('Jarvis session preservation across navigation', () => {
  it('restores the remembered conversation when returning to /jarvis', async () => {
    // Simulate a previous visit that left conv-B active.
    try { sessionStorage.setItem(CONV_KEY, 'conv-B'); } catch { /* ignore */ }
    const requested: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: any, options?: any) => {
      const u = String(url);
      if (u.includes('/messages')) requested.push(u);
      return routeFetch(u, options);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(
      <DataProvider>
        <AppProvider>
          <CodexProvider>
            <ProjectProvider>
              <MemoryRouter initialEntries={['/jarvis']}>
                <JarvisStudio />
              </MemoryRouter>
            </ProjectProvider>
          </CodexProvider>
        </AppProvider>
      </DataProvider>
    );
    await waitFor(() => {
      expect(requested.some((u) => u.includes('conv-B'))).toBe(true);
    });
    unmount(); // navigate away

    // Return to /jarvis — the SAME conversation must be restored.
    requested.length = 0;
    render(
      <DataProvider>
        <AppProvider>
          <CodexProvider>
            <ProjectProvider>
              <MemoryRouter initialEntries={['/jarvis']}>
                <JarvisStudio />
              </MemoryRouter>
            </ProjectProvider>
          </CodexProvider>
        </AppProvider>
      </DataProvider>
    );
    await waitFor(() => {
      expect(requested.some((u) => u.includes('conv-B'))).toBe(true);
    });
    expect(requested.some((u) => u.includes('conv-A'))).toBe(false);
  });

  it('falls back to the most recent conversation when nothing is remembered', async () => {
    const requested: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: any, options?: any) => {
      const u = String(url);
      if (u.includes('/messages')) requested.push(u);
      return routeFetch(u, options);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <DataProvider>
        <AppProvider>
          <CodexProvider>
            <ProjectProvider>
              <MemoryRouter initialEntries={['/jarvis']}>
                <JarvisStudio />
              </MemoryRouter>
            </ProjectProvider>
          </CodexProvider>
        </AppProvider>
      </DataProvider>
    );
    await waitFor(() => {
      expect(requested.length).toBeGreaterThan(0);
    });
    // Server ordering contract: data[0] is the newest (conv-B first).
    expect(requested[0]).toContain('conv-B');
  });
});

describe('Single voice owner on /jarvis', () => {
  it('exactly one mic owner, one composer, one core — no duplicate pipelines', async () => {
    render(
      <DataProvider>
        <AppProvider>
          <CodexProvider>
            <ProjectProvider>
              <MemoryRouter initialEntries={['/jarvis']}>
                <JarvisStudio />
              </MemoryRouter>
            </ProjectProvider>
          </CodexProvider>
        </AppProvider>
      </DataProvider>
    );
    await screen.findByTestId('jarvis-dashboard');
    // ONE engine-driven mic control (composer's duplicate mic is hidden)
    expect(screen.getAllByTestId('jarvis-mic-button')).toHaveLength(1);
    // ONE composer (text input + Send preserved)
    expect(screen.getAllByTestId('jarvis-composer')).toHaveLength(1);
    // ONE reactive core (one visual voice surface — JarvisCore renders the
    // orb on a div with data-testid, not a canvas element)
    expect(document.querySelectorAll('[data-testid="jarvis-orb"]')).toHaveLength(1);
    // No drawer-based duplicate voice controller on /jarvis
    expect(document.querySelector('[class*="inspector-drawer"]')).toBeNull();
  });
});
