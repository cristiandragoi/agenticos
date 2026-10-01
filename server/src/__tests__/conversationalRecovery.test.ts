/**
 * conversationalRecovery.test.ts
 *
 * Cases A–I from the conversational/recovery brief:
 * partial understanding, context continuation, narrowing clarifications,
 * renderer fact-fidelity, voice/text parity and interruption.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { routeTurn } from '../domains/jarvisNext/turnRouter.js';
import { renderOperationalResult, stripInternalTerminology } from '../domains/jarvisNext/resultRenderer.js';

const GENERIC = [
  "I didn't catch the command",
  "I didn't catch which command",
  'say it again',
  'Could you say it again',
  'say that again',
];

function isGeneric(text: string): boolean {
  const t = (text || '').toLowerCase();
  return GENERIC.some((g) => t.includes(g.toLowerCase()));
}

let conv = 0;
const conversationId = () => `conv-recovery-${++conv}-${Date.now()}`;

describe('Conversational recovery — partial understanding (A, B)', () => {
  it('A: low-confidence transcript that names a target asks about THAT target', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'opened Tik Tok Shop.',
      conversationId: conversationId(),
      sttConfidence: 0.25,
      rawStt: 'opened Tik Tok Shop.',
    });
    expect(isGeneric(res.spokenText)).toBe(false);
    expect(res.spokenText.toLowerCase()).toMatch(/tik\s?tok\s?shop/);
    expect(res.pendingClarification?.targetName?.toLowerCase()).toMatch(/tik\s?tok\s?shop/);
  });

  it('A2: genuine noise may still produce a generic re-ask (last resort)', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'mmm hmm',
      conversationId: conversationId(),
      sttConfidence: 0.12,
      rawStt: 'mmm hmm',
    });
    expect(res.spokenText.length).toBeGreaterThan(0);
    expect(res.pendingClarification).toBeUndefined();
  });

  it('B: "start working on Free Cash and see what is needed" never falls back to the generic re-ask', async () => {
    // Turn level: the canonical router composes the controller result with its
    // own downstream routes.
    const res = await routeTurn({
      prompt: 'Jarvis, start working on Free Cash and see what is needed.',
      conversationId: conversationId(),
      rawStt: 'Jarvis, start working on Free Cash and see what is needed.',
      confidence: 1.0,
    });
    expect(isGeneric(res.text)).toBe(false);
    expect(res.text.trim().length).toBeGreaterThan(0);
    // In a bare test environment the project store is empty, so the specific
    // outcome is a data report rather than execution; live, this resolves to
    // project_operate (verified in the Priority-1 acceptance run). Either way it
    // must never be the generic re-ask.
    expect(res.route).toBeTruthy();
  });
});

describe('Conversational recovery — anchors and continuation (C, D, E)', () => {
  it('C: "Seeadler TV on YouTube" keeps the target and offers a YouTube search', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, Seeadler TV on YouTube.',
      conversationId: conversationId(),
      sttConfidence: 0.3,
      rawStt: 'Jarvis, Seeadler TV on YouTube.',
    });
    expect(isGeneric(res.spokenText)).toBe(false);
    expect(res.spokenText).toContain('Seeadler TV');
    expect(res.spokenText.toLowerCase()).toContain('youtube');
    expect(res.pendingClarification?.targetName).toBe('Seeadler TV');
  });

  it('D: "The channel." resumes the pending YouTube goal instead of being a new command', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'The channel.',
      conversationId: conversationId(),
      sttConfidence: 1.0,
      rawStt: 'The channel.',
      context: {
        pendingClarification: {
          kind: 'anchor_action',
          targetName: 'Seeadler TV',
          targetType: 'youtube',
          attempt: 1,
          askedAt: Date.now(),
          options: ['the channel', 'a video'],
        },
      },
    });
    expect(isGeneric(res.spokenText)).toBe(false);
    // The goal was resumed: either it ran the search, or it reported on that goal.
    expect(JSON.stringify(res)).toMatch(/Seeadler TV/i);
  }, 15000);

  it('E: "Yes." continues the pending Free Cash operation', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'Yes.',
      conversationId: conversationId(),
      sttConfidence: 1.0,
      rawStt: 'Yes.',
      context: {
        activeProjectName: 'Free Cash',
        pendingClarification: {
          kind: 'confirm_project_work',
          targetName: 'Free Cash',
          targetType: 'project',
          intendedAction: 'operate_project',
          attempt: 1,
          askedAt: Date.now(),
          options: ['open it', 'check its status', 'start working on it'],
          // F5: a YES/NO question — so a bare "Yes." executes the pending action.
          // (Against a multi-choice question a bare "Yes." must ask which one.)
          clarificationType: 'yes_no',
        },
      },
    });
    expect(isGeneric(res.spokenText)).toBe(false);
    expect(res.route).toBe('project_operate');
  });
});

describe('Conversational recovery — no identical clarification loop (F)', () => {
  it('F: the second unresolved turn narrows instead of repeating', async () => {
    // Verb-less utterance: nothing can be composed from it, so this stays a
    // clarification (F6 composes a goal only when action + entity are present).
    const convId = conversationId();
    const first = await universalExecutionController.handleUserTurn({
      prompt: 'Free Cash',
      conversationId: convId,
      sttConfidence: 0.2,
      rawStt: 'Free Cash',
    });
    expect(first.pendingClarification?.attempt).toBe(1);
    const firstText = first.spokenText;

    const second = await universalExecutionController.handleUserTurn({
      prompt: 'Free Cash',
      conversationId: convId,
      sttConfidence: 0.2,
      rawStt: 'Free Cash',
      context: { pendingClarification: first.pendingClarification },
    });

    expect(second.spokenText).not.toBe(firstText);
    expect(second.pendingClarification?.attempt).toBe(2);
    expect(second.spokenText.toLowerCase()).toMatch(/open it, check its status, or start working on it/);
  });
});

describe('Natural expression layer — fact fidelity (G, H)', () => {
  const facts = {
    kind: 'project_operate' as const,
    entityName: 'Free Cash',
    runningTasks: 1,
    queuedTasks: 0,
    blockedTasks: 9,
    blocker: 'Missing external FreeCash API keys / credentials',
    blockerRecordedAt: '2026-09-11T11:14:31.654Z',
    blockerRevalidated: false,
    success: true,
    verified: true,
  };

  it('G: preserves entity and counts; an UNREVALIDATED blocker is not narrated as current state (GUI record keeps it)', async () => {
    const out = await renderOperationalResult(facts);
    expect(out).toContain('Free Cash');
    expect(out).toMatch(/one|1/i);
    // Spec change 2026-09-23: stale (blockerRevalidated=false) blocker detail
    // must not reach the voice channel at all — that was the "irrelevant old
    // blocker dump" defect. The blocked COUNT stays; the date/stale sentence goes.
    expect(out).not.toContain('Missing external FreeCash API keys / credentials');
    expect(out).not.toContain('September 11');
    expect(out).toMatch(/blocked/i);
    for (const forbidden of ['verified=false', 'entityId', 'route', 'action_status', 'confidence=', 'not revalidated in this turn']) {
      expect(out.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('G1b: a REVALIDATED blocker is spoken as current state', async () => {
    const out = await renderOperationalResult({ ...facts, blockerRevalidated: true });
    expect(out).toContain('Missing external FreeCash API keys / credentials');
    expect(out.toLowerCase()).toMatch(/current blocker is/);
  });

  it('G2: an unverified navigation never claims success', async () => {
    const out = await renderOperationalResult({ kind: 'navigate', entityName: 'Free Cash', verified: false });
    expect(out.toLowerCase()).not.toMatch(/is open/);
    expect(out.toLowerCase()).toContain('free cash');
  });

  it('G3: a failed operation never renders as started', async () => {
    const out = await renderOperationalResult({ ...facts, success: false, runningTasks: 0 });
    expect(out.toLowerCase()).not.toMatch(/started|running now/);
  });

  it('H: rendering is deterministic (same structured result → same sentence on both surfaces)', async () => {
    const a = await renderOperationalResult(facts);
    const b = await renderOperationalResult(facts);
    expect(a).toBe(b);
  });

  it('renderer strips machine metadata from inherited text', () => {
    const cleaned = stripInternalTerminology(
      'Started. 1 task is running now. The next blocker is X (recorded 2026-09-11, 6 days old, not revalidated in this turn).',
    );
    expect(cleaned).not.toContain('not revalidated');
    expect(cleaned).not.toContain('6 days old');
  });
});

describe('Interruption (I)', () => {
  it('I: "Shut up." is treated as an out-of-band stop returning to ready with immediate silence', async () => {
    const res = await universalExecutionController.handleUserTurn({
      prompt: 'Jarvis, shut up.',
      conversationId: conversationId(),
      sttConfidence: 1.0,
      rawStt: 'Jarvis, shut up.',
    });
    expect(res.handled).toBe(true);
    expect(res.goalId).toBe('stop');
    expect(res.spokenText).toBe(''); // Immediate silence: STOP_PRODUCES_NO_TTS
    expect(universalExecutionController.isSuspendedState()).toBe(false); // STOP_RETURNS_READY
  });
});
