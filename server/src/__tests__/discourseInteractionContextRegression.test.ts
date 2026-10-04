/**
 * discourseInteractionContextRegression.test.ts
 *
 * Persistent multi-turn DISCOURSE / INTERACTION-CONTEXT regression.
 *
 * Every turn goes through the same entry path JarvisNextAgent.handleUserText uses:
 *   createTurnEnvelope (AuthoritativeIntentCompiler + discourse resolver)
 *   â†’ turnLifecycle.submit (fast-local / dispatcher routing)
 *   â†’ CapabilityDispatcher â†’ UniversalCapabilityRuntime â†’ adapters / acquisition
 *   â†’ SourceOutcomeVerifier / VerificationGateway
 *   â†’ AuthoritativeInteractionContext commit (verified only)
 *   â†’ speak sink â†’ recordSpokenResponse
 *   â†’ NEXT TURN (same conversationId, same context).
 *
 * Only the physical boundary is simulated: desktop window list, app/chat activation,
 * window content acquisition, and the camera frame + Qwen-VL answer.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createTurnEnvelope } from '../domains/controlPlane/TurnEnvelope.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
import { universalContentAcquisition } from '../domains/controlPlane/UniversalContentAcquisition.js';
import { universalPerceptionService } from '../domains/controlPlane/UniversalPerceptionService.js';
import { appCapabilityAdapter, chatCapabilityAdapter } from '../domains/controlPlane/adapters/index.js';
import { isCausalFollowUp } from '../domains/controlPlane/DiscourseReferentResolver.js';
import { isInternalDiagnostic } from '../domains/controlPlane/UserFacingResponseGuard.js';
import { turnLifecycle } from '../domains/turnLifecycle/index.js';
import { ensureTurnLifecycleTables } from '../domains/turnLifecycle/store.js';

const TELEGRAM_HWND = 2493010;
const TELEGRAM_TITLE = 'AgenticOS â€“ (89)';
const MESSAGES = [
  { index: 1, sender: 'Cristian D.', text: 'jarvis you there?' },
  { index: 2, sender: 'Cristian D.', text: "I'm here." },
];
const INTERNAL_LEAK = /classified as|capability mapping|\bOTHER\b|TARGET_RESOLUTION|adapterId|undefined|\[object/;

interface TurnOutcome {
  text: string;
  action: string;
  target: string | null | undefined;
  contentRequest: string | null | undefined;
  outcome: string;
  spoken: string;
  acquisitions: number;
  cameraFrames: number;
  resolverCalls: number;
}

class PersistentSession {
  readonly conversationId: string;
  readonly transcript: string[] = [];
  private n = 0;
  acquisitionCalls: Array<{ action: string; target: string | null }> = [];
  cameraCalls: string[] = [];
  resolveSpy: ReturnType<typeof vi.spyOn>;

  constructor(label: string) {
    this.conversationId = `conv-discourse-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.resolveSpy = vi.spyOn(targetResolver, 'resolve');
  }

  async say(text: string): Promise<TurnOutcome> {
    this.n += 1;
    const turnId = `${this.conversationId}-t${this.n}`;
    const acqBefore = this.acquisitionCalls.length;
    const camBefore = this.cameraCalls.length;
    const resBefore = this.resolveSpy.mock.calls.length;
    const spoken: string[] = [];

    const envelope = createTurnEnvelope({ turnId, conversationId: this.conversationId, source: 'voice_livekit', rawText: text });
    const res = await turnLifecycle.submit(
      { envelope, source: 'voice_livekit', conversationId: this.conversationId, text, externalTurnId: turnId },
      {
        speak: async (reply: string) => {
          authoritativeInteractionContext.recordSpokenResponse(this.conversationId, reply);
          spoken.push(reply);
        },
      } as any,
    );

    const out: TurnOutcome = {
      text,
      action: String(envelope.compiledIntent.action),
      target: envelope.compiledIntent.target,
      contentRequest: envelope.compiledIntent.contentRequest,
      outcome: String(res.record.outcome),
      spoken: spoken.join(' ') || String(res.record.responseText || ''),
      acquisitions: this.acquisitionCalls.length - acqBefore,
      cameraFrames: this.cameraCalls.length - camBefore,
      resolverCalls: this.resolveSpy.mock.calls.length - resBefore,
    };
    const ctx = authoritativeInteractionContext.getContext(this.conversationId) as any;
    this.transcript.push(
      `USER: ${text}\n  â†’ ${out.action} target=${out.target ?? '-'} req=${out.contentRequest ?? '-'} outcome=${out.outcome}` +
        ` acq=${out.acquisitions} cam=${out.cameraFrames} targetResolver=${out.resolverCalls} modality=${ctx.activeModality}` +
        `\n  JARVIS: ${out.spoken}`,
    );
    return out;
  }

  ctx(): any {
    return authoritativeInteractionContext.getContext(this.conversationId);
  }
}

function installPhysicalBoundary(session: PersistentSession, opts: { telegram?: boolean } = {}) {
  targetResolver.setMockWindows([
    ...(opts.telegram !== false ? [{ hwnd: TELEGRAM_HWND, pid: 31980, process: 'Telegram', title: TELEGRAM_TITLE }] : []),
    { hwnd: 1905378, pid: 2144, process: 'Antigravity IDE', title: 'Antigravity IDE' },
  ] as any);

  const origApp = appCapabilityAdapter.execute.bind(appCapabilityAdapter);
  vi.spyOn(appCapabilityAdapter, 'execute').mockImplementation(async (step: any, stepId: any, ...rest: any[]) => {
    if (step.action === 'OPEN_APPLICATION' || step.action === 'FOCUS_APPLICATION') {
      const app = /telegram/i.test(String(step.application || step.target)) ? 'Telegram' : String(step.application || step.target);
      return {
        stepId, action: step.action, requestedTarget: app, executedTarget: app, success: true, verified: true,
        verificationEvidence: {
          source: 'authoritative_desktop_provider', label: `${app} foreground verified`, observedAt: Date.now(),
          data: { hwnd: TELEGRAM_HWND, pid: 31980, title: TELEGRAM_TITLE, foreground: true },
        },
        contextMutation: { application: app, window: TELEGRAM_TITLE, targetType: 'APPLICATION' },
        outputText: `Opened ${app}.`,
      } as any;
    }
    return origApp(step, stepId, ...rest);
  });

  const origChat = chatCapabilityAdapter.execute.bind(chatCapabilityAdapter);
  vi.spyOn(chatCapabilityAdapter, 'execute').mockImplementation(async (step: any, stepId: any, ...rest: any[]) => {
    if (step.action === 'OPEN_CHAT') {
      return {
        stepId, action: 'OPEN_CHAT', requestedTarget: step.target, executedTarget: 'Agentic OS bot', success: true, verified: true,
        verificationEvidence: {
          source: 'authoritative_desktop_provider', label: 'Agentic OS bot conversation header verified', observedAt: Date.now(),
          data: { hwnd: TELEGRAM_HWND, header: 'Agentic OS bot', selectedChatVerified: true },
        },
        contextMutation: { application: 'Telegram', chat: 'Agentic OS bot', verifiedSelectedChat: true, targetType: 'CHAT' },
        outputText: 'I have opened and verified the Agentic OS bot conversation in Telegram.',
      } as any;
    }
    return origChat(step, stepId, ...rest);
  });

  universalContentAcquisition.setMockProvider((intent: any, target: any) => {
    session.acquisitionCalls.push({ action: String(intent.action), target: intent.target ?? null });
    const now = Date.now();
    if (intent.action === 'READ_MESSAGES') {
      const n = intent.count && intent.count > 0 ? intent.count : 2;
      const msgs = MESSAGES.slice(-n);
      return {
        success: true,
        sourceApplication: 'Telegram',
        sourceWindow: TELEGRAM_TITLE,
        sourceChat: 'Agentic OS bot',
        sourceHwnd: TELEGRAM_HWND,
        acquisitionMethod: 'window_crop_vision',
        content: msgs.map(m => `${m.sender}: ${m.text}`).join('\n'),
        structuredItems: msgs.map(m => m.text),
        messages: msgs,
        timestamp: now,
        verificationEvidence: { provider: 'UI-TARS window crop', hwnd: TELEGRAM_HWND, chatHeader: 'Agentic OS bot', messageCount: msgs.length },
        confidence: 0.93,
        visionUsed: true,
        llmUsed: false,
        fallbackCount: 0,
      } as any;
    }
    if (target?.requestedTarget === 'screen' || intent.targetType === 'SCREEN') {
      return {
        success: true,
        sourceApplication: 'Antigravity IDE',
        sourceWindow: 'Antigravity IDE',
        sourceHwnd: 1905378,
        acquisitionMethod: 'window_crop_vision',
        content: 'DiscourseReferentResolver.ts open in the editor.',
        structuredItems: ['DiscourseReferentResolver.ts open in the editor.'],
        timestamp: now,
        verificationEvidence: { provider: 'screen capture', foreground: 'Antigravity IDE' },
        confidence: 0.9,
        visionUsed: true,
        llmUsed: false,
        fallbackCount: 0,
      } as any;
    }
    return {
      success: false,
      sourceApplication: null,
      sourceWindow: null,
      acquisitionMethod: 'uia',
      content: '',
      structuredItems: [],
      timestamp: now,
      verificationEvidence: { reason: 'no matching window' },
      confidence: 0,
      visionUsed: false,
      llmUsed: false,
      fallbackCount: 0,
      error: `No open or installed window matches '${intent.target || intent.application}'`,
    } as any;
  });

  let frame = 0;
  vi.spyOn(universalPerceptionService, 'observeCamera').mockImplementation(async (o: any) => {
    frame += 1;
    session.cameraCalls.push(String(o?.userPrompt || ''));
    const q = String(o?.userPrompt || '').toLowerCase();
    const answer = /hold|hand/.test(q)
      ? 'You are holding a white coffee mug with a printed logo.'
      : /read/.test(q)
        ? 'The mug says "AgenticOS" in black letters.'
        : 'Yes, I can see you. You are sitting at your desk facing the camera.';
    return {
      goalRunId: `cam-${frame}`, turnId: frame, hwnd: 0, windowIdentity: 'USB2.0 HD UVC WebCam', process: 'camera',
      captureTimestamp: new Date().toISOString(), screenshotHash: `sha256-frame-${frame}`,
      screenshotArtifactPath: `C:/tmp/camera-frame-${frame}.jpg`, dimensions: { width: 1280, height: 720 },
      extractedVisibleContent: answer, visionAnswer: answer, source: 'camera', confidence: 0.9, success: true,
    } as any;
  });
}

describe('Discourse / interaction-context regression (persistent session, real conversational entry path)', () => {
  beforeAll(() => {
    ensureTurnLifecycleTables();
  });

  afterEach(() => {
    universalContentAcquisition.setMockProvider(undefined);
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('TEST 1 â€” Telegram: "them" resolves to the verified messages, no window lookup, no re-acquisition', async () => {
    const s = new PersistentSession('telegram');
    installPhysicalBoundary(s);

    const t1 = await s.say('Open Telegram and locate Agentic OS.');
    expect(t1.outcome).toBe('VERIFIED');
    expect(s.ctx().verifiedSelectedChat).toBe(true);
    expect(s.ctx().activeModality).toBe('DESKTOP');

    const t2 = await s.say('Read the last two messages.');
    expect(t2.action).toBe('READ_MESSAGES');
    expect(t2.outcome).toBe('VERIFIED');
    expect(t2.acquisitions).toBe(1);
    const lr = s.ctx().lastReadResult;
    expect(lr?.kind).toBe('MESSAGES');
    expect(lr?.messages.map((m: any) => m.text)).toEqual(['jarvis you there?', "I'm here."]);
    expect(lr?.messages.map((m: any) => m.sender)).toEqual(['Cristian D.', 'Cristian D.']);

    for (const phrase of ['Yes, read them.', 'yes read them', 'yeah read those']) {
      const t = await s.say(phrase);
      expect(t.action).toBe('CONVERSATIONAL');
      expect(t.target).toBe('discourse_replay');
      expect(t.target).not.toBe('them');
      expect(t.outcome).toBe('VERIFIED');
      expect(t.acquisitions).toBe(0);
      expect(t.resolverCalls).toBe(0);
      expect(t.spoken).toContain('jarvis you there?');
      expect(t.spoken).toContain("I'm here.");
      expect(t.spoken).not.toMatch(/did not read content from them/i);
      expect(t.spoken).not.toMatch(INTERNAL_LEAK);
    }

    const t4 = await s.say('What did the first one say?');
    expect(t4.target).toBe('discourse_replay');
    expect(t4.acquisitions).toBe(0);
    expect(t4.spoken).toContain('jarvis you there?');
    expect(t4.spoken).not.toContain("I'm here.");

    const t5 = await s.say('Say the second one again.');
    expect(t5.target).toBe('discourse_replay');
    expect(t5.acquisitions).toBe(0);
    expect(t5.spoken).toContain("I'm here.");
    expect(t5.spoken).not.toContain('jarvis you there?');

    // Explicit refresh still re-acquires physically.
    const t6 = await s.say('Read them again from Telegram, refresh them.');
    expect(t6.action).toBe('READ_MESSAGES');
    expect(t6.acquisitions).toBe(1);

    console.log(`\n===== TEST 1 TRANSCRIPT =====\n${s.transcript.join('\n')}\n`);
    expect(s.ctx().lastExecutionFailure).toBeFalsy();
  });

  it('TEST 2 â€” Camera: deictic "this"/"holding" stays on CAMERA until an explicit modality switch', async () => {
    const s = new PersistentSession('camera');
    installPhysicalBoundary(s);

    const t1 = await s.say('Open the camera. Can you see me?');
    expect(t1.action).toBe('CAMERA_OBSERVE');
    expect(t1.outcome).toBe('VERIFIED');
    expect(t1.cameraFrames).toBe(1);
    expect(s.ctx().activeModality).toBe('CAMERA');
    expect(s.ctx().activePerceptionSource?.modality).toBe('CAMERA');
    expect(s.ctx().lastCameraFrame?.frameSha256).toBe('sha256-frame-1');

    const t2 = await s.say('Can you see what I\'m holding?');
    expect(t2.action).toBe('CAMERA_OBSERVE');
    expect(t2.cameraFrames).toBe(1);
    expect(t2.spoken).toMatch(/mug/);

    const t3 = await s.say('can you read this');
    expect(t3.action).toBe('CAMERA_OBSERVE');
    expect(t3.cameraFrames).toBe(1);
    expect(t3.acquisitions).toBe(0);
    expect(s.ctx().activeModality).toBe('CAMERA');

    const t3b = await s.say('Can we see what I hold in my hand? Can you read this?');
    expect(t3b.action).toBe('CAMERA_OBSERVE');
    expect(t3b.acquisitions).toBe(0);

    const t4 = await s.say("Now read what's on my screen.");
    expect(['READ_CONTENT', 'READ_SCREEN']).toContain(t4.action);
    expect(t4.cameraFrames).toBe(0);
    expect(t4.outcome).toBe('VERIFIED');
    expect(s.ctx().activeModality).toBe('SCREEN');

    const t5 = await s.say('no no I mean through the camera');
    expect(t5.action).toBe('CAMERA_OBSERVE');
    expect(s.ctx().activeModality).toBe('CAMERA');

    const t6 = await s.say('Go back to the camera. What am I holding?');
    expect(t6.action).toBe('CAMERA_OBSERVE');
    expect(t6.cameraFrames).toBe(1);
    expect(t6.spoken).toMatch(/mug/);
    expect(s.ctx().activeModality).toBe('CAMERA');

    for (const t of [t1, t2, t3, t3b, t4, t5, t6]) expect(t.spoken).not.toMatch(INTERNAL_LEAK);
    console.log(`\n===== TEST 2 TRANSCRIPT =====\n${s.transcript.join('\n')}\n`);
  });

  it('TEST 3 â€” Causal follow-ups all explain the SAME real failure; no OTHER, no internal strings', async () => {
    const s = new PersistentSession('causal');
    installPhysicalBoundary(s);

    const fail = await s.say('Read what is inside Notepad.');
    expect(fail.outcome).not.toBe('VERIFIED');
    const failure = s.ctx().lastExecutionFailure;
    expect(failure).toBeTruthy();
    expect(String(failure.technicalRootCause)).toMatch(/notepad/i);
    const failureTurn = failure.turnId;

    const followUps = [
      'Why?',
      'Why not?',
      "But why didn't that work?",
      "Why couldn't the content be verified?",
      'Why can the window content not be verified?',
      'What went wrong?',
      'why not can the content be verified',
      'Why not can we be con, can we in the content be verified? Why not?',
    ];
    for (const q of followUps) {
      const t = await s.say(q);
      expect(t.action, q).toBe('CONVERSATIONAL');
      expect(t.target, q).toBe('explain_previous_outcome');
      expect(t.acquisitions, q).toBe(0);
      expect(t.resolverCalls, q).toBe(0);
      expect(t.spoken, q).toMatch(/notepad/i);
      expect(t.spoken, q).not.toMatch(/window content could not be verified/i);
      expect(t.spoken, q).not.toMatch(INTERNAL_LEAK);
      expect(isInternalDiagnostic(t.spoken)).toBe(false);
      // Same failure context: the causal turn must not overwrite the failure record.
      expect(s.ctx().lastExecutionFailure.turnId).toBe(failureTurn);
    }
    console.log(`\n===== TEST 3 TRANSCRIPT =====\n${s.transcript.join('\n')}\n`);
  });

  it('TEST 3b â€” the proven human Turn-7 failure is explained with its real cause (pronoun mistaken for a window)', async () => {
    const s = new PersistentSession('turn7');
    installPhysicalBoundary(s);
    await s.say('Open Telegram and locate Agentic OS.');
    await s.say('Read the last two messages.');
    // Inject the exact historical failure record (as persisted by the pre-repair runtime).
    authoritativeInteractionContext.recordExecutionFailure(s.conversationId, {
      turnId: 'historical-turn-7', correlationId: 'corr-historical-7', action: 'READ_CONTENT', target: 'them',
      executionStage: 'TARGET_RESOLUTION', providerIdentity: 'perception',
      technicalRootCause: "Target resolution failed: No open or installed window matches 'them'",
      userFacingFailure: 'Did not read content from them.', failureReason: "No open or installed window matches 'them'",
      physicalEvidence: { uia: false, screenshot: false, uiTars: false, ocr: false, errorDetails: 'no window' },
      verifierState: 'FAILED_CLOSED', timestamp: Date.now(),
    } as any);
    const t = await s.say('Why not?');
    expect(t.target).toBe('explain_previous_outcome');
    expect(t.spoken).toMatch(/misunderstood 'them'/);
    expect(t.spoken).toMatch(/Telegram messages|two/);
    const t2 = await s.say('Why not?');
    expect(t2.spoken).toMatch(/target resolution/i);
    expect(t2.spoken).not.toBe(t.spoken);
    console.log(`\n===== TEST 3b TRANSCRIPT =====\n${s.transcript.join('\n')}\n`);
  });

  it('TEST 4 â€” unresolved referents clarify naturally instead of window lookup or internal errors', async () => {
    const s = new PersistentSession('unresolved');
    installPhysicalBoundary(s);
    const t = await s.say('Yes, read them.');
    expect(t.target).toBe('clarify_referent');
    expect(t.resolverCalls).toBe(0);
    expect(t.acquisitions).toBe(0);
    expect(t.spoken).not.toMatch(INTERNAL_LEAK);
    expect(s.ctx().lastExecutionFailure).toBeFalsy();
    console.log(`\n===== TEST 4 TRANSCRIPT =====\n${s.transcript.join('\n')}\n`);
  });

  it('causal intent detector accepts natural STT variants and rejects non-causal "why don\'t you" commands', () => {
    for (const q of [
      'why', 'why not', 'but why', 'and why', "why couldn't you", "why can't you", 'why did that fail',
      "why didn't that work", "why couldn't it be verified", 'why can the content not be verified',
      'what happened', 'what went wrong', 'what was the problem', 'why why not', 'uh why not',
    ]) expect(isCausalFollowUp(q), q).toBe(true);
    for (const q of ["why don't you open telegram", 'open telegram', 'read the last two messages', 'what happened with the build worker'])
      expect(isCausalFollowUp(q), q).toBe(false);
  });

  it('internal diagnostics are detected and never pass as user-facing text', () => {
    expect(isInternalDiagnostic('Action classified as OTHER without capability mapping')).toBe(true);
    expect(isInternalDiagnostic("I'm here.")).toBe(false);
  });
});
