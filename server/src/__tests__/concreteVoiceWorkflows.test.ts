import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { parseConcreteAppRequest, parseYouTubeChannelRequest, isYouTubeHomeRequest } from '../domains/controlPlane/ConcreteVoiceRequests.js';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { authoritativeInteractionContext as memory } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { autonomousPlanner } from '../domains/controlPlane/taskGraph/AutonomousPlanner.js';
import { browserCapabilityAdapter } from '../domains/controlPlane/adapters/BrowserCapabilityAdapter.js';
import { browserCodeProvider } from '../domains/controlPlane/browser/BrowserCodeProvider.js';
import { browserCodeSession } from '../domains/controlPlane/browser/BrowserCodeSession.js';
import fs from 'node:fs';

afterEach(() => { vi.restoreAllMocks(); semanticDiscourseInterpreter.setMockProvider(null); memory.resetContext('workflow-routing'); });
describe('observed microphone workflow routing', () => {
  it('does not mistake the browser launch clause for a YouTube channel', () => {
    expect(parseYouTubeChannelRequest('Open Chrome and open YouTube.')).toBeNull();
    expect(isYouTubeHomeRequest('Open Chrome and open YouTube.')).toBe(true);
    expect(parseYouTubeChannelRequest('Open Chrome and open YouTube and find Julian Goldie SEO')).toEqual({ channel: 'Julian Goldie SEO', openVideo: false });
    expect(parseYouTubeChannelRequest('Find Chrome on YouTube')).toEqual({ channel: 'Chrome', openVideo: false });
  });
  it.each([
    'Open YouTube and navigate to Julian Goldie, SEO.',
    'Go to YouTube and navigate to Julian Goldie SEO channel',
    'Jarvis, go to go to YouTube. Jarvis. Go to YouTube. YouTube. And navigate to Julian Goldie SEO channel',
    'Find Julian Goldie SEO on YouTube',
    'Open YouTube and search for Julian Goldie SEO channel',
  ])('maps natural wording to the existing channel workflow: %s', async text => {
    expect(parseYouTubeChannelRequest(text)).toEqual({ channel: 'Julian Goldie SEO', openVideo: false });
    const interpreted = await semanticDiscourseInterpreter.interpret(text);
    expect(interpreted.structuredIntent?.executionMode).toBe('AUTONOMOUS_GOAL');
    expect([...autonomousPlanner.planGoal(interpreted.structuredIntent!.goalIntent!).nodes.values()].map(n => n.operation)).toEqual(['YOUTUBE_SEARCH_CHANNEL', 'YOUTUBE_OPEN_CHANNEL', 'PRESENT_RESULT']);
  });
  it('binds a separate navigation sentence only to a verified YouTube context', async () => {
    expect(parseYouTubeChannelRequest('Navigate to Julian Goldie SEO')).toBeNull();
    memory.recordVerifiedStepSuccess('workflow-routing', 0, { application: 'Chrome', url: 'https://www.youtube.com/', targetType: 'BROWSER' });
    const interpreted = await semanticDiscourseInterpreter.interpret('Navigate to Julian Goldie SEO', { conversationId: 'workflow-routing' });
    expect(interpreted.plan.steps[0].target).toBe('Julian Goldie SEO');
    expect(interpreted.structuredIntent?.goalIntent?.userGoal).toContain('YouTube');
    expect(AuthoritativeIntentCompiler.compile('Navigate to the channel', { conversationId: 'workflow-routing' }).contentRequest).toBe('Which YouTube channel would you like me to open?');
    expect(AuthoritativeIntentCompiler.compile('Julian Goldie SEO', { conversationId: 'workflow-routing' })).toMatchObject({ action: 'NAVIGATE_WEB', target: 'Julian Goldie SEO' });
  });
  it('gives homepage connection and loading a goal lifetime and refuses a negated channel command', async () => {
    expect(AuthoritativeIntentCompiler.compile('Jarvis, go to YouTube')).toMatchObject({ action: 'NAVIGATE_WEB', target: 'YouTube' });
    const result = await semanticDiscourseInterpreter.interpret('Jarvis, go to YouTube');
    expect(result.structuredIntent?.executionMode).toBe('AUTONOMOUS_GOAL');
    expect([...autonomousPlanner.planGoal(result.structuredIntent!.goalIntent!).nodes.values()].map(n => n.operation)).toEqual(['YOUTUBE_OPEN_HOME', 'PRESENT_RESULT']);
    expect(parseYouTubeChannelRequest("Do not navigate to Julian Goldie SEO on YouTube")).toBeNull();
  });
  it.each(["Can you open what's up?", 'Open WhatsApp', 'Can you open WhatsApp again?'])('opens the requested app: %s', text => {
    expect(AuthoritativeIntentCompiler.compile(text).application).toBe('WhatsApp');
  });
  it.each(['Jarvis, open hammers 1.', 'Open Hermes one', 'Open Hermes 1'])('resolves %s as the installed app, never a delegation', text => {
    const step = AuthoritativeIntentCompiler.compile(text); expect(step.application).toBe('Hermes One'); expect(step.delegationRequested).toBe(false);
  });
  it('does not treat an unrelated greeting or negative command as app activation', () => {
    expect(parseConcreteAppRequest("What's up?")).toBeNull();
    expect(parseConcreteAppRequest('Do not open WhatsApp.')).toBeNull();
    expect(parseConcreteAppRequest('Open WhatsApp and send a message to someone')).toBeNull();
    expect(parseConcreteAppRequest('Ask Hermes to open WhatsApp')).toBeNull();
  });
  it('uses a bare app-name correction only after an earlier opening request', () => {
    memory.recordDialogueTurn('workflow-routing', 'user', "Open what's up and send a message to someone?");
    memory.recordDialogueTurn('workflow-routing', 'user', "What's up?");
    expect(AuthoritativeIntentCompiler.compile("What's up?", { conversationId: 'workflow-routing' }).application).toBe('WhatsApp');
  });
  it('retries a failed application resolution using the location correction', () => {
    memory.recordExplicitIntent('workflow-routing', AuthoritativeIntentCompiler.compile('Open Hermes 1'));
    expect(AuthoritativeIntentCompiler.compile("It's on the bottom on the desktop.", { conversationId: 'workflow-routing' }).application).toBe('Hermes One');
  });
  it('does not let a generic model response override an explicit simplified app request', async () => {
    const mock = vi.fn(() => ({ schemaVersion: '1' as const, turnType: 'CONVERSATIONAL' as const, confidence: 1, steps: [{ action: 'CONVERSATIONAL' as const }] }));
    semanticDiscourseInterpreter.setMockProvider(mock);
    const interpreted = await semanticDiscourseInterpreter.interpret("Can you open what's up?");
    expect(interpreted.plan.steps[0].application).toBe('WhatsApp'); expect(mock).not.toHaveBeenCalled();
  });
  it('plans the observed YouTube compound request as verified search, channel, video and presentation', () => {
    const text = 'Open YouTube and locate Julian Goldy SEO channel and open one video from him.';
    expect(parseYouTubeChannelRequest(text)).toEqual({ channel: 'Julian Goldie SEO', openVideo: true });
    const graph = autonomousPlanner.planGoal({ schemaVersion: '1', executionMode: 'AUTONOMOUS_GOAL', userGoal: text, confidence: 1, needsClarification: false });
    expect([...graph.nodes.values()].map(n => n.operation)).toEqual(['YOUTUBE_SEARCH_CHANNEL', 'YOUTUBE_OPEN_CHANNEL', 'YOUTUBE_OPEN_VIDEO', 'PRESENT_RESULT']);
  });
  it('rejects an unrelated channel rather than falling back to its first video', async () => {
    vi.spyOn(browserCodeProvider, 'executeScript').mockResolvedValue({ url: 'https://www.youtube.com/@someoneelse', channelName: 'Someone Else', videos: [{ url: 'https://www.youtube.com/watch?v=wrong' }] });
    const navigate = vi.spyOn(browserCodeProvider, 'navigate');
    const result = await browserCapabilityAdapter.executeYouTubeStage('YOUTUBE_OPEN_VIDEO', 'Julian Goldie SEO');
    expect(result.verified).toBe(false); expect(navigate).not.toHaveBeenCalled();
  });
  it('does not navigate after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const navigate = vi.spyOn(browserCodeProvider, 'navigate');
    const result = await browserCapabilityAdapter.executeYouTubeStage('YOUTUBE_SEARCH_CHANNEL', 'Julian Goldie SEO', controller.signal);
    expect(result.verified).toBe(false); expect(navigate).not.toHaveBeenCalled();
  });
  it('recognizes the opt-in WebSocket connection despite an unavailable HTTP discovery endpoint', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('9222\n/devtools/browser/stale-id\n');
    vi.spyOn(browserCodeSession, 'isPortListening').mockResolvedValue(false);
    vi.spyOn(browserCodeSession as any, 'isKnownWebSocketPortListening').mockResolvedValue(true);
    expect(await browserCodeSession.discoverRealChromeEndpoint()).toEqual({ port: 9222, endpoint: 'ws://127.0.0.1:9222/devtools/browser/stale-id' });
  });
  it('does not navigate when stop arrives during browser connection approval', async () => {
    const controller = new AbortController();
    const goto = vi.fn();
    vi.spyOn(browserCodeSession, 'getSession').mockImplementation(async () => { controller.abort(); return { page: { goto }, context: {}, browser: {} } as any; });
    await expect(browserCodeSession.navigate('https://www.youtube.com', 1000, controller.signal)).rejects.toThrow();
    expect(goto).not.toHaveBeenCalled();
  });
});
