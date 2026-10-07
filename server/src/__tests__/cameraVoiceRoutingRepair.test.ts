import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { validateStructuredIntent } from '../domains/controlPlane/StructuredIntent.js';
import { capabilityMethodSelector } from '../domains/controlPlane/CapabilityMethodSelector.js';
import { universalCapabilityRuntime } from '../domains/controlPlane/UniversalCapabilityRuntime.js';
import { universalPerceptionService } from '../domains/controlPlane/UniversalPerceptionService.js';
import { conversationCapabilityAdapter } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import { autonomousPlanner } from '../domains/controlPlane/taskGraph/AutonomousPlanner.js';
import { taskGraphExecutor } from '../domains/controlPlane/taskGraph/TaskGraphExecutor.js';
import { JarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';
import * as stt from '../services/voice/localTranscribe.js';

afterEach(() => vi.restoreAllMocks());

describe('reported camera and microphone routing defects (controlled regressions)', () => {
  it.each([
    ['Jarvis, take a screenshot of the thing that I am holding in my hand.', 'CAMERA_CAPTURE'],
    ["Jarvis, do you see what I'm holding in my hand?", 'CAMERA_OBSERVE'],
    ['Open the camera, I said, and tell me what you see.', 'CAMERA_OBSERVE'],
  ])('routes %s to %s', (text, action) => {
    expect(AuthoritativeIntentCompiler.compile(text).action).toBe(action);
  });

  it('corrects a model misclassification of a single camera action as a goal', () => {
    const result = validateStructuredIntent({ schemaVersion: '1', turnType: 'COMMAND', confidence: 0.95,
      executionMode: 'AUTONOMOUS_GOAL', userGoal: 'Open camera and tell me what you see',
      steps: [{ action: 'CAMERA_OBSERVE', target: 'camera' }] });
    expect(result.validatedIntent?.executionMode).toBe('DIRECT_ACTION');
    expect(result.validatedIntent?.steps[0].action).toBe('CAMERA_OBSERVE');
  });

  it.each(['Locate Julian Goldy SEO on YouTube.', 'Open Julian Goldy SEO on YouTube.'])('keeps %s on YouTube', text => {
    const step = AuthoritativeIntentCompiler.compile(text, { activeApplication: 'Telegram' });
    expect(step.action).toBe('NAVIGATE_WEB');
    expect(step.contentRequest?.toLowerCase()).toBe('https://www.youtube.com/results?search_query=julian%20goldy%20seo');
  });

  it('executes capture through the real selector/runtime/adapter rather than conversation', async () => {
    // Only the hardware/storage boundary is controlled here. A separate live probe
    // captures an actual webcam JPEG and verifies its stored hash.
    const capture = vi.spyOn(universalPerceptionService, 'captureCameraArtifact').mockResolvedValue({
      success: true, artifact: { artifactId: 'controlled-frame', type: 'CAMERA_FRAME', location: 'controlled.jpg',
        createdByTaskId: 'capture', verified: true, createdAt: Date.now(), sha256: 'controlled-hash', dimensions: { width: 1280, height: 720 } },
    });
    const conversation = vi.spyOn(conversationCapabilityAdapter, 'execute');
    const step = AuthoritativeIntentCompiler.compile("Jarvis, take a screenshot of the thing that I'm holding in my hand.");
    const result = await universalCapabilityRuntime.executeStep(step, 'capture-test', 'camera-route-regression');
    expect(capture).toHaveBeenCalledOnce();
    expect(conversation).not.toHaveBeenCalled();
    expect(result.action).toBe('CAMERA_CAPTURE');
    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.verificationEvidence?.source).toBe('camera_capture');
  });

  it('never certifies an unmapped physical action as a conversational success', async () => {
    const step = { ...AuthoritativeIntentCompiler.compile('Hello'), action: 'UNMAPPED_PHYSICAL_ACTION' } as any;
    expect(capabilityMethodSelector.selectMethod(step, {} as any, {} as any).adapterId).toBe('unsupported');
    const result = await conversationCapabilityAdapter.execute(step, 'unmapped', 'camera-route-regression');
    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.action).toBe('UNMAPPED_PHYSICAL_ACTION');
  });

  it('fails an unsupported goal instead of marking planned text as completed work', async () => {
    const graph = autonomousPlanner.planGoal({ schemaVersion: '1', executionMode: 'AUTONOMOUS_GOAL',
      userGoal: 'Open camera and tell me what you see', confidence: 1, needsClarification: false });
    const result = await taskGraphExecutor.executeGraph(graph);
    expect(result.success).toBe(false);
    expect(result.graph.status).not.toBe('COMPLETED');
    expect(result.resultSummary).not.toContain('Planned task for');
  });

  it('acknowledges confirmation without the generic listening loop', async () => {
    const result = await conversationCapabilityAdapter.execute(
      AuthoritativeIntentCompiler.compile("Yes, that's right. You read it all correct."), 'feedback', 'feedback-regression');
    expect(result.outputText).toBe('Thanks for confirming.');
  });

  it('preserves speech during execution and replays it through the same audio ingress after release', async () => {
    const agent = new JarvisNextAgent() as any;
    agent.isProcessingUserTurn = true;
    const frame = { data: new Int16Array(480).fill(10000), sampleRate: 24000, channels: 1 };
    agent.processUserAudioFrame(frame);
    frame.data.fill(0); // Native memory reuse must not alter the saved utterance.
    expect(agent.deferredMicFrames.length).toBeGreaterThan(0);
    expect(agent.deferredMicFrames.at(-1).data[0]).toBe(10000);
    const ingress = vi.spyOn(agent, 'processUserAudioFrame').mockImplementation(() => {});
    agent.releaseTurnLatch('controlled_action_completed');
    await Promise.resolve();
    expect(ingress).toHaveBeenCalled();
    expect(agent.deferredMicFrames).toHaveLength(0);
  });

  it('rejects a late partial transcript after speech has resumed in the same turn', async () => {
    const agent = new JarvisNextAgent() as any;
    let resolveStt!: (value: any) => void;
    vi.spyOn(stt, 'transcribeLocally').mockImplementation(() => new Promise(resolve => { resolveStt = resolve; }));
    agent.isAccumulatingSpeech = true;
    agent.speechFrames = Array.from({ length: 20 }, () => Buffer.alloc(960));
    const frame = (energy: number) => ({ data: new Int16Array(480).fill(energy), sampleRate: 24000, channels: 1 });
    agent.processUserAudioFrame(frame(0));
    const oldResolve = resolveStt;
    agent.processUserAudioFrame(frame(10000)); // Resumed sentence invalidates old audio snapshot.
    agent.processUserAudioFrame(frame(0));
    oldResolve({ text: 'Okay, bye.' });
    await Promise.resolve();
    expect(agent.precomputedSttResult).toBeNull();
    clearTimeout(agent.silenceTimeout);
    agent.silenceTimeout = null;
  });
});
