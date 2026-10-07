import { afterEach, describe, expect, it, vi } from 'vitest';
import { windowsApplicationResolver as resolver } from '../domains/controlPlane/WindowsApplicationResolver.js';
import { resolveApplicationRequest } from '../domains/controlPlane/ApplicationRequestGate.js';
import { authoritativeInteractionContext as memory } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { AuthoritativeIntentCompiler as compiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { chatCapabilityAdapter as chat } from '../domains/controlPlane/adapters/ChatCapabilityAdapter.js';
import { conversationCapabilityAdapter as conversation } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import { authoritativeDesktopComputerUseProvider as desktop } from '../domains/controlPlane/computerUse/AuthoritativeDesktopComputerUseProvider.js';
import { guiNavigationCapabilityAdapter as gui } from '../domains/controlPlane/adapters/GuiNavigationCapabilityAdapter.js';
import { computerUseRegistry } from '../domains/controlPlane/computerUse/ComputerUseRegistry.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
import * as whatsappNavigator from '../domains/controlPlane/computerUse/WhatsAppChatNavigator.js';

const id = 'application-clarification-tests';
const candidate = (name: string, score = .98) => ({ name, score, source: 'start_menu' as const, shortcutPath: `${name}.lnk`, description: name });
afterEach(() => { vi.restoreAllMocks(); memory.resetContext(id); });

describe('application clarification and truthful follow-ups', () => {
  it('keeps a desktop hint attached to app clarification despite older Telegram context',async()=>{
    memory.recordVerifiedStepSuccess(id,0,{application:'Telegram',chat:'AgenticOS',verifiedSelectedChat:true,capability:'CHAT'});
    memory.setPendingAction(id,{action:'CLARIFY_TARGET',target:'Hammas 1',context:{kind:'target_clarification',names:['Hermes One']}});
    const lookup=vi.spyOn(resolver,'resolveWithConfidence').mockResolvedValue({status:'resolved',candidates:[candidate('Hermes One')]});
    const reply=await resolveApplicationRequest("Hamas1, it's on the bottom. It's on the bottom, my desktop.",{conversationId:id});
    expect(reply?.steps[0]).toMatchObject({action:'OPEN_APPLICATION',application:'Hermes One'});
    expect(lookup).toHaveBeenCalledWith('Hermes One',{actionType:'open'});
    expect(compiler.compilePlan('You find it on the bottom of my desktop.',{conversationId:id}).steps.some(s=>s.action==='OPEN_CHAT')).toBe(false);
  });
  it('resolves the exact taskbar application request without a model', async () => {
    const lookup = vi.spyOn(resolver, 'resolveWithConfidence').mockResolvedValue({ status: 'resolved', candidates: [candidate('Hermes One')] });
    const result = await resolveApplicationRequest('Jarvis, go and locate on the bottom of my desktop the application Hermes 1.');
    expect(result?.steps[0]).toMatchObject({ action: 'OPEN_APPLICATION', application: 'Hermes One' });
    expect(lookup).toHaveBeenCalledWith('Hermes One', { actionType: 'open' });
  });
  it('does not explain an older chat failure when the user disputes opening Word', async () => {
    vi.spyOn(memory, 'getContext').mockReturnValue({ ...memory.getContext(id), lastSuccessfulAction: { action: 'OPEN_APPLICATION', target: 'Word', at: 200 },
      lastExecutionFailure: { target: 'Nicole Dragoi', timestamp: 100, reason: 'WhatsApp could not locate the chat' } } as any);
    const denial = await conversation.execute({ ...compiler.compile('Hello'), rawPrompt: 'No, you have not.' }, 1, id);
    expect(denial.outputText).toContain('Word'); expect(denial.outputText).not.toMatch(/WhatsApp|Nicole/);
    const why = await conversation.execute({ ...compiler.compile('Hello'), target: 'explain_previous_outcome', rawPrompt: 'Why not?' }, 2, id);
    expect(why.outputText).toContain('Word'); expect(why.outputText).not.toMatch(/WhatsApp|Nicole/);
  });
  it('does not accept a browser HWND labelled as Hermes when the launcher identifies another executable', async () => {
    vi.spyOn(desktop as any, 'probeWindow').mockImplementation(async (hwnd: number) => ({ isValidWindow: true, isVisible: true,
      processName: hwnd === 1 ? 'comet' : 'hermes-agent', pid: hwnd, bounds: { width: 800, height: 600 }, windowTitle: 'Hermes One' }));
    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([{ hwnd: 1, pid: 1, process: 'comet', title: 'Hermes One Word conversation' },
      { hwnd: 2, pid: 2, process: 'hermes-agent', title: 'Hermes One' }] as any);
    const result = await desktop.resolveTarget({ application: 'Hermes One', expectedProcessName: 'hermes-agent', exactHwnd: 1 });
    expect(result.target).toMatchObject({ hwnd: 2, processName: 'hermes-agent' });
  });
  it('deduplicates an open PDF and its application launcher by executable identity', async () => {
    vi.spyOn(resolver as any, 'discoverCandidates').mockResolvedValue([
      { ...candidate('Adobe Acrobat'), processName: 'Acrobat' },
      { name: 'Document.pdf - Adobe Acrobat Reader', processName: 'Acrobat', source: 'running_window', score: .97 },
    ]);
    expect((await resolver.resolveWithConfidence('Adobe')).status).toBe('resolved');
  });
  it('resolves the observed Word document wording through installed discovery', async () => {
    const lookup = vi.spyOn(resolver, 'resolveWithConfidence').mockResolvedValue({ status: 'resolved', candidates: [candidate('Word')] });
    expect((await resolveApplicationRequest('Open Words Document.', { conversationId: id }))?.steps[0].application).toBe('Word');
    expect(lookup).toHaveBeenCalledWith('Word', { actionType: 'open' });
  });
  it('does not select one Adobe product when equal matches exist', async () => {
    vi.spyOn(resolver as any, 'discoverCandidates').mockResolvedValue([candidate('Adobe Acrobat', .94), candidate('Adobe Photoshop', .94)]);
    expect((await resolver.resolveWithConfidence('Adobe')).status).toBe('ambiguous');
    expect(await resolver.resolve('Adobe')).toBeNull();
  });
  it('deduplicates multiple discovery surfaces for the same exact application', async () => {
    vi.spyOn(resolver as any, 'discoverCandidates').mockResolvedValue([candidate('Hermes One'), candidate('Hermes One', .96)]);
    expect((await resolver.resolveWithConfidence('Hermes 1')).status).toBe('resolved');
  });
  it('suggests uncertain pronunciation without authorizing execution', async () => {
    const score = (resolver as any).scoreMatch('hermos one', 'Hermes One');
    expect(score).toBeGreaterThan(.4); expect(score).toBeLessThan(.9);
    vi.spyOn(resolver as any, 'discoverCandidates').mockResolvedValue([candidate('Hermes One', score)]);
    expect((await resolver.resolveWithConfidence('Hermos One')).status).toBe('ambiguous');
  });
  it('asks for an app name and resumes only after a clear answer', async () => {
    const lookup = vi.spyOn(resolver, 'resolveWithConfidence').mockResolvedValue({ status: 'not_found', candidates: [] });
    const question = await resolveApplicationRequest('Open blorf', { conversationId: id });
    expect(question?.steps[0].action).toBe('CONVERSATIONAL');
    expect(question?.steps[0].contentRequest).toMatch(/repeat which application/);
    lookup.mockResolvedValue({ status: 'resolved', candidates: [candidate('Notepad')] });
    const answer = await resolveApplicationRequest('Notepad', { conversationId: id });
    expect(answer?.steps[0]).toMatchObject({ action: 'OPEN_APPLICATION', application: 'Notepad' });
    expect(memory.getContext(id).pendingAction).toBeNull();
  });
  it('does not execute a bare name without a pending question', async () => {
    expect(await resolveApplicationRequest('Notepad', { conversationId: id })).toBeNull();
  });
  it('asks for a missing website and never resolves its reply as a desktop app', async () => {
    const lookup = vi.spyOn(resolver, 'resolveWithConfidence');
    expect((await resolveApplicationRequest('Open the website', { conversationId: id }))?.steps[0].contentRequest).toMatch(/Which website/);
    const reply = await resolveApplicationRequest('https://example.com', { conversationId: id });
    expect(['OPEN_URL', 'NAVIGATE_WEB']).toContain(reply?.steps[0].action);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('preserves compound requested work across application clarification', async () => {
    const lookup = vi.spyOn(resolver, 'resolveWithConfidence').mockResolvedValue({ status: 'ambiguous', candidates: [candidate('Adobe Acrobat'), candidate('Adobe Photoshop')] });
    expect((await resolveApplicationRequest('Open Adobe and crop the image', { conversationId: id }))?.steps[0].action).toBe('CONVERSATIONAL');
    lookup.mockResolvedValue({ status: 'resolved', candidates: [candidate('Adobe Photoshop')] });
    const plan = await resolveApplicationRequest('Adobe Photoshop', { conversationId: id });
    expect(plan?.rawPrompt).toContain('and crop the image'); expect(plan?.isCompound).toBe(true);
  });
  it('keeps the latest attempted WhatsApp contact for open the chat', () => {
    const intent = { ...compiler.compile('Open Telegram'), action: 'OPEN_CHAT' as const, application: 'WhatsApp', target: 'Nicole Dragoi' };
    memory.recordExplicitIntent(id, intent);
    expect(compiler.compile('Yeah, open the chat.', { conversationId: id })).toMatchObject({ action: 'OPEN_CHAT', application: 'WhatsApp', target: 'Nicole Dragoi' });
  });
  it('clears a verified chat when another application is opened', () => {
    memory.recordVerifiedStepSuccess(id, 0, { application: 'Telegram', chat: 'AgenticOS', verifiedSelectedChat: true });
    memory.recordVerifiedStepSuccess(id, 1, { application: 'WhatsApp', windowHandle: 42 });
    expect(memory.getContext(id).activeChat).toBeNull();
    expect(compiler.compile('Open the chat', { conversationId: id }).target).toBe('clarify_execution_target');
  });
  it('rejects a successful navigation action without selected-chat evidence', async () => {
    vi.spyOn(whatsappNavigator, 'selectWhatsAppConversation').mockResolvedValue({ verified: false, reason: 'No matching header.' });
    const target = { application: 'WhatsApp', hwnd: 42, pid: 7, processName: 'WhatsApp.Root' } as any;
    vi.spyOn(desktop, 'resolveTarget').mockResolvedValue({ success: true, target } as any);
    vi.spyOn(desktop, 'activate').mockResolvedValue({ success: true } as any);
    vi.spyOn(desktop, 'observe').mockResolvedValue({ success: true, isForeground: true, windowTitle: 'WhatsApp' } as any);
    vi.spyOn(desktop, 'act').mockResolvedValue({ success: true, physicalEvidence: { actions: ['clicked'] } } as any);
    const step = { ...compiler.compile('Open WhatsApp'), action: 'OPEN_CHAT' as const, target: 'Nicole Dragoi' };
    const result = await chat.openChat(1, 'Nicole Dragoi', step, id);
    expect(result.verified).toBe(false); expect(result.outputText).toMatch(/could not locate and verify/);
  });
  it('does not explain a Hermes request using an unrelated Telegram failure', async () => {
    memory.recordExecutionFailure(id, { turnId: 'old', action: 'READ_MESSAGES', target: 'AgenticOS', failureReason: 'Telegram extraction failed', timestamp: Date.now() } as any);
    const result = await conversation.execute({ ...compiler.compile('Hello'), action: 'CONVERSATIONAL', target: 'explain_previous_outcome', rawPrompt: "Why can't you open Hermes One?" }, 1, id);
    expect(result.outputText).toMatch(/different target/);
    expect(result.outputText).not.toMatch(/couldn't read the messages/);
  });
  it('does not press Escape when the requested Telegram chat is already selected', async () => {
    const target = { application: 'Telegram', hwnd: 42, pid: 7, processName: 'Telegram' } as any;
    vi.spyOn(desktop, 'resolveTarget').mockResolvedValue({ success: true, target } as any);
    vi.spyOn(desktop, 'activate').mockResolvedValue({ success: true } as any);
    vi.spyOn(desktop, 'observe').mockResolvedValue({ success: true, isForeground: true, windowTitle: 'AgenticOS – Telegram' } as any);
    const act = vi.spyOn(desktop, 'act');
    const step = { ...compiler.compile('Open Telegram'), action: 'OPEN_CHAT' as const, target: 'AgenticOS' };
    expect((await chat.openChat(1, 'AgenticOS', step, id)).verified).toBe(true);
    expect(act).not.toHaveBeenCalled();
  });
  it('does not claim an in-app function succeeded merely because the app window exists', async () => {
    vi.spyOn(targetResolver, 'getOpenWindows').mockResolvedValue([{ title: 'Notepad', process: 'notepad', hwnd: 42 }] as any);
    vi.spyOn(computerUseRegistry, 'getActiveProvider').mockReturnValue({ id: 'fixture', name: 'fixture', executeGoal: vi.fn().mockResolvedValue({ status: 'SUCCESS', finalHwnd: 42 }) } as any);
    const result = await gui.execute({ ...compiler.compile('Open Notepad'), action: 'ACTIVATE_CONTROL' as any, application: 'Notepad', target: 'Print dialog', rawPrompt: 'Open the Print dialog in Notepad' }, 1, id);
    expect(result.verified).toBe(false); expect(result.outputText).toMatch(/could not verify/);
  });
});
