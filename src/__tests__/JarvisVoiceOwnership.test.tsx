import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import JarvisDrawer from '../components/drawers/JarvisDrawer';
import UniversalChatDock from '../components/layout/UniversalChatDock';
import { AppProvider, useAppDispatch } from '../store/appStore';
import { DataProvider } from '../store/dataStore';

// Mock audio / speechSynthesis
const mockSpeak = vi.fn().mockResolvedValue(undefined);
const mockStopAudio = vi.fn();
vi.mock('../hooks/useVoiceIO', () => ({
  useVoiceIO: () => ({
    speak: mockSpeak,
    stopAudio: mockStopAudio,
    stopListening: vi.fn(),
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
  })
}));

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ audioData: 'test' })
});
vi.stubGlobal('fetch', mockFetch);

vi.mock('../store/dataStore', async () => {
  const actual = await vi.importActual('../store/dataStore');
  return {
    ...actual as any,
    useData: () => ({
      isLoading: false,
      agents: [{ id: 'agent-jarvis', name: 'Jarvis' }, { id: 'agent-hermes', name: 'Hermes' }, { id: 'agent-codex', name: 'CodeX' }],
    })
  };
});

describe('Voice Ownership and Deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  it('UniversalChatDock never initiates TTS', async () => {
    render(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/mission-control']}>
            <UniversalChatDock />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>
    );

    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-jarvis', text: 'Should not play', messageId: 'msg-999' }
    }));

    // UniversalChatDock has no TTS listener now
    expect(mockFetch).not.toHaveBeenCalledWith('/api/voice/tts', expect.anything());
  });

  it('Jarvis TTS owns playback exclusively and plays exactly once per message (deduplicates)', async () => {
    const TestComponent = () => {
      const dispatch = useAppDispatch();
      React.useEffect(() => {
        dispatch({ type: 'OPEN_DRAWER', entityType: 'jarvis', entityId: 'agent-jarvis' });
      }, [dispatch]);
      return <JarvisDrawer />;
    };

    render(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/jarvis']}>
            <TestComponent />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>
    );

    // Dispatch event twice to simulate React StrictMode or multiple listeners
    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-jarvis', text: 'Hello Jarvis', messageId: 'msg-123' }
    }));
    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-jarvis', text: 'Hello Jarvis', messageId: 'msg-123' }
    }));

    // Should only be called once because of module-scoped deduplication
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledWith('Hello Jarvis');
  });

  it('two different Jarvis message IDs each play once', async () => {
    const TestComponent = () => {
      const dispatch = useAppDispatch();
      React.useEffect(() => {
        dispatch({ type: 'OPEN_DRAWER', entityType: 'jarvis', entityId: 'agent-jarvis' });
      }, [dispatch]);
      return <JarvisDrawer />;
    };

    render(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/jarvis']}>
            <TestComponent />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>
    );

    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-jarvis', text: 'Message 1', messageId: 'msg-100' }
    }));
    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-jarvis', text: 'Message 2', messageId: 'msg-101' }
    }));

    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(mockSpeak).toHaveBeenNthCalledWith(1, 'Message 1');
    expect(mockSpeak).toHaveBeenNthCalledWith(2, 'Message 2');
  });

  it('Hermes and CodeX messages never play through Jarvis TTS', async () => {
    const TestComponent = () => {
      const dispatch = useAppDispatch();
      React.useEffect(() => {
        dispatch({ type: 'OPEN_DRAWER', entityType: 'jarvis', entityId: 'agent-jarvis' });
      }, [dispatch]);
      return <JarvisDrawer />;
    };

    render(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/jarvis']}>
            <TestComponent />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>
    );

    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-hermes', text: 'Hermes test', messageId: 'msg-h1' }
    }));
    window.dispatchEvent(new CustomEvent('agent-response-ready', {
      detail: { agentId: 'agent-codex', text: 'CodeX test', messageId: 'msg-c1' }
    }));

    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('leaving /jarvis stops active playback', async () => {
    const TestComponent = () => {
      const dispatch = useAppDispatch();
      React.useEffect(() => {
        dispatch({ type: 'OPEN_DRAWER', entityType: 'jarvis', entityId: 'agent-jarvis' });
      }, [dispatch]);
      return <JarvisDrawer />;
    };

    const { unmount } = render(
      <DataProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/jarvis']}>
            <TestComponent />
          </MemoryRouter>
        </AppProvider>
      </DataProvider>
    );

    unmount();

    expect(mockStopAudio).toHaveBeenCalled();
  });
});
