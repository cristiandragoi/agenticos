/**
 * MissionControlConversation.test.tsx — conversation mode wired into the MAIN
 * Mission Control cockpit (the user-facing surface).
 *
 * Uses the REAL useVoiceIO engine inside the real JarvisConversationPanel
 * (the component mounted in MissionControlPage), with the same scriptable
 * VAD harness as JarvisConversation.test.tsx:
 *  - manual requestAnimationFrame queue
 *  - fake timers driving measured-silence durations
 *  - test-controlled microphone RMS amplitude
 *  - configurable MediaRecorder payload + fetch routing
 *
 * Proves (cycle contract):
 *  1. the main cockpit exposes Manual and Conversation modes
 *  2. Conversation mode auto-submits after end-of-speech (no Send click)
 *  3. Manual mode requires Send
 *  4. transcript submits exactly once
 *  5. no duplicate TTS (one synthesis per assistant turn)
 *  6. playback end resumes listening
 *  7. switching back to Manual stops continuous capture
 *  8. existing input and Send button remain available
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import MissionControlPage from '../pages/MissionControlPage';
import JarvisConversationPanel from '../components/jarvis/JarvisConversationPanel';
import { AppProvider } from '../store/appStore';
import { ProjectProvider } from '../store/projectStore';
import { MemoryRouter } from 'react-router-dom';

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

/* ─── Manual rAF queue ─── */
let rafQueue: Array<(t: number) => void> = [];
let rafIdCounter = 0;

function flushRaf(frames = 1) {
  for (let i = 0; i < frames; i++) {
    const current = rafQueue;
    rafQueue = [];
    current.forEach((cb) => cb(performance.now()));
  }
}

/* ─── Scriptable mic amplitude ─── */
let rmsLevel = 0;

/* ─── Configurable recorder payload ─── */
let recorderChunkSize = 600;

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
    const chunk = new Blob([new Uint8Array(recorderChunkSize).fill(1)], { type: 'audio/webm' });
    this.ondataavailable?.({ data: chunk });
  }

  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.onstop?.();
  }
}

/* ─── Audio element mock ─── */
let lastAudio: MockAudio | null = null;

class MockAudio {
  src = '';
  onplay: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn(() => {
    const self = this;
    if (self.src) Promise.resolve().then(() => self.onplay?.());
    return Promise.resolve();
  });
  constructor() {
    lastAudio = this;
  }
}

/* ─── Fetch routing: gateway health / conversation create / SSE stream / tts ─── */
let transcribeText = 'reply with exactly jarvis live';
let streamRoute = 'direct';

/** Build a ReadableStream that emits the given SSE events then closes. */
function makeSseResponse(events: Array<{ event: string; data: any }>) {
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
  return { ok: true, body: stream };
}

const fetchMock = vi.fn(async (input: unknown, _init?: unknown) => {
  const url = String(input);
  if (url.includes('/voice/transcribe')) {
    return { ok: true, json: async () => ({ text: transcribeText }) };
  }
  if (url.includes('/api/health/gateway')) {
    return { ok: true, json: async () => ({ status: 'online' }) };
  }
  if (url.includes('/voice/tts')) {
    return { ok: true, json: async () => ({ audioData: 'QkFTRTY0QVVESU8=' }) };
  }
  // Conversation creation.
  if (url.endsWith('/api/jarvis/conversations')) {
    return { ok: true, json: async () => ({ id: 'conv-1' }) };
  }
  // Streaming request path — the REAL Jarvis route. Emits status + chunk + done.
  if (url.includes('/message/stream')) {
    return makeSseResponse([
      { event: 'status', data: { state: 'thinking', provider: 'OpenRouter', model: 'poolside/laguna-s-2.1:free', operationId: 'op-1' } },
      { event: 'chunk', data: { delta: 'JARVIS', operationId: 'op-1' } },
      { event: 'chunk', data: { delta: '_LIVE', operationId: 'op-1' } },
      { event: 'done', data: { route: streamRoute, operationId: 'op-1', provider: 'OpenRouter', model: 'poolside/laguna-s-2.1:free' } },
    ]);
  }
  return { ok: true, json: async () => ({}) };
});

const trackStopMock = vi.fn();
const getUserMediaMock = vi.fn();

function setupNavigator() {
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
}

async function speakOneTurn() {
  rmsLevel = 0.1; // speech begins
  await act(async () => { flushRaf(1); });                    // mark speechStartedAt
  await act(async () => { vi.advanceTimersByTime(150); });    // sustain >= minSpeechMs (120)
  await act(async () => { flushRaf(1); });                    // turn recording starts
  rmsLevel = 0; // measured silence begins
  await act(async () => { flushRaf(1); });                    // mark silenceSince
  await act(async () => { vi.advanceTimersByTime(950); });    // exceed the 900ms silence window
  await act(async () => { flushRaf(1); });                    // end-of-speech → stop → transcribe → auto-submit
}

function renderPanel() {
  return render(
    <AppProvider>
      <JarvisConversationPanel />
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  rafIdCounter = 0;
  rmsLevel = 0;
  recorderChunkSize = 600;
  lastAudio = null;
  transcribeText = 'reply with exactly jarvis live';

  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    rafQueue.push(cb);
    return ++rafIdCounter;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  MockMediaRecorder.instances = [];
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  (globalThis as any).Audio = MockAudio;
  (globalThis as any).fetch = fetchMock;
  fetchMock.mockClear();
  trackStopMock.mockClear();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: trackStopMock }] });
  setupNavigator();

  (globalThis as any).AudioContext = class {
    state = 'running';
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createAnalyser() {
      return {
        fftSize: 0,
        frequencyBinCount: 128,
        getByteTimeDomainData(d: Uint8Array) {
          const v = Math.min(255, Math.max(0, Math.round(128 + rmsLevel * 128)));
          d.fill(v);
        },
        connect: vi.fn(),
      };
    }
    close() { return Promise.resolve(); }
  };

  (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
  (window as any).matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  (window as any).HTMLElement.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Flush enough microtask ticks for the SSE reader loop + speak() chain. */
async function flushAsync() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/** Fast-VAD conversation start through the real cockpit UI. */
async function activateConversationMode() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('mission-mode-conversation'));
  });
  // Flush the async startConversation() promise chain.
  await act(async () => { await Promise.resolve(); });
}

describe('Mission Control cockpit — conversation integration', () => {
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

  it('2. Conversation mode auto-submits after end-of-speech — no Send click', async () => {
    renderPanel();
    await activateConversationMode();

    await speakOneTurn();

    // The existing Jarvis STREAMING request path was invoked automatically,
    // once, with the transcribed text — the user never pressed Send.
    const streamCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/message/stream'));
    expect(streamCalls).toHaveLength(1);
    const body = JSON.parse((streamCalls[0][1] as any).body);
    expect(body.prompt).toBe('reply with exactly jarvis live');
    expect(body.inputChannel).toBe('voice');
    // The live streaming reply is visible in the transcript.
    await flushAsync();
    expect(screen.getAllByTestId('mission-jarvis-transcript-entry').some(
      (el) => el.textContent?.includes('JARVIS_LIVE'),
    )).toBe(true);
  });

  it('3. Manual mode requires Send — transcript lands in the editable input', async () => {
    renderPanel();

    // Manual record via the cockpit mic button.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mission-jarvis-mic'));
    });
    await flushAsync(); // getUserMedia resolves

    // Sustained silence stops the manual segment (existing behaviour).
    rmsLevel = 0;
    await act(async () => { flushRaf(1); });
    await act(async () => { vi.advanceTimersByTime(1600); });
    await act(async () => { flushRaf(1); });

    // Transcript filled the EDITABLE input; nothing was submitted.
    const input = screen.getByTestId('mission-jarvis-input') as HTMLInputElement;
    expect(input.value).toBe('reply with exactly jarvis live');
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/message/stream'))).toHaveLength(0);

    // Explicit Send submits it through the streaming path.
    await act(async () => {
      fireEvent.click(screen.getByTestId('mission-jarvis-send'));
    });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/message/stream'))).toHaveLength(1);
  });

  it('4. identical transcript submits exactly once (no duplicate turns)', async () => {
    renderPanel();
    await activateConversationMode();

    await speakOneTurn(); // turn 1
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/message/stream'))).toHaveLength(1);

    // Finish playback so the loop re-arms, then repeat the SAME utterance.
    await act(async () => { lastAudio?.onended?.(); });
    await speakOneTurn(); // turn 2 — identical transcript

    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/message/stream'))).toHaveLength(1);
  });

  it('5. no duplicate TTS — exactly one synthesis per assistant turn', async () => {
    renderPanel();
    await activateConversationMode();

    await speakOneTurn();
    await flushAsync(); // let speak() run to playback

    const ttsCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/voice/tts'));
    expect(ttsCalls).toHaveLength(1); // exactly one — no duplicate speech
    const ttsBody = JSON.parse((ttsCalls[0][1] as any).body);
    expect(ttsBody.text).toBe('JARVIS_LIVE'); // the streamed assistant reply, not the user turn
  });

  it('6. playback end resumes listening automatically', async () => {
    renderPanel();
    await activateConversationMode();

    await speakOneTurn();
    await flushAsync();

    // Speaking only after real playback confirmation.
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).toContain('speaking');

    // Real playback end → conversation listening resumes.
    await act(async () => { lastAudio?.onended?.(); });
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).toContain('listening');
  });

  it('7. switching back to Manual stops continuous capture', async () => {
    renderPanel();
    await activateConversationMode();
    expect(getUserMediaMock).toHaveBeenCalledTimes(1); // mic opened once

    await act(async () => {
      fireEvent.click(screen.getByTestId('mission-mode-manual'));
    });

    // Mic tracks released, mode back to manual.
    expect(trackStopMock).toHaveBeenCalled();
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).toContain('manual');

    // No new capture starts afterwards, even with loud input.
    const instancesBefore = MockMediaRecorder.instances.length;
    rmsLevel = 0.3;
    await act(async () => { flushRaf(3); });
    await act(async () => { vi.advanceTimersByTime(50); });
    await act(async () => { flushRaf(3); });
    expect(MockMediaRecorder.instances.length).toBe(instancesBefore);
  });

  it('8. text input and Send button remain available and functional', async () => {
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

    const streamCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/message/stream'));
    expect(streamCalls).toHaveLength(1);
    const body = JSON.parse((streamCalls[0][1] as any).body);
    expect(body.prompt).toBe('typed question');
    expect(body.inputChannel).toBe('typed');
    // Visible assistant response from the streaming path.
    await flushAsync();
    expect(screen.getAllByTestId('mission-jarvis-transcript-entry').some(
      (el) => el.textContent?.includes('JARVIS_LIVE'),
    )).toBe(true);
  });

  it('conversation mode persists for the session (re-mount resumes it)', async () => {
    const first = renderPanel();
    await activateConversationMode();
    expect(sessionStorage.getItem('agenticos:jarvis:conversationMode')).toBe('conversation');
    first.unmount();

    // Re-mount (navigation within the session) resumes conversation mode.
    renderPanel();
    await flushAsync();
    expect(screen.getByTestId('mission-conv-state').textContent?.toLowerCase()).not.toContain('manual');
    expect(getUserMediaMock).toHaveBeenCalledTimes(2); // re-opened on resume
  });
});
