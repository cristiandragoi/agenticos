import { Room, RoomEvent, RemoteTrack } from 'livekit-client';
import { apiUrl, apiFetch } from '../api/client';
import { backendLifecycleStore } from '../diagnostics/backendLifecycleStore';

export type JarvisSessionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface JarvisLiveKitState {
  sessionState: JarvisSessionState;
  isConnected: boolean;
  isConnecting: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isSuspended: boolean;
  errorMsg: string | null;
  micTrackCount: number;
  roomName: string | null;
}

const TAG = '[JARVIS_LIVEKIT_SESSION]';

/**
 * The ONE canonical Jarvis voice room.
 *
 * AgenticOS runs a single persistent Jarvis voice runtime, so every UI surface
 * (JarvisStudio, PersistentJarvisDock, JarvisDrawer) must join this same room. The
 * previous per-session name (`jarvis-room-${Date.now()}`) split that one runtime into
 * many competing agents and made "all surfaces share one session" impossible, since
 * two surfaces starting voice would land in two different rooms.
 *
 * Conversation isolation is carried by conversationId / turnId / participant identity —
 * never by the room name. Changing conversation must NOT require replacing the room.
 *
 * Must stay in agreement with the server default:
 *   server/src/domains/jarvisNext/tokenService.ts  (defaultRoom)
 *   server/src/routers/jarvisNext.ts               (targetRoom fallback)
 */
export const JARVIS_CANONICAL_ROOM = 'jarvis-next-main';

export class JarvisLiveKitSession {
  private room: Room | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private playbackAudioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private analyserSource: MediaStreamAudioSourceNode | null = null;
  private sessionState: JarvisSessionState = 'disconnected';
  private isSpeaking = false;
  private isListening = false;
  private isSuspended = false;
  private errorMsg: string | null = null;
  private micTrackCount = 0;
  private connectingPromise: Promise<boolean> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  private async waitForBackendReady(timeoutMs = 12000): Promise<boolean> {
    if (backendLifecycleStore.isReady()) {
      return true;
    }
    console.log(`${TAG} Backend not ready yet; awaiting readiness (max ${timeoutMs}ms)...`);
    const startTime = Date.now();
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      let timer: any = null;
      let unsub: (() => void) | null = null;
      const cleanup = () => {
        if (unsub) { unsub(); unsub = null; }
        if (timer) { clearTimeout(timer); timer = null; }
      };
      const checkAndResolve = () => {
        if (backendLifecycleStore.isReady()) {
          if (!resolved) {
            resolved = true;
            cleanup();
            console.log(`${TAG} Backend became ready after ${Date.now() - startTime}ms`);
            resolve(true);
          }
        }
      };
      unsub = backendLifecycleStore.subscribe(checkAndResolve);
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(backendLifecycleStore.isReady());
        }
      }, timeoutMs);
      checkAndResolve();
    });
  }
  private listeners: Set<() => void> = new Set();
  private dataListeners: Set<(data: any) => void> = new Set();

  getState(): JarvisLiveKitState {
    return {
      sessionState: this.sessionState,
      isConnected: this.sessionState === 'connected',
      isConnecting: this.sessionState === 'connecting',
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      isSuspended: this.isSuspended,
      errorMsg: this.errorMsg,
      micTrackCount: this.micTrackCount,
      roomName: this.room?.name || null,
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

  private teardownAnalyser() {
    try {
      this.analyserSource?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.analyserNode?.disconnect();
    } catch {
      // ignore
    }
    this.analyserSource = null;
    this.analyserNode = null;
  }

  /**
   * Current RMS energy (0..1) of the remote Jarvis audio, measured from the analyser tap.
   * Returns null when no remote audio graph is active. Diagnostic use only — the analyser
   * is not connected to the output, so calling this never affects playback.
   */
  getRemoteAudioEnergy(): number | null {
    const analyser = this.analyserNode;
    if (!analyser) return null;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    return Math.sqrt(sumSq / buf.length);
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

    // Metering ONLY. The HTMLAudioElement above is the single canonical audible path.
    // Connecting this graph to ctx.destination as well rendered the same MediaStream twice
    // concurrently; the two slightly offset copies comb-filtered into a metallic/phasey voice.
    // The analyser observes the stream without producing a second audible output.
    this.teardownAnalyser();
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
        const analyser = this.playbackAudioContext.createAnalyser();
        analyser.fftSize = 2048;
        streamSource.connect(analyser); // deliberately NOT connected to ctx.destination
        this.analyserSource = streamSource;
        this.analyserNode = analyser;
        console.log(`[JFE-AUDIO] WEBAUDIO_ANALYSER_ONLY state=${this.playbackAudioContext.state} audiblePaths=1`);
      }
    } catch (webaudioErr: any) {
      console.warn('[JFE-AUDIO] WEBAUDIO_ANALYSER_ERROR', webaudioErr?.message || webaudioErr);
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

    // Task 10: Backend readiness check before initiating voice token request
    const isBackendReady = await this.waitForBackendReady(12000);
    if (!isBackendReady) {
      console.warn(`${TAG} backend not ready after 12s, aborting connection attempt`);
      this.errorMsg = 'Backend offline: AgenticOS backend is not ready on port 4600. Please wait for startup or click Retry.';
      this.sessionState = 'error';
      this.notify();
      return false;
    }

    // Create persistent audio element upfront (Task 1: ONE audio element for full session)
    let audioEl = this.ensureAudioElement();

    if (!audioEl) {
      console.error(`${TAG} [JARVIS_AUDIO] createFailed — no audio element available`);
      this.errorMsg = 'Audio initialization failed: Browser DOM audio element could not be created.';
      this.sessionState = 'error';
      this.notify();
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

      const res = await apiFetch('/api/jarvis-next/token', {
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
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
        this.errorMsg = 'Backend unreachable: failed to fetch voice token from http://127.0.0.1:4600. Backend service may be restarting.';
      } else {
        this.errorMsg = `Token request failed: ${msg}`;
      }
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
        this.teardownAnalyser();
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

        if (data.type === 'stop_playback' || data.type === 'interrupt' || data.type === 'stop_speaking' || data.type === 'stop') {
          console.log(`[JFE-AUDIO] STOP/BARGE_IN packet received (type=${data.type}), immediately halting audio and returning to READY / LISTENING`);
          if (this.audioElement) {
            try {
              this.audioElement.pause();
              this.audioElement.currentTime = 0;
              this.audioElement.muted = true;
            } catch {}
          }
          this.isSpeaking = false;
          this.isSuspended = false;
          this.isListening = true;
          this.notify();
        } else if (data.type === 'provisional_barge_in' || data.state === 'barge_in_pending') {
          console.log(`[JFE-AUDIO] PROVISIONAL_BARGE_IN packet received — halting audio playout immediately during barge-in pending.`);
          if (this.audioElement) {
            try {
              this.audioElement.pause();
              this.audioElement.currentTime = 0;
              this.audioElement.muted = true;
            } catch {}
          }
          this.isSpeaking = false;
          this.notify();
        } else if (data.isSuspended === true || data.state === 'suspended') {
          console.log(`[JFE-AUDIO] Suspended packet received, halting audio`);
          if (this.audioElement) {
            try {
              this.audioElement.pause();
              this.audioElement.currentTime = 0;
              this.audioElement.muted = true;
            } catch {}
          }
          this.isSpeaking = false;
          this.isSuspended = true;
          this.isListening = false;
          this.notify();
        } else if (data.type === 'status') {
          if (typeof data.isSuspended === 'boolean') {
            this.isSuspended = data.isSuspended;
            if (this.isSuspended) {
              this.isSpeaking = false;
              this.isListening = false;
              if (this.audioElement) {
                try {
                  this.audioElement.pause();
                  this.audioElement.currentTime = 0;
                  this.audioElement.muted = true;
                } catch {}
              }
            }
          }
          if (typeof data.isSpeaking === 'boolean') {
            this.isSpeaking = this.isSuspended ? false : data.isSpeaking;
            if (this.isSpeaking && this.audioElement && !this.isSuspended) {
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
            } else if (!data.isSpeaking && this.audioElement) {
              try {
                this.audioElement.pause();
                this.audioElement.currentTime = 0;
              } catch {}
            }
          }
          if (typeof data.isListening === 'boolean') {
            this.isListening = this.isSuspended ? false : data.isListening;
          }
          this.notify();
        } else if (data.type === 'assistant_text') {
          if (this.audioElement && !this.isSuspended) {
            this.audioElement.muted = false;
            this.audioElement.volume = 1.0;
            this.audioElement.play().then(() => {
              console.log('[JFE-AUDIO] PLAY_RESOLVED (on assistant_text)');
            }).catch((err) => {
              console.warn('[JFE-AUDIO] PLAY_REJECTED (on assistant_text)', err?.message || String(err));
            });
          }
          if (this.playbackAudioContext && this.playbackAudioContext.state === 'suspended' && !this.isSuspended) {
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
      if (msg.includes('Could not establish PC connection') || msg.includes('could not connect') || msg.includes('timeout')) {
        this.errorMsg = `LiveKit connection failed: Could not establish WebRTC peer connection to ${wsUrl}. LiveKit server may be restarting.`;
      } else {
        this.errorMsg = `LiveKit connect failed: ${msg}`;
      }
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
        this.audioElement.muted = true;
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
      await apiFetch('/api/jarvis-next/agent/interrupt', { method: 'POST' });
    } catch {
      // ignore
    }
  }

  async stopSession(): Promise<void> {
    console.log(`${TAG} stopSession called`);
    this.teardownAnalyser();
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

  async sendData(data: Record<string, unknown>): Promise<boolean> {
    if (!this.room?.localParticipant) {
      console.warn(`${TAG} sendData failed: room or localParticipant not available`);
      return false;
    }
    try {
      const payload = new TextEncoder().encode(JSON.stringify(data));
      await this.room.localParticipant.publishData(payload, { reliable: true });
      return true;
    } catch (err) {
      console.error(`${TAG} sendData error:`, err);
      return false;
    }
  }
}

export const jarvisLiveKitSession = new JarvisLiveKitSession();
