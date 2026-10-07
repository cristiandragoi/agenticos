import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectWhatsAppChat, selectWhatsAppConversation, groundWhatsAppMessages, type OcrLine } from '../domains/controlPlane/computerUse/WhatsAppChatNavigator.js';
import { AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import * as guards from '../domains/jarvis/perception/perceptionOperation.js';
import { runWithTurnOwnership } from '../domains/jarvis/perception/turnOwnership.js';
import { authoritativeDesktopComputerUseProvider as desktop } from '../domains/controlPlane/computerUse/AuthoritativeDesktopComputerUseProvider.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
import { autonomousPlanner } from '../domains/controlPlane/taskGraph/AutonomousPlanner.js';
import { resolveApplicationRequest } from '../domains/controlPlane/ApplicationRequestGate.js';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { parseConcreteAppRequest } from '../domains/controlPlane/ConcreteVoiceRequests.js';
import { authoritativeInteractionContext as memory } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { sourceOutcomeVerifier } from '../domains/controlPlane/SourceOutcomeVerifier.js';
afterEach(() => vi.restoreAllMocks());
const line = (text: string, x: number, y: number): OcrLine => ({ text, x, y, width: text.length * 8, height: 17 });
const screen = (...extra: OcrLine[]) => ({ width: 800, height: 855, lines: [line('Chats', 94, 61), ...extra] });
describe('WhatsApp selected-header evidence', () => {
  it.each(['And locate the Nicole Dragoi.', 'And locate the Nicole Dragoi chat.', 'Then find the Nicole Dragoi conversation.'])('keeps the verified app across microphone segmentation: %s', async prompt => {
    const id = 'segmented-whatsapp';
    memory.resetContext(id);
    memory.recordVerifiedStepSuccess(id, 0, { application: 'Telegram', chat: 'Old chat' });
    expect(AuthoritativeIntentCompiler.compile('Go to WhatsApp.').application).toBe('WhatsApp');
    memory.recordVerifiedStepSuccess(id, 0, { application: 'WhatsApp' });
    const provider = vi.fn();
    semanticDiscourseInterpreter.setMockProvider(provider);
    try {
      const result = await semanticDiscourseInterpreter.interpret(prompt, { conversationId: id, activeApplication: 'Telegram' });
      expect(result.plan.steps[0]).toMatchObject({ action: 'OPEN_CHAT', application: 'WhatsApp', target: 'Nicole Dragoi' });
      expect(provider).not.toHaveBeenCalled();
    } finally { semanticDiscourseInterpreter.setMockProvider(null); memory.resetContext(id); }
  });
  it.each(['Go to WhatsApp and locate the Nicole Dragoi chat.', 'Navigate to WhatsApp and find the Nicole Dragoi conversation.'])('makes the explicitly named app authoritative over stale Telegram: %s', async prompt => {
    const result = await semanticDiscourseInterpreter.interpret(prompt, { activeApplication: 'Telegram' });
    expect(result.plan.steps.map(s => [s.action, s.application, s.target])).toEqual([
      ['OPEN_APPLICATION', 'WhatsApp', 'WhatsApp'], ['OPEN_CHAT', 'WhatsApp', 'Nicole Dragoi']]);
  });
  it('rejects a verified result from the wrong messaging application', () => {
    const step = AuthoritativeIntentCompiler.compile('Navigate to Nicole Dragoi in WhatsApp');
    expect(sourceOutcomeVerifier.verifyStepOutcome(step, { resolvedApplication: 'Telegram' } as any,
      { success: true, verified: true, outputText: 'Opened in Telegram' } as any)).toMatchObject({ isVerified: false, crossTargetContaminationDetected: true });
  });
  it.each(['Jarvis, open WhatsApp and locate Nicole Dragoi.', 'Yes, you open WhatsApp and locate the chat Nicole Dragoi.', 'Jarvis, Jarvis, open WhatsApp and locate Nicole Dragoi'])('retains every operation in the human compound request: %s', async prompt => {
    expect(parseConcreteAppRequest(prompt)).toBeNull();
    expect(await resolveApplicationRequest(prompt)).toBeNull();
    const interpreted = await semanticDiscourseInterpreter.interpret(prompt);
    expect(interpreted.plan.steps.map(step => [step.action, step.target])).toEqual([['OPEN_APPLICATION', 'WhatsApp'], ['OPEN_CHAT', 'Nicole Dragoi']]);
    expect(interpreted.structuredIntent?.executionMode).toBe('AUTONOMOUS_GOAL');
    const graph = autonomousPlanner.planGoal(interpreted.structuredIntent!.goalIntent!);
    expect([...graph.nodes.values()].map(node => node.operation)).toEqual(['OPEN_APPLICATION', 'OPEN_CHAT', 'PRESENT_RESULT']);
    expect([...graph.nodes.values()][1].inputs.chat).toBe('Nicole Dragoi');
  });
  it('retains app, contact and read count for a complete compound request', () => {
    const plan = AuthoritativeIntentCompiler.compilePlan('Open WhatsApp and locate Nicole Dragoi and read me the last message');
    expect(plan.steps.map(step => step.action)).toEqual(['OPEN_APPLICATION', 'OPEN_CHAT', 'READ_MESSAGES']);
    expect(plan.steps[2]).toMatchObject({ application: 'WhatsApp', target: 'Nicole Dragoi', count: 1 });
  });
  it('returns exactly the latest grounded text, regardless of model ordering or sender claims', () => {
    const result = groundWhatsAppMessages(screen(line('Nicole Dragoi', 413, 54), line('Earlier message', 413, 250), line('Latest message', 650, 745)), 'Nicole Dragoi', [{ text: 'Latest message' }, { text: 'Hallucinated text' }, { text: 'Earlier message' }], 1);
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ text: 'Latest message', sender: '' });
  });
  it('rejects text grounded only in a sidebar, composer or wrong conversation', () => {
    expect(groundWhatsAppMessages(screen(line('Nicole Dragoi', 413, 54), line('Draft', 413, 805), line('Sidebar', 120, 700)), 'Nicole Dragoi', [{ text: 'Draft' }, { text: 'Sidebar' }], 1)).toEqual([]);
    expect(groundWhatsAppMessages(screen(line('Other person', 413, 54), line('Message', 650, 745)), 'Nicole Dragoi', [{ text: 'Message' }], 1)).toEqual([]);
  });
  it.each(['Navigate to Nicole Dragoi and read me the last message', 'Open Nicole Dragoi and read me the last message', 'Open the chat with Nicole Dragoi in WhatsApp and read the last 1 messages'])('separates the contact and read action: %s', async prompt => {
    const plan = AuthoritativeIntentCompiler.compilePlan(prompt, { activeApplication: 'WhatsApp' });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({ action: 'OPEN_CHAT', application: 'WhatsApp', target: 'Nicole Dragoi' });
    expect(plan.steps[1]).toMatchObject({ action: 'READ_MESSAGES', application: 'WhatsApp', target: 'Nicole Dragoi', count: 1 });
    expect(await resolveApplicationRequest(prompt, { activeApplication: 'WhatsApp' })).toBeNull();
    const graph = autonomousPlanner.planGoal({ userGoal: prompt, entities: ['WhatsApp'] } as any);
    expect([...graph.nodes.values()].map(n => n.operation)).toEqual(['OPEN_CHAT', 'READ_MESSAGES', 'PRESENT_RESULT']);
    expect([...graph.nodes.values()][1].inputs).toMatchObject({ application: 'WhatsApp', chat: 'Nicole Dragoi', count: 1 });
  });
  it('refuses a malformed compound contact before touching the desktop', async () => {
    const observe = vi.spyOn(desktop, 'observe');
    expect((await selectWhatsAppConversation({ hwnd: 42 } as any, 'Nicole Dragoi and read me the last message', 'bad-contact')).verified).toBe(false);
    expect(observe).not.toHaveBeenCalled();
  });
  it('resolves WhatsApp rather than the simultaneously open Telegram window', async () => {
    targetResolver.setMockWindows([{ hwnd: 2493010, pid: 1, process: 'Telegram.exe', title: 'Telegram' }, { hwnd: 262846, pid: 2, process: 'WhatsApp.Root.exe', title: 'WhatsApp' }] as any);
    try {
      const step = AuthoritativeIntentCompiler.compile('Navigate to Nicole Dragoi', { activeApplication: 'WhatsApp' });
      expect(await targetResolver.resolve(step, {} as any)).toMatchObject({ windowHandle: 262846, resolvedApplication: 'WhatsApp' });
    } finally { targetResolver.setMockWindows(null); }
  });
  it('refuses navigation after its owning turn is cancelled', async () => {
    vi.spyOn(guards, 'guardExternalSideEffect').mockReturnValue({ ok: false } as any);
    const observe = vi.spyOn(desktop, 'observe');
    await expect(runWithTurnOwnership({ conversationId: 'cancelled-chat', turnId: 1 }, () => selectWhatsAppConversation({ hwnd: 42 } as any, 'Nicole Dragoi', 'cancelled'))).rejects.toThrow(/cancelled/);
    expect(observe).not.toHaveBeenCalled();
  });
  it('binds explicit contact navigation to the active messaging app without a model', () => {
    expect(AuthoritativeIntentCompiler.compile('Navigate to Nicole Dragoi', { activeApplication: 'WhatsApp' })).toMatchObject({ action: 'OPEN_CHAT', application: 'WhatsApp', target: 'Nicole Dragoi' });
    expect(AuthoritativeIntentCompiler.compile('Navigate to Nicole Dragoi in WhatsApp', { activeApplication: 'Telegram' })).toMatchObject({ action: 'OPEN_CHAT', application: 'WhatsApp', target: 'Nicole Dragoi' });
  });
  it('does not confuse the contact list with the selected conversation', () => {
    const result = inspectWhatsAppChat(screen(line('Other Person', 413, 54), line('Nicole Dragoi', 160, 597)), 'Nicole Dragoi');
    expect(result.header).toBeUndefined(); expect(result.contacts).toHaveLength(1);
  });
  it('verifies the full exact name in the observed header row', () => {
    expect(inspectWhatsAppChat(screen(line('Nicole Dragoi', 413, 54)), 'Nicole Dragoi').header).toBeDefined();
  });
  it('does not use message text as a selected header', () => {
    expect(inspectWhatsAppChat(screen(line('Nicole Dragoi', 413, 230)), 'Nicole Dragoi').header).toBeUndefined();
  });
  it('does not accept a partial or similar name', () => {
    expect(inspectWhatsAppChat(screen(line('Nicole', 413, 54)), 'Nicole Dragoi').header).toBeUndefined();
    expect(inspectWhatsAppChat(screen(line('Nicole Dragoi Family', 413, 54)), 'Nicole Dragoi').header).toBeUndefined();
  });
  it('retains ambiguity rather than selecting an arbitrary duplicate', () => {
    expect(inspectWhatsAppChat(screen(line('Nicole Dragoi', 160, 397), line('Nicole Dragoi', 160, 597)), 'Nicole Dragoi').contacts).toHaveLength(2);
  });
  it('fails closed when the layout anchor is absent', () => {
    expect(inspectWhatsAppChat({ width: 800, height: 855, lines: [line('Nicole Dragoi', 413, 54)] }, 'Nicole Dragoi').header).toBeUndefined();
  });
});
