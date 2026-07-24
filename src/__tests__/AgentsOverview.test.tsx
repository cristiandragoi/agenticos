import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsGallery from '../pages/AgentsGallery';
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

function setData() {
  dataState.current = {
    agents: [
      {
        id: 'agent-jarvis',
        name: 'JARVIS',
        status: 'active',
        runtimeId: 'rt-jarvis',
        providerIds: ['prov-local'],
        toolIds: ['tool-chat'],
        capabilities: ['chat'],
        description: 'Primary assistant',
      },
      {
        id: 'agent-hermes',
        name: 'HERMES',
        status: 'idle',
        runtimeId: 'rt-hermes',
        providerIds: ['prov-video'],
        toolIds: [],
        capabilities: ['video'],
        description: 'Video studio',
      },
      {
        id: 'agent-codex',
        name: 'CODEX',
        status: 'running',
        runtimeId: 'rt-codex',
        providerIds: ['prov-code'],
        toolIds: ['tool-shell'],
        capabilities: ['code'],
        description: 'Coding agent',
      },
      {
        id: 'agent-athena',
        name: 'Athena',
        status: 'active',
        runtimeId: 'rt-athena',
        providerIds: ['prov-fake'],
        toolIds: [],
        capabilities: [],
        description: 'Should not render',
      },
      {
        id: 'agent-mnemosyne',
        name: 'Mnemosyne',
        status: 'active',
        runtimeId: 'rt-mnemosyne',
        providerIds: ['prov-fake'],
        toolIds: [],
        capabilities: [],
        description: 'Should not render',
      },
    ],
    providers: [
      { id: 'prov-local', name: 'Local Registry', defaultModel: 'local-registry-model' },
      { id: 'prov-video', name: 'Video Registry', defaultModel: 'video-registry-model' },
      { id: 'prov-code', name: 'Code Registry', defaultModel: 'code-registry-model' },
      { id: 'prov-fake', name: 'Fake Provider', defaultModel: 'GPT-4o' },
    ],
    runs: [
      {
        id: 'run-codex',
        agentId: 'agent-codex',
        status: 'running',
        input: 'Live code run',
        createdAt: '2026-07-24T10:00:00.000Z',
        updatedAt: '2026-07-24T10:00:00.000Z',
      },
    ],
    runtimes: [],
    schedules: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  };
}

beforeEach(() => {
  setData();
});

describe('Agents Overview', () => {
  it('/agents renders the overview page', () => {
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentsGallery />} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    );

    expect(screen.getByRole('heading', { name: /agents registry/i })).toBeInTheDocument();
  });

  it('AI AGENTS links to /agents', () => {
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/mission-control']}>
          <LeftRail />
          <Routes>
            <Route path="/mission-control" element={<div>Mission Control</div>} />
            <Route path="/agents" element={<div>Agents Route</div>} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    );

    fireEvent.click(screen.getByRole('link', { name: 'AI AGENTS' }));

    expect(screen.getByText('Agents Route')).toBeInTheDocument();
  });

  it('renders only the first-step agent overview entries from live store data', () => {
    render(
      <AppProvider>
        <MemoryRouter initialEntries={['/agents']}>
          <Routes>
            <Route path="/agents" element={<AgentsGallery />} />
          </Routes>
        </MemoryRouter>
      </AppProvider>
    );

    expect(screen.getByText('JARVIS')).toBeInTheDocument();
    expect(screen.getByText('HERMES')).toBeInTheDocument();
    expect(screen.getByText('CODEX')).toBeInTheDocument();
    expect(screen.getByText('AGENT TEAMS')).toBeInTheDocument();
    expect(screen.queryByText('Athena')).not.toBeInTheDocument();
    expect(screen.queryByText('Mnemosyne')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/GPT-4o|Claude 3\.5|o1-mini|Perplexity/i);
  });
});
