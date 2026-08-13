import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MissionControlPage from '../pages/MissionControlPage';
import LeftRail from '../components/layout/LeftRail';
import { AppProvider } from '../store/appStore';
import { ProjectProvider } from '../store/projectStore';

const dataState = vi.hoisted(() => ({
  current: {
    agents: [] as any[],
    providers: [] as any[],
    runs: [] as any[],
    runtimes: [] as any[],
    schedules: [] as any[],
    isLoading: false,
    error: null as string | null,
    refresh: vi.fn(),
  },
}));

vi.mock('../store/dataStore', () => ({
  useData: () => dataState.current,
}));

const liveRegistry = {
  agents: [
    { id: 'agent-jarvis', name: 'JARVIS', status: 'active', runtimeId: 'rt-jarvis', description: 'Assistant', capabilities: ['chat'] },
    { id: 'agent-hermes', name: 'HERMES', status: 'active', runtimeId: 'rt-hermes', description: 'Assistant', capabilities: ['chat'] },
    { id: 'agent-codex', name: 'CODEX', status: 'idle', runtimeId: 'rt-codex', description: 'Coding', capabilities: ['code'] },
  ],
  providers: [
    {
      id: 'prov-ollama',
      name: 'Ollama',
      kind: 'llm',
      category: 'local',
      status: 'connected',
      adapter: 'ollama-adapter',
      authScheme: 'none',
      defaultModel: 'laguna-xs-2.1',
      models: [{ id: 'laguna-xs-2.1', name: 'laguna-xs-2.1' }],
      scopes: ['chat'],
    },
  ],
  runtimes: [{ id: 'rt-jarvis', label: 'Jarvis Runtime', health: { status: 'healthy' } }],
  runs: [
    { id: 'run-1', agentId: 'agent-codex', status: 'running', input: 'Inspect files', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'run-2', agentId: 'agent-hermes', status: 'waiting', input: 'Approve plan', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'run-3', agentId: 'agent-jarvis', status: 'failed', input: 'Check health', errorMessage: 'Provider failed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: 'run-4', agentId: 'agent-jarvis', status: 'completed', input: 'Summarize', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  ],
  schedules: [{ id: 'schedule-1', name: 'Nightly check', status: 'active' }],
};

function setData(overrides: Partial<typeof dataState.current> = {}) {
  dataState.current = {
    ...dataState.current,
    ...liveRegistry,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  // jsdom lacks scrollIntoView (used by the mounted JarvisOrb internals).
  (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  // Stub the gateway health probe (and any panel fetch) for deterministic runs.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'online' }) })));
  sessionStorage.clear();
  setData();
});

/** MissionControlPage now mounts the main-cockpit Jarvis conversation panel,
 *  which uses the shared app store — renders must sit inside AppProvider.
 *  Claude's project-aware Mission Control also uses useProjects(), so the
 *  ProjectProvider must wrap it too (project foundation integration). */
function renderCockpit() {
  return render(
    <AppProvider>
      <ProjectProvider>
        <MemoryRouter initialEntries={['/mission-control']}>
          <MissionControlPage />
        </MemoryRouter>
      </ProjectProvider>
    </AppProvider>,
  );
}

describe('Mission Control cockpit', () => {
  it('mounts the Jarvis conversation panel but not a duplicate full Jarvis chat/composer', () => {
    renderCockpit();

    expect(screen.getByTestId('mission-control-cockpit')).toBeInTheDocument();
    // The main-cockpit conversation surface IS present (mode selector + input).
    expect(screen.getByTestId('mission-jarvis-panel')).toBeInTheDocument();
    expect(screen.getByTestId('mission-mode-manual')).toBeInTheDocument();
    expect(screen.getByTestId('mission-mode-conversation')).toBeInTheDocument();
    // But no SECOND, separate Jarvis chat/composer is duplicated into the page.
    expect(screen.queryByTestId('jarvis-composer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Message Input')).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick Chat|OmniRoot/i)).not.toBeInTheDocument();
  });

  it('mounts the reactive Jarvis orb, driven by real signals (idle at rest)', () => {
    renderCockpit();

    // The EXISTING JarvisOrb component is mounted inside Mission Control.
    expect(screen.getByTestId('mission-jarvis-orb')).toBeInTheDocument();
    const orb = screen.getByTestId('jarvis-orb');
    expect(orb).toBeInTheDocument();
    // No mic capture, no confirmed playback, no in-flight runs, backend reachable
    // in the test environment → real-signal derivation resolves to idle.
    expect(orb.getAttribute('data-orb-state')).toBe('idle');
    expect(screen.getByTestId('jarvis-orb-label').textContent).toBe('Ready');
  });

  it('keeps technical telemetry OUT of the main view until diagnostics is opened', () => {
    renderCockpit();

    // Milestone 1: no permanent telemetry panels/metric cards in the main view.
    expect(screen.queryByText('PROVIDERS AND MODELS')).not.toBeInTheDocument();
    expect(screen.queryByText('REGISTERED AGENTS')).not.toBeInTheDocument();
    expect(screen.queryByText('PENDING APPROVALS')).not.toBeInTheDocument();
    expect(screen.queryByText('ACTIVE EXECUTIONS')).not.toBeInTheDocument();
    expect(screen.queryByText('FAILED RUNS AND ALERTS')).not.toBeInTheDocument();
    expect(screen.queryByText('SYSTEM REGISTRY')).not.toBeInTheDocument();
    // No permanently visible Action Log panel on this route either.
    expect(document.body.textContent).not.toContain('Action Log');

    // Opening the collapsible diagnostics drawer reveals live registry data.
    fireEvent.click(screen.getByTestId('mission-diagnostics-toggle'));
    expect(screen.getByTestId('mission-diagnostics-content')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Ollama');
    expect(document.body.textContent).toContain('JARVIS');
    expect(document.body.textContent).toContain('HERMES');
    expect(document.body.textContent).toContain('CODEX');
    expect(screen.queryByText('Athena')).not.toBeInTheDocument();
    expect(screen.queryByText('Mnemosyne')).not.toBeInTheDocument();
  });

  it('serves provider values from the live registry inside diagnostics', () => {
    renderCockpit();

    fireEvent.click(screen.getByTestId('mission-diagnostics-toggle'));
    expect(screen.getByText('Ollama')).toBeInTheDocument();
    expect(screen.queryByText(/GPT-4o|Claude 3\.5|o1-mini|Perplexity/i)).not.toBeInTheDocument();
  });

  it('does not render static temperature values without runtime configuration', () => {
    renderCockpit();

    expect(document.body.textContent).not.toMatch(/temperature/i);
    expect(document.body.textContent).not.toMatch(/0\.[0-9]/);
  });

  it('shows the compact status strip with provider/model/connection/mic/voice', () => {
    renderCockpit();

    const strip = screen.getByTestId('mission-status-strip');
    expect(strip).toBeInTheDocument();
    expect(strip.textContent).toContain('MODE');
    expect(strip.textContent).toContain('CONNECTED');
    expect(strip.textContent).toContain('MIC');
    expect(strip.textContent).toContain('VOICE');
    // The visible voice selector exposes British + American choices.
    const select = screen.getByTestId('mission-voice-select') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent || '');
    expect(labels.some((l) => l.includes('British'))).toBe(true);
    expect(labels.some((l) => l.includes('American'))).toBe(true);
  });

  it('hides raw stack traces behind a compact error card', () => {
    setData({ error: 'TypeError: broken\n    at MissionControlPage (src/pages/MissionControlPage.tsx:10:1)' });
    renderCockpit();

    expect(screen.getByText('Backend unavailable')).toBeInTheDocument();
    expect(screen.getByText('TypeError: broken')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/open diagnostics/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('at MissionControlPage');
  });
});

describe('navigation IA', () => {
  it('displays the final sidebar structure with JARVIS and no Dashboard item', () => {
    render(
      <AppProvider>
        <ProjectProvider>
          <MemoryRouter initialEntries={['/mission-control']}>
            <LeftRail />
          </MemoryRouter>
        </ProjectProvider>
      </AppProvider>
    );

    expect(screen.getByText('AI AGENTS')).toBeInTheDocument();
    expect(screen.getByText('WORKSPACE')).toBeInTheDocument();
    expect(screen.getByText('SYSTEM')).toBeInTheDocument();
    expect(screen.getByText('JARVIS')).toBeInTheDocument();
    expect(screen.queryByText('J.A.R.V.I.S.')).not.toBeInTheDocument();
    expect(screen.getByText('MISSION CONTROL')).toBeInTheDocument();
    expect(screen.getByText('MODELS & PROVIDERS')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('redirects Dashboard to Mission Control', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Navigate to="/mission-control" replace />} />
          <Route path="/mission-control" element={<div>Mission Control Landing</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Mission Control Landing')).toBeInTheDocument();
  });
});
