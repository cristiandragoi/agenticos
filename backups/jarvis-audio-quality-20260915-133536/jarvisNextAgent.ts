import fs from 'node:fs';
import path from 'node:path';
import {
  Room,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  RemoteTrack,
  RemoteParticipant,
  RoomEvent,
} from '@livekit/rtc-node';
import { LIVEKIT_CONFIG, generateAgentToken } from './tokenService.js';
import { mp3ToPcmFrames, pcmChunksToWav } from './audioUtils.js';
import { synthesizeLocally } from '../../services/voice/localTts.js';
import { transcribeLocally } from '../../services/voice/localTranscribe.js';
import { operatorController } from './operator/operatorController.js';
import { llmChat } from '../../services/llmGateway.js';
import { logger } from '../../utils/logger.js';
import { ensureLivekitServerRunning } from './livekitServerManager.js';

const JRT_TRACE_FILE = 'D:\\AgenticOS\\data\\jarvis-runtime-trace.log';

export function logJRT(marker: string, details: string = ''): void {
  const ts = new Date().toISOString();
  const line = details ? `${ts} [JRT] ${marker} ${details}` : `${ts} [JRT] ${marker}`;
  logger.info(`[JRT] ${marker}${details ? ' ' + details : ''}`);
  try {
    const dir = path.dirname(JRT_TRACE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(JRT_TRACE_FILE, line + '\n', 'utf8');
  } catch (err: any) {
    logger.warn('[JRT] Failed to write trace to file:', err?.message);
  }
}

export interface JarvisNextStatus {
  connected: boolean;
  roomName: string | null;
  isSpeaking: boolean;
  isListening: boolean;
  totalBargeIns: number;
  lastUserText: string | null;
  lastAssistantText: string | null;
  legacyVoiceActive: boolean;
  activeMicOwners: number;
  activeVoiceOwners: number;
}

export class JarvisNextAgent {
  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private currentRoomName: string | null = null;

  // Independent Lifecycle & Cancellation Tracking
  private currentUserTurnId = 0;
  private currentAssistantPlayoutId = 0;
  private isSynthesizing = false;
  private isSpeaking = false;
  private isListening = false;
  private isProcessingUserTurn = false;
  private totalBargeIns = 0;
  private lastUserText: string | null = null;
  private lastAssistantText: string | null = null;

  // Playout timing & barge-in detection
  private speechStartTime = 0;
  private consecutiveBargeInFrames = 0;

  // Pre-roll ring buffer and continuous utterance audio capture
  private activeStreams: AudioStream[] = [];
  private preRollBuffer: Buffer[] = [];
  private readonly PRE_ROLL_MAX_FRAMES = 20; // ~400ms at 20ms/frame
  private speechFrames: Buffer[] = [];
  private silenceTimeout: NodeJS.Timeout | null = null;
  private isAccumulatingSpeech = false;
  private lastFrameSampleRate = 24000;
  private lastFrameChannels = 1;
  private hasReceivedFirstFrame = false;
  private lastRmsLogTime = 0;
  public maxObservedRms = 0;

  // Calibrated voice activity thresholds
  private readonly SPEECH_START_THRESHOLD = 900;
  private readonly SPEECH_CONTINUE_THRESHOLD = 450;
  private readonly BARGE_IN_THRESHOLD = 5000;
  private readonly BARGE_IN_GRACE_MS = 600;
  private readonly SILENCE_DURATION_MS = 850;

  private startingPromise: Promise<void> | null = null;
  private isReady = false;
  private subscribedTrackSids: Set<string> = new Set();

  public getStatus(): JarvisNextStatus {
    return {
      connected: this.room ? this.room.isConnected : false,
      roomName: this.currentRoomName,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      totalBargeIns: this.totalBargeIns,
      lastUserText: this.lastUserText,
      lastAssistantText: this.lastAssistantText,
      legacyVoiceActive: false,
      activeMicOwners: 1,
      activeVoiceOwners: this.isSpeaking ? 1 : 0,
    };
  }

  public async waitForReady(roomName: string = LIVEKIT_CONFIG.defaultRoom, timeoutMs: number = 10000): Promise<void> {
    if (this.isReady && this.room && this.room.isConnected && this.currentRoomName === roomName) {
      logger.info('[JarvisNext] Agent is already ready in room:', roomName);
      return;
    }

    if (!this.startingPromise) {
      this.startingPromise = this.start(roomName);
    }

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`AGENT_READY_TIMEOUT: Jarvis agent failed to become ready for room ${roomName} within ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([this.startingPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public start(roomName: string = LIVEKIT_CONFIG.defaultRoom): Promise<void> {
    if (this.isReady && this.room && this.room.isConnected && this.currentRoomName === roomName) {
      logger.info('[JarvisNext] Agent already connected to room:', roomName);
      return Promise.resolve();
    }

    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = this.startInternal(roomName).finally(() => {
      this.startingPromise = null;
    });

    return this.startingPromise;
  }

  private async startInternal(roomName: string): Promise<void> {
    this.isReady = false;
    logJRT('AGENT_STARTING', `room=${roomName}`);

    if (this.room) {
      await this.stop();
    }

    // Guarantee LiveKit server is running before connecting
    await ensureLivekitServerRunning();

    this.hasReceivedFirstFrame = false;
    this.lastRmsLogTime = 0;
    this.maxObservedRms = 0;
    this.subscribedTrackSids.clear();

    this.currentRoomName = roomName;
    const token = await generateAgentToken(roomName);

    logger.info('[JarvisNext] Connecting agent to LiveKit room:', roomName);
    const room = new Room();
    this.room = room;

    // Create 24kHz audio source for Jarvis voice
    this.audioSource = new AudioSource(24000, 1);
    this.localTrack = LocalAudioTrack.createAudioTrack('jarvis-assistant-voice', this.audioSource);

    // Setup room listeners
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _: any, participant: RemoteParticipant) => {
      logger.info('[JarvisNext] Remote track subscribed:', {
        kind: track.kind,
        participant: participant.identity,
        sid: track.sid,
      });

      if (track.kind === 1 /* Audio */) {
        const sid = track.sid || '';
        if (!this.subscribedTrackSids.has(sid)) {
          logJRT('AUDIO_TRACK_SUBSCRIBED', `participant=${participant.identity} kind=audio sid=${sid}`);
          this.handleIncomingAudioTrack(track, participant);
        }
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      logger.info('[JarvisNext] Remote track unsubscribed:', track.sid);
      if (track.sid) {
        this.subscribedTrackSids.delete(track.sid);
      }
    });

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      logger.info('[JarvisNext] User connected to room:', participant.identity);
      logJRT('PARTICIPANT_CONNECTED', `participant=${participant.identity} room=${this.currentRoomName || ''}`);
      // Greet user on join
      setTimeout(() => {
        if (!this.isSpeaking && !this.isSynthesizing && this.room?.isConnected) {
          this.speak('Hello! Jarvis is online on LiveKit with zero cloud cost. How can I help you?');
        }
      }, 500);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      logger.info('[JarvisNext] User disconnected from room:', participant.identity);
      logJRT('PARTICIPANT_DISCONNECTED', `participant=${participant.identity} room=${this.currentRoomName || ''}`);
    });

    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
      try {
        const text = new TextDecoder().decode(payload);
        logger.info('[JarvisNext] Data message received from user:', { text, participant: participant?.identity });
        const data = JSON.parse(text);
        if (data.type === 'barge_in' || data.type === 'interrupt' || data.type === 'stop_speaking') {
          this.interrupt('client_data_channel');
        } else if (data.type === 'user_text' && data.text) {
          this.handleUserText(data.text);
        }
      } catch {
        // Not JSON data
      }
    });

    await room.connect(LIVEKIT_CONFIG.wsUrl, token);
    logger.info('[JarvisNext] Agent connected successfully to room:', roomName);
    logJRT('AGENT_CONNECTED', `room=${roomName}`);

    // Publish assistant audio track
    if (!room.localParticipant) {
      throw new Error('Failed to acquire localParticipant after room connect');
    }
    const opts = new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE });
    await room.localParticipant.publishTrack(this.localTrack, opts);
    logger.info('[JarvisNext] Assistant audio track published.');
    this.isListening = true;

    // Phase 4: Handle existing participants & tracks already present upon joining
    for (const [_, participant] of room.remoteParticipants) {
      logger.info('[JarvisNext] Existing participant found on connect:', participant.identity);
      logJRT('PARTICIPANT_CONNECTED', `participant=${participant.identity} room=${this.currentRoomName || ''}`);
      for (const [_, publication] of participant.trackPublications) {
        if (publication.kind === 1 /* Audio */) {
          if (!publication.subscribed) {
            try {
              publication.setSubscribed(true);
            } catch (subErr: any) {
              logger.warn('[JarvisNext] Failed to setSubscribed on existing track publication:', subErr?.message);
            }
          }
          if (publication.track) {
            const sid = publication.track.sid || publication.sid || '';
            if (!this.subscribedTrackSids.has(sid)) {
              logger.info('[JarvisNext] Subscribing to existing audio track:', sid);
              logJRT('AUDIO_TRACK_SUBSCRIBED', `participant=${participant.identity} kind=audio sid=${sid}`);
              this.handleIncomingAudioTrack(publication.track as RemoteTrack, participant);
            }
          }
        }
      }
    }

    this.isReady = true;
    logJRT('AGENT_READY', `room=${roomName}`);
    logJRT('ROOM_AGENT_STARTED', `room=${roomName}`);

    this.broadcastData({
      type: 'status',
      state: 'listening',
      isSpeaking: false,
      isListening: true,
    });
  }

  private handleIncomingAudioTrack(track: RemoteTrack, participant: RemoteParticipant): void {
    const sid = track.sid || '';
    if (sid && this.subscribedTrackSids.has(sid)) {
      logger.info('[JarvisNext] Track already subscribed, skipping duplicate:', sid);
      return;
    }
    if (sid) {
      this.subscribedTrackSids.add(sid);
    }
    try {
      // Resample to 24kHz mono natively via rtc-node AudioStream
      const stream = new AudioStream(track, { sampleRate: 24000, numChannels: 1 });
      this.activeStreams.push(stream);

      (async () => {
        for await (const frame of stream) {
          this.processUserAudioFrame(frame);
        }
      })().catch((err) => {
        logger.debug('[JarvisNext] AudioStream closed or errored:', err?.message);
      });
    } catch (err: any) {
      logger.error('[JarvisNext] Failed to create AudioStream:', err);
    }
  }

  private processUserAudioFrame(frame: any): void {
    if (frame.sampleRate) this.lastFrameSampleRate = frame.sampleRate;
    if (frame.channels) this.lastFrameChannels = frame.channels;

    const samples = frame.data;
    if (!samples || samples.length === 0) return;

    if (!this.hasReceivedFirstFrame) {
      this.hasReceivedFirstFrame = true;
      logJRT('AUDIO_FIRST_FRAME', `sampleRate=${frame.sampleRate || this.lastFrameSampleRate} channels=${frame.channels || this.lastFrameChannels}`);
    }

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);

    if (rms > this.maxObservedRms) {
      this.maxObservedRms = rms;
    }

    const now = Date.now();
    if (now - this.lastRmsLogTime >= 1000) {
      this.lastRmsLogTime = now;
      logJRT('AUDIO_LEVEL', `rms=${Math.round(rms)}`);
    }

    // Maintain circular pre-roll buffer (~400ms)
    // Own the bytes: the native capture buffer may be reused after this frame.
    const pcmBytes = Buffer.from(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    this.preRollBuffer.push(pcmBytes);
    if (this.preRollBuffer.length > this.PRE_ROLL_MAX_FRAMES) {
      this.preRollBuffer.shift();
    }

    // CASE A: Assistant is physically outputting audio to speakers
    if (this.isSpeaking) {
      const timeSinceSpeechStarted = Date.now() - this.speechStartTime;
      if (timeSinceSpeechStarted > this.BARGE_IN_GRACE_MS && rms > this.BARGE_IN_THRESHOLD) {
        this.consecutiveBargeInFrames++;
        if (this.consecutiveBargeInFrames >= 5) {
          logger.info('[JarvisNext] Sustained user speech detected during playout -> BARGE-IN TRIGGERED');
          this.interruptAssistantPlayout('barge_in');
          // Immediately start capturing user utterance from pre-roll
          this.isAccumulatingSpeech = true;
          logJRT('SPEECH_START', `rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD} reason=barge_in`);
          this.speechFrames = [...this.preRollBuffer];
          this.consecutiveBargeInFrames = 0;
        }
      } else {
        this.consecutiveBargeInFrames = 0;
      }
      return;
    }

    // Reset barge-in frames when not speaking
    this.consecutiveBargeInFrames = 0;

    // CASE B: Assistant is NOT speaking (idle, listening, or synthesizing)
    if (!this.isAccumulatingSpeech) {
      if (this.isProcessingUserTurn) {
        // Jarvis is actively transcribing, reasoning via Codex, or synthesizing speech.
        // Gate microphone frames so ambient sound or thinking-out-loud does not cancel the in-flight answer.
        return;
      }

      if (rms >= this.SPEECH_START_THRESHOLD) {
        // User speech onset: prepend pre-roll buffer so initial phonemes/consonants are preserved
        this.isAccumulatingSpeech = true;
        logJRT('SPEECH_START', `rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD}`);
        this.speechFrames = [...this.preRollBuffer];
        if (this.silenceTimeout) {
          clearTimeout(this.silenceTimeout);
          this.silenceTimeout = null;
        }
      }
    } else {
      // User utterance in progress - ALWAYS record frame to capture quiet phonemes & intra-sentence pauses
      this.speechFrames.push(pcmBytes);

      if (rms >= this.SPEECH_CONTINUE_THRESHOLD) {
        // Active voice energy - reset silence timer
        if (this.silenceTimeout) {
          clearTimeout(this.silenceTimeout);
          this.silenceTimeout = null;
        }
      } else {
        // Voice dipped into pause/silence
        if (!this.silenceTimeout) {
          this.silenceTimeout = setTimeout(() => {
            logJRT('SPEECH_END', `frames=${this.speechFrames.length}`);
            this.commitUserTurn();
          }, this.SILENCE_DURATION_MS);
        }
      }
    }
  }

  public interrupt(reason = 'user_request'): void {
    // Invalidate pending transcription/reasoning, while allowing the next utterance.
    this.currentUserTurnId++;
    this.isProcessingUserTurn = false;
    this.interruptAssistantPlayout(reason);
  }

  public interruptAssistantPlayout(reason = 'unknown'): void {
    logger.info(`[JarvisNext] Assistant playout interrupted (${reason}). Halting speech immediately.`);
    this.currentAssistantPlayoutId++;
    this.isSpeaking = false;
    this.isSynthesizing = false;
    this.totalBargeIns++;
    this.consecutiveBargeInFrames = 0;

    try {
      (this.audioSource as any)?.clearQueue?.();
    } catch {
      // ignore
    }

    this.broadcastData({
      type: 'status',
      state: 'listening',
      isSpeaking: false,
      isListening: true,
    });
  }

  private async commitUserTurn(): Promise<void> {
    this.isAccumulatingSpeech = false;
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    const recordedFrames = [...this.speechFrames];
    this.speechFrames = [];

    // Ignore short clicks or transients (< 200ms)
    if (recordedFrames.length < 10) {
      return;
    }

    // A recording is not yet a valid user turn. Silence must not cancel a reply.
    const turnId = this.currentUserTurnId;
    this.isProcessingUserTurn = true;
    logJRT('COMMIT_TURN_BEGIN', `turn=${turnId} frames=${recordedFrames.length}`);
    logger.info(`[JarvisNext] User turn #${turnId} completed. Processing recorded frames:`, recordedFrames.length);
    this.broadcastData({
      type: 'status',
      state: 'thinking',
      isSpeaking: false,
      isListening: true,
    });

    try {
      if (!this.audioSource || !this.room?.isConnected) {
        logger.warn('[JarvisNext] Audio source unavailable during turn commit');
        this.isProcessingUserTurn = false;
        return;
      }

      const wavBuffer = pcmChunksToWav(recordedFrames, this.lastFrameSampleRate, this.lastFrameChannels);
      logJRT('WAV_READY', `turn=${turnId} bytes=${wavBuffer.length}`);

      logJRT('STT_BEGIN', `turn=${turnId}`);
      const transcribeResult = await transcribeLocally(wavBuffer, '.wav', 'en');
      const text = transcribeResult.text?.trim();

      if (!text) {
        logJRT('STT_EMPTY', `turn=${turnId}`);
      } else {
        logJRT('STT_RESULT', `text_length=${text.length} turn=${turnId}`);
      }

      // Check if a newer user turn was committed while Whisper was transcribing
      if (this.currentUserTurnId !== turnId) {
        logger.info(`[JarvisNext] User turn #${turnId} superseded by turn #${this.currentUserTurnId}.`);
        this.isProcessingUserTurn = false;
        return;
      }

      const cleanText = (text || '').replace(/[^\p{L}\p{N}]/gu, '').trim();

      if (cleanText.length >= 2) {
        logJRT('TRANSCRIPT_ACCEPTED', `turn=${turnId} text_length=${text.length}`);
        const acceptedTurnId = ++this.currentUserTurnId;
        this.interruptAssistantPlayout('accepted_user_turn');
        logger.info(`[JarvisNext] Transcribed user speech (turn #${turnId}):`, text);
        this.lastUserText = text;

        // Broadcast transcript to UI
        this.broadcastData({
          type: 'transcript',
          text,
          isFinal: true,
        });
        logJRT('TRANSCRIPT_BROADCAST', `turn=${turnId}`);

        await this.handleUserText(text, acceptedTurnId);
      } else {
        logJRT('TRANSCRIPT_REJECTED', `clean_length=${cleanText.length} text="${text || ''}" turn=${turnId}`);
        logger.info(`[JarvisNext] Ignoring noise/trivial transcript (turn #${turnId}):`, text);
        this.isProcessingUserTurn = false;
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      }
    } catch (err: any) {
      logJRT('STT_ERROR', `${err?.message || err} turn=${turnId}`);
      logger.warn(`[JarvisNext] Local transcription error on turn #${turnId}:`, err?.message);
      if (this.currentUserTurnId === turnId) {
        this.isProcessingUserTurn = false;
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      }
    }
  }

  public async handleUserText(text: string, turnId?: number): Promise<void> {
    const activeTurnId = turnId ?? ++this.currentUserTurnId;
    this.lastUserText = text;
    logJRT('HANDLE_USER_TEXT_BEGIN', `turn=${activeTurnId} text_length=${text.length}`);
    logger.info(`[JarvisNext] Handling conversational turn #${activeTurnId} for text:`, text);

    const lower = text.toLowerCase().trim();

    // Fast local conversational paths
    if (/^(?:(?:hey\s+)?jarvis[, ]+)?(?:please\s+)?(?:stop(?:\s+(?:speaking|talking))?|be quiet|halt|cancel)[.!? ]*$/i.test(lower)) {
      this.interrupt('user_stop_command');
      return;
    }

    // 1. Check Operator Controller for deterministic mission/project execution
    try {
      const opResult = await operatorController.handleIntent(text);
      if (this.currentUserTurnId !== activeTurnId) {
        logger.info(`[JarvisNext] Turn cancelled: stale check failed on Operator path.`);
        return;
      }

      if (opResult.handled && opResult.response) {
        logger.info('[JarvisNext] Operator handled intent:', { intent: opResult.intent, missionId: opResult.missionId });
        this.lastAssistantText = opResult.response;
        this.broadcastData({ type: 'assistant_text', text: opResult.response });
        await this.speak(opResult.response);
        logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
        return;
      }
    } catch (opErr) {
      logger.warn('[JarvisNext] Operator handle error:', opErr);
    }

    if (this.currentUserTurnId !== activeTurnId) {
      logger.info(`[JarvisNext] Turn cancelled: stale check failed after Operator.`);
      return;
    }

    if (lower.includes('who are you') || lower.includes('what are you')) {
      const intro = 'I am Jarvis, your autonomous AI desktop operating assistant on LiveKit.';
      this.broadcastData({ type: 'assistant_text', text: intro });
      await this.speak(intro);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
      return;
    }

    if (lower.includes('hello') || lower.includes('hi jarvis') || lower.includes('hey jarvis')) {
      const greeting = 'Good day! I am fully operational and ready to assist you.';
      this.broadcastData({ type: 'assistant_text', text: greeting });
      await this.speak(greeting);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
      return;
    }

    // 2. Primary Route: Route reasoning through configured Codex Integration via llmChat
    this.broadcastData({ type: 'status', state: 'thinking', isSpeaking: false, isListening: true });
    try {
      logJRT('LLM_BEGIN', `turn=${activeTurnId}`);
      const chatResult = await llmChat({
        agentId: 'agent-jarvis',
        systemPrompt:
          'You are Jarvis, an advanced AI desktop operating assistant on AgenticOS. This voice session is in English. Reply in English. You are speaking directly to the user over voice. Respond concisely and clearly in 1 to 2 natural sentences without markdown, asterisks, code blocks, or bullet lists.',
        prompt: text,
      });

      if (this.currentUserTurnId !== activeTurnId) {
        logger.info(`[JarvisNext] Turn cancelled: stale check failed on LLM path.`);
        return;
      }

      const reply = chatResult.reply?.trim();
      if (reply) {
        logJRT('LLM_RESULT', `turn=${activeTurnId} provider=${chatResult.provider} length=${reply.length}`);
        logger.info(`[JarvisNext] Codex reasoning reply received (turn #${activeTurnId}):`, {
          provider: chatResult.provider,
          model: chatResult.model,
          length: reply.length,
        });
        this.lastAssistantText = reply;
        this.broadcastData({ type: 'assistant_text', text: reply });
        await this.speak(reply);
        logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
        return;
      } else {
        logger.warn(`[JarvisNext] LLM returned empty content on turn #${activeTurnId}.`);
      }
    } catch (err: any) {
      logJRT('LLM_ERROR', `${err?.message || err} turn=${activeTurnId}`);
      logger.warn(`[JarvisNext] llmChat error on turn #${activeTurnId} (${err?.message}), using fallback.`);
    }

    if (this.currentUserTurnId !== activeTurnId) {
      return;
    }

    const fallbackReply = 'I could not get a response from the reasoning service. Please try again.';
    this.broadcastData({ type: 'assistant_text', text: fallbackReply });
    await this.speak(fallbackReply);
    logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
  }

  public async speak(text: string): Promise<void> {
    if (!this.audioSource || !this.room?.isConnected) {
      logger.warn('[JarvisNext] Cannot speak: audio source not ready or room disconnected.');
      this.isProcessingUserTurn = false;
      return;
    }

    const playoutId = ++this.currentAssistantPlayoutId;
    this.lastAssistantText = text;
    this.isSynthesizing = true;
    this.isSpeaking = false;

    this.broadcastData({
      type: 'status',
      state: 'thinking',
      isSpeaking: false,
      isListening: true,
      text,
    });

    logJRT('TTS_BEGIN', `playout=${playoutId} text_length=${text.length}`);
    logger.info(`[JarvisNext] Synthesizing speech (playout #${playoutId}):`, text);

    try {
      // Synthesize locally using edge-tts (RyanNeural)
      const mp3Buffer = await synthesizeLocally(text);

      if (this.currentAssistantPlayoutId !== playoutId) {
        logger.info(`[JarvisNext] Speech synthesis aborted before audio decode (playout #${playoutId}).`);
        this.isProcessingUserTurn = false;
        return;
      }

      // Convert MP3 to 24kHz raw PCM frames
      const frames = await mp3ToPcmFrames(mp3Buffer, 24000, 20);

      if (this.currentAssistantPlayoutId !== playoutId) {
        logger.info(`[JarvisNext] Speech playout cancelled before frame transmission (playout #${playoutId}).`);
        this.isProcessingUserTurn = false;
        return;
      }

      logJRT('TTS_AUDIO_READY', `playout=${playoutId} frames=${frames.length}`);

      this.isSynthesizing = false;
      this.isSpeaking = true;
      this.speechStartTime = Date.now();
      this.consecutiveBargeInFrames = 0;

      this.broadcastData({
        type: 'status',
        state: 'speaking',
        isSpeaking: true,
        isListening: true,
        text,
      });

      logger.info(`[JarvisNext] Playing ${frames.length} audio frames to LiveKit room (playout #${playoutId})...`);

      for (let i = 0; i < frames.length; i++) {
        if (
          this.currentAssistantPlayoutId !== playoutId ||
          !this.room?.isConnected ||
          !this.audioSource
        ) {
          logger.info(`[JarvisNext] Speech playout aborted mid-stream (playout #${playoutId})!`);
          break;
        }

        try {
          await this.audioSource.captureFrame(frames[i]);
        } catch (frameErr: any) {
          logger.warn('[JarvisNext] AudioSource.captureFrame error:', frameErr?.message);
          break;
        }

        // 20ms frame pacing
        await new Promise((resolve) => setTimeout(resolve, 19));
      }

      logJRT('TTS_PUBLISHED', `playout=${playoutId} frames=${frames.length}`);
    } catch (err: any) {
      logger.error(`[JarvisNext] Speech error on playout #${playoutId}:`, err);
    } finally {
      if (this.currentAssistantPlayoutId === playoutId) {
        this.isSynthesizing = false;
        this.isSpeaking = false;
        setTimeout(() => {
          if (this.currentAssistantPlayoutId === playoutId) {
            this.isProcessingUserTurn = false;
          }
        }, 400);
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      }
    }
  }

  public broadcastData(payload: Record<string, unknown>): void {
    if (!this.room?.localParticipant) return;
    try {
      const json = JSON.stringify(payload);
      const data = new TextEncoder().encode(json);
      void this.room.localParticipant.publishData(data, { reliable: true }).catch((err: any) => {
        logger.debug('[JarvisNext] Failed to broadcast data message:', err?.message);
      });
    } catch (err: any) {
      logger.debug('[JarvisNext] Failed to broadcast data message:', err?.message);
    }
  }

  public async stop(): Promise<void> {
    logJRT('STOP_SESSION_BEGIN', `room=${this.currentRoomName || ''}`);
    this.isListening = false;
    this.isSpeaking = false;
    this.isSynthesizing = false;
    this.isAccumulatingSpeech = false;
    this.isProcessingUserTurn = false;
    this.currentAssistantPlayoutId++;
    this.currentUserTurnId++;

    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    this.activeStreams = [];
    this.preRollBuffer = [];
    this.speechFrames = [];

    if (this.room) {
      logJRT('ROOM_DISCONNECT', `room=${this.currentRoomName || ''}`);
      try {
        await this.room.disconnect();
      } catch {
        // ignore
      }
      this.room = null;
    }

    this.audioSource = null;
    this.localTrack = null;
    this.currentRoomName = null;
    this.hasReceivedFirstFrame = false;
    this.isReady = false;
    this.startingPromise = null;
    this.subscribedTrackSids.clear();
    logger.info('[JarvisNext] Agent stopped.');
    logJRT('STOP_SESSION_COMPLETE');
  }
}

// Global singleton instance for the process
export const jarvisNextAgent = new JarvisNextAgent();
