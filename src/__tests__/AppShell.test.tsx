import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import { AppProvider } from '../store/appStore';
import { DataProvider } from '../store/dataStore';
import { CodexProvider } from '../store/codexStore';

// Mock dependencies
vi.mock('../components/layout/LeftRail', () => ({
  default: () => <div data-testid="mock-left-rail">LeftRail</div>
}));
vi.mock('../components/layout/TopContextBar', () => ({
  default: () => <div data-testid="mock-top-context-bar">TopContextBar</div>
}));
vi.mock('../components/layout/InspectorDrawer', () => ({
  default: () => <div data-testid="mock-inspector">Inspector</div>
}));
vi.mock('../components/layout/CustomTitlebar', () => ({
  default: () => <div data-testid="mock-titlebar">Titlebar</div>
}));
vi.mock('../ui/CommandPalette', () => ({
  default: () => <div data-testid="mock-command-palette">CommandPalette</div>
}));
vi.mock('../store/dataStore', async () => {
  const actual = await vi.importActual('../store/dataStore');
  return {
    ...actual as any,
    useData: () => ({
      isLoading: false,
      error: null,
      agents: [{ id: 'agent-hermes', name: 'Hermes', status: 'active' }],
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

// We need an Outlet that renders something representing HermesKanbanView
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual as any,
    Outlet: () => (
      <div data-testid="mock-hermes-kanban-view">
        <div data-testid="mock-hermes-kanban-board">KanbanBoard</div>
        <div data-testid="mock-hermes-context-panel">ContextPanel</div>
        <textarea data-testid="mock-hermes-composer" placeholder="Ask anything or request a task..." />
        <button data-testid="mock-hermes-send">Send</button>
      </div>
    )
  };
});

describe('AppShell > UniversalChatDock integration on /hermes-studio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  const renderWithProviders = () => {
    return render(
      <DataProvider>
        <AppProvider>
          <CodexProvider>
            <MemoryRouter initialEntries={['/hermes-studio']}>
              <AppShell />
            </MemoryRouter>
          </CodexProvider>
        </AppProvider>
      </DataProvider>
    );
  };

  it('mounts UniversalChatDock on /hermes-studio along with Hermes Kanban components', async () => {
    renderWithProviders();
    
    // Wait for the shell to finish loading data
    await waitFor(() => {
      expect(screen.queryByText(/Connecting to backend.../i)).not.toBeInTheDocument();
    });

    // UniversalChatDock should be present (find its composer input)
    const dockInput = document.querySelector('.chat-dock__input');
    expect(dockInput).toBeInTheDocument();

    // The mock Outlet representing HermesKanbanView should be present
    expect(screen.getByTestId('mock-hermes-kanban-board')).toBeInTheDocument();
    expect(screen.getByTestId('mock-hermes-context-panel')).toBeInTheDocument();

    // The dock should be singular (only one dock composer input in the UniversalChatDock)
    const dockContainer = dockInput?.closest('.chat-dock');
    expect(dockContainer).toBeInTheDocument();
    
    const allDocks = document.querySelectorAll('.chat-dock');
    expect(allDocks.length).toBe(1);
  });

  it('displays submitted messages and streamed responses in the dock', async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(screen.queryByText(/Connecting to backend.../i)).not.toBeInTheDocument();
    });

    // Expand the dock to see messages
    const expandButton = screen.getByTitle('Expand');
    fireEvent.click(expandButton);

    // Initial system message should be visible
    expect(screen.getByText(/Agentic OS ready/i)).toBeInTheDocument();

    // Type a message in the UniversalChatDock composer
    const dockInput = document.querySelector('.chat-dock__input') as HTMLElement;
    fireEvent.change(dockInput, { target: { value: 'Hello Hermes!' } });
    
    const sendButton = dockInput.parentElement?.querySelector('button[title="Send"]') as HTMLElement;
    fireEvent.click(sendButton);

    // The user's message should instantly appear
    expect(await screen.findByText('Hello Hermes!')).toBeInTheDocument();
  });
});
