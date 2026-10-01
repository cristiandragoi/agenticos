/**
 * Voice execution-path regression harness — RC1 (acknowledgement lifecycle) and
 * RC3 (turn identity).
 *
 * This drives the REAL route:
 *
 *     handleUserText()  ->  routing  ->  speak() playout
 *
 * Nothing about the routing decision is mocked. Only external side effects are
 * replaced:
 *   - node:child_process: the single choke point through which any desktop
 *     application launch, browser launch, PowerShell automation or shell command
 *     would happen. Mocking it guarantees NO real GUI application (Chrome,
 *     Outlook, Calculator, Telegram, Comet, ...) can be opened by this suite.
 *   - TTS synthesis / MP3 decoding / local transcription: audio and disk I/O.
 *   - the LLM gateway: outbound network.
 *
 * speak() is deliberately NOT mocked for the RC1 lifecycle tests: the defect
 * being guarded against lives inside speak()'s playout-finally block, so a
 * mocked speak() would prove nothing.
 *
 * Every assertion is made against state the production code actually produced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hard safety: nothing in this suite may spawn a process. ──────────────────
const fakeChild = () => ({
  on: () => {}, once: () => {}, off: () => {}, emit: () => {},
  stdout: null, stderr: null, stdin: null, kill: () => {}, unref: () => {},
  pid: 4242, killed: false, exitCode: 0,
});
vi.mock('node:child_process', () => ({
  spawn: vi.fn(fakeChild),
  fork: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execFile: vi.fn((_f: any, _a: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), pid: 4242 })),
  default: {},
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })),
  default: {},
}));

vi.mock('@livekit/rtc-node', () => ({
  Room: class {}, AudioSource: class {}, AudioStream: class {},
  LocalAudioTrack: {}, TrackPublishOptions: class {}, TrackSource: {}, RoomEvent: {},
}));
vi.mock('../domains/jarvisNext/tokenService.js', () => ({ LIVEKIT_CONFIG: {}, generateAgentToken: vi.fn() }));
// Two frames => ~40ms of playout: fast, but the real playout loop still runs.
vi.mock('../domains/jarvisNext/audioUtils.js', () => ({
  mp3ToPcmFrames: vi.fn(async () => [Buffer.alloc(960), Buffer.alloc(960)]),
  pcmChunksToWav: vi.fn(() => Buffer.alloc(44)),
}));
vi.mock('../services/voice/localTts.js', () => ({ synthesizeLocally: vi.fn(async () => Buffer.alloc(64)) }));
vi.mock('../services/voice/localTranscribe.js', () => ({ transcribeLocally: vi.fn() }));
vi.mock('../domains/jarvisNext/operator/operatorController.js', () => ({
  operatorController: { handleIntent: vi.fn(async () => ({ handled: false })) },
}));
vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn(async () => ({ reply: 'llm fallback reply' })) }));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../domains/jarvisNext/livekitServerManager.js', () => ({ ensureLivekitServerRunning: vi.fn() }));

import { JarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';

const TURN_META = {
  captureStart: 0, captureStop: 1000, rawDurationMs: 1000, rawPcmBytes: 1000,
  vadStart: 0, vadEnd: 1000, boundaryReason: 'vad', wavPath: 'test.wav',
  whisperFinal: 'test',
};

/**
 * An utterance the REAL router answers locally — no database, no tool execution,
 * no application launching. Keeps the turn-identity tests fast and side-effect
 * free while still going through the production routing path.
 */
const DETERMINISTIC_PROMPT = 'what time of day comes after morning';
const DETERMINISTIC_ANSWER = 'Afternoon comes after morning.';

/** Agent wired with a fake LiveKit room/audio source so the REAL speak() runs. */
function makeSpeakingAgent(): any {
  const agent: any = new JarvisNextAgent();
  agent.room = {
    isConnected: true,
    name: 'test-room',
    localParticipant: { publishData: vi.fn(async () => undefined) },
  };
  agent.audioSource = { captureFrame: vi.fn(async () => undefined), clearQueue: vi.fn() };
  return agent;
}

describe('RC1 — acknowledgement lifecycle does not release the active turn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the acknowledgement playout completing does NOT release the turn latch', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 5;
    agent.isProcessingUserTurn = true;      // the router is still computing
    agent.foregroundTurnActive = true;
    agent.turnLatchAcquiredAt = Date.now();

    await agent.speak("I'm checking that now.", 5, { preliminaryAck: true });

    expect(agent.isProcessingUserTurn).toBe(true);
    expect(agent.foregroundTurnActive).toBe(true);
    expect(agent.isSpeaking).toBe(false);
    // Channel handed back so the real answer can take it...
    expect(agent.speechOwnerTurnId).toBeNull();
    // ...but the microphone is NOT reopened while the turn is in flight.
    expect(agent.micState).not.toBe('LISTENING');
  });

  it('the real answer playout DOES release the turn latch', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 5;
    agent.isProcessingUserTurn = true;
    agent.foregroundTurnActive = true;
    agent.turnLatchAcquiredAt = Date.now();

    await agent.speak('The answer is 42.', 5);
    await new Promise((r) => setTimeout(r, 500));   // release is deferred 400ms
    expect(agent.isProcessingUserTurn).toBe(false);
    expect(agent.foregroundTurnActive).toBe(false);
  });

  it('ack then answer never leaves the latch stuck', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 7;
    agent.isProcessingUserTurn = true;
    agent.turnLatchAcquiredAt = Date.now();

    await agent.speak('I am checking the camera now.', 7, { preliminaryAck: true });
    expect(agent.isProcessingUserTurn).toBe(true);

    await agent.speak('The camera shows a desk.', 7);
    await new Promise((r) => setTimeout(r, 500));
    expect(agent.isProcessingUserTurn).toBe(false);
  });

  it('if an acknowledgement is spoken it is marked as a preliminary ack', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak');
    agent.currentUserTurnId = 3;

    // A visual/perception utterance schedules the ~650ms acknowledgement.
    await agent.handleUserText('look at my screen and tell me what is open', 3, 0.95, false, TURN_META);
    await new Promise((r) => setTimeout(r, 1000));

    const ackCall = speakSpy.mock.calls.find((c) => /checking/i.test(String(c[0])));
    if (ackCall) {
      // An ack that was spoken must be marked preliminary, so its playout can
      // never terminate the turn that is still being routed.
      expect(ackCall[2]).toEqual({ preliminaryAck: true });
      expect(ackCall[1]).toBe(3);
    }
    speakSpy.mockRestore();
  });

  it('a stale speak() for a superseded turn is never played out', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 11;              // the turn has already moved on
    const framesBefore = agent.audioSource.captureFrame.mock.calls.length;

    await agent.speak('late answer for turn 10', 10);   // real speak()

    expect(agent.audioSource.captureFrame.mock.calls.length).toBe(framesBefore);
    expect(agent.speechOwnerTurnId).toBeNull();
  });
});

describe('RC3 — turn identity through the real handleUserText path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allocates exactly one turn id per request, and never a second one', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined);
    const before = agent.currentUserTurnId;

    // Caller supplies no id (HTTP entry point / data channel / tests).
    await agent.handleUserText(DETERMINISTIC_PROMPT);
    expect(agent.currentUserTurnId).toBe(before + 1);

    // Caller supplies the id it already allocated (the voice path).
    await agent.handleUserText(DETERMINISTIC_PROMPT, before + 1);
    expect(agent.currentUserTurnId).toBe(before + 1);

    expect(speakSpy).toHaveBeenCalled();
    speakSpy.mockRestore();
  });

  it('the answer is associated with its own turn across 20 consecutive turns', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined);
    const answeredTurns: number[] = [];

    for (let i = 1; i <= 20; i++) {
      agent.currentUserTurnId = i;
      const callsBefore = speakSpy.mock.calls.length;
      await agent.handleUserText(DETERMINISTIC_PROMPT, i, 0.95, false, TURN_META);

      // Scope the lookup to the calls THIS turn made: the answer text is
      // identical every iteration, so a plain find() would return turn 1's call.
      const call = speakSpy.mock.calls
        .slice(callsBefore)
        .find((c) => String(c[0]) === DETERMINISTIC_ANSWER);
      expect(call).toBeDefined();
      answeredTurns.push(call![1] as number);
      // The counter must never drift while turns are processed.
      expect(agent.currentUserTurnId).toBe(i);
    }

    expect(answeredTurns).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    speakSpy.mockRestore();
  });

  it('an unrelated request does not produce repeated runtime-status messages', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined);
    const broadcasts: any[] = [];
    const broadcastSpy = vi.spyOn(agent, 'broadcastData').mockImplementation((p: any) => {
      broadcasts.push(p);
    });

    agent.currentUserTurnId = 3;
    await agent.handleUserText(DETERMINISTIC_PROMPT, 3, 0.95, false, TURN_META);

    const assistantTexts = broadcasts.filter((b) => b?.type === 'assistant_text').map((b) => b.text);
    expect(assistantTexts).toEqual([DETERMINISTIC_ANSWER]);
    expect(assistantTexts.join(' ')).not.toMatch(/checking that now|checking the camera/i);

    speakSpy.mockRestore();
    broadcastSpy.mockRestore();
  });
});
