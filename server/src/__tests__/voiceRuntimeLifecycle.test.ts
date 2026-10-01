/**
 * voiceRuntimeLifecycle.test.ts — regression suite for the Jarvis voice runtime
 * lifecycle failure observed live on the installed runtime.
 *
 * Live evidence this suite encodes (build d14253df-dirty-20260921-065519, PID 37164):
 *   - "Start the project Shopify." was committed at 06:58:32.662 as turn #6,
 *     routed to browser.click, and its executor failed with
 *     "Browser navigation failed: unverified host".
 *   - No TURN_COMPLETE for turn #6 was ever logged: the turn had NO terminal outcome.
 *   - `isProcessingUserTurn` therefore stayed true, and jarvisNextAgent's mic gate
 *     (`if (this.isProcessingUserTurn) return;`) discarded every subsequent frame —
 *     so USER_SPEECH_START never fired again despite the user speaking loudly
 *     (AUDIO_LEVEL rms=1680 at 06:58:41.910, rms=1575 at 06:58:47.965).
 *     Jarvis was permanently deaf; the user's "Jarvis?" produced nothing.
 *   - Separately, at 07:00:57.260 a 76-character reply was cut off after ~140 frames
 *     by "Assistant playout interrupted (barge_in)" — with no verified human barge-in.
 *
 * Layer note: this suite drives the real invariant engine, the real barge-in
 * decision function the audio loop calls, and the real FailureDetector/incident
 * store. It does NOT drive a microphone or a LiveKit room; acoustic acceptance is
 * performed by the user.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  evaluateVoiceInvariants,
  decideBargeIn,
  detectTruncation,
  buildEngineeringEvidencePack,
  raiseVoiceInvariantIncident,
  persistOriginalGoalForRetry,
  takeOriginalGoalForRetry,
  voiceRecoveryAnnouncement,
  VOICE_INVARIANT_IDS,
  type VoiceTurnEvidence,
} from '../domains/jarvisNext/voiceRuntimeInvariants.js';
import { rawDb } from '../db/index.js';

/**
 * Test scaffold: the vitest database is not migrated, so the incidents table the
 * production FailureDetector writes into must exist. Columns mirror
 * domains/selfHeal/schema.ts exactly.
 */
beforeAll(() => {
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS repair_incidents (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      component TEXT NOT NULL,
      failure_domain TEXT NOT NULL,
      symptom TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      resolved_at TEXT,
      triggered_by TEXT NOT NULL,
      priority TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
  `);
});

const BARGES = { graceMs: 700, playoutFloor: 900, sustainFrames: 8 };

/** The real captured state of turn #6 at the moment it stalled. */
function stuckTurn6(): VoiceTurnEvidence {
  return {
    turnId: 6,
    conversationId: 'conv-d179e881-',
    transcript: 'Start the project Shopify.',
    sttConfidence: 0.8061,
    committedAt: 1789973912662,
    rawAudioDurationMs: 1759,
    vadStartMs: 1789973908495,
    vadEndMs: 1789973910254,
    endpointReason: 'vad_silence',
    route: 'project_operate',
    executor: 'browser',
    executorCompleted: false,
    isProcessingUserTurn: true,
    isAccumulatingSpeech: false,
    isSpeaking: false,
    isListening: true,
    ambientNoiseFloor: 4,
    droppedFramesWhileLatched: 42,
    droppedSpeechEstimateMs: 840,
    lastError: 'Browser navigation failed: unverified host',
  };
}

// ── 5. transcript committed → a terminal outcome is guaranteed ──────────────

describe('turn lifecycle — every committed turn must end terminally', () => {
  it('5. a committed turn with no terminal outcome is reported as VOICE_TURN_STUCK', () => {
    const fired = evaluateVoiceInvariants({
      terminal: false,
      turn: stuckTurn6(),
      listenerRearmed: true,
    });
    expect(fired.map((f) => f.id)).toContain('VOICE_TURN_STUCK');
    const detail = fired.find((f) => f.id === 'VOICE_TURN_STUCK')!.detail;
    expect(detail).toContain('turn 6');
    expect(detail).toContain('unverified host');
  });

  it('6. a terminal turn does NOT fire the stuck invariant (latch released after success)', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: { ...stuckTurn6(), executorCompleted: true, isProcessingUserTurn: false },
      listenerRearmed: true,
    });
    expect(fired.map((f) => f.id)).not.toContain('VOICE_TURN_STUCK');
    expect(fired.map((f) => f.id)).not.toContain('VOICE_TURN_LATCH_LEAK');
  });

  it('7. a FAILED turn that released its latch is clean; a failed turn that held it is a leak', () => {
    const failedClean = evaluateVoiceInvariants({
      terminal: true,
      turn: { ...stuckTurn6(), executorCompleted: false, isProcessingUserTurn: false },
      listenerRearmed: true,
    });
    expect(failedClean).toHaveLength(0);

    const failedHeld = evaluateVoiceInvariants({
      terminal: true,
      turn: { ...stuckTurn6(), executorCompleted: false, isProcessingUserTurn: true },
      listenerRearmed: true,
    });
    expect(failedHeld.map((f) => f.id)).toContain('VOICE_TURN_LATCH_LEAK');
  });

  it('8. a CANCELLED turn that released its latch is clean', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: {
        ...stuckTurn6(),
        executorCompleted: false,
        isProcessingUserTurn: false,
        cancellationReason: 'user_stop_command',
        ttsState: 'idle',
      },
      listenerRearmed: true,
    });
    expect(fired.map((f) => f.id)).not.toContain('VOICE_TURN_LATCH_LEAK');
    expect(fired.map((f) => f.id)).not.toContain('VOICE_TURN_STUCK');
  });
});

// ── 1, 2, 9. listener re-arm after an action / after TTS ───────────────────

describe('listener re-arm', () => {
  it('1. after a browser action completed, the turn is terminal and the listener is rearmed', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: { ...stuckTurn6(), executor: 'browser', executorCompleted: true, isProcessingUserTurn: false, isListening: true },
      listenerRearmed: true,
    });
    expect(fired).toHaveLength(0);
  });

  it('2. after TTS completed (AUDIO_ENDED), the latch is released so the mic re-arms', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: {
        ...stuckTurn6(),
        isProcessingUserTurn: false,
        isSpeaking: false,
        ttsState: 'ended',
        ttsEndedAt: 1789973920000,
      },
      listenerRearmed: true,
    });
    expect(fired).toHaveLength(0);
  });

  it('2b. VOICE_NOT_REARMED fires when the turn is terminal but the listener never returns', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: { ...stuckTurn6(), isProcessingUserTurn: false, isListening: false },
      listenerRearmed: false,
    });
    expect(fired.map((f) => f.id)).toContain('VOICE_NOT_REARMED');
  });

  it('9. a wake-word turn after a browser execution is not blocked by a held latch', () => {
    // The user's "Jarvis?" at 06:58:41 arrived while the latch was still held.
    // With the latch released, that same state must no longer suppress a turn.
    const blocked = evaluateVoiceInvariants({ terminal: false, turn: stuckTurn6(), listenerRearmed: false });
    expect(blocked.map((f) => f.id)).toContain('VOICE_TURN_STUCK');

    const recovered = evaluateVoiceInvariants({
      terminal: true,
      turn: { ...stuckTurn6(), isProcessingUserTurn: false, droppedFramesWhileLatched: 0 },
      listenerRearmed: true,
    });
    expect(recovered).toHaveLength(0);
  });
});

// ── 3, 4. barge-in must be a person, never our own audio ───────────────────

describe('barge-in / echo guard', () => {
  it('3. Jarvis\'s own TTS energy does NOT trigger a barge-in', () => {
    // Echo of our own playback: clears the idle floor (dynamicFloor ~= 363..1000)
    // but not the playout floor.
    expect(
      decideBargeIn({ rms: 800, msSincePlayoutStart: 5000, ambientNoiseFloor: 30, consecutiveFrames: 99, ...BARGES }),
    ).toBe('reject_echo');
    expect(
      decideBargeIn({ rms: 850, msSincePlayoutStart: 9000, ambientNoiseFloor: 4, consecutiveFrames: 99, ...BARGES }),
    ).toBe('reject_echo');
  });

  it('3b. the first moments of our own playback are inside the echo grace', () => {
    expect(
      decideBargeIn({ rms: 2000, msSincePlayoutStart: 120, ambientNoiseFloor: 4, consecutiveFrames: 99, ...BARGES }),
    ).toBe('reject_grace');
  });

  it('4. a real human barge-in still works: loud AND sustained', () => {
    // The live human levels observed in the log were rms 1356 and 1680.
    expect(
      decideBargeIn({ rms: 1356, msSincePlayoutStart: 2000, ambientNoiseFloor: 4, consecutiveFrames: 8, ...BARGES }),
    ).toBe('trigger');
    expect(
      decideBargeIn({ rms: 1680, msSincePlayoutStart: 3000, ambientNoiseFloor: 4, consecutiveFrames: 12, ...BARGES }),
    ).toBe('trigger');
  });

  it('4b. one loud frame is not enough — a person must be sustained', () => {
    expect(
      decideBargeIn({ rms: 1500, msSincePlayoutStart: 2000, ambientNoiseFloor: 4, consecutiveFrames: 2, ...BARGES }),
    ).toBe('sustain');
  });
});

// ── TTS_PREMATURE_TERMINATION ──────────────────────────────────────────────

describe('TTS premature termination', () => {
  it('a cancelled playout with no verified human barge-in fires TTS_PREMATURE_TERMINATION', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: {
        turnId: 0,
        ttsState: 'ended',
        ttsStartedAt: 1789974054075,
        ttsFramesPublished: 140,
        cancellationReason: 'barge_in',
        bargeInVerifiedHuman: false,
        isProcessingUserTurn: false,
        isListening: true,
      },
      listenerRearmed: true,
      bareBargeInVerified: false,
    });
    expect(fired.map((f) => f.id)).toContain('TTS_PREMATURE_TERMINATION');
  });

  it('a playout that reached its own AUDIO_ENDED does not fire', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: {
        turnId: 0,
        ttsState: 'ended',
        ttsStartedAt: 1789974054075,
        ttsEndedAt: 1789974059000,
        ttsFramesPublished: 400,
        isProcessingUserTurn: false,
        isListening: true,
      },
      listenerRearmed: true,
    });
    expect(fired.map((f) => f.id)).not.toContain('TTS_PREMATURE_TERMINATION');
  });

  it('a VERIFIED human barge-in is not a defect', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: {
        turnId: 0,
        ttsState: 'ended',
        ttsStartedAt: 1789974054075,
        cancellationReason: 'barge_in',
        ttsFramesPublished: 140,
        bargeInVerifiedHuman: true,
        isProcessingUserTurn: false,
        isListening: true,
      },
      listenerRearmed: true,
      bareBargeInVerified: true,
    });
    expect(fired.map((f) => f.id)).not.toContain('TTS_PREMATURE_TERMINATION');
  });
});

// ── 13. WAV vs transcript classification ──────────────────────────────────

describe('13. input truncation classification', () => {
  it('a complete WAV with a complete transcript is not truncation', () => {
    expect(detectTruncation({ turnId: 1, rawAudioDurationMs: 1759, transcript: 'Start the project Shopify.' })).toBeNull();
  });

  it('B: a complete WAV whose transcript lost most of the speech IS truncation', () => {
    const verdict = detectTruncation({
      turnId: 2,
      rawAudioDurationMs: 27960,
      transcript: 'You know what',
    });
    expect(verdict).toBeTruthy();
    expect(verdict).toMatch(/implies ~\d+ words/);
  });

  it('an empty transcript over non-trivial audio is truncation', () => {
    expect(detectTruncation({ turnId: 3, rawAudioDurationMs: 4000, transcript: '' })).toMatch(/transcript is empty/);
  });

  it('no duration evidence means no verdict (never guess)', () => {
    expect(detectTruncation({ turnId: 4, transcript: 'hello' })).toBeNull();
  });
});

// ── 14. dead air and unclear speech must NOT open an incident ─────────────

describe('14. uncertainty alone never opens a Self-Heal incident', () => {
  it('low confidence but a clean terminal turn fires nothing', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: {
        turnId: 9,
        transcript: 'mmbl',
        sttConfidence: 0.12,
        isProcessingUserTurn: false,
        isListening: true,
        ttsState: 'idle',
      },
      listenerRearmed: true,
    });
    expect(fired).toHaveLength(0);
  });

  it('a quiet, short, noisy capture fires nothing', () => {
    const fired = evaluateVoiceInvariants({
      terminal: true,
      turn: { turnId: 10, transcript: '', rawAudioDurationMs: 300, isProcessingUserTurn: false, isListening: true },
      listenerRearmed: true,
    });
    expect(fired).toHaveLength(0);
  });
});

// ── 10, 11. the incident really reaches the Self-Heal / Hermes path ───────

describe('10 & 11. invariant → FailureDetector → Self-Heal incident → engineering', () => {
  it('10. a fired invariant creates a real incident row', async () => {
    const [stuck] = evaluateVoiceInvariants({ terminal: false, turn: stuckTurn6(), listenerRearmed: false });
    expect(stuck.id).toBe('VOICE_TURN_STUCK');

    const res = await raiseVoiceInvariantIncident(stuck, { watchdogMs: 120000 });
    expect(res.raised).toBe(true);
    expect(res.incidentId).toMatch(/^SELFHEAL-\d+$/);

    const row: any = rawDb
      .prepare('SELECT * FROM repair_incidents WHERE id = ?')
      .get(res.incidentId);
    expect(row).toBeTruthy();
    expect(row.component).toBe('voice_turn_lifecycle');
    expect(row.failure_domain).toBe('voice');
    expect(row.priority).toBe('high');
  });

  it('11. the incident carries the full evidence pack Hermes needs — no guessing', async () => {
    const [stuck] = evaluateVoiceInvariants({ terminal: false, turn: stuckTurn6(), listenerRearmed: false });
    const res = await raiseVoiceInvariantIncident(stuck, { watchdogMs: 120000 });
    const row: any = rawDb.prepare('SELECT metadata FROM repair_incidents WHERE id = ?').get(res.incidentId);
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;

    expect(metadata.source).toBe('voice_runtime_invariant');
    expect(metadata.invariant).toBe('VOICE_TURN_STUCK');
    expect(metadata.conversationId).toBe('conv-d179e881-');

    const pack: string = metadata.evidencePack;
    for (const field of [
      'FAILING_INVARIANT=VOICE_TURN_STUCK',
      'TURN_ID=6',
      'CONVERSATION_ID=conv-d179e881-',
      'TRANSCRIPT=Start the project Shopify.',
      'STT_CONFIDENCE=0.8061',
      'ROUTE=project_operate',
      'EXECUTOR=browser',
      'EXECUTOR_COMPLETED=false',
      'IS_PROCESSING_USER_TURN=true',
      'DROPPED_FRAMES_WHILE_LATCHED=42',
      'LAST_ERROR=Browser navigation failed: unverified host',
    ]) {
      expect(pack, `evidence pack missing ${field}`).toContain(field);
    }
  });

  it('the evidence pack is built from the invariant, verbatim', () => {
    const [stuck] = evaluateVoiceInvariants({ terminal: false, turn: stuckTurn6(), listenerRearmed: false });
    const pack = buildEngineeringEvidencePack(stuck, { watchdogMs: 120000 });
    expect(pack).toContain('FAILING_INVARIANT=VOICE_TURN_STUCK');
    expect(pack).toContain('WATCHDOGMS=120000');
  });

  it('every declared invariant id is evaluable', () => {
    // Guards against an invariant being declared but never reachable.
    expect(VOICE_INVARIANT_IDS).toEqual([
      'VOICE_TURN_STUCK',
      'VOICE_NOT_REARMED',
      'TTS_PREMATURE_TERMINATION',
      'VOICE_TURN_LATCH_LEAK',
      'STT_TRUNCATION',
      'ECHO_DROPPED_LEGITIMATE_SPEECH',
    ]);
  });
});

// ── 12. original goal retried exactly once ─────────────────────────────────

describe('12. original goal is retried once, never twice', () => {
  it('persists the goal and hands it back exactly once', async () => {
    await persistOriginalGoalForRetry({
      goal: 'Start the project Shopify.',
      conversationId: 'conv-d179e881-',
      incidentId: 'SELFHEAL-999',
      turnId: 6,
    });

    const first = await takeOriginalGoalForRetry();
    expect(first).toBeTruthy();
    expect(first!.goal).toBe('Start the project Shopify.');
    expect(first!.goalRecordId).toBeTruthy();

    // Second call must not produce a duplicate action.
    const second = await takeOriginalGoalForRetry();
    expect(second).toBeNull();
  });
});

// ── F. user-facing wording ────────────────────────────────────────────────

describe('F. recovery announcement states the real situation', () => {
  it('names the defect and the incident, and claims no repair yet', () => {
    const [stuck] = evaluateVoiceInvariants({ terminal: false, turn: stuckTurn6(), listenerRearmed: false });
    const text = voiceRecoveryAnnouncement([stuck], ['SELFHEAL-070']);
    expect(text).toMatch(/voice runtime/i);
    expect(text).toMatch(/SELFHEAL-070/);
    expect(text).toMatch(/Hermes/i);
    expect(text).not.toMatch(/\bfixed\b|\brepaired\b/i);
  });

  it('says so plainly when no incident could be opened', () => {
    const [stuck] = evaluateVoiceInvariants({ terminal: false, turn: stuckTurn6(), listenerRearmed: false });
    const text = voiceRecoveryAnnouncement([stuck], []);
    expect(text).toMatch(/could not open a Self-Heal incident/i);
  });
});
