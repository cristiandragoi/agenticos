import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import UniversalChatDock from '../components/layout/UniversalChatDock';
import { AppProvider, useAppDispatch } from '../store/appStore';
import { DataProvider } from '../store/dataStore';

vi.mock('../store/dataStore', async () => {
  const actual = await vi.importActual('../store/dataStore');
  return {
    ...actual as any,
    useData: () => ({
      isLoading: false,
      agents: [{ id: 'agent-jarvis', name: 'Jarvis' }, { id: 'agent-hermes', name: 'Hermes' }],
    })
  };
});

describe('UniversalChatDock message filtering', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('only displays messages for the current targetAgentId', () => {
    const TestComponent = () => {
      const dispatch = useAppDispatch();
      React.useEffect(() => {
        // Set target to hermes
        dispatch({ type: 'SET_CHAT_TARGET', agentId: 'agent-hermes' });
        
        // Add a message for hermes
        dispatch({ type: 'SEND_MESSAGE', message: {
          id: 'msg-hermes', role: 'user', content: 'Message for Hermes', agentId: 'agent-hermes', timestamp: new Date().toISOString()
        }});
        
        // Add a message for jarvis
        dispatch({ type: 'SEND_MESSAGE', message: {
          id: 'msg-jarvis', role: 'user', content: 'Message for Jarvis', agentId: 'agent-jarvis', timestamp: new Date().toISOString()
        }});
        
        // Add a legacy message with no agentId
        dispatch({ type: 'SEND_MESSAGE', message: {
          id: 'msg-legacy', role: 'user', content: 'Message for Legacy', timestamp: new Date().toISOString()
        } as any});

        // Expand the dock
        dispatch({ type: 'TOGGLE_CHAT_EXPANDED' });
      }, [dispatch]);

      return <UniversalChatDock />;
    };

    render(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/hermes-studio']}>
            <TestComponent />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>
    );

    // Should see hermes message
    expect(screen.getByText('Message for Hermes')).toBeInTheDocument();
    
    // Should NOT see jarvis message
    expect(screen.queryByText('Message for Jarvis')).not.toBeInTheDocument();

    // Should NOT see legacy message
    expect(screen.queryByText('Message for Legacy')).not.toBeInTheDocument();
  });
});
