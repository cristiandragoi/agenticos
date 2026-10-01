import { Room, RoomEvent, RemoteTrack } from 'livekit-client';
import { apiUrl } from '../api/client';

export type JarvisSessionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface JarvisLiveKitState {
  sessionState: JarvisSessionState;
  isConnected: boolean;
  isConnecting: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  errorMsg: string | null;
  micTrackCount: number;
}

const TAG = '[JARVIS_LIVEKIT_SESSION]';

export class JarvisLiveKitSession {
  private room: Room | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private playbackAudioContext: AudioContext | null = null;
  private sessionState: JarvisSessionState = 'disconnected';
  private isSpeaking = false;
  private isListening = false;
  private errorMsg: string | null = null;
  private micTrackCount = 0;
  private connectingPromise: Promise<boolean> | null = null;
  private listeners: Set<() => void> = new Set();
  private dataListeners: Set<(data: any) => void> = new Set();

  getState(): JarvisLiveKitState {
    return {
      sessionState: this.sessionState,
      isConnected: this.sessionState === 'connected',
      isConnecting: this.sessionState === 'connecting',
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      errorMsg: this.errorMsg,
      micTrackCount: this.micTrackCount,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onData(listener: (data: any) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error(`${TAG} listener callback error:`, e);
      }
    }
  }

  private emitData(data: any) {
    for (const listener of this.dataListeners) {
      try {
        listener(data);
      } catch (e) {
        console.error(`${TAG} data listener callback error:`, e);
      }
    }
  }

  private ensureAudioElement(): HTMLAudioElement | null {
    if (this.audioElement) return this.audioElement;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      let el = document.getElementById('jarvis-livekit-audio') as HTMLAudioElement | null;
      if (!el) {
        try {
          el = document.createElement('audio');
          el.id = 'jarvis-livekit-audio';
          el.autoplay = true;
          // Never use display: none for WebRTC media in Chromium! Keep in render tree.
          el.style.position = 'fixed';
          el.style.bottom = '0';
          el.style.left = '0';
          el.style.width = '1px';
          el.style.height = '1px';
          el.style.opacity = '0.01';
          el.style.pointerEvents = 'none';
          document.body.appendChild(el);
        } catch {
          return null;
        }
      }
      this.audioElement = el;
      return el;
    }
    return null;
  }

  private attachAndPlayRemoteAudio(track: RemoteTrack) {
    const audioEl = this.ensureAudioElement();
    if (!audioEl) {
      console.error('[JFE-AUDIO] AUDIO_ELEMENT_NOT_FOUND');
      return;
    }
    console.log('[JFE-AUDIO] AUDIO_ELEMENT_FOUND');

    try {
      if (typeof (track as any).attach === 'function') {
        (track as any).attach(audioEl);
        console.log('[JFE-AUDIO] TRACK_ATTACHED');
      }
    } catch (attachErr: any) {
      console.error('[JFE-AUDIO] TRACK_ATTACH_FAILED:', attachErr?.message || attachErr);
      return;
    }

    const hasSrcObject = Boolean(audioEl.srcObject);
    if (hasSrcObject) {
      console.log('[JFE-AUDIO] SRC_OBJECT_SET');
    } else {
      console.warn('[JFE-AUDIO] SRC_OBJECT_NOT_SET');
    }

    audioEl.autoplay = true;
    (audioEl as any).playsInline = true;
    audioEl.muted = false;
    audioEl.volume = 1.0;

    // Connect remote MediaStream directly to WebAudio destination to guarantee hardware output
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx && audioEl.srcObject instanceof MediaStream) {
        if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
          this.playbackAudioContext = new AudioCtx();
        }
        if (this.playbackAudioContext.state === 'suspended') {
          this.playbackAudioContext.resume().catch(() => {});
        }
        const streamSource = this.playbackAudioContext.createMediaStreamSource(audioEl.srcObject);
        streamSource.connect(this.playbackAudioContext.destination);
        console.log(`[JFE-AUDIO] WEBAUDIO_ROUTED state=${this.playbackAudioContext.state}`);
      }
    } catch (webaudioErr: any) {
      console.warn('[JFE-AUDIO] WEBAUDIO_ROUTE_ERROR', webaudioErr?.message || webaudioErr);
    }

    console.log(`[JFE-AUDIO] ELEMENT_STATE autoplay=${audioEl.autoplay} muted=${audioEl.muted} volume=${audioEl.volume} paused=${audioEl.paused} readyState=${audioEl.readyState} srcObject=${hasSrcObject}`);

    console.log('[JFE-AUDIO] PLAY_BEGIN');
    try {
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            console.log('[JFE-AUDIO] PLAY_RESOLVED');
          })
          .catch((err: any) => {
            console.error('[JFE-AUDIO] PLAY_REJECTED', err?.message || String(err));
          });
      } else {
        console.log('[JFE-AUDIO] PLAY_RESOLVED');
      }
    } catch (err: any) {
      console.error('[JFE-AUDIO] PLAY_REJECTED', err?.message || String(err));
    }
  }

  async startSession(roomName: string = 'jarvis-next-main'): Promise<boolean> {
    console.log('[JFE] LIVEKIT_START', { roomName });
    console.log(`${TAG} startSession called, currentState=${this.sessionState}`);
    if (this.sessionState === 'connected' && this.room?.state === 'connected') {
      console.log(`${TAG} session already active and connected — reusing`);
      return true;
    }
    if (this.connectingPromise) {
      console.log(`${TAG} session connection already in flight — awaiting active promise`);
      return this.connectingPromise;
    }

    this.connectingPromise = this.connectInternal(roomName);
    try {
      return await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async connectInternal(roomName: string): Promise<boolean> {
    this.sessionState = 'connecting';
    this.errorMsg = null;
    this.notify();

    // Create persistent audio element upfront (Task 1: ONE audio element for full session)
    let audioEl = this.ensureAudioElement();

    if (!audioEl) {
      console.error(`${TAG} [JARVIS_AUDIO] createFailed — no audio element available`);
      return false;
    }

    const activeAudioEl = audioEl;

    // Non-blocking playback unlock during user-gesture chain.
    // An empty audio element without src will leave play() pending in Chromium if awaited.
    // Do not await — real audio plays when remote MediaStream track is attached.
    try {
      activeAudioEl.play()?.catch?.(() => {});
      console.log(`${TAG} [JARVIS_AUDIO] initial unlock attempted (non-blocking)`);
    } catch (err: any) {
      console.warn(`${TAG} [JARVIS_AUDIO] initial unlock skipped (non-fatal):`, err?.message || String(err));
    }

    let token: string;
    let wsUrl: string;

    try {
      const tokenUrl = apiUrl('/api/jarvis-next/token');
      console.log('[JFE] TOKEN_FETCH_BEGIN', { roomName, url: tokenUrl });
      console.log(`${TAG} requesting token from ${tokenUrl}`);

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          identity: `user-${Date.now().toString(36)}`,
          name: 'Desktop User',
        }),
        signal: AbortSignal.timeout(30000),
      });

      console.log('[JFE] TOKEN_FETCH_RESULT', { status: res.status, ok: res.ok });

      if (!res.ok) {
        const body = await res.text().catch(() => '(no body)');
        throw new Error(`HTTP ${res.status} — ${body}`);
      }

      const json = await res.json();
      token = json.token;
      wsUrl = json.wsUrl;

      if (!token || !wsUrl) {
        throw new Error(`Token response missing token or wsUrl: ${JSON.stringify(json)}`);
      }

      console.log(`${TAG} token received successfully for room ${roomName}`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.log('[JFE] TOKEN_FETCH_RESULT', { status: 'error', error: msg });
      console.error(`${TAG} token request failed: ${msg}`, err);
      this.errorMsg = `Token request failed: ${msg}`;
      this.sessionState = 'error';
      this.notify();
      return false;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.room = room;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      console.log(`[JFE-AUDIO] TRACK_SUBSCRIBED kind=${track.kind} sid=${track.sid}`);
      if (track.kind === 'audio') {
        this.attachAndPlayRemoteAudio(track);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      console.log(`[JFE-AUDIO] TRACK_UNSUBSCRIBED kind=${track.kind} sid=${track.sid}`);
      if (track.kind === 'audio' && this.audioElement && typeof (track as any).detach === 'function') {
        try {
          (track as any).detach(this.audioElement);
        } catch {}
        this.isSpeaking = false;
        this.notify();
      }
    });

    room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        console.log(`[JFE-DATA] RECEIVED type=${data.type}`);
        console.log(`${TAG} data packet received:`, data);

        if (data.type === 'status') {
          if (typeof data.isSpeaking === 'boolean') {
            this.isSpeaking = data.isSpeaking;
            if (data.isSpeaking && this.audioElement) {
              console.log('[JFE-AUDIO] PLAY_BEGIN (on status isSpeaking)');
              this.audioElement.muted = false;
              this.audioElement.volume = 1.0;
              this.audioElement.play().then(() => {
                console.log('[JFE-AUDIO] PLAY_RESOLVED (on status isSpeaking)');
              }).catch((err) => {
                console.error('[JFE-AUDIO] PLAY_REJECTED (on status isSpeaking)', err?.message || String(err));
              });
              if (this.playbackAudioContext && this.playbackAudioContext.state === 'suspended') {
                this.playbackAudioContext.resume().catch(() => {});
              }
            }
          }
          if (typeof data.isListening === 'boolean') {
            this.isListening = data.isListening;
          }
          this.notify();
        } else if (data.type === 'assistant_text') {
          if (this.audioElement) {
            this.audioElement.muted = false;
            this.audioElement.volume = 1.0;
            this.audioElement.play().then(() => {
              console.log('[JFE-AUDIO] PLAY_RESOLVED (on assistant_text)');
            }).catch((err) => {
              console.warn('[JFE-AUDIO] PLAY_REJECTED (on assistant_text)', err?.message || String(err));
            });
          }
          if (this.playbackAudioContext && this.playbackAudioContext.state === 'suspended') {
            this.playbackAudioContext.resume().catch(() => {});
          }
        }

        this.emitData(data);
      } catch (e) {
        // Not JSON
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log(`${TAG} room disconnected event received`);
      this.sessionState = 'disconnected';
      this.isSpeaking = false;
      this.isListening = false;
      this.micTrackCount = 0;
      this.room = null;
      this.notify();
    });

    try {
      console.log(`${TAG} connecting to LiveKit room at ${wsUrl}`);
      await room.connect(wsUrl, token);
      console.log(`${TAG} room connected`);

      // Unblock LiveKit WebAudio engine and audio playback
      try {
        await room.startAudio();
        console.log('[JFE-AUDIO] ROOM_START_AUDIO_SUCCESS canPlaybackAudio=' + room.canPlaybackAudio);
      } catch (startAudioErr: any) {
        console.warn('[JFE-AUDIO] ROOM_START_AUDIO_WARN', startAudioErr?.message || startAudioErr);
      }

      // Check if remote participants already published audio tracks before client joined
      for (const [_, participant] of room.remoteParticipants) {
        for (const [_, pub] of participant.trackPublications) {
          if (pub.kind === 'audio' && pub.track) {
            console.log(`[JFE-AUDIO] EXISTING_TRACK_FOUND kind=${pub.track.kind} sid=${pub.track.sid}`);
            this.attachAndPlayRemoteAudio(pub.track as RemoteTrack);
          }
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`${TAG} LiveKit room connect failed: ${msg}`, err);
      this.errorMsg = `LiveKit connect failed: ${msg}`;
      this.sessionState = 'error';
      this.room = null;
      this.notify();
      return false;
    }

    try {
      console.log(`${TAG} enabling microphone`);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.micTrackCount = room.localParticipant.audioTrackPublications?.size ?? 1;
      console.log(`${TAG} microphone enabled`);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`${TAG} microphone enable failed: ${msg}`, err);
      this.errorMsg = `Microphone enable failed: ${msg}`;
      this.sessionState = 'error';
      await room.disconnect().catch(() => undefined);
      this.room = null;
      this.notify();
      return false;
    }

    this.sessionState = 'connected';
    this.isListening = true;
    this.notify();
    return true;
  }

  async stopSpeaking(): Promise<void> {
    console.log(`${TAG} stopSpeaking called`);

    // 1. Immediately pause and reset local playback
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      } catch {
        // ignore
      }
    }

    this.isSpeaking = false;
    this.notify();

    // 2. Publish interruption event over LiveKit DataChannel
    if (this.room?.localParticipant) {
      try {
        const payload = new TextEncoder().encode(JSON.stringify({ type: 'stop_speaking' }));
        await this.room.localParticipant.publishData(payload, { reliable: true });
      } catch (err) {
        console.warn(`${TAG} failed to publish stop_speaking packet:`, err);
      }
    }

    // 3. Fallback POST to API
    try {
      await fetch(apiUrl('/api/jarvis-next/agent/interrupt'), { method: 'POST' });
    } catch {
      // ignore
    }
  }

  async stopSession(): Promise<void> {
    console.log(`${TAG} stopSession called`);
    const room = this.room;
    this.room = null;
    if (room) {
      await room.disconnect().catch(() => undefined);
    }
    this.sessionState = 'disconnected';
    this.isSpeaking = false;
    this.isListening = false;
    this.micTrackCount = 0;
    this.notify();
  }

  get isConnected(): boolean {
    return this.sessionState === 'connected';
  }

  get isConnecting(): boolean {
    return this.sessionState === 'connecting';
  }

  get state(): JarvisSessionState {
    return this.sessionState;
  }

  get currentRoom(): Room | null {
    return this.room;
  }
}

export const jarvisLiveKitSession = new JarvisLiveKitSession();
