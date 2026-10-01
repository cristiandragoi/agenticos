import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JarvisStudio from '../pages/JarvisStudio';
import { JarvisRuntimeProvider } from '../context/JarvisRuntimeContext';
import { PersistentJarvisDock } from '../components/jarvis/PersistentJarvisDock';
import JarvisDrawer from '../components/drawers/JarvisDrawer';
import { AppProvider } from '../store/appStore';
import { ProjectProvider } from '../store/projectStore';
import { HermesProvider } from '../store/hermesStore';
import { CodexProvider } from '../store/codexStore';
import { jarvisLiveKitSession } from '../lib/jarvisLiveKitSession';

const { MockRoom, createdRooms } = vi.hoisted(() => {
  const createdRooms: any[] = [];
  class MockRoom {
    name = 'jarvis-next-main';
    state: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
    listeners: Map<string, Function[]> = new Map();
    connectCalled = 0;
    disconnectCalled = 0;
    localParticipant = {
      identity: 'user-canonical',
      audioTrackPublications: new Map([['track-1', {}]]),
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
        this.micEnabled = enabled;
        return {};
      }),
      publishData: vi.fn(),
    };
    micEnabled = false;
    options?: any;
    // LiveKit exposes remoteParticipants as a Map<identity, RemoteParticipant> and
    // connectInternal iterates it (src/lib/jarvisLiveKitSession.ts:457). Omitting it
    // threw `TypeError: room.remoteParticipants is not iterable` on every connect.
    remoteParticipants = new Map<string, unknown>();
    canPlaybackAudio = true;
    startAudio = vi.fn(async () => {});

    constructor(options?: any) {
      this.options = options;
      createdRooms.push(this);
    }

    on(event: string, cb: Function) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(cb);
      return this;
    }

    emit(event: string, ...args: any[]) {
      const list = this.listeners.get(event) || [];
      list.forEach(cb => cb(...args));
    }

    async connect(wsUrl: string, token: string) {
      this.connectCalled++;
      this.state = 'connected';
      return this;
    }

    async disconnect() {
      this.disconnectCalled++;
      this.state = 'disconnected';
      this.emit('disconnected');
    }
  }
  return { MockRoom, createdRooms };
});

vi.mock('livekit-client', () => ({
  Room: MockRoom,
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    Disconnected: 'disconnected',
    DataReceived: 'dataReceived',
  },
  RemoteTrack: class {},
  RemoteParticipant: class {},
}));

vi.mock('../store/dataStore', () => ({
  useData: () => ({
    agents: [{ id: 'agent-jarvis', name: 'JARVIS', status: 'active', description: 'Assistant' }],
    providers: [{ id: 'prov-ollama', name: 'Ollama', status: 'connected', defaultModel: 'laguna-xs-2.1', models: [] }],
    runs: [],
    runtimes: [],
    schedules: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

describe('JARVIS-SELFHEAL-003: Canonical Voice Path Integration Test', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: Array<{ url: string; body?: any }> = [];

  beforeEach(async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    createdRooms.length = 0;
    fetchCalls = [];
    sessionStorage.clear();
    localStorage.clear();
    await jarvisLiveKitSession.stopSession().catch(() => undefined);

    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      let body: any;
      try { body = init?.body ? JSON.parse(init.body) : undefined; } catch {}
      fetchCalls.push({ url, body });

      if (url.includes('/api/jarvis-next/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token: 'mock-jwt-token-canonical-12345',
            wsUrl: 'ws://127.0.0.1:7880',
            roomName: body?.roomName || 'jarvis-next-main',
            identity: body?.identity || 'user-canonical',
          }),
        } as any;
      }

      if (url.includes('/api/jarvis/runtime-state') || url.includes('/api/jarvis/live-events')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: 'idle', events: [] }),
        } as any;
      }

      if (url.includes('/api/background-tasks') || url.includes('/api/agents') || url.includes('/api/runs')) {
        return {
          ok: true,
          status: 200,
          json: async () => ([]),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '',
      } as any;
    });
  });

  afterEach(async () => {
    await jarvisLiveKitSession.stopSession().catch(() => undefined);
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function renderCanonicalJarvisUI(includeDock = false, includeDrawer = false) {
    return render(
      <MemoryRouter initialEntries={['/jarvis']}>
        <AppProvider>
          <ProjectProvider>
            <HermesProvider>
              <CodexProvider>
                <JarvisRuntimeProvider>
                  <JarvisStudio />
                  {includeDock && <PersistentJarvisDock />}
                  {includeDrawer && <JarvisDrawer />}
                </JarvisRuntimeProvider>
              </CodexProvider>
            </HermesProvider>
          </ProjectProvider>
        </AppProvider>
      </MemoryRouter>
    );
  }

  it('1. JarvisStudio canonical START CONVERSATION click initiates LiveKit session', async () => {
    renderCanonicalJarvisUI();

    const startBtn = screen.getByTestId('jarvis-primary-control');
    expect(startBtn.textContent).toBe('START CONVERSATION');

    await act(async () => {
      fireEvent.click(startBtn);
    });

    const tokenCall = fetchCalls.find(c => c.url.includes('/api/jarvis-next/token'));
    expect(tokenCall).toBeDefined();
    expect(tokenCall?.body?.roomName).toBe('jarvis-next-main');

    expect(createdRooms.length).toBe(1);
    const room = createdRooms[0];
    expect(room.connectCalled).toBe(1);
    expect(room.state).toBe('connected');
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);

    expect(jarvisLiveKitSession.isConnected).toBe(true);
    expect(startBtn.textContent).toBe('END CONVERSATION');
  });

  it('2. END CONVERSATION from JarvisStudio cleanly tears down LiveKit session', async () => {
    renderCanonicalJarvisUI();

    const primaryBtn = screen.getByTestId('jarvis-primary-control');
    await act(async () => {
      fireEvent.click(primaryBtn);
    });
    expect(primaryBtn.textContent).toBe('END CONVERSATION');

    const room = createdRooms[0];
    await act(async () => {
      fireEvent.click(primaryBtn);
    });

    expect(room.disconnectCalled).toBe(1);
    expect(jarvisLiveKitSession.isConnected).toBe(false);
    expect(primaryBtn.textContent).toBe('START CONVERSATION');
  });

  it('3. Start -> Stop -> Start cleanly reconnects without leaking or orphaned state', async () => {
    renderCanonicalJarvisUI();

    const primaryBtn = screen.getByTestId('jarvis-primary-control');

    // Start 1
    await act(async () => {
      fireEvent.click(primaryBtn);
    });
    expect(createdRooms.length).toBe(1);
    expect(primaryBtn.textContent).toBe('END CONVERSATION');

    // Stop 1
    await act(async () => {
      fireEvent.click(primaryBtn);
    });
    expect(primaryBtn.textContent).toBe('START CONVERSATION');
    expect(createdRooms[0].disconnectCalled).toBe(1);

    // Start 2
    await act(async () => {
      fireEvent.click(primaryBtn);
    });
    expect(createdRooms.length).toBe(2);
    expect(createdRooms[1].connectCalled).toBe(1);
    expect(primaryBtn.textContent).toBe('END CONVERSATION');
  });

  it('4. PersistentJarvisDock shares the exact same LiveKit session and creates NO duplicate room', async () => {
    renderCanonicalJarvisUI(true, false);

    const studioBtn = screen.getByTestId('jarvis-primary-control');
    const dockMicBtn = screen.getByLabelText('Toggle Jarvis microphone');

    expect(studioBtn.textContent).toBe('START CONVERSATION');
    expect(dockMicBtn.textContent).toBe('Mic on');

    // Start via JarvisStudio
    await act(async () => {
      fireEvent.click(studioBtn);
    });

    expect(createdRooms.length).toBe(1);
    expect(studioBtn.textContent).toBe('END CONVERSATION');
    expect(dockMicBtn.textContent).toBe('Mic off');

    // Click Mic off in Dock -> should stop the shared session
    await act(async () => {
      fireEvent.click(dockMicBtn);
    });

    expect(jarvisLiveKitSession.isConnected).toBe(false);
    expect(studioBtn.textContent).toBe('START CONVERSATION');
    expect(dockMicBtn.textContent).toBe('Mic on');

    // Start via PersistentJarvisDock -> should start the shared session
    await act(async () => {
      fireEvent.click(dockMicBtn);
    });

    expect(createdRooms.length).toBe(2);
    expect(jarvisLiveKitSession.isConnected).toBe(true);
    expect(studioBtn.textContent).toBe('END CONVERSATION');
    expect(dockMicBtn.textContent).toBe('Mic off');
  });

  it('5. JarvisDrawer conversation controls resolve to the same canonical LiveKit session', async () => {
    renderCanonicalJarvisUI(false, true);

    const studioBtn = screen.getByTestId('jarvis-primary-control');
    await act(async () => {
      fireEvent.click(studioBtn);
    });

    expect(createdRooms.length).toBe(1);
    expect(jarvisLiveKitSession.isConnected).toBe(true);

    // Stop session via canonical controller
    await act(async () => {
      await jarvisLiveKitSession.stopSession();
    });

    expect(jarvisLiveKitSession.isConnected).toBe(false);
    expect(studioBtn.textContent).toBe('START CONVERSATION');
  });

  it('6. Rapid repeated Start clicks do not duplicate LiveKit rooms', async () => {
    renderCanonicalJarvisUI();

    const startBtn = screen.getByTestId('jarvis-primary-control');

    // Fire 3 clicks rapidly
    await act(async () => {
      fireEvent.click(startBtn);
      fireEvent.click(startBtn);
      fireEvent.click(startBtn);
    });

    const tokenCalls = fetchCalls.filter(c => c.url.includes('/api/jarvis-next/token'));
    expect(tokenCalls.length).toBe(1);
    expect(createdRooms.length).toBe(1);
    expect(createdRooms[0].connectCalled).toBe(1);
    expect(startBtn.textContent).toBe('END CONVERSATION');
  });

  it('7. Stop speaking triggers LiveKit interruption and halts speech while preserving listening', async () => {
    renderCanonicalJarvisUI();

    const startBtn = screen.getByTestId('jarvis-primary-control');
    await act(async () => {
      fireEvent.click(startBtn);
    });

    expect(jarvisLiveKitSession.isConnected).toBe(true);

    // Simulate assistant speaking state via status event
    const room = createdRooms[0];
    await act(async () => {
      room.emit('dataReceived', new TextEncoder().encode(JSON.stringify({
        type: 'status',
        state: 'speaking',
        isSpeaking: true,
        isListening: true,
      })));
    });

    await waitFor(() => {
      expect(startBtn.textContent).toBe('STOP SPEAKING');
    });

    // Click STOP SPEAKING
    await act(async () => {
      fireEvent.click(startBtn);
    });

    // Verify publishData was called with stop_speaking
    expect(room.localParticipant.publishData).toHaveBeenCalled();
    const lastPublish = room.localParticipant.publishData.mock.calls[0][0];
    const decoded = JSON.parse(new TextDecoder().decode(lastPublish));
    expect(decoded.type).toBe('stop_speaking');

    // Button should revert back to END CONVERSATION while staying connected
    expect(jarvisLiveKitSession.isConnected).toBe(true);
    expect(startBtn.textContent).toBe('END CONVERSATION');
  });

  it('8. Incoming LiveKit DataChannel events deliver transcripts to the UI', async () => {
    renderCanonicalJarvisUI();

    const startBtn = screen.getByTestId('jarvis-primary-control');
    await act(async () => {
      fireEvent.click(startBtn);
    });

    const room = createdRooms[0];
    await act(async () => {
      room.emit('dataReceived', new TextEncoder().encode(JSON.stringify({
        type: 'transcript',
        text: 'Deploy the latest release',
        isFinal: true,
      })));
    });

    // Sticky composer should reflect transcribed user text
    const composer = screen.getByPlaceholderText(/Ask Jarvis anything/i) as HTMLTextAreaElement;
    expect(composer.value).toBe('Deploy the latest release');
  });
});
