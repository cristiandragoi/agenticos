import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MissionControlPage from '../pages/MissionControlPage';
import LeftRail from '../components/layout/LeftRail';
import { AppProvider } from '../store/appStore';

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
  setData();
});

describe('Mission Control cockpit', () => {
  it('does not render a duplicate full Jarvis chat or composer', () => {
    render(<MissionControlPage />);

    expect(screen.getByTestId('mission-control-cockpit')).toBeInTheDocument();
    expect(screen.queryByTestId('mission-jarvis-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mission-jarvis-orb')).not.toBeInTheDocument();
    expect(screen.queryByTestId('jarvis-composer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Message Input')).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick Chat|OmniRoot|Listening/i)).not.toBeInTheDocument();
  });

  it('shows only registered agents from live data', () => {
    render(<MissionControlPage />);

    expect(screen.getAllByText('JARVIS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('HERMES').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CODEX').length).toBeGreaterThan(0);
    expect(screen.queryByText('Athena')).not.toBeInTheDocument();
    expect(screen.queryByText('Mnemosyne')).not.toBeInTheDocument();
  });

  it('uses provider and model values from the live registry', () => {
    render(<MissionControlPage />);

    expect(screen.getByText('Ollama')).toBeInTheDocument();
    expect(document.body.textContent).toContain('laguna-xs-2.1');
    expect(screen.queryByText(/GPT-4o|Claude 3\.5|o1-mini|Perplexity/i)).not.toBeInTheDocument();
  });

  it('does not render static temperature values without runtime configuration', () => {
    render(<MissionControlPage />);

    expect(document.body.textContent).not.toMatch(/temperature/i);
    expect(document.body.textContent).not.toMatch(/0\.[0-9]/);
  });

  it('hides raw stack traces behind a compact error card', () => {
    setData({ error: 'TypeError: broken\n    at MissionControlPage (src/pages/MissionControlPage.tsx:10:1)' });
    render(<MissionControlPage />);

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
        <MemoryRouter initialEntries={['/mission-control']}>
          <LeftRail />
        </MemoryRouter>
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
