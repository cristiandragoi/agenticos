/**
 * MissionControlConversation.test.tsx — conversation mode wired into the MAIN
 * Mission Control cockpit (the user-facing surface).
 *
 * RETARGETED to the CURRENT Jarvis voice architecture.
 *
 * The original suite drove the browser VAD turn engine inside the cockpit: a manual
 * requestAnimationFrame queue, test-controlled microphone RMS, a MediaRecorder payload
 * and `/voice/transcribe` → browser-side auto-submit. `agent-jarvis` no longer runs that
 * architecture — SELFHEAL-001 removed `useVoiceIO` from the cockpit entirely ("Voice is
 * now handled exclusively by JarvisNextVoiceSession"), because two engines fighting over
 * the microphone blocked Start Conversation. Voice is LiveKit-first:
 *
 *   browser mic → LiveKit canonical room → server-side voice agent
 *   → transcription / turn handling → Jarvis execution → response
 *
 * So for Jarvis there is no browser end-of-speech to detect, no browser auto-submit and
 * no client-side TTS: the server-side voice agent owns the turn AND the spoken reply.
 *
 * The USER-LEVEL requirements the old suite protected are preserved and re-expressed
 * against the live contract:
 *   - conversation mode opens exactly ONE LiveKit session in the canonical room
 *   - the browser runs NO VAD / recorder / transcribe loop for Jarvis
 *   - no client-side TTS (the reply is spoken by the server-side voice agent)
 *   - a browser lifecycle interruption neither duplicates nor loses the session
 *   - switching back to Manual tears the session down
 *   - typed input + Send keep working
 *
 * No fake browser-VAD behaviour is simulated to satisfy the historical assertions.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import MissionControlPage from '../pages/MissionControlPage';
import JarvisConversationPanel from '../components/jarvis/JarvisConversationPanel';
import { AppProvider } from '../store/appStore';
import { ProjectProvider } from '../store/projectStore';
import { MemoryRouter } from 'react-router-dom';
import { jarvisLiveKitSession } from '../lib/jarvisLiveKitSession';
import {
  createdRooms,
  resetJarvisVoiceHarness,
  withJarvisVoiceEndpoints,
  JARVIS_TEST_ROOM,
  JARVIS_TEST_WS_URL,
} from './helpers/jarvisVoiceHarness';

// Jarvis voice is LiveKit-first: the client fetches a token and constructs a Room, so
// both livekit-client and the token endpoint must be modelled.
vi.mock('livekit-client', async () => (await import('./helpers/jarvisVoiceHarness')).liveKitClientMock());

/* ─── dataStore mock for the full-page render ─── */
vi.mock('../store/dataStore', () => ({
  useData: () => ({
    agents: [{ id: 'agent-jarvis', name: 'JARVIS', status: 'active', description: 'Assistant' }],
    providers: [{ id: 'prov-ollama', name: 'Ollama', status: 'connected', defaultModel: 'laguna-xs-2.1', models: [{ id: 'laguna-xs-2.1', displayName: 'laguna-xs-2.1' }] }],
    runs: [],
    runtimes: [],
    schedules: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

/* ─── Browser voice-capture machinery: counted so we can prove it is NEVER used ─── */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: unknown;

  constructor(stream: unknown) {
    this.stream = stream;
    MockMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(600).fill(1)], { type: 'audio/webm' }) });
  }

  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.onstop?.();
  }
}

class MockAudio {
  src = '';
  paused = true;
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn(() => Promise.resolve());
  private listeners = new Map<string, Array<(...a: unknown[]) => void>>();
  addEventListener = (type: string, cb: (...a: unknown[]) => void) => {
    const l = this.listeners.get(type) ?? [];
    l.push(cb);
    this.listeners.set(type, l);
  };
  removeEventListener = (type: string, cb: (...a: unknown[]) => void) => {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== cb));
  };
  currentTime = 0;
  volume = 1;
}

/* ─── Fetch routing ─── */
const streamRoute = 'direct';
/** Every /voice/tts request — must stay 0 for Jarvis: the voice agent speaks. */
let ttsCalls = 0;
/** Every /voice/transcribe request — must stay 0: STT runs in the voice agent. */
let transcribeCalls = 0;
/** Every Jarvis streaming turn request, with the channel it was submitted on. */
let streamPrompts: Array<{ prompt: string; inputChannel: string }> = [];

/** Build a ReadableStream that emits the given SSE events then closes. The `json`
 *  member satisfies the harness's JarvisResponse shape (`tsc -b` type-checks
 *  src/__tests__); the SSE bodies themselves are read from `body`. */
function makeSseResponse(events: Array<{ event: string; data: unknown }>) {
  const encoder = new TextEncoder();
  let sseText = '';
  for (const e of events) {
    sseText += `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
  }
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return { ok: true, body: stream, json: async () => ({}) };
}

const fetchMock = vi.fn(
  withJarvisVoiceEndpoints((url, init) => {
    // The deprecated browser path — counted, never expected to be used by Jarvis.
    if (url.includes('/voice/transcribe')) {
      transcribeCalls++;
      return { ok: true, status: 200, json: async () => ({ text: 'should never happen' }) };
    }
    if (url.includes('/voice/tts')) {
      ttsCalls++;
      return { ok: true, status: 200, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
    }
    if (url.includes('/api/health/gateway')) {
      return { ok: true, status: 200, json: async () => ({ status: 'online' }) };
    }
    if (url.endsWith('/api/jarvis/conversations')) {
      return { ok: true, status: 200, json: async () => ({ id: 'conv-1' }) };
    }
    if (url.includes('/api/jarvis/runtime-state')) {
      return { ok: true, status: 200, json: async () => ({ state: 'idle' }) };
    }
    if (url.includes('/api/jarvis/live-events')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    // Streaming request path — the REAL Jarvis route. Emits status + chunk + done.
    if (url.includes('/message/stream')) {
      let body: { prompt?: string; inputChannel?: string } = {};
      try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { /* keep defaults */ }
      streamPrompts.push({ prompt: String(body.prompt ?? ''), inputChannel: String(body.inputChannel ?? '') });
      return makeSseResponse([
        { event: 'status', data: { state: 'thinking', provider: 'OpenRouter', model: 'poolside/laguna-s-2.1:free', operationId: 'op-1' } },
        { event: 'chunk', data: { delta: 'JARVIS', operationId: 'op-1' } },
        { event: 'chunk', data: { delta: '_LIVE', operationId: 'op-1' } },
        { event: 'done', data: { route: streamRoute, operationId: 'op-1', provider: 'OpenRouter', model: 'poolside/laguna-s-2.1:free' } },
      ]);
    }
    return undefined;
  }),
);

const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();

function renderPanel() {
  return render(
    <AppProvider>
      <JarvisConversationPanel />
    </AppProvider>,
  );
}

/** Flush the async startSession()/stopSession()/SSE promise chains. */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  });
}

/** Let real timers fire (the cockpit polls runtime-state every 3s). */
async function settle(ms = 40) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Enter conversation mode through the real cockpit control. */
async function activateConversationMode() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('mission-mode-conversation'));
  });
  await flushAsync();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetJarvisVoiceHarness();
  ttsCalls = 0;
  transcribeCalls = 0;
  streamPrompts = [];
  MockMediaRecorder.instances = [];

  vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  trackStopMock.mockClear();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: trackStopMock }], getAudioTracks: () => [{ enabled: true }] });
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createMediaElementSource() { return { connect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, getByteTimeDomainData: vi.fn(), connect: vi.fn() }; }
    destination = {};
    close() { return Promise.resolve(); }
  });
  vi.stubGlobal('speechSynthesis', { cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(async () => {
  // jarvisLiveKitSession is a module-level singleton: a surviving session makes the next
  // test's startSession() short-circuit against it and never construct a Room.
  await jarvisLiveKitSession.stopSession().catch(() => undefined);
  vi.unstubAllGlobals();
});

describe('Mission Control cockpit — conversation integration (LiveKit)', () => {
  it('1. the main cockpit page exposes Manual and Conversation modes', () => {
    render(
      <AppProvider>
        <ProjectProvider>
          <MemoryRouter initialEntries={['/mission-control']}>
            <MissionControlPage />
          </MemoryRouter>
        </ProjectProvider>
      </AppProvider>,
    );
    expect(screen.getByTestId('mission-control-cockpit')).toBeTruthy();
    expect(screen.getByTestId('mission-jarvis-panel')).toBeTruthy();
    expect(screen.getByTestId('mission-mode-manual')).toBeTruthy();
    expect(screen.getByTestId('mission-mode-conversation')).toBeTruthy();
    // Mode state visible in the cockpit (shows 'manual' at rest).
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).toContain('manual');
  });

  it('2. Conversation mode opens exactly ONE canonical LiveKit session, mic enabled', async () => {
    renderPanel();
    await activateConversationMode();

    // One room, one connect — in the ONE canonical room, never a per-session random name.
    expect(createdRooms.length).toBe(1);
    expect(createdRooms[0].connectCalled).toBe(1);
    expect(createdRooms[0].connectArgs?.wsUrl).toBe(JARVIS_TEST_WS_URL);
    expect(jarvisLiveKitSession.getState().roomName).toBe(JARVIS_TEST_ROOM);
    expect(jarvisLiveKitSession.isConnected).toBe(true);

    // The browser joined the room and published its microphone: this is the transport the
    // server-side voice agent receives user audio on.
    expect(createdRooms[0].localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);

    // Mode persisted for the session.
    expect(sessionStorage.getItem('agenticos:jarvis:conversationMode')).toBe('conversation');

    // The browser does NOT submit the turn — the voice agent owns turn handling.
    expect(streamPrompts).toHaveLength(0);
  });

  it('3. the browser runs NO VAD / recorder / transcribe loop for Jarvis voice', async () => {
    renderPanel();
    await activateConversationMode();
    await settle(); // plenty of time for any capture loop to arm itself

    // The deprecated browser VAD architecture: no recorder is ever constructed and no audio
    // blob is ever sent to /voice/transcribe. A browser-side VAD loop produced both. This is
    // the direct replacement for the old "VAD loop armed / rAF queue filled" assertions.
    expect(MockMediaRecorder.instances.length).toBe(0);
    expect(transcribeCalls).toBe(0);

    // LiveKit is the single owner of the microphone. (0 or 1 — never two engines racing for
    // one device, which is the defect SELFHEAL-001 removed the second engine for.)
    expect(getUserMediaMock.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('4. no client-side TTS — the server-side voice agent speaks', async () => {
    renderPanel();
    await activateConversationMode();
    await settle();

    // The cockpit never requests synthesis: Jarvis audio arrives over LiveKit.
    expect(ttsCalls).toBe(0);
  });

  it('5. a lifecycle interruption neither duplicates nor loses the session', async () => {
    renderPanel();
    await activateConversationMode();
    const room = createdRooms[0];

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flushAsync();

    // The active session survives a browser lifecycle event: not torn down, not duplicated.
    expect(room.disconnectCalled).toBe(0);
    expect(createdRooms.length).toBe(1);
    expect(jarvisLiveKitSession.isConnected).toBe(true);
    expect(getUserMediaMock.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('6. switching back to Manual tears the LiveKit session down', async () => {
    renderPanel();
    await activateConversationMode();
    expect(jarvisLiveKitSession.isConnected).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTestId('mission-mode-manual'));
    });
    await flushAsync();

    // Session released, mode back to manual and persisted as such. No new session appeared,
    // and the browser still never started a capture loop.
    expect(jarvisLiveKitSession.isConnected).toBe(false);
    expect(createdRooms.length).toBe(1);
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).toContain('manual');
    expect(sessionStorage.getItem('agenticos:jarvis:conversationMode')).toBe('manual');
    expect(MockMediaRecorder.instances.length).toBe(0);
    expect(transcribeCalls).toBe(0);
  });

  it('7. text input and Send remain available and functional', async () => {
    renderPanel();

    const input = screen.getByTestId('mission-jarvis-input') as HTMLInputElement;
    const send = screen.getByTestId('mission-jarvis-send') as HTMLButtonElement;
    expect(input).toBeTruthy();
    expect(send).toBeTruthy();

    await act(async () => {
      fireEvent.change(input, { target: { value: 'typed question' } });
    });
    expect(send.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(send);
    });
    await flushAsync();

    expect(streamPrompts).toHaveLength(1);
    expect(streamPrompts[0].prompt).toBe('typed question');
    expect(streamPrompts[0].inputChannel).toBe('typed');
    // Visible assistant response from the streaming path.
    expect(screen.getAllByTestId('mission-jarvis-transcript-entry').some(
      (el) => el.textContent?.includes('JARVIS_LIVE'),
    )).toBe(true);

    // A typed turn is not a voice turn: still no browser capture, still no client TTS.
    expect(MockMediaRecorder.instances.length).toBe(0);
    expect(ttsCalls).toBe(0);
  });

  it('8. an identical typed turn is not submitted twice (no duplicate turns)', async () => {
    renderPanel();
    const input = screen.getByTestId('mission-jarvis-input') as HTMLInputElement;

    for (const attempt of [1, 2]) {
      await act(async () => {
        fireEvent.change(input, { target: { value: 'repeat me' } });
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId('mission-jarvis-send'));
      });
      await flushAsync();
      expect(streamPrompts, `attempt ${attempt}`).toHaveLength(1);
    }
  });

  it('9. conversation mode persists for the session (re-mount rejoins the canonical room)', async () => {
    const first = renderPanel();
    await activateConversationMode();
    expect(sessionStorage.getItem('agenticos:jarvis:conversationMode')).toBe('conversation');
    expect(jarvisLiveKitSession.isConnected).toBe(true);

    first.unmount();
    await flushAsync();
    // Unmounting a live conversation releases the session — no orphaned room.
    expect(jarvisLiveKitSession.isConnected).toBe(false);

    // Re-mount (navigation within the session) resumes conversation mode by rejoining the
    // SAME canonical room — one live session again, never two.
    renderPanel();
    await flushAsync();
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).not.toContain('manual');
    expect(jarvisLiveKitSession.isConnected).toBe(true);
    expect(jarvisLiveKitSession.getState().roomName).toBe(JARVIS_TEST_ROOM);
    expect(MockMediaRecorder.instances.length).toBe(0);
  });
});
