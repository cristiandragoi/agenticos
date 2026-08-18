import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsGallery from '../pages/AgentsGallery';
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

function setData(overrides: Partial<typeof dataState.current> = {}) {
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
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderOverview(initialPath = '/agents') {
  return render(
    <AppProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/agents"
            element={
              <>
                <AgentsGallery />
                <LocationProbe />
              </>
            }
          />
          <Route path="/jarvis" element={<LocationProbe />} />
          <Route path="/hermes" element={<LocationProbe />} />
          <Route path="/codex" element={<LocationProbe />} />
          <Route path="/agent-teams" element={<LocationProbe />} />
          <Route path="/control-room" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );
}

beforeEach(() => {
  setData();
});

describe('Agents Overview', () => {
  it('/agents renders the overview page', () => {
    renderOverview();

    expect(screen.getByRole('heading', { name: /agents overview/i })).toBeInTheDocument();
  });

  it('renders exactly four primary agent cards', () => {
    renderOverview();

    expect(screen.getAllByTestId('agent-overview-card')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /jarvis agent card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hermes agent card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /codex agent card/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /agent teams agent card/i })).toBeInTheDocument();
  });

  it('shows JARVIS without dotted spelling', () => {
    renderOverview();

    expect(screen.getByText('JARVIS')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/J\.A\.R\.V\.I\.S/i);
  });

  it('does not render Athena or Mnemosyne', () => {
    renderOverview();

    expect(screen.queryByText('Athena')).not.toBeInTheDocument();
    expect(screen.queryByText('Mnemosyne')).not.toBeInTheDocument();
  });

  it('does not render fake model names from non-primary agents', () => {
    renderOverview();

    expect(document.body.textContent).not.toMatch(/GPT-4o|Claude 3\.5|o1-mini|Perplexity/i);
  });

  it('selecting a card opens details', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /jarvis agent card/i }));

    expect(screen.getByRole('region', { name: /jarvis details/i })).toBeInTheDocument();
  });

  it('clicking Close closes details', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /jarvis agent card/i }));
    fireEvent.click(screen.getByRole('button', { name: /close jarvis details/i }));

    expect(screen.queryByRole('region', { name: /jarvis details/i })).not.toBeInTheDocument();
  });

  it('pressing Escape closes details', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /jarvis agent card/i }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: /jarvis details/i })).not.toBeInTheDocument();
  });

  it('Enter or Space selects a focused card', () => {
    renderOverview();

    const jarvis = screen.getByRole('button', { name: /jarvis agent card/i });
    fireEvent.keyDown(jarvis, { key: 'Enter' });
    expect(screen.getByRole('region', { name: /jarvis details/i })).toBeInTheDocument();

    const hermes = screen.getByRole('button', { name: /hermes agent card/i });
    fireEvent.keyDown(hermes, { key: ' ' });
    expect(screen.getByRole('region', { name: /hermes details/i })).toBeInTheDocument();
  });

  it.each([
    ['JARVIS', '/jarvis'],
    ['HERMES', '/hermes'],
    ['CODEX', '/codex'],
    ['AGENT TEAMS', '/agent-teams'],
  ])('Open Agent for %s navigates to %s', (name, path) => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${name} agent card`, 'i') }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Open Agent ${name}`, 'i') }));

    expect(screen.getByTestId('location')).toHaveTextContent(path);
  });

  it('missing model shows Not configured or Unknown', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /agent teams agent card/i }));

    expect(screen.getByRole('region', { name: /agent teams details/i })).toHaveTextContent(/Not configured|Unknown/);
  });

  it('missing provider shows Not configured or Unknown', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /agent teams agent card/i }));

    expect(screen.getByRole('region', { name: /agent teams details/i })).toHaveTextContent(/Not configured|Unknown/);
  });

  it('no active run shows No active run', () => {
    renderOverview();

    fireEvent.click(screen.getByRole('button', { name: /hermes agent card/i }));

    expect(screen.getByRole('region', { name: /hermes details/i })).toHaveTextContent('No active run');
  });

  it('active count is derived from live state', () => {
    renderOverview();

    expect(screen.getByLabelText('2 of 4 active agents')).toHaveTextContent('2 of 4 active');
  });

  it('temperature is not rendered without live configuration', () => {
    renderOverview();

    expect(document.body.textContent).not.toMatch(/temperature/i);
  });

  it('loading state shows skeleton cards', () => {
    setData({ isLoading: true });

    renderOverview();

    expect(screen.getAllByTestId('agent-skeleton-card')).toHaveLength(4);
  });

  it('error state hides raw stack traces', () => {
    setData({ error: 'Error: registry failed\n    at fetchData (dataStore.tsx:52:1)' });

    renderOverview();

    expect(screen.getByRole('alert', { name: /agents overview error/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry agents overview data/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open diagnostics/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/fetchData|dataStore\.tsx|stack/i);
  });

  it('reduced-motion mode preserves interaction', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    renderOverview();
    fireEvent.click(screen.getByRole('button', { name: /codex agent card/i }));

    expect(screen.getByRole('region', { name: /codex details/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('AI AGENTS sidebar heading still links to /agents', () => {
    render(
      <AppProvider>
        <ProjectProvider>
          <MemoryRouter initialEntries={['/mission-control']}>
            <LeftRail />
            <Routes>
              <Route path="/mission-control" element={<div>Mission Control</div>} />
              <Route path="/agents" element={<div>Agents Route</div>} />
            </Routes>
          </MemoryRouter>
        </ProjectProvider>
      </AppProvider>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'AI AGENTS' }));

    expect(screen.getByText('Agents Route')).toBeInTheDocument();
  });
});
