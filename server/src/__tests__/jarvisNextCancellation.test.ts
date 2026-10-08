import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@livekit/rtc-node', () => ({ Room: class {}, AudioSource: class {}, AudioStream: class {}, LocalAudioTrack: {}, TrackPublishOptions: class {}, TrackSource: {}, RoomEvent: {} }));
vi.mock('../domains/jarvisNext/tokenService.js', () => ({ LIVEKIT_CONFIG: {}, generateAgentToken: vi.fn() }));
vi.mock('../domains/jarvisNext/audioUtils.js', () => ({ mp3ToPcmFrames: vi.fn(), pcmChunksToWav: vi.fn(() => Buffer.alloc(44)) }));
vi.mock('../services/voice/localTts.js', () => ({ synthesizeLocally: vi.fn() }));
vi.mock('../services/voice/localTranscribe.js', () => ({
  transcribeLocally: vi.fn(),
  cancelLocalTranscription: vi.fn(),
  purgeObsoleteTranscriptions: vi.fn(),
  isMeaningfulSpeech: vi.fn(() => true),
}));
vi.mock('../domains/jarvisNext/operator/operatorController.js', () => ({ operatorController: { handleIntent: vi.fn(async () => ({ handled: false })) } }));
vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../domains/jarvisNext/livekitServerManager.js', () => ({ ensureLivekitServerRunning: vi.fn() }));

import { JarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';
import { llmChat } from '../services/llmGateway.js';
import { transcribeLocally } from '../services/voice/localTranscribe.js';

describe('Jarvis live voice cancellation and capture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an empty recording does not cancel pending assistant output and uses English STT', async () => {
    vi.mocked(transcribeLocally).mockResolvedValueOnce({ text: '' });
    const agent: any = new JarvisNextAgent();
    agent.currentAssistantPlayoutId = 7;
    agent.currentUserTurnId = 3;
    agent.speechFrames = Array.from({ length: 20 }, () => Buffer.alloc(960));
    await agent.commitUserTurn();
    expect(agent.currentAssistantPlayoutId).toBe(7);
    expect(agent.currentUserTurnId).toBe(3);
    expect(transcribeLocally).toHaveBeenCalledWith(expect.anything(), '.wav', 'en', 3, 400);
  });

  it('Stop suppresses an in-flight reasoning reply but permits the next request', async () => {
    let resolveReply!: (value: any) => void;
    vi.mocked(llmChat).mockImplementationOnce(() => new Promise(resolve => { resolveReply = resolve; }));
    const agent = new JarvisNextAgent();
    const speak = vi.spyOn(agent, 'speak').mockResolvedValue();
    const pending = agent.handleUserText('What is two plus two?');
    await vi.waitFor(() => expect(llmChat).toHaveBeenCalledTimes(1));
    agent.interrupt();
    resolveReply({ reply: 'Four' });
    await pending;
    expect(speak).not.toHaveBeenCalled();
    vi.mocked(llmChat).mockResolvedValueOnce({ reply: 'Six' } as any);
    await agent.handleUserText('What is three plus three?');
    expect(speak).toHaveBeenCalledWith(expect.stringMatching(/Six|6/), expect.anything());
  });

  it('does not interpret a question containing stop as a stop command', async () => {
    vi.mocked(llmChat).mockResolvedValue({ reply: 'Here is how.' } as any);
    const agent = new JarvisNextAgent();
    vi.spyOn(agent, 'speak').mockResolvedValue();
    await agent.handleUserText('How do I stop a timer?');
    expect(llmChat).toHaveBeenCalled();
  });

  it('a spoken stop command remains silent', async () => {
    const agent = new JarvisNextAgent();
    const speak = vi.spyOn(agent, 'speak').mockResolvedValue();
    await agent.handleUserText('Jarvis, stop speaking.');
    expect(speak).not.toHaveBeenCalled();
    expect(llmChat).not.toHaveBeenCalled();
  });

  it('keeps quiet samples and owns captured bytes after the native buffer changes', async () => {
    const agent: any = new JarvisNextAgent();
    const samples = new Int16Array(480).fill(1200);
    agent.processUserAudioFrame({ data: samples, sampleRate: 24000, channels: 1 });
    samples.fill(100);
    agent.processUserAudioFrame({ data: samples, sampleRate: 24000, channels: 1 });
    samples.fill(0);
    expect(agent.speechFrames[0].readInt16LE(0)).toBe(1200);
    expect(agent.speechFrames[1].readInt16LE(0)).toBe(100);
    await agent.stop();
    expect(agent.isAccumulatingSpeech).toBe(false);
  });
});
