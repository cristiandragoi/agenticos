/**
 * Canonical test harness for the Jarvis voice path.
 *
 * WHY THIS EXISTS
 * Jarvis voice is LiveKit-first: for `agentId === 'agent-jarvis'`,
 * `useVoiceIO.startConversation` enters the LiveKit branch and its FIRST network
 * call is `POST /api/jarvis-next/token`. Suites that predate LiveKit modelled the
 * old REST voice path (`/voice/transcribe` + `/voice/tts`) and answered everything
 * else with a generic `{}` catch-all. That catch-all silently answered the token
 * request with `{}`, which fails the client's guard
 * (`src/lib/jarvisLiveKitSession.ts`: `if (!token || !wsUrl) throw`), so
 * `startConversation` returned false, the mic loop never ran, and every downstream
 * assertion failed for a reason that had nothing to do with what it tested.
 *
 * Instead of hand-copying a MockRoom into every suite, use this one harness:
 *
 *   vi.mock('livekit-client', async () =>
 *     (await import('./helpers/jarvisVoiceHarness')).liveKitClientMock());
 *
 *   const fetchMock = vi.fn(withJarvisVoiceEndpoints((url) => {
 *     if (url.includes('/voice/transcribe')) return { ok: true, status: 200, json: async () => ({ text: 'hi' }) };
 *     return undefined;              // -> canonical empty fallback
 *   }));
 *
 * A catch-all may keep returning `{}` for unrelated endpoints; it must never be the
 * thing that answers `/api/jarvis-next/token`.
 *
 * NOTE on scope: these suites cannot assert `onAutoSubmit` / `onControlCommand` for
 * `agentId: 'agent-jarvis'` at all — `useVoiceIO.submitConversationTurn` deliberately
 * returns false for that agent ("[LegacyVoice] Suppressed ... deactivated for LiveKit
 * replacement"). Use this harness to prove session/transport behaviour, not to force
 * the legacy hook assertions green.
 */
import { vi } from 'vitest';

/** Must match the server default (server/src/routers/jarvisNext.ts). */
export const JARVIS_TEST_ROOM = 'jarvis-next-main';
export const JARVIS_TEST_WS_URL = 'ws://127.0.0.1:7880';
export const JARVIS_TEST_TOKEN = 'mock-jwt-token-canonical-12345';

/** The subset of a fetch Response these suites consume. */
export interface JarvisResponse {
  ok: boolean;
  /** Optional: suites that only care about ok/json may omit it. */
  status?: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}

type Listener = (...args: unknown[]) => void;

/** Every Room constructed since the last reset — one per real LiveKit session. */
export const createdRooms: MockRoom[] = [];

export function resetJarvisVoiceHarness(): void {
  createdRooms.length = 0;
}

export function isJarvisTokenUrl(url: string): boolean {
  return url.includes('/api/jarvis-next/token');
}

/**
 * The real endpoint's response shape:
 * 200 -> { token, wsUrl, roomName, identity }
 */
export function jarvisTokenResponse(init?: RequestInit): JarvisResponse {
  let body: { roomName?: string; identity?: string } | undefined;
  try {
    body = init?.body ? JSON.parse(String(init.body)) as { roomName?: string; identity?: string } : undefined;
  } catch {
    body = undefined; // non-JSON body: fall back to the canonical defaults
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      token: JARVIS_TEST_TOKEN,
      wsUrl: JARVIS_TEST_WS_URL,
      roomName: body?.roomName || JARVIS_TEST_ROOM,
      identity: body?.identity || 'user-harness',
    }),
  };
}

/**
 * Wraps a suite's responder so the Jarvis voice endpoints are always modelled.
 * The responder returns `undefined` to fall through to the canonical empty body.
 */
export function withJarvisVoiceEndpoints(
  responder: (url: string, init?: RequestInit) => JarvisResponse | undefined,
  fallback: () => JarvisResponse = () => ({ ok: true, status: 200, json: async () => ({}) }),
): (input: unknown, init?: RequestInit) => Promise<JarvisResponse> {
  return async (input, init) => {
    const url = String(input);
    if (isJarvisTokenUrl(url)) return jarvisTokenResponse(init);
    return responder(url, init) ?? fallback();
  };
}

/**
 * Implements only the surface `src/lib/jarvisLiveKitSession.ts` consumes:
 *   Room: constructor(opts), on, connect, disconnect, canPlaybackAudio, startAudio,
 *         remoteParticipants (iterable — connectInternal iterates it), localParticipant
 *   localParticipant: setMicrophoneEnabled, publishData, audioTrackPublications
 *   participant: trackPublications
 * plus the RoomEvent names the session subscribes to.
 */
export class MockRoom {
  name = JARVIS_TEST_ROOM;
  state: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  canPlaybackAudio = true;
  micEnabled = false;
  connectCalled = 0;
  disconnectCalled = 0;
  /** What the client actually asked for — lets tests assert the canonical room. */
  connectArgs: { wsUrl: string; token: string } | null = null;
  options: Record<string, unknown> | undefined;
  startAudio = vi.fn(async () => {});
  private listeners = new Map<string, Listener[]>();

  localParticipant = {
    identity: 'user-harness',
    audioTrackPublications: new Map<string, unknown>([['track-1', {}]]),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      this.micEnabled = enabled;
      return {};
    }),
    publishData: vi.fn(),
  };

  /** Iterable so `for (const [_, p] of room.remoteParticipants)` works. */
  remoteParticipants = new Map<string, unknown>();

  constructor(options?: Record<string, unknown>) {
    this.options = options;
    createdRooms.push(this);
  }

  on(event: string, cb: Listener) {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  /** Test affordance: drive a LiveKit event the session subscribes to. */
  emit(event: string, ...args: unknown[]) {
    (this.listeners.get(event) ?? []).forEach((cb) => cb(...args));
  }

  async connect(wsUrl: string, token: string) {
    this.connectCalled++;
    this.connectArgs = { wsUrl, token };
    this.state = 'connected';
    return this;
  }

  async disconnect() {
    this.disconnectCalled++;
    this.state = 'disconnected';
    this.emit('disconnected');
  }
}

/** Module shape returned by the `vi.mock('livekit-client')` factory. */
export function liveKitClientMock() {
  return {
    Room: MockRoom,
    RoomEvent: {
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      Disconnected: 'disconnected',
      DataReceived: 'dataReceived',
    },
    RemoteTrack: class {},
    RemoteParticipant: class {},
  };
}
