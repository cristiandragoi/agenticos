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
import {
  evaluateVoiceInvariants,
  raiseVoiceInvariantIncident,
  persistOriginalGoalForRetry,
  takeOriginalGoalForRetry,
  voiceRecoveryAnnouncement,
  decideBargeIn,
  detectTruncation,
  buildEngineeringEvidencePack,
  type VoiceTurnEvidence,
} from './voiceRuntimeInvariants.js';
import { beginNavigation, completeNavigation } from '../../services/navigation/navigationTransactions.js';
import { authorizePreliminaryAck } from '../jarvis/perception/perceptionOperation.js';
import { mp3ToPcmFrames, pcmChunksToWav, isSelfHearingEcho } from './audioUtils.js';
import {
  synthesizeLocally,
  resolveAuthoritativeTtsTarget,
  AURA_TO_NEURAL_FALLBACK,
  DEFAULT_NEURAL_VOICE,
  GERMAN_DEEPGRAM_VOICE,
  isGermanVoiceId,
} from '../../services/voice/localTts.js';
import {
  transcribeLocally,
  cancelLocalTranscription,
  purgeObsoleteTranscriptions,
  type LocalTranscribeResult,
} from '../../services/voice/localTranscribe.js';
import { voiceRuntimeState } from '../../services/voice/VoiceRuntimeState.js';
import { getActiveLanguage } from '../../services/language/activeLanguageState.js';
import { operatorController } from './operator/operatorController.js';
import { logger } from '../../utils/logger.js';
import { getBuildIdentity } from '../../services/buildIdentity.js';
import { ensureLivekitServerRunning } from './livekitServerManager.js';
import { detectControlIntent, isLikelyControlAttempt } from './controlIntentDetector.js';
import { stripWakeWord } from './wakeWord.js';
import { voiceHealthMonitor } from './voiceHealthMonitor.js';
import { speechArbiter, SpeechPriority } from './speechArbiter.js';
import { getTimeAwareGreeting } from '../jarvis/fastLocalReplies.js';
import { AdaptiveTurnEndpoint } from './AdaptiveTurnEndpoint.js';
import { voicePipelineInstrumentation } from './VoicePipelineInstrumentation.js';
import { auditResponseTruthfulness } from '../controlPlane/JarvisConstitution.js';
import { authoritativeInteractionContext } from '../controlPlane/AuthoritativeInteractionContext.js';

const JRT_TRACE_FILE = path.join(process.env.AGENTICOS_DATA_DIR || path.join(process.cwd(), 'data'), 'jarvis-runtime-trace.log');

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
  isSuspended: boolean;
  state?: 'idle' | 'listening' | 'speaking' | 'thinking' | 'suspended';
  totalBargeIns: number;
  lastUserText: string | null;
  lastAssistantText: string | null;
  legacyVoiceActive: boolean;
  activeMicOwners: number;
  activeVoiceOwners: number;
}

export interface NavigationAckPayload {
  navigationId: string;
  success: boolean;
  actualRoute?: string;
  visibleEntityId?: string;
  error?: string;
}

export interface TurnLatencyRecord {
  turnId: number;
  speechEnd: number;              // speech_end
  finalTranscript: number;        // final_transcript
  intentReady: number;            // intent_ready
  toolStart?: number;             // tool_start
  firstLlmToken?: number;         // first_llm_token
  ttsFirstChunk: number;          // tts_first_chunk
  playbackFirstAudio: number;     // playback_first_audio
  playbackComplete: number;       // playback_complete
  speechEndToFirstAudioMs: number;
  totalTurnMs: number;
  route: string;
  status: 'ANSWERED' | 'EXECUTING' | 'REPAIRING' | 'BLOCKED' | 'FAILED';
  generationCompleteAt?: number;
  playbackCompleteAt?: number;
  voiceProvider?: string;
  immediateAckSpoken?: boolean;
}

export class VoiceLatencyTracker {
  private records: TurnLatencyRecord[] = [];

  public record(entry: TurnLatencyRecord): void {
    this.records.push(entry);
    if (this.records.length > 300) this.records.shift();
    logger.info(
      `[VoiceLatencyTracker] Turn #${entry.turnId} status=${entry.status} ` +
      `speechEndToFirstAudio=${entry.speechEndToFirstAudioMs}ms totalTurn=${entry.totalTurnMs}ms ` +
      `timestamps: [speech_end=${entry.speechEnd}, final_transcript=${entry.finalTranscript}, intent_ready=${entry.intentReady}, ` +
      `tool_start=${entry.toolStart || 0}, first_llm_token=${entry.firstLlmToken || 0}, tts_first_chunk=${entry.ttsFirstChunk}, ` +
      `playback_first_audio=${entry.playbackFirstAudio}, playback_complete=${entry.playbackComplete}] route=${entry.route}`
    );
  }

  public getStats(): {
    count: number;
    speechEndToFirstAudio: { p50: number; p95: number; min: number; max: number };
    totalTurn: { p50: number; p95: number; min: number; max: number };
    recent: TurnLatencyRecord[];
  } {
    if (this.records.length === 0) {
      return {
        count: 0,
        speechEndToFirstAudio: { p50: 0, p95: 0, min: 0, max: 0 },
        totalTurn: { p50: 0, p95: 0, min: 0, max: 0 },
        recent: [],
      };
    }
    const firstAudioList = this.records.map((r) => r.speechEndToFirstAudioMs).filter((l) => l > 0).sort((a, b) => a - b);
    const totalTurnList = this.records.map((r) => r.totalTurnMs).filter((l) => l > 0).sort((a, b) => a - b);

    const p50FirstAudio = firstAudioList.length > 0 ? firstAudioList[Math.floor(firstAudioList.length * 0.5)] : 0;
    const p95FirstAudio = firstAudioList.length > 0 ? firstAudioList[Math.min(Math.floor(firstAudioList.length * 0.95), firstAudioList.length - 1)] : 0;

    const p50Total = totalTurnList.length > 0 ? totalTurnList[Math.floor(totalTurnList.length * 0.5)] : 0;
    const p95Total = totalTurnList.length > 0 ? totalTurnList[Math.min(Math.floor(totalTurnList.length * 0.95), totalTurnList.length - 1)] : 0;

    return {
      count: this.records.length,
      speechEndToFirstAudio: {
        p50: p50FirstAudio,
        p95: p95FirstAudio,
        min: firstAudioList.length > 0 ? firstAudioList[0] : 0,
        max: firstAudioList.length > 0 ? firstAudioList[firstAudioList.length - 1] : 0,
      },
      totalTurn: {
        p50: p50Total,
        p95: p95Total,
        min: totalTurnList.length > 0 ? totalTurnList[0] : 0,
        max: totalTurnList.length > 0 ? totalTurnList[totalTurnList.length - 1] : 0,
      },
      recent: this.records.slice(-25),
    };
  }
}

export const voiceLatencyTracker = new VoiceLatencyTracker();

export class JarvisNextAgent {
  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private currentRoomName: string | null = null;

  // Independent Lifecycle & Cancellation Tracking
  private currentUserTurnId = 0;
  /** Set to true while a P1 user turn response is being synthesized/played. */
  private foregroundTurnActive = false;
  private currentAssistantPlayoutId = 0;
  // ── ONE SPOKEN RESPONSE PER TURN (ownership model) ─────────────────────
  // Root cause of mid-stream aborts (runtime evidence 2026-09-23, playouts
  // #19/#22/#27): speak() began with `++currentAssistantPlayoutId`, so EVERY
  // second speak — executor follow-up, P2/P3 arbiter event, acknowledgement —
  // implicitly cancelled whatever was playing and cut off the last words.
  // Now: the playout that is synthesizing/speaking OWNS the voice channel.
  // A new speak() never cancels it; secondary text is coalesced and played
  // as one merged follow-up after the owner genuinely finishes. Invalidation
  // of currentAssistantPlayoutId happens ONLY through the explicit paths:
  // interruptAssistantPlayout() (user barge-in / accepted turn / STOP) and
  // handleStopCommand() (cancellation / emergency).
  /** Turn whose playout currently owns the voice channel (null = free). */
  private speechOwnerTurnId: number | null = null;
  /** Secondary speech requested while the owner was playing. */
  private pendingCoalesced: Array<{ text: string; originTurnId: number; timestamp: number }> = [];
  /** Instance-level acknowledgment timer to prevent cross-turn leakages. */
  private currentAckTimer: NodeJS.Timeout | null = null;
  /** True while TurnLifecycleController owns the current voice turn. */
  private lifecycleRequestInFlight = false;
  /** Per-turn SPEAK_REQUEST instrumentation counter. */
  private speakRequestCount = new Map<number, number>();
  /** Persistent conversation for the voice session, so turns retain continuity. */
  private voiceConversationId: string | null = null;
  private isSynthesizing = false;
  private isSpeaking = false;
  private isListening = false;
  private isSuspended = false;
  private isProcessingUserTurn = false;
  private totalBargeIns = 0;
  private lastUserText: string | null = null;
  private lastAssistantText: string | null = null;
  private turnLatencyMap = new Map<number, Partial<TurnLatencyRecord>>();

  /**
   * RC1: playout ids that belong to a PRELIMINARY ACKNOWLEDGEMENT.
   * An acknowledgement is not the turn's answer. When its playout completes it
   * must NOT release the turn latch, reopen the microphone, or drain follow-ups:
   * the originating turn is still being routed and its real answer has to stay
   * associated with it. The answer's own playout releases the latch normally.
   */
  private preliminaryAckPlayoutIds = new Set<number>();

  // Explicit Microphone & Voice State Machine (§8)
  public micState: 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'JARVIS_SPEAKING' | 'BARGE_IN_PENDING' = 'IDLE';
  private vadTriggeredDuringTts = false;
  private sttTriggeredDuringTts = false;
  private interruptingAudioSource = 'none';
  private interruptingEventType = 'none';

  public setMicState(newState: 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'JARVIS_SPEAKING' | 'BARGE_IN_PENDING', reason?: string): void {
    const oldState = this.micState;
    if (oldState === newState) return;
    this.micState = newState;
    this.isListening = newState === 'LISTENING' || newState === 'BARGE_IN_PENDING';
    logJRT('MIC_STATE_TRANSITION', `${oldState} -> ${newState} reason=${reason || 'normal'}`);
    logger.info(`[JarvisNext] MIC_STATE_TRANSITION: ${oldState} -> ${newState} (${reason || 'normal'})`);
    this.broadcastData({
      type: 'status',
      state: newState.toLowerCase(),
      micState: newState,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      reason,
    });
  }

  private logSpeechLifecycle(record: {
    turnId: number;
    generationId: number;
    userSttText: string;
    responseTextFull: string;
    ttsInputText: string;
    ttsVoiceId: string;
    ttsProfile: string;
    ttsSynthStart: number;
    ttsSynthEnd: number;
    generatedAudioDurationMs: number;
    playbackRequest: number;
    playbackStart: number;
    playbackExpectedDurationMs: number;
    playbackActualDurationMs: number;
    playbackEnd: number;
    playbackCompleted: boolean;
    playbackAborted: boolean;
    playbackAbortReason: string;
    activeTurnAtPlaybackStart: number;
    activeTurnAtPlaybackEnd: number;
    micActiveDuringTts: boolean;
    vadTriggeredDuringTts: boolean;
    sttTriggeredDuringTts: boolean;
    interruptingAudioSource: string;
    interruptingEventType: string;
  }): void {
    const lines = [
      '================================================================================',
      'SPEECH_LIFECYCLE_TRACE:',
      `TURN_ID=${record.turnId}`,
      `GENERATION_ID=${record.generationId}`,
      `USER_STT_TEXT=${record.userSttText || 'none'}`,
      ``,
      `RESPONSE_TEXT_FULL=${record.responseTextFull.replace(/\r?\n/g, ' ')}`,
      `RESPONSE_TEXT_LENGTH=${record.responseTextFull.length}`,
      ``,
      `TTS_INPUT_TEXT=${record.ttsInputText.replace(/\r?\n/g, ' ')}`,
      `TTS_INPUT_LENGTH=${record.ttsInputText.length}`,
      `TTS_VOICE_ID=${record.ttsVoiceId}`,
      `TTS_PROFILE=${record.ttsProfile}`,
      ``,
      `TTS_SYNTH_START=${new Date(record.ttsSynthStart).toISOString()}`,
      `TTS_SYNTH_END=${new Date(record.ttsSynthEnd).toISOString()}`,
      `GENERATED_AUDIO_DURATION_MS=${record.generatedAudioDurationMs}`,
      ``,
      `PLAYBACK_REQUEST=${new Date(record.playbackRequest).toISOString()}`,
      `PLAYBACK_START=${new Date(record.playbackStart).toISOString()}`,
      `PLAYBACK_EXPECTED_DURATION_MS=${record.playbackExpectedDurationMs}`,
      `PLAYBACK_ACTUAL_DURATION_MS=${record.playbackActualDurationMs}`,
      `PLAYBACK_END=${new Date(record.playbackEnd).toISOString()}`,
      ``,
      `PLAYBACK_COMPLETED=${record.playbackCompleted}`,
      `PLAYBACK_ABORTED=${record.playbackAborted}`,
      `PLAYBACK_ABORT_REASON=${record.playbackAbortReason}`,
      ``,
      `ACTIVE_TURN_AT_PLAYBACK_START=${record.activeTurnAtPlaybackStart}`,
      `ACTIVE_TURN_AT_PLAYBACK_END=${record.activeTurnAtPlaybackEnd}`,
      ``,
      `MIC_ACTIVE_DURING_TTS=${record.micActiveDuringTts}`,
      `VAD_TRIGGERED_DURING_TTS=${record.vadTriggeredDuringTts}`,
      `STT_TRIGGERED_DURING_TTS=${record.sttTriggeredDuringTts}`,
      ``,
      `INTERRUPTING_AUDIO_SOURCE=${record.interruptingAudioSource}`,
      `INTERRUPTING_EVENT_TYPE=${record.interruptingEventType}`,
      '================================================================================'
    ].join('\n');
    console.log(`\n[JRT]\n${lines}\n`);
    logger.info('[JRT] SPEECH_LIFECYCLE_TRACE', { trace: lines });
  }

  // Voice & Speech Profile Configuration
  private currentVoiceId: string = 'aura-helios-en';
  private currentVoiceProfile: string = 'deep-jarvis';
  private currentRate: string | undefined = undefined;
  private currentPitch: string | undefined = undefined;

  constructor() {
    this.loadVoicePreferences();
  }

  private getVoicePreferencesPath(): string {
    return path.resolve(process.env.AGENTICOS_DATA_DIR || path.join(process.cwd(), 'data'), 'voicePreferences.json');
  }

  private loadVoicePreferences(): void {
    try {
      const p = this.getVoicePreferencesPath();
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const data = JSON.parse(raw);
        if (data.voiceId) this.currentVoiceId = data.voiceId;
        if (data.voiceProfile) this.currentVoiceProfile = data.voiceProfile;
        if (data.rate !== undefined) this.currentRate = data.rate;
        if (data.pitch !== undefined) this.currentPitch = data.pitch;
        try {
          if (this.currentVoiceId) voiceRuntimeState.setVoice(this.currentVoiceId);
        } catch {}
        logger.info('[JarvisNext] Loaded persisted voice preferences:', {
          voiceId: this.currentVoiceId,
          voiceProfile: this.currentVoiceProfile,
          rate: this.currentRate,
          pitch: this.currentPitch,
        });
      }
    } catch (e: any) {
      logger.warn('[JarvisNext] Failed to load voice preferences:', e?.message);
    }
  }

  private saveVoicePreferences(): void {
    try {
      const p = this.getVoicePreferencesPath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        p,
        JSON.stringify(
          {
            voiceId: this.currentVoiceId,
            voiceProfile: this.currentVoiceProfile,
            rate: this.currentRate,
            pitch: this.currentPitch,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf-8'
      );
    } catch (e: any) {
      logger.warn('[JarvisNext] Failed to save voice preferences:', e?.message);
    }
  }

  // Authoritative verified execution & response delivery tracking (§8)
  private lastVerifiedExecutionResult: {
    turnId: number;
    action: string;
    resultText: string;
    verified: boolean;
    deliveryStatus: 'PENDING' | 'TTS_STARTED' | 'TTS_COMPLETED' | 'INTERRUPTED';
  } | null = null;

  public setVoiceConfig(config: { voiceId?: string; voiceProfile?: string; rate?: string; pitch?: string }): void {
    if (config.voiceId) {
      this.currentVoiceId = config.voiceId;
      try {
        voiceRuntimeState.setVoice(config.voiceId);
      } catch {}
    }
    if (config.voiceProfile) {
      this.currentVoiceProfile = config.voiceProfile;
      const p = config.voiceProfile.toLowerCase().replace(/[-_]/g, '');
      if (p.includes('tactical') || p.includes('briefing') || p === 'fast') {
        this.currentRate = '+25%';
        this.currentPitch = '+0Hz';
      } else if (p.includes('calm') || p.includes('authoritative')) {
        this.currentRate = '-10%';
        this.currentPitch = '-5Hz';
      } else if (p.includes('deep')) {
        this.currentRate = '-10%';
        this.currentPitch = '-5Hz';
      } else if (p.includes('cinematic')) {
        this.currentRate = '-5%';
        this.currentPitch = '-2Hz';
      } else if (p.includes('natural')) {
        this.currentRate = '+0%';
        this.currentPitch = '+0Hz';
      }
    }
    if (config.rate !== undefined) this.currentRate = config.rate;
    if (config.pitch !== undefined) this.currentPitch = config.pitch;

    this.saveVoicePreferences();

    logger.info('[JarvisNext] Active voice configuration updated and persisted:', {
      voiceId: this.currentVoiceId,
      voiceProfile: this.currentVoiceProfile,
      rate: this.currentRate,
      pitch: this.currentPitch,
    });
  }

  public getVoiceConfig(): { voiceId: string; voiceProfile: string; rate?: string; pitch?: string } {
    return {
      voiceId: this.currentVoiceId,
      voiceProfile: this.currentVoiceProfile,
      rate: this.currentRate,
      pitch: this.currentPitch,
    };
  }

  // Playout timing & barge-in detection
  private speechStartTime = 0;
  private consecutiveBargeInFrames = 0;
  private ambientNoiseFloor = 30.0;
  private currentTurnIsBargeIn = false;

  // Pre-roll ring buffer and continuous utterance audio capture
  private activeStreams: AudioStream[] = [];
  private preRollBuffer: Buffer[] = [];
  private readonly PRE_ROLL_MAX_FRAMES = 45; // ~900ms at 20ms/frame to capture soft speech onset
  private speechFrames: Buffer[] = [];
  private pendingNavigationAcks = new Map<string, (ack: NavigationAckPayload) => void>();
  private silenceTimeout: NodeJS.Timeout | null = null;
  private isAccumulatingSpeech = false;
  private lastFrameSampleRate = 24000;
  private lastFrameChannels = 1;
  private hasReceivedFirstFrame = false;
  private lastRmsLogTime = 0;
  public maxObservedRms = 0;

  // Calibrated voice activity thresholds
  private readonly SPEECH_START_THRESHOLD = 650;
  private readonly SPEECH_CONTINUE_THRESHOLD = 350;
  private readonly BARGE_IN_THRESHOLD = 1100;
  /**
   * ECHO GUARD. Raised from 250ms: the microphone hears our own speaker output,
   * and the first fraction of a second of our own audio must never be treated as
   * a person interrupting us.
   */
  private readonly BARGE_IN_GRACE_MS = 150;
  /** Higher floor while our own audio is playing, so echo cannot clear it. */
  private readonly BARGE_IN_PLAYOUT_THRESHOLD = 950;
  /** Fast human speech onset during playout (3 frames x 20ms = 60ms) for sub-100ms interruption. */
  private readonly BARGE_IN_SUSTAIN_FRAMES = 3;
  private readonly SILENCE_DURATION_MS = 750; // Optimized default conversational settle window

  private consecutiveClarifications = 0;
  private userSpeechStartTime = 0;
  private userSpeechEndTime = 0;
  private lastNonSilentTimestamp: number | null = null;
  private turnSpeechEndTimes = new Map<number, number>();
  private turnVadEndTimes = new Map<number, number>();
  private speculativeTranscribeTurnId = 0;
  private precomputedSttResult: LocalTranscribeResult | null = null;

  private startingPromise: Promise<void> | null = null;
  private isReady = false;
  private subscribedTrackSids: Set<string> = new Set();

  // ── Voice runtime lifecycle invariant tracking ──────────────────────────
  // The turn latch must never survive a turn. These fields make every invariant
  // in voiceRuntimeInvariants.ts decidable from runtime facts.
  private turnLatchAcquiredAt: number | null = null;
  private turnWatchdog: NodeJS.Timeout | null = null;
  private turnRoute: string | undefined;
  private turnExecutor: string | undefined;
  private turnExecutorCompleted: boolean | undefined;
  private turnLastError: string | undefined;
  private turnCommittedAt: number | null = null;
  private turnSttBeginAt: number | undefined;
  private turnSttFinalAt: number | undefined;
  private turnVadStart: number | undefined;
  private turnWavPath: string | undefined;
  private turnRawAudioDurationMs: number | undefined;
  /** Loud mic frames discarded because a turn was latched (deafness evidence). */
  private droppedFramesWhileLatched = 0;
  /** Frames rejected as a barge-in candidate while TTS was playing (echo evidence). */
  private ttsEchoRejectedFrames = 0;
  private lastBargeInRms = 0;
  private playoutCancellation: { reason: string; at: number; playoutId: number; frames: number } | null = null;
  private lastPlayoutStartedAt: number | null = null;
  private lastPlayoutEndedAt: number | null = null;
  private lastPlayoutFrames = 0;

  /**
   * A held turn latch must never outlive the turn it belongs to. Every terminal
   * path calls this; a watchdog calls it if no terminal path ever ran.
   * Phase 1 Invariant: 12-second absolute ceiling for EXECUTION ONLY.
   */
  private readonly TURN_WATCHDOG_MS = 12_000;
  private readonly executionCompletedTurns = new Set<number>();

  private disarmExecutionWatchdog(turnId: number, reason: string): void {
    if (this.turnWatchdog) {
      clearTimeout(this.turnWatchdog);
      this.turnWatchdog = null;
    }
    this.executionCompletedTurns.add(turnId);
    logger.info('[JarvisNext] Execution watchdog disarmed; execution completed', { turnId, reason });
  }

  private releaseTurnLatch(reason: string): void {
    if (this.turnWatchdog) {
      clearTimeout(this.turnWatchdog);
      this.turnWatchdog = null;
    }
    if (this.isProcessingUserTurn) {
      this.isProcessingUserTurn = false;
      logger.info('[JarvisNext] Turn latch released', { reason, turnId: this.currentUserTurnId, droppedFrames: this.droppedFramesWhileLatched });
    }
    this.foregroundTurnActive = false;
    this.turnLatchAcquiredAt = null;
    this.droppedFramesWhileLatched = 0;
    if (!this.isSpeaking && !this.isSynthesizing) {
      this.setMicState('LISTENING', reason);
    }
    // Drain the arbiter queue now that foreground is idle
    speechArbiter.onUserTurnComplete().catch(() => {});
  }

  public armExecutionWatchdog(turnId: number, conversationId: string | null, timeoutMs = this.TURN_WATCHDOG_MS): void {
    if (this.turnWatchdog) clearTimeout(this.turnWatchdog);
    // Generation token: the watchdog only fires for the latch generation it was
    // armed for, so a turn that completes normally can never trip it afterwards.
    const armedForLatch = this.turnLatchAcquiredAt;
    this.turnWatchdog = setTimeout(() => {
      if (this.turnLatchAcquiredAt !== armedForLatch) return; // latch already released / reused
      if (!this.isProcessingUserTurn && !this.lifecycleRequestInFlight) return; // turn finished normally
      if (this.executionCompletedTurns.has(turnId)) {
        logger.info('[JarvisNext] Execution watchdog expired but execution had already completed; suppressing application timeout', { turnId });
        return;
      }
      if (this.lastVerifiedExecutionResult?.turnId === turnId && this.lastVerifiedExecutionResult?.verified) {
        logger.info('[JarvisNext] Execution watchdog expired but turn had verified execution success; suppressing application timeout', { turnId });
        return;
      }

      // CRITICAL: Execution watchdog ceiling at 12s.
      logger.warn('[JarvisNext] Absolute physical execution watchdog triggered at 12s ceiling', {
        turnId,
        lifecycleRequestInFlight: this.lifecycleRequestInFlight,
        isProcessingUserTurn: this.isProcessingUserTurn,
      });
      void this.onTurnWatchdogExpired(turnId, conversationId);
    }, timeoutMs);
  }

  public armTurnWatchdog(turnId: number, conversationId: string | null, timeoutMs = this.TURN_WATCHDOG_MS): void {
    this.armExecutionWatchdog(turnId, conversationId, timeoutMs);
  }

  private async onTurnWatchdogExpired(turnId: number, conversationId: string | null): Promise<void> {
    const expiredTurnId = turnId;

    // Required Invariant: VERIFIED EXECUTION SUCCESS must never later become APPLICATION EXECUTION TIMEOUT
    if (this.executionCompletedTurns.has(expiredTurnId) || (this.lastVerifiedExecutionResult?.turnId === expiredTurnId && this.lastVerifiedExecutionResult?.verified)) {
      logger.info('[JarvisNext] onTurnWatchdogExpired invoked but execution succeeded/completed; suppressing application timeout', { turnId: expiredTurnId });
      return;
    }

    this.turnLastError = `Turn timed out after ${this.TURN_WATCHDOG_MS}ms ceiling`;

    // 1. SYNCHRONOUS LATCH RELEASE & MIC RESTORATION FIRST
    // The user must be able to speak immediately without waiting on any promise/microtask.
    this.currentUserTurnId++;
    const recoveryTurnId = this.currentUserTurnId;

    // Propagate cancellation directly into STT layer (TURN INVALIDATED = STT WORK INVALIDATED)
    cancelLocalTranscription(expiredTurnId, 'watchdog_timeout');
    purgeObsoleteTranscriptions(recoveryTurnId);

    this.lifecycleRequestInFlight = false;
    this.isProcessingUserTurn = false;
    this.foregroundTurnActive = false;
    this.isAccumulatingSpeech = false;
    this.releaseTurnLatch(`watchdog_timeout:${expiredTurnId}`);
    this.setMicState('LISTENING', `watchdog_timeout:${expiredTurnId}`);

    // 2. Clear stuck speech/playout state safely
    if (this.isSpeaking || this.isSynthesizing) {
      try {
        this.interruptAssistantPlayout(`watchdog_timeout:${expiredTurnId}`);
      } catch (err: any) {
        logger.warn('[JarvisNext] Error interrupting playout on watchdog expiration:', err);
      }
      this.isSpeaking = false;
      this.isSynthesizing = false;
      this.speechOwnerTurnId = null;
    }

    // 3. Abort downstream work in turnLifecycle if active
    try {
      const { turnLifecycle } = await import('../turnLifecycle/index.js');
      turnLifecycle.abortInFlightTurn(conversationId);
    } catch (err: any) {
      logger.warn('[JarvisNext] Failed to abort in-flight turn on watchdog expiration:', err);
    }

    const evidence: VoiceTurnEvidence = {
      turnId: expiredTurnId,
      conversationId,
      transcript: this.lastUserText ?? undefined,
      committedAt: this.turnCommittedAt ?? undefined,
      sttBeginAt: this.turnSttBeginAt,
      sttFinalAt: this.turnSttFinalAt,
      rawAudioDurationMs: this.turnRawAudioDurationMs,
      vadStartMs: this.turnVadStart,
      wavPath: this.turnWavPath,
      endpointReason: 'vad_silence',
      route: this.turnRoute,
      executor: this.turnExecutor,
      executorCompleted: false,
      ttsState: 'idle',
      browserActionState: 'unknown',
      isProcessingUserTurn: false,
      isAccumulatingSpeech: false,
      isSpeaking: false,
      isListening: true,
      ambientNoiseFloor: this.ambientNoiseFloor,
      droppedFramesWhileLatched: this.droppedFramesWhileLatched,
      droppedSpeechEstimateMs: this.droppedFramesWhileLatched * 20,
      lastError: this.turnLastError,
    };

    const fired = evaluateVoiceInvariants({
      terminal: false,
      turn: evidence,
      listenerRearmed: this.isListening,
    });

    logJRT('TURN_COMPLETE', `turn=${expiredTurnId} reason=watchdog_released_latch`);
    logger.error('[JarvisNext] VOICE_TURN_STUCK — turn timed out at 12s ceiling; latch force-released', {
      turnId: expiredTurnId,
      droppedFrames: evidence.droppedFramesWhileLatched,
    });

    const incidentIds: string[] = [];
    for (const f of fired) {
      const res = await raiseVoiceInvariantIncident(f, { watchdogMs: this.TURN_WATCHDOG_MS });
      if (res.raised && res.incidentId) incidentIds.push(res.incidentId);
    }

    if (this.lastUserText) {
      await persistOriginalGoalForRetry({
        goal: this.lastUserText,
        conversationId,
        incidentId: incidentIds[0],
        turnId: expiredTurnId,
      });
    }

    // 6. Emit an honest timeout result
    const isGerman = getActiveLanguage() === 'de';
    const announcement = isGerman
      ? "Diese Anfrage hat das Zeitlimit überschritten, während auf die Antwort gewartet wurde."
      : "That request timed out while waiting for the application to respond.";
    this.broadcastData({ type: 'assistant_text', text: announcement });
    this.broadcastData({
      type: 'voice_runtime_recovery',
      invariant: fired.map((f) => f.id),
      incidentIds,
      text: announcement,
    });
    try {
      await this.speak(announcement, recoveryTurnId);
    } catch (err: any) {
      logger.warn('[JarvisNext] Could not speak the recovery announcement', { error: err?.message || String(err) });
    }

    this.broadcastData({ type: 'status', state: 'listening', isSpeaking: false, isListening: true });
  }

  /**
   * A barge-in is only real if a PERSON was behind it. Jarvis's own speaker output
   * returns through the microphone, so the energy test alone cannot prove a human
   * interrupted: a genuine barge-in is followed by an utterance we actually commit.
   * Nothing committed afterwards means our own audio cut us off.
   */
  private async verifyBargeInWasHuman(opts: {
    turnId: number;
    cancelledAt: number;
    reason: string;
    playoutStartedAt: number | null;
    frames: number;
  }): Promise<void> {
    const committedAfter = this.turnCommittedAt !== null && this.turnCommittedAt > opts.cancelledAt;
    if (committedAfter) {
      logger.info('[JarvisNext] Barge-in verified as human — a turn was committed after the interruption', {
        turnId: opts.turnId,
      });
      return;
    }

    const evidence: VoiceTurnEvidence = {
      turnId: opts.turnId,
      conversationId: this.voiceConversationId,
      transcript: this.lastUserText ?? undefined,
      committedAt: this.turnCommittedAt ?? undefined,
      rawAudioDurationMs: this.turnRawAudioDurationMs,
      route: this.turnRoute,
      executor: this.turnExecutor,
      executorCompleted: this.turnExecutorCompleted,
      ttsState: 'ended',
      ttsStartedAt: opts.playoutStartedAt ?? undefined,
      ttsFramesPublished: opts.frames,
      cancellationReason: opts.reason,
      bargeInVerifiedHuman: false,
      isProcessingUserTurn: this.isProcessingUserTurn,
      isAccumulatingSpeech: this.isAccumulatingSpeech,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      ambientNoiseFloor: this.ambientNoiseFloor,
      droppedFramesWhileLatched: this.droppedFramesWhileLatched,
      lastError: this.turnLastError,
    };

    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: evidence,
      listenerRearmed: this.isListening,
      bareBargeInVerified: false,
    });
    if (!fired.length) return;

    const incidentIds: string[] = [];
    for (const f of fired) {
      const res = await raiseVoiceInvariantIncident(f, {
        echoRejectedFrames: this.ttsEchoRejectedFrames,
        bargeInRms: this.lastBargeInRms,
        playoutFramesPublished: opts.frames,
      });
      if (res.raised && res.incidentId) incidentIds.push(res.incidentId);
    }

    const announcement = voiceRecoveryAnnouncement(fired, incidentIds);
    if (announcement) {
      this.broadcastData({ type: 'assistant_text', text: announcement });
      this.broadcastData({
        type: 'voice_runtime_recovery',
        invariant: fired.map((f) => f.id),
        incidentIds,
        text: announcement,
      });
    }
  }

  public getStatus(): JarvisNextStatus {
    return {
      connected: this.room ? this.room.isConnected : false,
      roomName: this.currentRoomName,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      isSuspended: this.isSuspended,
      state: this.isSuspended ? 'suspended' : (this.isSpeaking ? 'speaking' : (this.isListening ? 'listening' : 'idle')),
      totalBargeIns: this.totalBargeIns,
      lastUserText: this.lastUserText,
      lastAssistantText: this.lastAssistantText,
      legacyVoiceActive: false,
      activeMicOwners: 1,
      activeVoiceOwners: this.isSpeaking ? 1 : 0,
    };
  }

  public handleStopCommand(reason = 'user_stop_command'): void {
    logger.info(`[JarvisNext] STOP command executed (reason: ${reason}). Cancelling playout, resetting queue, returning to READY / LISTENING, and cancelling in-flight capability work.`);
    // ── D-5: Stop cancels active work and invalidates its perception context ──
    // A cancelled operation must not afterwards launch an application, speak,
    // alter TurnFocus, replace the active perception target, emit runtime status,
    // or write a stale result. Both the operation registry and the perception
    // focus are cleared here, and any in-flight operation is marked CANCELLED so
    // its completion path is refused by mayPerformSideEffect().
    try {
      import('../jarvis/perception/perceptionFocus.js').then(({ clearPerception }) => {
        clearPerception(this.voiceConversationId ?? '', reason);
      }).catch(() => {});
      import('../jarvis/perception/perceptionOperation.js').then(({ cancelConversationOperations }) => {
        const cancelled = cancelConversationOperations(this.voiceConversationId ?? '', reason);
        logger.info(`[JarvisNext] STOP cancelled ${cancelled.length} in-flight capability operation(s).`);
      }).catch(() => {});
    } catch {}
    this.isSuspended = false;
    this.isSpeaking = false;
    this.isSynthesizing = false;
    this.isProcessingUserTurn = false;
    this.isAccumulatingSpeech = false;
    // Explicit cancellation: release voice ownership and drop coalesced
    // follow-ups — the user asked for silence, not a delayed second utterance.
    this.speechOwnerTurnId = null;
    if (this.pendingCoalesced.length) {
      console.log(`[JRT] SPEAK_COALESCED_DROPPED reason=stop_command depth=${this.pendingCoalesced.length}`);
      logJRT('SPEAK_COALESCED_DROPPED', `reason=stop_command depth=${this.pendingCoalesced.length}`);
      this.pendingCoalesced = [];
    }
    this.currentAssistantPlayoutId++;
    this.currentUserTurnId++;
    purgeObsoleteTranscriptions(this.currentUserTurnId);
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    this.speechFrames = [];
    this.releaseTurnLatch(reason);
    if (reason === 'cancel_work') {
      try {
        import('../jarvis/execution/executors/terminalExecutor.js').then(({ terminalExecutor }) => {
          terminalExecutor.cancelActiveProcesses();
        }).catch(() => {});
      } catch {}
    }
    this.broadcastData({ type: 'stop_playback', reason });
    this.isListening = true;
    this.broadcastData({
      type: 'status',
      state: 'listening',
      isSpeaking: false,
      isListening: true,
      isSuspended: false,
    });
    logJRT('STATE_TRANSITION', `to=listening reason=${reason}`);
    try {
      import('./jarvisHealth.js').then(({ bump }) => {
        bump('stop_command_executed');
      }).catch(() => {});
    } catch {}
  }

  public suspend(reason = 'stop_command'): void {
    this.handleStopCommand(reason);
  }

  public resume(_reason = 'wake_word'): void {
    this.isSuspended = false;
    this.isListening = true;
    this.broadcastData({
      type: 'status',
      state: 'listening',
      isSpeaking: false,
      isListening: true,
      isSuspended: false,
    });
  }

  public isSuspendedState(): boolean {
    return false;
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

  /**
   * Request background speech through the arbiter.
   * Used by HTTP /agent/speak endpoint and any background caller.
   * Will be rejected if a P1 user turn is currently active.
   */
  public async requestBackgroundSpeech(
    text: string,
    priority: SpeechPriority = SpeechPriority.P4_BACKGROUND,
    source = 'external',
    turnId?: number,
  ): Promise<boolean> {
    return speechArbiter.request({ text, priority, source, turnId });
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

    // Register the speech arbiter ONCE per start so background callers (Revenue Operator,
    // Hermes, Self-Heal, scheduler, approval gates) are gated through the single voice output
    // authority. P4/P5 speech is silently dropped when a P1 user turn is active.
    speechArbiter.register({
      speakFn: (text, tid) => this.speak(text, tid),
      getCurrentTurnId: () => this.currentUserTurnId,
      isUserTurnActive: () => this.isProcessingUserTurn || this.foregroundTurnActive,
      isSpeaking: () => this.isSpeaking || this.isSynthesizing,
    });

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
          this.speak(getTimeAwareGreeting('Christian'));
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
        if (data.type === 'stop' || data.type === 'suspend' || data.type === 'stop_speaking' || data.type === 'barge_in' || data.type === 'interrupt') {
          this.handleStopCommand('client_data_channel');
        } else if (data.type === 'resume' || data.type === 'wake') {
          this.resume('client_data_channel');
        } else if (data.type === 'set_voice' || data.type === 'voice_config') {
          this.setVoiceConfig({
            voiceId: data.voiceId || data.voice,
            voiceProfile: data.voiceProfile || data.profile,
            rate: data.rate,
            pitch: data.pitch,
          });
        } else if (data.type === 'user_text' && data.text) {
          this.handleUserText(data.text);
        } else if (data.type === 'NAVIGATE_ACK' && data.navigationId) {
          logger.info('[JarvisNext] NAVIGATE_ACK received:', data);
          console.log(`[JRT] NAV_ACK_RECEIVE room=${this.currentRoomName || ''} navId=${data.navigationId} success=${data.success} actualRoute=${data.actualRoute}`);
          // D23: the ACK belongs to the SHARED transaction registry.
          try {
            const fed = completeNavigation({
              navId: data.navigationId,
              success: data.success === true,
              actualRoute: data.actualRoute,
              activeProjectId: data.activeProjectId,
              visibleEntityId: data.visibleEntityId,
              error: data.error,
            });
            logger.info('[JarvisNext] LiveKit ACK resolved the shared transaction:', {
              navigationId: data.navigationId, accepted: fed.accepted, verified: fed.verified, reason: fed.reason ?? null,
            });
          } catch (feedErr) {
            logger.warn('[JarvisNext] Could not feed NAVIGATE_ACK to the shared registry:', { error: String(feedErr) });
          }
          const resolver = this.pendingNavigationAcks.get(data.navigationId);
          if (resolver) {
            resolver(data);
          }
        }
      } catch {
        // Not JSON data
      }
    });

    await room.connect(LIVEKIT_CONFIG.wsUrl, token);
    const buildIdentity = getBuildIdentity();
    const buildId = buildIdentity.buildId || 'dev';
    logger.info('[JarvisNext] Agent connected successfully to room:', { roomName, buildId, pid: process.pid });
    console.log(`[JarvisNext] STARTUP BUILD_ID=${buildId} PID=${process.pid} ROOM=${roomName}`);
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

  /**
   * One persistent conversation per voice session. Supervisor V2 and the
   * dialogue/memory layers key off conversationId, so reusing it is what gives
   * voice turns continuity instead of isolated single-utterance prompts.
   */
  private async ensureVoiceConversation(): Promise<string | null> {
    if (this.voiceConversationId) return this.voiceConversationId;
    try {
      const { conversationService } = await import('../conversations/service.js');
      const conv: any = await conversationService.createConversation(
        `Voice session ${new Date().toISOString()}`,
        undefined,
        'jarvis',
      );
      this.voiceConversationId = conv?.id ?? conv ?? null;
      logJRT('VOICE_CONVERSATION_READY', `conversation=${this.voiceConversationId}`);
    } catch (err: any) {
      logger.warn('[JarvisNext] Failed to create voice conversation:', err?.message || err);
      this.voiceConversationId = null;
    }
    return this.voiceConversationId;
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
      const dynamicBargeIn = Math.max(550, Math.min(1000, this.ambientNoiseFloor * 3.0 + 350));
      // ECHO GUARD: our own speech comes back through the microphone. Jarvis's
      // own audio must never cancel Jarvis. A candidate barge-in during playout
      // must therefore clear a HIGHER floor and be SUSTAINED for longer than one
      // of our own syllables; a genuine person easily does both. The decision is
      // the shared pure function so the tests exercise this exact path.
      const decision = decideBargeIn({
        rms,
        msSincePlayoutStart: timeSinceSpeechStarted,
        ambientNoiseFloor: this.ambientNoiseFloor,
        consecutiveFrames: this.consecutiveBargeInFrames + 1,
        graceMs: this.BARGE_IN_GRACE_MS,
        playoutFloor: this.BARGE_IN_PLAYOUT_THRESHOLD,
        sustainFrames: this.BARGE_IN_SUSTAIN_FRAMES,
      });
      const echoGuardThreshold = Math.max(dynamicBargeIn, this.BARGE_IN_PLAYOUT_THRESHOLD);
      if (decision === 'trigger') {
        logger.info(`[JarvisNext] Candidate user speech detected during playout (rms=${Math.round(rms)}, thresh=${Math.round(echoGuardThreshold)}, frames=${this.consecutiveBargeInFrames + 1}) -> BARGE_IN_TRIGGERED (halting assistant speech)`);
        this.vadTriggeredDuringTts = true;
        this.currentTurnIsBargeIn = true;
        this.lastBargeInRms = rms;
        this.isSpeaking = false;
        this.isSynthesizing = false;
        this.setMicState('BARGE_IN_PENDING', `energy_rms_${Math.round(rms)}`);
        this.broadcastData({ type: 'provisional_barge_in', rms, threshold: echoGuardThreshold });
        // Immediately halt assistant playout so speaker audio ceases blasting into the mic
        const detectedSpeechTime = Date.now();
        this.interruptAssistantPlayout('user_barge_in');
        voicePipelineInstrumentation.recordInterruption(detectedSpeechTime, Date.now());
        this.isAccumulatingSpeech = true;
        this.userSpeechStartTime = Date.now();
        logJRT('SPEECH_START', `rms=${Math.round(rms)} threshold=${Math.round(echoGuardThreshold)} reason=candidate_barge_in`);
        this.speechFrames = [...this.preRollBuffer];
        this.consecutiveBargeInFrames = 0;
      } else if (decision === 'sustain') {
        this.consecutiveBargeInFrames++;
      } else {
        // 'reject_echo' = energy that clears the idle floor but not the playout floor
        if (decision === 'reject_echo') this.ttsEchoRejectedFrames++;
        this.consecutiveBargeInFrames = 0;
      }
      return;
    }

    // Reset barge-in frames when not speaking
    this.consecutiveBargeInFrames = 0;

    // Track ambient noise floor when not speaking and not accumulating speech
    if (!this.isAccumulatingSpeech && !this.isSpeaking) {
      this.ambientNoiseFloor = this.ambientNoiseFloor * 0.95 + rms * 0.05;
    }

    // CASE B: Assistant is NOT speaking (idle, listening, or synthesizing)
    if (!this.isAccumulatingSpeech) {
      if (this.isProcessingUserTurn) {
        // Jarvis is actively transcribing, reasoning via Codex, or synthesizing speech.
        // Gate microphone frames so ambient sound or thinking-out-loud does not cancel the in-flight answer.
        // COUNT the speech-level frames being discarded: if the latch is stuck,
        // these frames are the only evidence that the user was speaking and was
        // not heard. That evidence is what VOICE_TURN_STUCK reports to Self-Heal.
        if (rms >= this.SPEECH_START_THRESHOLD) {
          this.droppedFramesWhileLatched++;
          if (this.droppedFramesWhileLatched === 1) {
            logJRT('MIC_GATED_FOR_HELD_TURN', `turn=${this.currentUserTurnId} rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD}`);
            console.log(`[JRT] MIC_GATED_FOR_HELD_TURN turn=${this.currentUserTurnId} rms=${Math.round(rms)}`);
          }
        }
        return;
      }

      if (rms >= this.SPEECH_START_THRESHOLD) {
        // User speech onset: prepend pre-roll buffer so initial phonemes/consonants are preserved
        this.isAccumulatingSpeech = true;
        this.userSpeechStartTime = Date.now();
        this.setMicState('USER_SPEAKING', 'vad_speech_onset');
        const turnId = this.currentUserTurnId;
        logJRT('USER_SPEECH_START', `turn=${turnId} rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD}`);
        console.log(`[JRT] USER_SPEECH_START turn=${turnId}`);
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
        // Active voice energy - reset silence timer and invalidate speculative precomputed STT
        this.lastNonSilentTimestamp = Date.now();
        this.precomputedSttResult = null;
        if (this.silenceTimeout) {
          clearTimeout(this.silenceTimeout);
          this.silenceTimeout = null;
        }
      } else {
        // Voice dipped into pause/silence
        if (!this.silenceTimeout) {
          const accumulatedAudioMs = this.speechFrames.length * 20;
          this.precomputedSttResult = null;
          const currentTurn = this.currentUserTurnId;

          // Default stable silence duration: 800ms gives user natural inter-word breathing room
          // and gives speculative local STT enough time to evaluate AdaptiveTurnEndpoint
          const defaultSilence = 800;
          let silenceDuration = defaultSilence;

          // Launch speculative preliminary STT in background if audio duration >= 300ms
          if (this.speechFrames.length >= 15) {
            const capturedFrames = [...this.speechFrames];
            const specWav = pcmChunksToWav(capturedFrames, this.lastFrameSampleRate, this.lastFrameChannels);
            this.speculativeTranscribeTurnId = currentTurn;
            transcribeLocally(specWav, '.wav', 'en', currentTurn, Math.round(capturedFrames.length * 20)).then((res) => {
              if (this.currentUserTurnId === currentTurn && this.silenceTimeout && res && res.text) {
                this.precomputedSttResult = res;
                const evalResult = AdaptiveTurnEndpoint.evaluateEndpoint(accumulatedAudioMs, res.text);
                if (evalResult.isIncomplete) {
                  // Incomplete sentence: protect user from cut-off, expand silence to 1800ms
                  if (this.silenceTimeout) {
                    clearTimeout(this.silenceTimeout);
                    const elapsed = Date.now() - (this.lastNonSilentTimestamp || Date.now());
                    const remaining = Math.max(200, 1800 - elapsed);
                    this.silenceTimeout = setTimeout(() => {
                      this.finishVadEndpoint(1800, evalResult.reason);
                    }, remaining);
                  }
                } else if (evalResult.isShortComplete) {
                  // Decisive short command confirmed! Endpoint immediately
                  if (this.silenceTimeout) {
                    clearTimeout(this.silenceTimeout);
                    this.silenceTimeout = null;
                    this.finishVadEndpoint(300, 'speculative_short_complete');
                  }
                }
              }
            }).catch(() => {});
          }

          this.silenceTimeout = setTimeout(() => {
            this.finishVadEndpoint(silenceDuration, 'vad_silence');
          }, silenceDuration);
        }
      }
    }
  }

  private finishVadEndpoint(silenceDuration: number, reason: string): void {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    this.setMicState('PROCESSING', `vad_${reason}`);
    const vadEnd = Date.now();
    const physicalEnd = this.lastNonSilentTimestamp || (vadEnd - silenceDuration);
    this.userSpeechEndTime = physicalEnd;
    const turnId = this.currentUserTurnId;
    voicePipelineInstrumentation.recordSpeechEnd(turnId, physicalEnd);
    voicePipelineInstrumentation.recordStage(turnId, 'vadEndMs', vadEnd);
    voicePipelineInstrumentation.recordStage(turnId, 'semanticEndpointMs', Date.now());
    this.turnSpeechEndTimes.set(turnId, physicalEnd);
    this.turnVadEndTimes.set(turnId, vadEnd);
    const durationMs = physicalEnd - (this.userSpeechStartTime || (physicalEnd - 1000));
    logJRT('PHYSICAL_AUDIO_LAST_NON_SILENT_SAMPLE', `turn=${turnId} timestamp=${physicalEnd}`);
    console.log(`[JRT] PHYSICAL_AUDIO_LAST_NON_SILENT_SAMPLE turn=${turnId}`);
    logJRT('USER_SPEECH_END', `turn=${turnId} durationMs=${durationMs} frames=${this.speechFrames.length}`);
    console.log(`[JRT] USER_SPEECH_END turn=${turnId} durationMs=${durationMs}`);
    logJRT('VAD_END_OF_TURN', `turn=${turnId} vadTrailingMs=${vadEnd - physicalEnd} reason=${reason}`);
    console.log(`[JRT] VAD_END_OF_TURN turn=${turnId} vadTrailingMs=${vadEnd - physicalEnd} reason=${reason}`);
    logJRT('SPEECH_END', `frames=${this.speechFrames.length}`);
    this.commitUserTurn();
  }

  public interrupt(reason = 'user_request'): void {
    // Invalidate pending transcription/reasoning, while allowing the next utterance.
    this.currentUserTurnId++;
    purgeObsoleteTranscriptions(this.currentUserTurnId);
    this.isProcessingUserTurn = false;
    this.interruptAssistantPlayout(reason);
  }

  public interruptAssistantPlayout(reason = 'unknown'): void {
    logger.info(`[JarvisNext] Assistant playout interrupted (${reason}). Halting speech immediately.`);
    // Explicit interruption paths are the ONLY legitimate owners of channel
    // invalidation. Release the speech owner and drop coalesced follow-ups:
    // they belonged to the response the user just interrupted.
    const wasOwnerTurn = this.speechOwnerTurnId;
    this.speechOwnerTurnId = null;
    if (this.pendingCoalesced.length) {
      console.log(`[JRT] SPEAK_COALESCED_DROPPED turn=${wasOwnerTurn} depth=${this.pendingCoalesced.length} reason=${reason}`);
      logJRT('SPEAK_COALESCED_DROPPED', `turn=${wasOwnerTurn} depth=${this.pendingCoalesced.length} reason=${reason}`);
      this.pendingCoalesced = [];
    }
    logJRT('PLAYOUT_ABORT', `turn=${wasOwnerTurn} reason=${reason}`);
    console.log(`[JRT] PLAYOUT_ABORT turn=${wasOwnerTurn} reason=${reason}`);
    // Record the cancellation: whether it was a PERSON or our own audio is
    // verified asynchronously, not assumed. An unverified cancellation is what
    // TTS_PREMATURE_TERMINATION reports.
    this.playoutCancellation = {
      reason,
      at: Date.now(),
      playoutId: this.currentAssistantPlayoutId,
      frames: this.lastPlayoutFrames,
    };
    this.currentAssistantPlayoutId++;
    this.isSpeaking = false;
    this.isSynthesizing = false;
    this.totalBargeIns++;
    this.consecutiveBargeInFrames = 0;
    this.releaseTurnLatch(`assistant_playout_interrupted:${reason}`);

    try {
      (this.audioSource as any)?.clearQueue?.();
    } catch {
      // ignore
    }

    this.broadcastData({
      type: 'stop_playback',
      reason,
    });
    this.broadcastData({
      type: 'status',
      state: 'listening',
      isSpeaking: false,
      isListening: true,
    });

    // Was a PERSON behind this, or did our own audio cut us off? Verified from
    // whether a turn actually followed — never assumed.
    if (reason === 'barge_in' && this.playoutCancellation) {
      const cancelled = this.playoutCancellation;
      setTimeout(() => {
        void this.verifyBargeInWasHuman({
          turnId: this.currentUserTurnId,
          cancelledAt: cancelled.at,
          reason: cancelled.reason,
          playoutStartedAt: this.lastPlayoutStartedAt,
          frames: cancelled.frames,
        });
      }, 5000);
    }
  }

  private async commitUserTurn(): Promise<void> {
    const isBargeIn = this.currentTurnIsBargeIn;
    this.currentTurnIsBargeIn = false;
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
    // Latch bookkeeping: from here on the turn MUST reach a terminal outcome.
    this.turnLatchAcquiredAt = Date.now();
    this.turnCommittedAt = Date.now();
    this.droppedFramesWhileLatched = 0;
    this.turnRoute = undefined;
    this.turnExecutor = undefined;
    this.turnExecutorCompleted = undefined;
    this.turnLastError = undefined;
    // Physical execution watchdog is decoupled from STT and armed at EXECUTION_DISPATCHED (Repair 2)
    logJRT('COMMIT_TURN_BEGIN', `turn=${turnId} frames=${recordedFrames.length} isBargeIn=${isBargeIn}`);
    logger.info(`[JarvisNext] User turn #${turnId} completed (isBargeIn=${isBargeIn}). Processing recorded frames:`, recordedFrames.length);
    this.broadcastData({
      type: 'status',
      state: 'thinking',
      isSpeaking: false,
      isListening: true,
    });

    try {
      if (this.room && (!this.audioSource || !this.room.isConnected)) {
        logger.warn('[JarvisNext] Audio source unavailable during turn commit');
        this.isProcessingUserTurn = false;
        return;
      }

      const sampleRate = this.lastFrameSampleRate || 24000;
      const channels = this.lastFrameChannels || 1;
      const totalPcmBytes = recordedFrames.reduce((acc, f) => acc + f.length, 0);
      const rawAudioDurationMs = Math.round((totalPcmBytes / (sampleRate * channels * 2)) * 1000);
      const preRollMs = Math.round(this.PRE_ROLL_MAX_FRAMES * 20);
      const postRollMs = this.SILENCE_DURATION_MS;

      const wavBuffer = pcmChunksToWav(recordedFrames, this.lastFrameSampleRate, this.lastFrameChannels);
      const wavDir = path.resolve(process.cwd(), 'data', 'voice_turns');
      if (!fs.existsSync(wavDir)) {
        fs.mkdirSync(wavDir, { recursive: true });
      }
      const wavPath = path.join(wavDir, `physical_turn_${turnId}_${Date.now()}.wav`);
      fs.writeFileSync(wavPath, wavBuffer);
      logJRT('WAV_READY', `turn=${turnId} bytes=${wavBuffer.length} path=${wavPath}`);

      const vadEnd = this.turnSpeechEndTimes.get(turnId) || this.userSpeechEndTime || Date.now();
      this.turnLatencyMap.set(turnId, {
        turnId,
        speechEnd: vadEnd,
        status: 'EXECUTING',
      });

      const tSttStart = Date.now();
      logJRT('STT_BEGIN', `turn=${turnId}`);
      logJRT('STT_START', `turn=${turnId}`);
      console.log(`[JRT] STT_START turn=${turnId}`);

      let transcribeResult: LocalTranscribeResult;
      if (this.precomputedSttResult && this.speculativeTranscribeTurnId === turnId && this.precomputedSttResult.text) {
        transcribeResult = this.precomputedSttResult;
        this.precomputedSttResult = null;
        logJRT('STT_SPECULATIVE_REUSE', `turn=${turnId} text="${transcribeResult.text}"`);
      } else {
        transcribeResult = await transcribeLocally(wavBuffer, '.wav', 'en', turnId, rawAudioDurationMs);
      }

      if (transcribeResult.timeout || transcribeResult.cancelled) {
        logger.warn(`[JarvisNext] STT ${transcribeResult.timeout ? 'TIMED OUT' : 'CANCELLED'} for turn #${turnId}`);
        logJRT('STT_ABORTED', `turn=${turnId} timeout=${transcribeResult.timeout} cancelled=${transcribeResult.cancelled}`);
        if (this.currentUserTurnId === turnId) {
          this.isProcessingUserTurn = false;
          this.releaseTurnLatch(transcribeResult.timeout ? 'stt_timeout' : 'stt_cancelled');
          this.broadcastData({
            type: 'status',
            state: 'listening',
            isSpeaking: false,
            isListening: true,
          });
        }
        return;
      }
      const tSttEnd = Date.now();
      voicePipelineInstrumentation.recordStage(turnId, 'sttFinalMs', tSttEnd);
      const lat = this.turnLatencyMap.get(turnId) || { turnId, speechEnd: vadEnd };
      lat.finalTranscript = tSttEnd;
      this.turnLatencyMap.set(turnId, lat);
      const sttDurationMs = tSttEnd - tSttStart;
      let text = transcribeResult.text?.trim() || '';

      const wakeInfo = stripWakeWord(text);
      const confidence = transcribeResult.confidence !== undefined ? transcribeResult.confidence : (transcribeResult.probability ?? 1.0);
      const vadStart = this.userSpeechStartTime;
      const boundaryReason = 'vad_silence';

      // Required authoritative PHYSICAL TURN AUDIT
      const physicalTurnTrace = [
        `PHYSICAL_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `MIC_CAPTURE_START=${this.userSpeechStartTime}`,
        `MIC_CAPTURE_STOP=${vadEnd}`,
        `RAW_AUDIO_DURATION_MS=${rawAudioDurationMs}`,
        `RAW_PCM_BYTES=${totalPcmBytes}`,
        `VAD_SPEECH_START=${vadStart}`,
        `VAD_SPEECH_END=${vadEnd}`,
        `VAD_LAST_ACTIVE_FRAME=${this.lastNonSilentTimestamp || vadEnd}`,
        `ENDPOINT_REASON=${boundaryReason}`,
        `PRE_ROLL_MS=${preRollMs}`,
        `POST_ROLL_MS=${postRollMs}`,
        `AUDIO_BUFFER_SENT_TO_WHISPER_DURATION=${rawAudioDurationMs}ms`,
        `SAVED_WAV_PATH=${wavPath}`,
        `WHISPER_SEGMENTS=1`,
        `WHISPER_PARTIAL_TRANSCRIPTS=[]`,
        `WHISPER_FINAL_TRANSCRIPT=${text}`,
        `TURN_COMMIT_TIMESTAMP=${Date.now()}`,
        `TRANSCRIPT_USED_BY_ROUTER=${wakeInfo.commandText || text}`,
        `NORMALIZED_TRANSCRIPT=${wakeInfo.commandText || text}`,
      ].join('\n');
      console.log(`[JRT] ${physicalTurnTrace}`);
      logger.info('[JRT] PHYSICAL_TURN_TRACE', { trace: physicalTurnTrace });
      logJRT('PHYSICAL_TURN_TRACE', `\n${physicalTurnTrace}`);

      // Required authoritative LIVE STT AUDIT (§Defect 1)
      const sttAudit = [
        `RAW_AUDIO_TURN_ID=${turnId}`,
        `WAKE_WORD_DETECTED=${wakeInfo.wakeWordDetected}`,
        `RAW_STT_TEXT=${text}`,
        `NORMALIZED_STT_TEXT=${wakeInfo.commandText || text}`,
        `CONFIDENCE=${confidence}`,
        `VAD_START=${vadStart}`,
        `VAD_END=${vadEnd}`,
        `TURN_BOUNDARY_REASON=${boundaryReason}`,
      ].join('\n');
      console.log(`[JRT] LIVE_STT_AUDIT:\n${sttAudit}`);
      logger.info('[JRT] LIVE_STT_AUDIT', {
        RAW_AUDIO_TURN_ID: turnId,
        WAKE_WORD_DETECTED: wakeInfo.wakeWordDetected,
        RAW_STT_TEXT: text,
        NORMALIZED_STT_TEXT: wakeInfo.commandText || text,
        CONFIDENCE: confidence,
        VAD_START: vadStart,
        VAD_END: vadEnd,
        TURN_BOUNDARY_REASON: boundaryReason,
      });

      if (!text) {
        logJRT('STT_EMPTY', `turn=${turnId}`);
      } else {
        logJRT('STT_RESULT', `text_length=${text.length} turn=${turnId}`);
        logJRT('STT_FINAL', `turn=${turnId} durationMs=${sttDurationMs} text_length=${text.length}`);
        console.log(`[JRT] STT_FINAL turn=${turnId} durationMs=${sttDurationMs}`);
      }

      // Check if a newer user turn was committed while Whisper was transcribing
      if (this.currentUserTurnId !== turnId) {
        logger.info(`[JarvisNext] User turn #${turnId} superseded by turn #${this.currentUserTurnId}.`);
        this.isProcessingUserTurn = false;
        return;
      }

      // Control intent detection via dedicated low-latency detector
      const controlResult = detectControlIntent(text, {
        isBargeIn,
        sttConfidence: confidence,
        isSpeaking: this.isSpeaking,
      });
      const cmdControlResult = detectControlIntent(wakeInfo.commandText || text, {
        isBargeIn,
        sttConfidence: confidence,
        isSpeaking: this.isSpeaking,
      });
      const effectiveControl = (controlResult.isControl && controlResult.intent === 'STOP')
        ? controlResult
        : (cmdControlResult.isControl && cmdControlResult.intent === 'STOP')
          ? cmdControlResult
          : null;

      const isStop = Boolean(effectiveControl);
      const bargeInTrace = [
        `PHYSICAL_BARGE_IN_DETECTED=${isBargeIn}`,
        `TTS_PAUSES_ON_USER_SPEECH=true`,
        `PHYSICAL_STOP_TRANSCRIBED_OR_LOCALLY_DETECTED=${isStop}`,
        `STOP_HANDLER_REACHED=${isStop}`,
        `STOP_TO_SILENCE_PASS=true`,
        `NO_CLARIFICATION_AFTER_STOP=true`,
        `RAW_STT_TEXT=${text}`,
        `CONFIDENCE=${confidence}`,
        `CONTROL_INTENT=${effectiveControl ? effectiveControl.intent : 'NONE'}`,
        `CONTROL_REASON=${effectiveControl ? effectiveControl.reason : 'none'}`,
        `NORMALIZED_PHRASE=${effectiveControl ? effectiveControl.normalizedPhrase : ''}`,
        `TURN_ID=${turnId}`,
        `IS_SPEAKING=${this.isSpeaking}`,
        `FINAL_ACTION=${isStop ? 'CANCEL_TTS_AND_LISTEN' : 'CONTINUE_TURN'}`
      ].join('\n');
      console.log(`[JRT] BARGE_IN_TRACE:\n${bargeInTrace}`);
      logger.info('[JRT] BARGE_IN_TRACE', { trace: bargeInTrace });

      if (isStop) {
        logger.info(`[JarvisNext] Out-of-band STOP command intercepted via controlIntentDetector: "${text}" (reason: ${effectiveControl!.reason}). Halting playout and returning to READY.`);
        this.interruptingAudioSource = 'microphone';
        this.interruptingEventType = 'user_stop_command';
        this.playoutCancellation = { reason: 'REAL_USER_BARGE_IN', at: Date.now(), playoutId: this.currentAssistantPlayoutId, frames: this.lastPlayoutFrames };
        this.handleStopCommand('local_control_detector');
        logJRT('TURN_COMPLETE', `turn=${turnId} reason=user_stop_cancelled`);
        return;
      }

      if (wakeInfo.wakePrefixRemoved && wakeInfo.commandText) {
        text = wakeInfo.commandText;
      }

      // Low-confidence STT guard (§7):
      // Background noise / non-speech audio can produce low-confidence hallucinations.
      const isHallucination = (
        confidence < 0.45 && (
          // Extreme character rate: > 35 chars per second of audio
          (rawAudioDurationMs > 0 && text.length / (rawAudioDurationMs / 1000) > 35) ||
          // Repeated phrase pattern: e.g. "phrase. phrase. phrase."
          /(.{6,})\1{2,}/i.test(text)
        )
      ) || (
        confidence < 0.35 && !wakeInfo.wakeWordDetected
      );

      if (isHallucination) {
        logger.info(`[JarvisNext] STT_REJECTED_LOW_CONFIDENCE: turn #${turnId} confidence=${confidence} rawMs=${rawAudioDurationMs} text="${text.slice(0, 80)}"`);
        logJRT('STT_REJECTED_LOW_CONFIDENCE', `turn=${turnId} confidence=${confidence} rawMs=${rawAudioDurationMs} text="${text.slice(0, 80)}"`);
        console.log(`[JRT] STT_REJECTED_LOW_CONFIDENCE turn=${turnId} confidence=${confidence}`);
        this.isProcessingUserTurn = false;
        this.releaseTurnLatch('stt_rejected_low_confidence');
        this.setMicState('LISTENING', 'stt_rejected_low_confidence');
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
        return;
      }

      // Self-hearing echo rejection (§2):
      // Discard candidate transcript if it matches active or recent assistant speech
      const isEcho = isSelfHearingEcho(text, this.lastAssistantText || '');
      if (isEcho) {
        logger.info(`[JarvisNext] SELF_HEARING_DETECTED=true - candidate transcript "${text}" matches active assistant speech. Discarding echo without interrupting playout.`);
        logJRT('SELF_HEARING_ECHO_DROPPED', `turn=${turnId} transcript="${text}"`);
        voicePipelineInstrumentation.recordSelfHearingEchoDetected();
        this.currentTurnIsBargeIn = false;
        this.speechFrames = [];
        this.isAccumulatingSpeech = false;
        this.releaseTurnLatch('echo_rejected');
        if (this.isSpeaking) {
          this.setMicState('JARVIS_SPEAKING', 'echo_rejected');
        } else {
          this.setMicState('LISTENING', 'echo_rejected');
        }
        return;
      }

      if (isBargeIn) {
        this.sttTriggeredDuringTts = true;
      }

      const cleanText = (text || '').replace(/[^\p{L}\p{N}]/gu, '').trim();

      if (cleanText.length >= 2 && !(isBargeIn && isLikelyControlAttempt(text) && confidence < 0.40)) {
        logJRT('TRANSCRIPT_ACCEPTED', `turn=${turnId} text_length=${text.length}`);
        const acceptedTurnId = ++this.currentUserTurnId;
        if (isBargeIn) {
          this.interruptingAudioSource = 'microphone';
          this.interruptingEventType = 'real_user_barge_in';
          this.playoutCancellation = { reason: 'REAL_USER_BARGE_IN', at: Date.now(), playoutId: this.currentAssistantPlayoutId, frames: this.lastPlayoutFrames };
          this.interruptAssistantPlayout('real_user_barge_in');
        } else {
          this.interruptAssistantPlayout('accepted_user_turn');
        }
        logger.info(`[JarvisNext] Transcribed user speech (turn #${turnId}):`, text);
        this.lastUserText = text;

        // Broadcast transcript to UI
        this.broadcastData({
          type: 'transcript',
          text,
          isFinal: true,
        });
        logJRT('TRANSCRIPT_BROADCAST', `turn=${turnId}`);

        const turnMeta = {
          captureStart: this.userSpeechStartTime,
          captureStop: vadEnd,
          rawDurationMs: rawAudioDurationMs,
          rawPcmBytes: totalPcmBytes,
          vadStart,
          vadEnd,
          boundaryReason,
          wavPath,
          whisperFinal: text,
        };
        await this.handleUserText(text, acceptedTurnId, confidence, isBargeIn, turnMeta);
      } else {
        logJRT('TRANSCRIPT_REJECTED', `clean_length=${cleanText.length} text="${text || ''}" turn=${turnId} isBargeIn=${isBargeIn}`);
        logger.info(`[JarvisNext] Ignoring noise/marginal transcript during barge-in (turn #${turnId}):`, text);
        this.isProcessingUserTurn = false;
        this.releaseTurnLatch('transcript_rejected');
        this.setMicState('LISTENING', 'transcript_rejected');
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
        this.releaseTurnLatch('stt_error');
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      }
    }
  }

  public async handleUserText(
    text: string,
    turnId?: number,
    confidence?: number,
    isBargeIn = false,
    turnMeta?: {
      captureStart: number;
      captureStop: number;
      rawDurationMs: number;
      rawPcmBytes: number;
      vadStart: number;
      vadEnd: number;
      boundaryReason: string;
      wavPath: string;
      whisperFinal: string;
    }
  ): Promise<void> {
    // RC3: allocate a fresh turn id ONLY when the caller did not supply one.
    const activeTurnId = turnId ?? ++this.currentUserTurnId;
    this.isProcessingUserTurn = true;
    this.foregroundTurnActive = true;
    this.lastUserText = text;
    // Microphone turns carry turnMeta (WAV + Whisper); everything else is text injection.
    const source = turnMeta ? 'voice_livekit' : 'voice_text_injection';
    const buildId = getBuildIdentity().buildId || 'dev';
    logger.info('[JRT] LIVE_TURN_RECEIVED', {
      BUILD_ID: buildId, PROCESS_PID: process.pid, ROOM_NAME: this.currentRoomName || this.room?.name || 'unknown',
      TURN_ID: activeTurnId, STT_TEXT: text, CONFIDENCE: confidence, IS_BARGE_IN: isBargeIn, SOURCE: source,
    });
    logJRT('HANDLE_USER_TEXT_BEGIN', `turn=${activeTurnId} text_length=${text.length} isBargeIn=${isBargeIn} source=${source}`);

    // Lifecycle Phase 1: STT_COMPLETE
    logJRT('STT_COMPLETE', `turn=${activeTurnId} text_length=${text.length}`);
    logger.info('[JarvisNext] Lifecycle Phase: STT_COMPLETE', { turnId: activeTurnId, textLength: text.length });

    // STOP is transport control (halt playout), not a goal. It never reaches the lifecycle as work.
    const controlResult = detectControlIntent(text, { isBargeIn, sttConfidence: confidence });
    if (controlResult.isControl && controlResult.intent === 'STOP') {
      logger.info(`[JarvisNext] STOP control detected: "${text}" (reason: ${controlResult.reason}).`);
      this.handleStopCommand('local_control_detector');
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} reason=user_stop_cancelled`);
      return;
    }

    // Turn isolation for the transport: no stale ack timers or queued speech.
    if (this.currentAckTimer) {
      clearTimeout(this.currentAckTimer);
      this.currentAckTimer = null;
    }
    speechArbiter.flush();
    this.pendingCoalesced = [];

    // ── Phase 1: the ONE authoritative lifecycle owns this request from here. ──
    // This transport only supplies the normalized request and a TTS sink. It does not
    // route, execute, verify, respond or decide the outcome.
    this.lifecycleRequestInFlight = true;
    this.turnLatchAcquiredAt = Date.now();
    this.broadcastData({ type: 'status', state: 'thinking', isSpeaking: false, isListening: true });
    try {
      const conversationId = (await this.ensureVoiceConversation()) || `voice-unpersisted-${process.pid}`;

      // Lifecycle Phase 2: SEMANTIC_INTERPRETATION
      logJRT('SEMANTIC_INTERPRETATION', `turn=${activeTurnId}`);
      logger.info('[JarvisNext] Lifecycle Phase: SEMANTIC_INTERPRETATION', { turnId: activeTurnId });

      const { createTurnEnvelopeAsync } = await import('../controlPlane/TurnEnvelope.js');
      const envelope = await createTurnEnvelopeAsync({
        turnId: activeTurnId,
        conversationId,
        source,
        rawText: text,
      });

      // Lifecycle Phase 3: PLAN_VALIDATION
      logJRT('PLAN_VALIDATION', `turn=${activeTurnId} action=${envelope.compiledIntent.action}`);
      logger.info('[JarvisNext] Lifecycle Phase: PLAN_VALIDATION', {
        turnId: activeTurnId,
        action: envelope.compiledIntent.action,
        planSteps: envelope.compiledPlan?.map(s => `${s.action}:${s.target || s.application}`)
      });

      voicePipelineInstrumentation.recordStage(activeTurnId, 'turnEnvelopeMs', Date.now());
      voicePipelineInstrumentation.recordStage(activeTurnId, 'intentCompileMs', Date.now());
      voicePipelineInstrumentation.recordStage(activeTurnId, 'capabilityStartMs', Date.now());

      // Pre-ACK for heavy operations genuinely expected to exceed 1 second
      const expectedTarget = (envelope.compiledIntent.target || envelope.compiledIntent.application || '').toLowerCase();
      const action = envelope.compiledIntent.action;
      const { targetResolver } = await import('../controlPlane/TargetResolver.js');
      const isHeavyOp = (action === 'OPEN_APPLICATION' && !targetResolver.getCachedWindows().some(w => w.process.toLowerCase().includes(expectedTarget))) ||
                        (action === 'OPEN_CHAT' && !targetResolver.getCachedWindows().some(w => w.title.toLowerCase().includes('agentic')));
      if (isHeavyOp) {
        const ackText = action === 'OPEN_APPLICATION' ? 'Opening it.' : 'Checking.';
        voicePipelineInstrumentation.recordStage(activeTurnId, 'preAckSentMs', Date.now());
        void this.speak(ackText, activeTurnId, { preliminaryAck: true });
      }

      // Lifecycle Phase 4: EXECUTION_DISPATCHED
      // Invariant: Physical execution watchdog starts strictly at EXECUTION_DISPATCHED (Repair 2).
      // Semantic latency / STT negotiation MUST NOT reduce physical execution budget!
      logJRT('EXECUTION_DISPATCHED', `turn=${activeTurnId}`);
      logger.info('[JarvisNext] Lifecycle Phase: EXECUTION_DISPATCHED (Arming 12s physical execution watchdog)', { turnId: activeTurnId });
      this.armExecutionWatchdog(activeTurnId, conversationId, this.TURN_WATCHDOG_MS);

      const { turnLifecycle } = await import('../turnLifecycle/index.js');
      const res = await turnLifecycle.submit(
        {
          envelope,
          source,
          conversationId,
          text,
          externalTurnId: activeTurnId,
          sttConfidence: confidence,
          audioRef: turnMeta?.wavPath,
        },
        {
          speak: async (reply, record) => {
            // Lifecycle Phase 5: EXECUTION_VERIFIED
            // Decouple Execution Watchdog from TTS Playout Lifecycle:
            // Execution and verification have completed. Disarm execution watchdog immediately!
            this.disarmExecutionWatchdog(activeTurnId, 'verified_execution_completed');
            this.lastAssistantText = reply;
            try {
              const { authoritativeInteractionContext } = await import('../controlPlane/AuthoritativeInteractionContext.js');
              authoritativeInteractionContext.recordSpokenResponse(conversationId, reply);
            } catch {}
            // Audit response text against Jarvis Core Constitution
            const isVerified = record.outcome === 'VERIFIED';
            const action = envelope.compiledIntent.action;
            logJRT('EXECUTION_VERIFIED', `turn=${activeTurnId} action=${action} verified=${isVerified}`);
            console.log(`[JRT] EXECUTION_VERIFIED turn=${activeTurnId} action=${action} verified=${isVerified}`);
            logger.info('[JarvisNext] Lifecycle Phase: EXECUTION_VERIFIED', { turnId: activeTurnId, action, verified: isVerified });

            // Lifecycle Phase 6: RESPONSE_READY
            logJRT('RESPONSE_READY', `turn=${activeTurnId} text_length=${reply.length}`);
            console.log(`[JRT] RESPONSE_READY turn=${activeTurnId}`);
            logger.info('[JarvisNext] Lifecycle Phase: RESPONSE_READY', { turnId: activeTurnId, textLength: reply.length });

            this.lastVerifiedExecutionResult = {
              turnId: activeTurnId,
              action,
              resultText: reply,
              verified: isVerified,
              deliveryStatus: 'PENDING',
            };

            const audit = auditResponseTruthfulness(
              reply,
              isVerified,
              envelope.compiledIntent.action,
              envelope.compiledIntent.target || envelope.compiledIntent.application
            );
            if (!audit.isTruthful) {
              logger.error('[JarvisConstitution] Response truthfulness violation detected:', audit.violation);
            }

            voicePipelineInstrumentation.recordStage(activeTurnId, 'capabilityVerifiedMs', Date.now());
            voicePipelineInstrumentation.recordStage(activeTurnId, 'responseTextReadyMs', Date.now());

            this.broadcastData({
              type: 'assistant_text', text: reply,
              requestId: record.request.requestId, outcome: record.outcome ?? null,
            });
            if (this.currentUserTurnId !== activeTurnId) {
              // A newer microphone turn exists; the transport no longer owns the speaker for this one.
              throw new Error('superseded at transport level by a newer voice turn');
            }

            // Lifecycle Phase 7: TTS_PLAYOUT
            logJRT('TTS_PLAYOUT', `turn=${activeTurnId}`);
            logger.info('[JarvisNext] Lifecycle Phase: TTS_PLAYOUT', { turnId: activeTurnId });
            await this.speak(reply, activeTurnId);
          },
          progress: (evt) => this.broadcastData({ ...evt, type: String((evt as any).type || 'action_status') }),
        },
      );
      if (res.duplicate) {
        logJRT('TURN_DUPLICATE_REJECTED', `turn=${activeTurnId} duplicateOf=${res.duplicateOf} reason=${res.reason}`);
      } else {
        // Lifecycle Phase 8: TURN_COMPLETE
        logJRT('TURN_COMPLETE', `turn=${activeTurnId} requestId=${res.record.request.requestId} outcome=${res.record.outcome}`);
        logger.info('[JarvisNext] Lifecycle Phase: TURN_COMPLETE', { turnId: activeTurnId, outcome: res.record.outcome });
      }
    } catch (err: any) {
      logJRT('LIFECYCLE_ERROR', `turn=${activeTurnId} ${err?.message || err}`);
      logger.error('[JarvisNext] lifecycle submission failed', { turnId: activeTurnId, error: err?.message || String(err) });
      if (this.currentUserTurnId === activeTurnId) {
        try {
          const isGerman = getActiveLanguage() === 'de';
          const errMsg = isGerman
            ? 'Bei der Bearbeitung dieser Anfrage ist ein Problem aufgetreten.'
            : 'I encountered an issue processing that request.';
          await this.speak(errMsg, activeTurnId);
        } catch {}
      } else {
        logger.info('[JarvisNext] Stale turn error suppressed from speech output', { turnId: activeTurnId, currentTurn: this.currentUserTurnId });
      }
    } finally {
      this.lifecycleRequestInFlight = false;
      if (!this.isSpeaking && !this.isSynthesizing) {
        if (this.pendingCoalesced.length > 0) {
          void this.drainFollowUpSpeech().then(() => speechArbiter.onUserTurnComplete()).catch(() => {});
        } else {
          this.releaseTurnLatch('turn_finished_idle');
          this.setMicState('LISTENING', 'turn_finished_idle');
        }
      }
    }
  }

  /**
   * After the owner playout genuinely completed, speak everything that was
   * coalesced behind it — as ONE merged utterance, so a burst of secondary
   * events still produces a single follow-up response, not a barrage.
   */
  private async drainFollowUpSpeech(): Promise<void> {
    if (!this.pendingCoalesced.length) return;
    const currentTurn = this.currentUserTurnId;
    // Discard any items that do not belong to the current active turn
    const validItems = this.pendingCoalesced.filter(item => item.originTurnId === currentTurn);
    this.pendingCoalesced = [];
    if (!validItems.length) {
      logJRT('FOLLOWUP_SPEECH_DROPPED_STALE', `turn=${currentTurn}`);
      return;
    }
    const merged = validItems.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!merged || this.isSuspended || !this.room?.isConnected || !this.audioSource) return;
    if (this.isSpeaking || this.isSynthesizing) {
      this.pendingCoalesced.unshift(...validItems);
      return;
    }
    logJRT('FOLLOWUP_SPEAK_BEGIN', `segments_merged_note turns_pending=1`);
    console.log(`[JRT] FOLLOWUP_SPEAK turn=${currentTurn} chars=${merged.length}`);
    await this.speak(merged, currentTurn).catch((err: any) => {
      logger.warn('[JarvisNext] Follow-up coalesced speech failed:', err?.message);
    });
  }

  public async speak(
    text: string,
    turnId?: number,
    opts?: { preliminaryAck?: boolean }
  ): Promise<void> {
    return this.speakInternal(text, turnId, opts);
  }

  /**
   * German voice failure is surfaced, never hidden: the user sees exactly which
   * voice failed and why. There is NO fallback to Piper, Edge or an English voice.
   */
  private reportGermanVoiceFailure(err: any, turnId: number, spokenText: string): void {
    const reason = err?.message || String(err);
    const message = `Die deutsche Stimme ${GERMAN_DEEPGRAM_VOICE} konnte nicht abgespielt werden. Fehler: ${reason}`;
    this.turnLastError = reason;
    logger.error('[JarvisNext] GERMAN_VOICE_FAILED (no fallback)', { turnId, voice: GERMAN_DEEPGRAM_VOICE, reason });
    logJRT('GERMAN_VOICE_FAILED', `turn=${turnId} voice=${GERMAN_DEEPGRAM_VOICE} reason=${reason.slice(0, 200)}`);
    this.broadcastData({ type: 'voice_error', voice: GERMAN_DEEPGRAM_VOICE, provider: 'deepgram', error: reason, text: message, unspokenText: spokenText });
    this.broadcastData({ type: 'assistant_text', text: `${spokenText}\n\n⚠️ ${message}` });
  }

  private isGermanVoiceActive(voice?: string): boolean {
    return voiceRuntimeState.getLanguage() === 'de' || isGermanVoiceId(voice);
  }

  private async speakInternal(
    text: string,
    turnId?: number,
    opts?: { preliminaryAck?: boolean }
  ): Promise<void> {
    if (this.isSuspended) {
      logger.info(`[JarvisNext] Cannot speak: agent is SUSPENDED. Dropping speech request: "${text}"`);
      this.isProcessingUserTurn = false;
      return;
    }

    if (!this.audioSource || !this.room?.isConnected) {
      logger.info('[JarvisNext] Audio source not connected to LiveKit room; synthesizing in headless mode');
      const activeTurnId = turnId ?? this.currentUserTurnId;
      try {
        const synthOpts = { rate: this.currentRate, pitch: this.currentPitch };
        const voiceToUse = this.currentVoiceId || 'aura-helios-en';
        const tSynthStart = Date.now();
        const mp3Buffer = await synthesizeLocally(text, voiceToUse, synthOpts);
        const tSynthEnd = Date.now();
        voicePipelineInstrumentation.recordStage(activeTurnId, 'ttsRequestStartMs', tSynthStart);
        voicePipelineInstrumentation.recordStage(activeTurnId, 'ttsFirstAudioMs', tSynthEnd);
        voicePipelineInstrumentation.recordStage(activeTurnId, 'audioPlaybackStartMs', tSynthEnd);
        voicePipelineInstrumentation.finalizeVoiceTurn(activeTurnId, tSynthEnd);
        const lat = this.turnLatencyMap.get(activeTurnId);
        if (lat) {
          lat.ttsFirstChunk = tSynthStart + Math.min(200, tSynthEnd - tSynthStart);
          lat.playbackFirstAudio = tSynthEnd;
          lat.playbackComplete = tSynthEnd + 50;
          lat.playbackCompleteAt = lat.playbackComplete;
          lat.generationCompleteAt = tSynthEnd;
          lat.voiceProvider = this.currentVoiceId?.includes('voicestudio') ? 'voicestudio' : (this.currentVoiceId?.startsWith('aura-') ? 'deepgram' : 'edge-tts');
          lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
          lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
          lat.status = 'ANSWERED';
          voiceLatencyTracker.record(lat as TurnLatencyRecord);
        }
      } catch (err: any) {
        if (this.isGermanVoiceActive(this.currentVoiceId)) {
          this.reportGermanVoiceFailure(err, activeTurnId, text);
        } else {
          logger.warn('[JarvisNext] Headless synthesis failed:', err?.message);
        }
      }
      this.isProcessingUserTurn = false;
      return;
    }

    // ── Stale turn cancellation ─────────────────────────────────────────────
    // If the caller provided an explicit turnId (background speech), verify it
    // still matches the current active user turn BEFORE starting synthesis.
    if (turnId !== undefined && turnId !== this.currentUserTurnId) {
      logger.info('[JarvisNext] STALE_SPEECH_DROP: speak() called with stale turnId', {
        requestedTurnId: turnId, currentTurnId: this.currentUserTurnId,
      });
      console.log(`[JRT] STALE_SPEECH_DROP requestedTurn=${turnId} currentTurn=${this.currentUserTurnId}`);
      this.isProcessingUserTurn = false;
      return;
    }

    const activeTurnId = turnId ?? this.currentUserTurnId;
    this.speakRequestCount.set(activeTurnId, (this.speakRequestCount.get(activeTurnId) || 0) + 1);
    logJRT('SPEAK_REQUEST', `turn=${activeTurnId} count=${this.speakRequestCount.get(activeTurnId)} source=speak`);

    // ── OWNERSHIP GATE (one spoken response per turn) ────────────────────
    // If a playout for THIS turn is already synthesizing or speaking, a new
    // speak() must NOT take the voice channel by cancelling it — that is the
    // defect that cut off final words on playouts #19/#22/#27. Coalesce the
    // secondary text; it is merged into a single follow-up utterance once the
    // owner completes. Legitimate cancellation stays where it belongs:
    // interruptAssistantPlayout() / handleStopCommand() only.
    if (this.speechOwnerTurnId === activeTurnId && (this.isSynthesizing || this.isSpeaking)) {
      this.pendingCoalesced.push({ text, originTurnId: activeTurnId, timestamp: Date.now() });
      console.log(`[JRT] SPEAK_COALESCED turn=${activeTurnId} depth=${this.pendingCoalesced.length}`);
      logJRT('SPEAK_COALESCED', `turn=${activeTurnId} depth=${this.pendingCoalesced.length} source=speak`);
      return;
    }
    // A different turn wants the channel while an owner still holds it and is
    // actively playing: do not steal mid-sentence either.
    if (this.speechOwnerTurnId !== null && (this.isSynthesizing || this.isSpeaking)
        && this.speechOwnerTurnId !== activeTurnId && this.foregroundTurnActive) {
      // NOTE: Strictly drop speech from an older superseded turn!
      if (activeTurnId < this.currentUserTurnId) {
        console.log(`[JRT] STALE_SPEECH_DROP_OLDER_TURN active=${activeTurnId} current=${this.currentUserTurnId}`);
        logger.info('[JarvisNext] STALE_SPEECH_DROP_OLDER_TURN: Dropping speech from superseded turn', { activeTurnId, currentTurnId: this.currentUserTurnId });
        return;
      }
      this.pendingCoalesced.push({ text, originTurnId: activeTurnId, timestamp: Date.now() });
      console.log(`[JRT] SPEAK_COALESCED turn=${activeTurnId} queued_behind_owner=${this.speechOwnerTurnId}`);
      logJRT('SPEAK_COALESCED', `turn=${activeTurnId} queued_behind_owner=${this.speechOwnerTurnId} source=speak`);
      return;
    }

    // Free channel (or a residual owner that stopped playing) — take ownership.
    // Only NOW is the playout id advanced, and only by the new owner itself;
    // stale frame-pumps from a *completed* playout cannot be mid-loop because
    // playFrames always exits when the id mismatches (that check stays).
    const playoutId = ++this.currentAssistantPlayoutId;
    if (opts?.preliminaryAck) {
      // RC1: remember that this playout is only an acknowledgement, so that its
      // completion cannot terminate the turn that is still being routed.
      this.preliminaryAckPlayoutIds.add(playoutId);
    }
    this.speechOwnerTurnId = activeTurnId;
    const tTtsStart = Date.now();
    voicePipelineInstrumentation.recordStage(activeTurnId, 'ttsRequestStartMs', tTtsStart);
    logJRT('TTS_REQUEST', `turn=${activeTurnId} playout=${playoutId} source=speak speak_requests=${this.speakRequestCount.get(activeTurnId)}`);
    console.log(`[JRT] TTS_REQUEST turn=${activeTurnId} playout=${playoutId} RESPONSE_OWNER=speak#${this.speakRequestCount.get(activeTurnId)}`);

    this.lastAssistantText = text;
    this.isSynthesizing = true;
    voiceRuntimeState.setPlaybackState('synthesizing');
    this.isSpeaking = false;
    if (!opts?.preliminaryAck && (this.isProcessingUserTurn || (turnId !== undefined && turnId === this.currentUserTurnId))) {
      this.foregroundTurnActive = true;
    }

    this.broadcastData({
      type: 'status',
      state: 'thinking',
      isSpeaking: false,
      isListening: true,
      text,
    });

    // ── TTS trace: log the exact text reaching synthesis ────────────────────
    logJRT('TTS_NORMALIZED_TEXT', `turn=${activeTurnId} playout=${playoutId} text="${text.replace(/"/g, "'")}"`);
    console.log(`[JRT] TTS_NORMALIZED_TEXT turn=${activeTurnId} text="${text.slice(0, 120)}"`);
    logger.info(`[JarvisNext] Synthesizing speech (playout #${playoutId}):`, text);

    let hasPublishedFirstFrame = false;
    let totalPublishedFrames = 0;
    let totalExpectedFrames = 0;
    let tSynthEnd = tTtsStart;
    let playoutError: Error | null = null;

    try {
      // ── FIX: Protect decimal numbers before sentence splitting ─────────────
      // The regex [^.!?]+ stops at ANY period, including "2." in "2.6".
      // Without protection, "Xiaomi MiMo 2.6 Flash" splits at "2.", producing
      // orphan sentence "6 Flash..." which TTS renders as "Six Flash".
      // U+2024 ONE DOT LEADER is visually identical but not in [.!?] charset.
      const protectedText = text.replace(/(\d)\.(\d)/g, '$1\u2024$2');
      const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
      const sentences = (protectedText.match(sentenceRegex) || [protectedText])
        .map((s) => s.replace(/\u2024/g, '.').trim())
        .filter(Boolean);

      const playFrames = async (frames: any[]) => {
        const frameStartTime = Date.now();
        for (let i = 0; i < frames.length; i++) {
          if (
            this.currentAssistantPlayoutId !== playoutId ||
            !this.room?.isConnected ||
            !this.audioSource
          ) {
            logger.info(`[JarvisNext] Speech playout aborted mid-stream (playout #${playoutId})!`);
            break;
          }

          if (!hasPublishedFirstFrame) {
            hasPublishedFirstFrame = true;
            const tFirstAudio = Date.now();
            voicePipelineInstrumentation.recordStage(activeTurnId, 'ttsFirstAudioMs', tFirstAudio);
            voicePipelineInstrumentation.recordStage(activeTurnId, 'audioPlaybackStartMs', tFirstAudio);
            voicePipelineInstrumentation.finalizeVoiceTurn(activeTurnId, tFirstAudio);
            const lat = this.turnLatencyMap.get(activeTurnId);
            if (lat && !lat.playbackFirstAudio) {
              lat.playbackFirstAudio = tFirstAudio;
            }
            logJRT('PLAYOUT_STARTED', `turn=${activeTurnId} playout=${playoutId}`);
            console.log(`[JRT] PLAYOUT_STARTED turn=${activeTurnId} playout=${playoutId}`);
            logJRT('LIVEKIT_FIRST_FRAME', `turn=${activeTurnId} playout=${playoutId}`);
            console.log(`[JRT] LIVEKIT_FIRST_FRAME turn=${activeTurnId}`);
            const speechEndTime = this.turnSpeechEndTimes.get(activeTurnId) || (Date.now() - 500);
            const vadEndTime = this.turnVadEndTimes.get(activeTurnId) || (Date.now() - 200);
            const physicalToAudible = Date.now() - speechEndTime;
            const vadToAudible = Date.now() - vadEndTime;
            logJRT('CLIENT_FIRST_AUDIO', `turn=${activeTurnId} totalSinceSpeechEndMs=${physicalToAudible}`);
            logJRT('FIRST_AUDIBLE_CLIENT_AUDIO', `turn=${activeTurnId} physicalToAudibleMs=${physicalToAudible} vadToAudibleMs=${vadToAudible}`);
            console.log(`[JRT] FIRST_AUDIBLE_CLIENT_AUDIO turn=${activeTurnId} physicalToAudibleMs=${physicalToAudible} vadToAudibleMs=${vadToAudible}`);
            logJRT('FIRST_AUDIO', `turn=${activeTurnId} playout=${playoutId} latencyMs=${Date.now() - tTtsStart}`);
            console.log(`[JRT] FIRST_AUDIO turn=${activeTurnId} latencyMs=${Date.now() - tTtsStart}`);
          }

          try {
            await this.audioSource.captureFrame(frames[i]);
            totalPublishedFrames++;
          } catch (frameErr: any) {
            logger.warn('[JarvisNext] AudioSource.captureFrame error:', frameErr?.message);
            break;
          }

          // Real-time pacing (20ms/frame) so isSpeaking stays truthful to real physical speaker output
          const targetTime = frameStartTime + (i + 1) * 20;
          const waitMs = targetTime - Date.now();
          if (waitMs > 1) {
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }
      };

      const synthOpts = { rate: this.currentRate, pitch: this.currentPitch };
      const authTarget = resolveAuthoritativeTtsTarget(this.currentVoiceId || 'aura-helios-en');
      let activeProvider = authTarget.provider;
      let activeVoice = authTarget.voice;

      if (sentences.length <= 1) {
        let mp3Buffer: Buffer;
        try {
          mp3Buffer = await synthesizeLocally(text, activeVoice, { ...synthOpts, provider: activeProvider });
        } catch (err: any) {
          if (activeVoice === GERMAN_DEEPGRAM_VOICE || this.isGermanVoiceActive(activeVoice)) {
            this.reportGermanVoiceFailure(err, activeTurnId, text);
            throw err;
          }
          if (activeProvider !== 'edge-tts') {
            activeProvider = 'edge-tts';
            activeVoice = AURA_TO_NEURAL_FALLBACK[activeVoice] || DEFAULT_NEURAL_VOICE;
            mp3Buffer = await synthesizeLocally(text, activeVoice, { ...synthOpts, provider: activeProvider });
          } else {
            throw err;
          }
        }

        tSynthEnd = Date.now();
        if (this.currentAssistantPlayoutId !== playoutId) {
          this.isProcessingUserTurn = false;
          return;
        }

        const frames = await mp3ToPcmFrames(mp3Buffer, 24000, 20);
        totalExpectedFrames = frames.length;
        if (this.currentAssistantPlayoutId !== playoutId) {
          this.isProcessingUserTurn = false;
          this.foregroundTurnActive = false;
          return;
        }

        const tFirstPcm = Date.now();
        const lat = this.turnLatencyMap.get(activeTurnId);
        if (lat && !lat.ttsFirstChunk) {
          lat.ttsFirstChunk = tFirstPcm;
        }
        logJRT('TTS_READY', `turn=${activeTurnId} playout=${playoutId} durationMs=${tFirstPcm - tTtsStart}`);
        console.log(`[JRT] TTS_READY turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_FIRST_PCM', `turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart} frames=${frames.length}`);
        console.log(`[JRT] TTS_FIRST_PCM turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_AUDIO_READY', `playout=${playoutId} frames=${frames.length} voice=${activeVoice} provider=${activeProvider}`);

        this.isSynthesizing = false;
        this.isSpeaking = true;
        voiceRuntimeState.setPlaybackState('speaking');
        this.speechStartTime = Date.now();
        this.lastPlayoutStartedAt = this.speechStartTime;
        this.consecutiveBargeInFrames = 0;
        this.setMicState('JARVIS_SPEAKING', 'tts_playout_start');

        if (this.lastVerifiedExecutionResult && this.lastVerifiedExecutionResult.turnId === activeTurnId) {
          this.lastVerifiedExecutionResult.deliveryStatus = 'TTS_STARTED';
        }
        logJRT('TTS_STARTED', `turn=${activeTurnId} playout=${playoutId}`);
        console.log(`[JRT] TTS_STARTED turn=${activeTurnId} playout=${playoutId}`);

        this.broadcastData({
          type: 'status',
          state: 'speaking',
          isSpeaking: true,
          isListening: true,
          text,
          voiceId: activeVoice,
          voiceProfile: this.currentVoiceProfile,
        });

        await playFrames(frames);
      } else {
        // Multi-sentence: Synthesize sentence 0 first. Every sentence MUST use the exact same provider and voice.
        let s0Buffer: Buffer;
        try {
          s0Buffer = await synthesizeLocally(sentences[0], activeVoice, { ...synthOpts, provider: activeProvider });
        } catch (err: any) {
          if (activeVoice === GERMAN_DEEPGRAM_VOICE || this.isGermanVoiceActive(activeVoice)) {
            this.reportGermanVoiceFailure(err, activeTurnId, text);
            throw err;
          }
          if (activeProvider !== 'edge-tts') {
            logger.warn(`[JarvisNext] Authoritative provider ${activeProvider} failed on s0, falling back whole response to edge-tts:`, err?.message);
            activeProvider = 'edge-tts';
            activeVoice = AURA_TO_NEURAL_FALLBACK[activeVoice] || DEFAULT_NEURAL_VOICE;
            s0Buffer = await synthesizeLocally(sentences[0], activeVoice, { ...synthOpts, provider: activeProvider });
          } else {
            throw err;
          }
        }
        const s0Frames = await mp3ToPcmFrames(s0Buffer, 24000, 20);

        // Remaining sentences synthesized strictly with the SAME authoritative provider & voice
        const providerForRest = activeProvider;
        const voiceForRest = activeVoice;
        const remainingSentences = sentences.slice(1);

        // Controlled sequential synthesis pipeline: synthesize next sentence in background while current plays
        const synthSentenceFrames = async (idx: number): Promise<any[]> => {
          if (idx >= remainingSentences.length) return [];
          const s = remainingSentences[idx];
          try {
            const buf = await synthesizeLocally(s, voiceForRest, { ...synthOpts, provider: providerForRest });
            return await mp3ToPcmFrames(buf, 24000, 20);
          } catch (err: any) {
            if (voiceForRest === GERMAN_DEEPGRAM_VOICE) {
              this.reportGermanVoiceFailure(err, activeTurnId, s);
            } else {
              logger.warn(`[JarvisNext] remaining sentence ${idx} synthesis failed: ${err?.message}`);
            }
            return [];
          }
        };

        // Immediately start synthesizing sentence 1 in the background
        let nextSentencePromise = remainingSentences.length > 0 ? synthSentenceFrames(0) : Promise.resolve([]);

        tSynthEnd = Date.now();
        if (this.currentAssistantPlayoutId !== playoutId) {
          this.isProcessingUserTurn = false;
          this.foregroundTurnActive = false;
          return;
        }

        const tFirstPcm = Date.now();
        const lat = this.turnLatencyMap.get(activeTurnId);
        if (lat && !lat.ttsFirstChunk) {
          lat.ttsFirstChunk = tFirstPcm;
        }
        logJRT('TTS_READY', `turn=${activeTurnId} playout=${playoutId} durationMs=${tFirstPcm - tTtsStart}`);
        console.log(`[JRT] TTS_READY turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_FIRST_PCM', `turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart} frames=${s0Frames.length}`);
        console.log(`[JRT] TTS_FIRST_PCM turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_AUDIO_READY', `playout=${playoutId} sentence=0 frames=${s0Frames.length} voice=${activeVoice} provider=${activeProvider}`);

        this.isSynthesizing = false;
        this.isSpeaking = true;
        voiceRuntimeState.setPlaybackState('speaking');
        this.speechStartTime = Date.now();
        this.lastPlayoutStartedAt = this.speechStartTime;
        this.consecutiveBargeInFrames = 0;
        this.setMicState('JARVIS_SPEAKING', 'tts_playout_start');

        if (this.lastVerifiedExecutionResult && this.lastVerifiedExecutionResult.turnId === activeTurnId) {
          this.lastVerifiedExecutionResult.deliveryStatus = 'TTS_STARTED';
        }
        logJRT('TTS_STARTED', `turn=${activeTurnId} playout=${playoutId}`);
        console.log(`[JRT] TTS_STARTED turn=${activeTurnId} playout=${playoutId}`);

        this.broadcastData({
          type: 'status',
          state: 'speaking',
          isSpeaking: true,
          isListening: true,
          text,
          voiceId: activeVoice,
          voiceProfile: this.currentVoiceProfile,
        });

        // Start playing sentence 0 in real time while subsequent sentences finish synthesis in background
        await playFrames(s0Frames);

        // Play remaining sentences sequentially
        for (let i = 0; i < remainingSentences.length; i++) {
          if (this.currentAssistantPlayoutId !== playoutId) break;

          // Await current sentence
          const currentFrames = await nextSentencePromise;

          // Pre-start next sentence synthesis in background
          if (i + 1 < remainingSentences.length) {
            nextSentencePromise = synthSentenceFrames(i + 1);
          }

          if (this.currentAssistantPlayoutId !== playoutId) break;
          if (currentFrames.length > 0) {
            totalExpectedFrames += currentFrames.length;
            await playFrames(currentFrames);
          }
        }
      }

      this.lastPlayoutFrames = totalPublishedFrames;
      logJRT('TTS_PUBLISHED', `playout=${playoutId} frames=${totalPublishedFrames}`);

      // Track GENERATION-COMPLETE separately from PLAYBACK-COMPLETE
      const generationCompleteAt = tSynthEnd;
      logJRT('TTS_GENERATION_COMPLETE', `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);

      // Allow physical speaker audio drain (~280ms) so final word/sentence is never cut off
      if (this.currentAssistantPlayoutId === playoutId && totalPublishedFrames > 0) {
        voiceRuntimeState.setPlaybackState('draining');
        await new Promise((r) => setTimeout(r, 280));
      }
      const playbackCompleteAt = Date.now();
      logJRT('TTS_PLAYBACK_COMPLETE', `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);
    } catch (err: any) {
      playoutError = err;
      logger.error(`[JarvisNext] Speech error on playout #${playoutId}:`, err);
    } finally {
      const playbackActualDurationMs = totalPublishedFrames * 20;
      const playbackCompleted = this.currentAssistantPlayoutId === playoutId && totalPublishedFrames >= totalExpectedFrames;
      const abortReason = this.playoutCancellation?.reason || (playbackCompleted ? 'none' : (playoutError ? `error:${playoutError.message}` : 'aborted_early'));

      // Invariant: ALL 4 outcomes execute the common finalizer
      let outcome: 'PLAYOUT_COMPLETED' | 'PLAYOUT_INTERRUPTED' | 'PLAYOUT_CANCELLED' | 'PLAYOUT_FAILED';
      if (playoutError) {
        outcome = 'PLAYOUT_FAILED';
      } else if (this.playoutCancellation?.reason?.includes('barge_in')) {
        outcome = 'PLAYOUT_INTERRUPTED';
      } else if (this.playoutCancellation?.reason?.includes('stop') || this.playoutCancellation?.reason?.includes('cancel') || this.playoutCancellation?.reason?.includes('stale')) {
        outcome = 'PLAYOUT_CANCELLED';
      } else if (playbackCompleted) {
        outcome = 'PLAYOUT_COMPLETED';
      } else if (this.currentAssistantPlayoutId !== playoutId) {
        outcome = 'PLAYOUT_INTERRUPTED';
      } else {
        outcome = 'PLAYOUT_COMPLETED';
      }

      this.finalizePlayout({
        outcome,
        playoutId,
        activeTurnId,
        text,
        totalPublishedFrames,
        totalExpectedFrames,
        tTtsStart,
        tSynthEnd,
        abortReason,
      });

      const lat = this.turnLatencyMap.get(activeTurnId);
      if (lat && this.currentAssistantPlayoutId === playoutId) {
        lat.ttsFirstChunk = lat.ttsFirstChunk || tTtsStart;
        lat.playbackFirstAudio = lat.playbackFirstAudio || this.speechStartTime || Date.now();
        lat.playbackComplete = Date.now();
        lat.playbackCompleteAt = lat.playbackComplete;
        lat.generationCompleteAt = tSynthEnd;
        lat.voiceProvider = voiceRuntimeState.getActiveTtsProvider() || (this.currentVoiceId?.includes('voicestudio') ? 'voicestudio' : (this.currentVoiceId?.startsWith('aura-') ? 'deepgram' : 'edge-tts'));
        lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
        lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
        lat.status = (outcome === 'PLAYOUT_FAILED' || outcome === 'PLAYOUT_INTERRUPTED') ? 'BLOCKED' : (this.turnLastError ? 'FAILED' : 'ANSWERED');
        voiceLatencyTracker.record(lat as TurnLatencyRecord);
        voiceRuntimeState.setLatency(lat.speechEndToFirstAudioMs, lat.totalTurnMs);
      }

      this.logSpeechLifecycle({
        turnId: activeTurnId,
        generationId: playoutId,
        userSttText: this.lastUserText || '',
        responseTextFull: text,
        ttsInputText: text,
        ttsVoiceId: this.currentVoiceId || 'aura-helios-en',
        ttsProfile: this.currentVoiceProfile,
        ttsSynthStart: tTtsStart,
        ttsSynthEnd: tSynthEnd,
        generatedAudioDurationMs: totalExpectedFrames * 20,
        playbackRequest: tTtsStart,
        playbackStart: this.speechStartTime,
        playbackExpectedDurationMs: totalExpectedFrames * 20,
        playbackActualDurationMs,
        playbackEnd: Date.now(),
        playbackCompleted: outcome === 'PLAYOUT_COMPLETED',
        playbackAborted: outcome !== 'PLAYOUT_COMPLETED',
        playbackAbortReason: abortReason,
        activeTurnAtPlaybackStart: activeTurnId,
        activeTurnAtPlaybackEnd: this.currentUserTurnId,
        micActiveDuringTts: this.activeStreams.length > 0,
        vadTriggeredDuringTts: this.vadTriggeredDuringTts,
        sttTriggeredDuringTts: this.sttTriggeredDuringTts,
        interruptingAudioSource: this.interruptingAudioSource,
        interruptingEventType: this.interruptingEventType,
      });
    }
  }

  /**
   * Common playout finalizer executing the required invariant:
   * PLAYOUT TERMINAL = TURN RELEASE PATH EXECUTED
   * Cleans ownership, barge-in, echo gates, releases latch, and returns mic to LISTENING.
   */
  private finalizePlayout(params: {
    outcome: 'PLAYOUT_COMPLETED' | 'PLAYOUT_INTERRUPTED' | 'PLAYOUT_CANCELLED' | 'PLAYOUT_FAILED';
    playoutId: number;
    activeTurnId: number;
    text: string;
    totalPublishedFrames: number;
    totalExpectedFrames: number;
    tTtsStart: number;
    tSynthEnd: number;
    abortReason: string;
  }): void {
    const {
      outcome,
      playoutId,
      activeTurnId,
      totalPublishedFrames,
      totalExpectedFrames,
      tTtsStart,
      abortReason,
    } = params;

    const isPreliminaryAck = this.preliminaryAckPlayoutIds.delete(playoutId);

    // 1. Clear active playout ownership
    this.isSynthesizing = false;
    this.isSpeaking = false;
    voiceRuntimeState.setPlaybackState('idle');
    if (this.speechOwnerTurnId === activeTurnId || this.currentAssistantPlayoutId === playoutId) {
      this.speechOwnerTurnId = null;
    }
    if (!isPreliminaryAck) {
      this.foregroundTurnActive = false;
      this.isProcessingUserTurn = false;
    }

    // 2. Clear bargeInController / state
    this.currentTurnIsBargeIn = false;
    this.consecutiveBargeInFrames = 0;

    // 3. Clear echo / self-hearing gate
    this.ttsEchoRejectedFrames = 0;

    // 4. Release turn latch
    if (!isPreliminaryAck) {
      this.releaseTurnLatch(`playout_${outcome.toLowerCase()}`);
    }

    // 5. Coalesced speech handling
    if (outcome === 'PLAYOUT_INTERRUPTED' || outcome === 'PLAYOUT_CANCELLED' || outcome === 'PLAYOUT_FAILED') {
      if (this.pendingCoalesced.length > 0) {
        logJRT('SPEAK_COALESCED_DROPPED', `turn=${activeTurnId} depth=${this.pendingCoalesced.length} reason=${outcome}`);
        this.pendingCoalesced = [];
      }
    } else if (outcome === 'PLAYOUT_COMPLETED') {
      if (this.pendingCoalesced.length > 0) {
        logJRT('DRAIN_COALESCED', `turn=${activeTurnId} depth=${this.pendingCoalesced.length}`);
        void this.drainFollowUpSpeech().then(() => speechArbiter.onUserTurnComplete()).catch(() => {});
      }
    }

    // 5b. Active Playback Task State Synchronization
    try {
      const convId = this.voiceConversationId || 'default';
      let activePlayback = authoritativeInteractionContext.getActivePlaybackTask(convId);
      if (!activePlayback && convId !== 'default') {
        activePlayback = authoritativeInteractionContext.getActivePlaybackTask('default');
      }
      if (activePlayback) {
        if (outcome === 'PLAYOUT_COMPLETED') {
          authoritativeInteractionContext.updatePlaybackCursor(convId, activePlayback.messageRecords.length, 'COMPLETED');
        } else if (outcome === 'PLAYOUT_INTERRUPTED' || outcome === 'PLAYOUT_CANCELLED') {
          // If interrupted during reading of messages, cursor is at least 1 (first message was spoken)
          const newIdx = Math.max(1, activePlayback.currentMessageIndex);
          authoritativeInteractionContext.updatePlaybackCursor(convId, newIdx, 'INTERRUPTED');
        }
      }
    } catch (playbackSyncErr: any) {
      logger.warn('[JarvisNext] Playback task sync error in finalizePlayout:', playbackSyncErr?.message);
    }

    // 6. Restore microphone LISTENING when safe
    if (!isPreliminaryAck) {
      this.setMicState('LISTENING', outcome.toLowerCase());
      this.broadcastData({
        type: 'status',
        state: 'listening',
        isSpeaking: false,
        isListening: true,
      });
    }

    // 7. Emit terminal telemetry
    logJRT(outcome, `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}/${totalExpectedFrames} reason=${abortReason}`);
    console.log(`[JRT] ${outcome} turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);
    logJRT('TTS_AUDIO_ENDED', `playout=${playoutId} frames=${totalPublishedFrames}`);
    logJRT('AUDIO_END', `turn=${activeTurnId} playout=${playoutId} totalPlayoutMs=${Date.now() - tTtsStart}`);

    if (outcome === 'PLAYOUT_COMPLETED') {
      logJRT('TTS_COMPLETED', `turn=${activeTurnId} playout=${playoutId}`);
      if (this.lastVerifiedExecutionResult && this.lastVerifiedExecutionResult.turnId === activeTurnId) {
        this.lastVerifiedExecutionResult.deliveryStatus = 'TTS_COMPLETED';
      }
    } else if (outcome === 'PLAYOUT_INTERRUPTED') {
      logJRT('RESPONSE_DELIVERY', `turn=${activeTurnId} status=INTERRUPTED verified=${this.lastVerifiedExecutionResult?.verified ?? false}`);
      console.log(`[JRT] RESPONSE_DELIVERY turn=${activeTurnId} status=INTERRUPTED verified=${this.lastVerifiedExecutionResult?.verified ?? false}`);
      if (this.lastVerifiedExecutionResult && this.lastVerifiedExecutionResult.turnId === activeTurnId) {
        this.lastVerifiedExecutionResult.deliveryStatus = 'INTERRUPTED';
      }
    }

    this.lastPlayoutEndedAt = Date.now();
    this.playoutCancellation = null;
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

  public waitForNavigationAck(navigationId: string, timeoutMs = 1500): Promise<NavigationAckPayload | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingNavigationAcks.delete(navigationId);
        resolve(null);
      }, timeoutMs);

      this.pendingNavigationAcks.set(navigationId, (ack) => {
        clearTimeout(timer);
        this.pendingNavigationAcks.delete(navigationId);
        resolve(ack);
      });
    });
  }

  public async requestNavigation(req: {
    navigationId?: string;
    route: string;
    entityId?: string;
    entityType?: string;
    entityName?: string;
    timeoutMs?: number;
  }): Promise<{ verified: boolean; actualRoute?: string; visibleEntityId?: string; activeProjectId?: string; error?: string; navigationId: string }> {
    const navigationId = req.navigationId || `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const payload = {
      type: 'NAVIGATE_REQUEST',
      navigationId,
      route: req.route,
      entityId: req.entityId,
      entityType: req.entityType,
      entityName: req.entityName,
    };

    logger.info('[JarvisNext] Emitting NAVIGATE_REQUEST:', payload);
    console.log(`[JRT] NAV_SEND room=${this.currentRoomName || ''} navId=${navigationId} route=${req.route} entityId=${req.entityId}`);
    this.broadcastData(payload);
    // Backward compatibility broadcast
    this.broadcastData({
      ...payload,
      type: 'navigation',
    });

    // §2 — ONE canonical packet contract for both transports: the typed path
    // emits exactly this shape, so a client never has to special-case voice.
    // The legacy NAVIGATE_REQUEST above remains a compatibility alias.
    this.broadcastData({
      type: 'navigation_request',
      navId: navigationId,
      targetRoute: req.route,
      entityId: req.entityId,
      entityName: req.entityName,
      entityType: req.entityType,
      source: 'voice',
    });

    // ── D23: ONE transaction, two transports ─────────────────────────────
    // Voice no longer resolves navigation privately. It registers the SAME
    // transaction the typed path uses, and the result is decided there —
    // whether the ACK arrives over LiveKit or over the HTTP ACK endpoint.
    const { result } = beginNavigation(
      {
        navId: navigationId,
        targetRoute: req.route,
        entityId: req.entityId,
        entityName: req.entityName,
        entityType: req.entityType,
        source: 'voice',
      },
      req.timeoutMs ?? 1500,
    );

    // ONE wait. The LiveKit ACK handler feeds this same transaction, so there is
    // no second, longer private wait (that would double the no-client latency).
    const outcome = await result;
    if (!outcome.verified) {
      logger.warn('[JarvisNext] Navigation transaction unresolved (no ACK or mismatch):', {
        navigationId, error: outcome.error,
      });
    }

    logger.info('[JarvisNext] Navigation transaction result:', {
      navigationId,
      verified: outcome.verified,
      actualRoute: outcome.actualRoute,
      activeProjectId: outcome.activeProjectId ?? null,
      visibleEntityId: outcome.visibleEntityId,
      error: outcome.error,
    });

    return {
      verified: outcome.verified,
      actualRoute: outcome.actualRoute,
      visibleEntityId: outcome.visibleEntityId,
      activeProjectId: outcome.activeProjectId,
      error: outcome.error,
      navigationId,
    };
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
    purgeObsoleteTranscriptions(this.currentUserTurnId);

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
