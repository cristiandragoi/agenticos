import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';
import * as stt from '../services/voice/localTranscribe.js';
import * as gateway from '../services/llmGateway.js';
import { speechArbiter, SpeechPriority } from '../domains/jarvisNext/speechArbiter.js';
import { authoritativeInteractionContext as context } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { conversationCapabilityAdapter as conversation } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { mediaCapabilityAdapter, inspectGeneratedImage } from '../domains/controlPlane/adapters/MediaCapabilityAdapter.js';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { rawDb } from '../db/index.js';

const frame = (energy: number) => ({ data: new Int16Array(480).fill(energy), sampleRate: 24000, channels: 1 });
beforeEach(() => { speechArbiter.flush(); context.resetContext('phase-one'); });
afterEach(() => vi.restoreAllMocks());

describe('phase one stop capture (controlled PCM and transcription; not acoustic acceptance)', () => {
  it('recognizes stop while an atomic action owns the turn without submitting another execution turn', async () => {
    const agent = new JarvisNextAgent() as any;
    agent.voiceConversationId = 'phase-one'; agent.isProcessingUserTurn = true;
    agent.broadcastData = () => {};
    const submit = vi.spyOn(agent, 'handleUserText').mockResolvedValue(undefined);
    const stop = vi.spyOn(agent, 'handleStopCommand');
    vi.spyOn(stt, 'transcribeLocally').mockResolvedValue({ text: 'Jarvis stop', confidence: 0.95 });
    for (let i = 0; i < 28; i++) agent.processUserAudioFrame(frame(1800));
    agent.processUserAudioFrame(frame(0));
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce(), { timeout: 1500 });
    expect(agent.isProcessingUserTurn).toBe(false); expect(agent.deferredMicFrames).toHaveLength(0);
    expect(submit).not.toHaveBeenCalled();
  });
  it('retains a non-control follow-up while the owning atomic action is busy', async () => {
    const agent = new JarvisNextAgent() as any;
    agent.isProcessingUserTurn = true; agent.broadcastData = () => {};
    const stop = vi.spyOn(agent, 'handleStopCommand');
    const transcribe = vi.spyOn(stt, 'transcribeLocally').mockResolvedValue({ text: 'Now open YouTube', confidence: 0.95 });
    for (let i = 0; i < 28; i++) agent.processUserAudioFrame(frame(1800));
    agent.processUserAudioFrame(frame(0));
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    expect(stop).not.toHaveBeenCalled(); expect(agent.isProcessingUserTurn).toBe(true);
    expect(agent.deferredMicFrames.length).toBeGreaterThan(20);
  });
  it('ignores a late busy-control transcript after voice ownership changes', async () => {
    const agent = new JarvisNextAgent() as any;
    agent.isProcessingUserTurn = true; agent.broadcastData = () => {};
    const stop = vi.spyOn(agent, 'handleStopCommand');
    let resolve: (value: any) => void;
    const transcribe = vi.spyOn(stt, 'transcribeLocally').mockImplementation(() => new Promise(done => { resolve = done; }));
    for (let i = 0; i < 28; i++) agent.processUserAudioFrame(frame(1800));
    agent.processUserAudioFrame(frame(0));
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    agent.currentUserTurnId++;
    resolve!({ text: 'Jarvis stop', confidence: 0.95 });
    await new Promise(done => setTimeout(done, 0));
    expect(stop).not.toHaveBeenCalled(); expect(agent.isProcessingUserTurn).toBe(true);
  });
  it('captures and endpoints stop during sustained playout, then invalidates audio and clears queued speech', async () => {
    const agent = new JarvisNextAgent() as any;
    agent.voiceConversationId = 'phase-one'; agent.isSpeaking = true; agent.speechStartTime = Date.now() - 2000;
    agent.currentAssistantPlayoutId = 41; agent.speechOwnerTurnId = 1;
    const clearQueue = vi.fn(); agent.audioSource = { clearQueue };
    const packets: any[] = []; agent.broadcastData = (packet: any) => packets.push(packet);
    const stop = vi.spyOn(agent, 'handleStopCommand');
    const submit = vi.spyOn(agent, 'handleUserText').mockResolvedValue(undefined);
    const transcribe = vi.spyOn(stt, 'transcribeLocally').mockResolvedValue({ text: 'Okay Jarvis, stop.', confidence: 0.95 });
    speechArbiter.register({ speakFn: async () => {}, getCurrentTurnId: () => 1, isUserTurnActive: () => true });
    await speechArbiter.request({ text: 'A pending goal result', priority: SpeechPriority.P2_PROGRESS,
      responseType: 'goal_result', goalSignal: new AbortController().signal });
    // Energy is below the old 3600 floor, yet represents sustained speech.
    for (let i = 0; i < 28; i++) agent.processUserAudioFrame(frame(2000));
    expect(agent.speechFrames.length).toBeGreaterThan(20);
    expect(agent.isSpeaking).toBe(true); // Energy alone never stops playback.
    agent.processUserAudioFrame(frame(0));
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce(), { timeout: 1500 });
    expect(transcribe).toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(agent.currentAssistantPlayoutId).toBe(42);
    expect(agent.isSpeaking).toBe(false); expect(clearQueue).toHaveBeenCalledOnce();
    expect(speechArbiter.snapshot().queueDepth).toBe(0);
    expect(packets.some(p => p.type === 'stop_playback')).toBe(true);
    expect(packets.some(p => p.type === 'provisional_barge_in')).toBe(false);
  });

  it('records a candidate continuously without resetting its initial audio on later peaks', () => {
    const agent = new JarvisNextAgent() as any;
    agent.isSpeaking = true; agent.speechStartTime = Date.now() - 2000; agent.broadcastData = () => {};
    for (let i = 0; i < 3; i++) agent.processUserAudioFrame(frame(2000));
    const first = agent.speechFrames[0];
    for (let i = 0; i < 30; i++) agent.processUserAudioFrame(frame(5000));
    expect(agent.speechFrames[0]).toBe(first); expect(agent.speechFrames.length).toBeGreaterThan(30);
    expect(agent.isSpeaking).toBe(true);
  });

  it('keeps playout running when the transcript is a verbatim speaker echo', async () => {
    const agent = new JarvisNextAgent() as any;
    agent.isSpeaking = true; agent.speechStartTime = Date.now() - 2000; agent.broadcastData = () => {};
    agent.lastAssistantText = 'The final result is available for review.';
    vi.spyOn(stt, 'transcribeLocally').mockResolvedValue({ text: agent.lastAssistantText, confidence: 0.95 });
    const stop = vi.spyOn(agent, 'handleStopCommand');
    for (let i = 0; i < 25; i++) agent.processUserAudioFrame(frame(1500));
    agent.processUserAudioFrame(frame(0));
    await vi.waitFor(() => expect(agent.isAccumulatingSpeech).toBe(false), { timeout: 1500 });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(stop).not.toHaveBeenCalled(); expect(agent.isSpeaking).toBe(true);
  });
});

describe('truthful capability reporting and contextual reasoning', () => {
  it('persists dialogue separately from physical verification and reloads it for the same conversation', () => {
    context.recordDialogueTurn('phase-one', 'user', 'Use real tools, show progress, and let me handle Google authorization.');
    context.recordSpokenResponse('phase-one', 'Video generation is not integrated yet.');
    const row = rawDb.prepare('SELECT turns_json FROM jarvis_dialogue_memory WHERE conversation_id = ?').get('phase-one') as any;
    expect(JSON.parse(row.turns_json)).toHaveLength(2);
    (context as any).contexts.delete('phase-one');
    const restored = context.getContext('phase-one');
    expect(restored.dialogueHistory?.[0].text).toContain('Google authorization');
    expect(restored.lastVerifiedResult).toBeNull();
  });

  it('passes the earlier instruction and real capability limits to the existing gateway for a follow-up', async () => {
    context.recordDialogueTurn('phase-one', 'user', 'Create a cinematic advertisement using a real app. I will handle login.');
    const model = vi.spyOn(gateway, 'llmChat').mockResolvedValue({ reply: JSON.stringify({ reply: 'You want the real advertisement workflow and will handle login. Video creation is not integrated yet.' }), provider: 'controlled', offline: false });
    const result = await conversation.execute({ ...AuthoritativeIntentCompiler.compile("I already said it. I will not repeat it."), action: 'CONVERSATIONAL', target: null } as any, 'followup', 'phase-one');
    const supplied = JSON.parse(model.mock.calls[0][0].prompt);
    expect(supplied.dialogueHistory[0].text).toContain('real app');
    expect(supplied.capabilityFacts.cinematicVideoCreation).toContain('Not integrated');
    expect(result.outputText).toContain('will handle login'); expect(result.outputText).not.toContain('repeat the');
  });

  it('includes dialogue history in semantic interpretation without granting new capabilities', async () => {
    context.recordDialogueTurn('phase-one', 'user', 'I want to use free tools and handle sign-in personally.');
    const model = vi.spyOn(gateway, 'llmChat').mockResolvedValue({ reply: JSON.stringify({ schemaVersion: '1', turnType: 'CONVERSATIONAL', confidence: 0.95, steps: [{ action: 'CONVERSATIONAL' }] }), provider: 'controlled', offline: false });
    semanticDiscourseInterpreter.setMockProvider(null);
    await semanticDiscourseInterpreter.interpret('What about that earlier instruction?', { conversationId: 'phase-one' });
    const payload = model.mock.calls[0][0].prompt;
    expect(payload).toContain('free tools'); expect(payload).toContain('cinematicVideoGeneration');
  });

  it.each(['I have created', "I've created", 'I will create'])( 'rejects a conversation-model claim: %s the advertisement', async (claim) => {
    vi.spyOn(gateway, 'llmChat').mockResolvedValue({ reply: JSON.stringify({ reply: `${claim} the cinematic advertisement.` }), provider: 'controlled', offline: false });
    const result = await conversation.execute({ ...AuthoritativeIntentCompiler.compile('What about the advertisement?'), action: 'CONVERSATIONAL', target: null } as any, 'claim', 'phase-one');
    expect(result.outputText).toContain('No advertisement has been completed');
  });

  it('explains internal numbers instead of explaining an unrelated camera success', async () => {
    const result = await conversation.execute({ ...AuthoritativeIntentCompiler.compile('Why are you telling me about millions?'), action: 'CONVERSATIONAL', target: 'explain_previous_outcome' } as any, 'numbers', 'phase-one');
    expect(result.outputText).toContain('internal file details'); expect(result.outputText).not.toContain('camera was completed');
  });

  it('rejects the actual 1x1 placeholder bytes even if a provider reports success', async () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    expect(inspectGeneratedImage(bytes)).toEqual({ width: 1, height: 1 });
    const adapter = mediaCapabilityAdapter as any;
    const providers = adapter.providers;
    adapter.providers = [{ name: 'controlled_bad_provider', isAvailable: async () => true, generate: async () => ({ success: true, imageBuffer: bytes, mimeType: 'image/png' }) }];
    try {
      const result = await adapter.generateImage({ taskId: 'bad-image', prompt: 'Product artwork', operation: 'IMAGE_GENERATE' });
      expect(result.success).toBe(false); expect(result.artifact).toBeUndefined(); expect(result.error).toContain('placeholder');
    } finally { adapter.providers = providers; }
  });

  it('does not call a generator that cannot use the captured reference image', async () => {
    const adapter = mediaCapabilityAdapter as any; const providers = adapter.providers;
    const generate = vi.fn(); adapter.providers = [{ name: 'non_reference_provider', isAvailable: async () => true, generate }];
    try {
      const result = await adapter.generateImage({ taskId: 'reference', operation: 'IMAGE_GENERATE', prompt: 'Advertisement',
        sourceImageArtifact: { artifactId: 'camera-frame', type: 'CAMERA_FRAME', location: 'frame.jpg', createdByTaskId: 'capture', verified: true, createdAt: Date.now() } });
      expect(generate).not.toHaveBeenCalled(); expect(result.success).toBe(false); expect(result.error).toContain('No advertisement was created');
    } finally { adapter.providers = providers; }
  });

  it('does not publish late provider output after user cancellation', async () => {
    const adapter = mediaCapabilityAdapter as any; const providers = adapter.providers;
    const controller = new AbortController();
    adapter.providers = [{ name: 'late_provider', isAvailable: async () => true,
      generate: async (request: any) => {
        expect(request.signal).toBe(controller.signal);
        controller.abort();
        return { success: true, imageBuffer: Buffer.alloc(100), mimeType: 'image/png' };
      } }];
    try {
      const result = await adapter.generateImage({ taskId: 'cancelled-image', operation: 'IMAGE_GENERATE', prompt: 'Artwork', signal: controller.signal });
      expect(result.success).toBe(false); expect(result.artifact).toBeUndefined(); expect(result.error).toContain('cancelled');
    } finally { adapter.providers = providers; }
  });
});
