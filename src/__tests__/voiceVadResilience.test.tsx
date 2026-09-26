import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceIO } from '../hooks/useVoiceIO';
import { jarvisLiveKitSession } from '../lib/jarvisLiveKitSession';
import {
  createdRooms,
  resetJarvisVoiceHarness,
  withJarvisVoiceEndpoints,
  JARVIS_TEST_ROOM,
  JARVIS_TEST_WS_URL,
} from './helpers/jarvisVoiceHarness';

// Jarvis voice is LiveKit-first: the client calls POST /api/jarvis-next/token and then
// constructs a Room, so both must be modelled.
vi.mock('livekit-client', async () => (await import('./helpers/jarvisVoiceHarness')).liveKitClientMock());

/**
 * `agent-jarvis` voice-session resilience.
 *
 * RETARGETED from "VAD liveness / watchdog". The original suite asserted the browser
 * requestAnimationFrame VAD analysis loop: exactly one loop armed per conversation, no
 * duplicate arm on `focus`, a watchdog re-arming a loop frozen by Chromium's rAF
 * throttling, and re-arm on `visibilitychange`.
 *
 * That architecture is no longer used by `agent-jarvis`. Voice is LiveKit-first — the
 * browser owns the room and the microphone, while transcription and turn handling happen
 * in the server-side voice agent — so there is no browser VAD loop to keep alive.
 *
 * The USER-LEVEL requirement behind the old assertions is preserved and still asserted
 * here: voice must not silently die, and recovery must neither LOSE nor DUPLICATE the
 * logical conversation. It is expressed against the live contract instead: exactly one
 * LiveKit session per conversation, the one canonical room, no duplicate session on
 * focus/visibilitychange, truthful state after a transport drop, and no mic churn.
 *
 * No fake browser-VAD behaviour is simulated to satisfy the historical assertions.
 */
describe('Jarvis LiveKit voice-session resilience (single-session ownership)', () => {
  let track: { enabled: boolean; kind: string; stop: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    resetJarvisVoiceHarness();

    class MockTrack {
      enabled = true;
      kind = 'audio';
      stop = vi.fn();
    }
    track = new MockTrack();
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });

    class MockAnalyser {
      fftSize = 512;
      frequencyBinCount = 256;
      getByteTimeDomainData = vi.fn((data: Uint8Array) => data.fill(128));
    }
    class MockAudioContext {
      state = 'running';
      destination = {};
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
      createAnalyser = vi.fn(() => new MockAnalyser());
      createBuffer = vi.fn(() => ({}));
      createBufferSource = vi.fn(() => ({ buffer: null, connect: vi.fn(), start: vi.fn() }));
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    class MockMediaRecorder {
      static instances: MockMediaRecorder[] = [];
      state = 'inactive';
      stream: unknown;
      ondataavailable: unknown = null;
      onstop: unknown = null;
      constructor(stream: unknown) { this.stream = stream; MockMediaRecorder.instances.push(this); }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; }
    }
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);

    vi.stubGlobal('SpeechSynthesisUtterance', class { onend: unknown = null; onerror: unknown = null; text = ''; });
    (window as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };

    class MockAudio {
      src = '';
      paused = true;
      onplay: unknown = null;
      onended: unknown = null;
      onerror: unknown = null;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      removeAttribute = vi.fn();
      duration = 2;
      error: unknown = null;
    }
    vi.stubGlobal('Audio', MockAudio);

    (globalThis as any).fetch = vi.fn(withJarvisVoiceEndpoints(() => undefined));
  });

  // jarvisLiveKitSession is a module-level singleton: without tearing the session down,
  // the next test's startSession() short-circuits against the still-connected session
  // and never constructs a Room.
  afterEach(async () => {
    await jarvisLiveKitSession.stopSession().catch(() => undefined);
  });

  async function startConversation(result: { current: ReturnType<typeof useVoiceIO> }) {
    let ok = false;
    await act(async () => { ok = await result.current.startConversation(); });
    expect(ok).toBe(true);
    return ok;
  }

  it('opens exactly ONE LiveKit session per conversation, in the canonical room', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    await startConversation(result);

    // Single-session ownership: one room, one connect.
    expect(createdRooms.length).toBe(1);
    expect(createdRooms[0].connectCalled).toBe(1);
    expect(jarvisLiveKitSession.isConnected).toBe(true);

    // The session joins the ONE canonical room — conversation identity lives in
    // conversationId, so the room itself is never per-session.
    expect(createdRooms[0].connectArgs).not.toBeNull();
    expect(createdRooms[0].connectArgs?.wsUrl).toBe(JARVIS_TEST_WS_URL);
    expect(jarvisLiveKitSession.getState().roomName).toBe(JARVIS_TEST_ROOM);
  });

  it('a healthy session is not duplicated, and focus does not open a second one', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    await startConversation(result);

    await act(async () => { window.dispatchEvent(new Event('focus')); });

    // Focus is a UI event: it must not spawn a competing voice session.
    expect(createdRooms.length).toBe(1);
    expect(jarvisLiveKitSession.isConnected).toBe(true);
  });

  it('a dropped transport is reported truthfully and creates no phantom session', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    await startConversation(result);
    const room = createdRooms[0];

    // Transport drops (network/agent restart) — the old failure mode was a session that
    // silently claimed to still be listening while nothing was flowing.
    await act(async () => { room.emit('disconnected'); });

    expect(jarvisLiveKitSession.isConnected).toBe(false); // not falsely "live"
    expect(createdRooms.length).toBe(1);                  // no phantom duplicate session
  });

  it('visibilitychange keeps the session usable and does not duplicate it', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    await startConversation(result);
    const room = createdRooms[0];

    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    // The active session must survive a visibility change: not torn down, not duplicated.
    expect(room.disconnectCalled).toBe(0);
    expect(createdRooms.length).toBe(1);
    expect(jarvisLiveKitSession.isConnected).toBe(true);
  });

  it('does not re-acquire the microphone while the session is live (no getUserMedia churn)', async () => {
    const { result } = renderHook(() => useVoiceIO({ agentId: 'agent-jarvis' }));
    await startConversation(result);
    const gum = vi.mocked(navigator.mediaDevices.getUserMedia);
    const gumCalls = gum.mock.calls.length;

    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(gum.mock.calls.length).toBe(gumCalls); // stream preserved
    expect(track.enabled).toBe(true);
  });
});
