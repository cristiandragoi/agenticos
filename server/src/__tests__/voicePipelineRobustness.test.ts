import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isSelfHearingEcho } from '../domains/jarvisNext/audioUtils.js';
import { routeTurn, getFocus } from '../domains/jarvisNext/turnRouter.js';
import { stripWakeWord } from '../domains/jarvisNext/wakeWord.js';
import { detectControlIntent } from '../domains/jarvisNext/controlIntentDetector.js';
import { evaluateVoiceInvariants } from '../domains/jarvisNext/voiceRuntimeInvariants.js';
import { projectsStore } from '../services/projectsStore.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';

describe('Voice Pipeline Robustness & Regression Suite', () => {
  let convId = 'test-voice-robustness-' + Date.now();

  beforeEach(() => {
    convId = 'test-voice-robustness-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const focus = getFocus(convId);
    focus.activeEntityId = undefined;
    focus.activeEntityName = undefined;
    focus.activeEntityType = undefined;
    focus.activeProjectId = undefined;
    focus.activeProjectName = undefined;
    // Ensure proj-free-cash exists in mock store
    if (!projectsStore.getProject('proj-free-cash')) {
      projectsStore.createProject({
        id: 'proj-free-cash',
        name: 'Free Cash',
        priority: 1,
        status: 'active',
      });
    }
  });

  // ── 1. FreeCash context -> arithmetic -> unrelated question ──────────────────
  describe('1. Context isolation: FreeCash context -> arithmetic -> unrelated question', () => {
    it('answers arithmetic 2 + 2 = 4 and does not become a Free Cash status request', async () => {
      // Step A: Discuss Free Cash
      const turn1 = await routeTurn({
        prompt: 'What is Free Cash?',
        conversationId: convId,
      });
      expect(turn1.handled).toBe(true);

      // Step B: Follow-up with math immediately after Free Cash
      const turn2 = await routeTurn({
        prompt: 'how much is 2 plus 2?',
        conversationId: convId,
      });
      expect(turn2.handled).toBe(true);
      expect(turn2.route).toBe('chat_trivial');
      expect(turn2.text).toContain('4');
      expect(turn2.text.toLowerCase()).not.toContain('free cash is active');
      expect(turn2.text.toLowerCase()).not.toContain('tasks are running');

      // Step C: Follow-up with unrelated geography question
      const turn3 = await routeTurn({
        prompt: 'what is the capital of France?',
        conversationId: convId,
      });
      expect(turn3.route).not.toBe('fast_read');
      expect(turn3.entityId).not.toBe('proj-free-cash');
      expect(turn3.text.toLowerCase()).not.toContain('free cash');
    });
  });

  // ── 2. Global status containing "actually" ──────────────────────────────────
  describe('2. Global status query containing "actually"', () => {
    it('preserves scope for "Okay, across all projects, what work is actually running?"', async () => {
      const turn = await routeTurn({
        prompt: 'Okay, across all projects, what work is actually running?',
        conversationId: convId,
      });
      expect(turn.handled).toBe(true);
      // Route must be global work summary or project_overview, NOT single-project fast_read
      expect(turn.route).toBe('fast_read');
      expect(turn.entityType).toBe('project_list');
      // Must not be scoped to proj-free-cash alone
      expect(turn.entityId).not.toBe('proj-free-cash');
      expect(turn.text).toMatch(/projects registered|priority|tasks are running|no tasks/i);
    });

    it('preserves scope for "across all projects, what is actually blocked?"', async () => {
      const turn = await routeTurn({
        prompt: 'across all projects, what is actually blocked?',
        conversationId: convId,
      });
      expect(turn.handled).toBe(true);
      expect(turn.route).toBe('fast_read');
      expect(turn.entityType).toBe('blocked_overview');
      expect(turn.text).toMatch(/globally across all projects/i);
    });
  });

  // ── 3. Genuine self-correction versus ordinary "actually" ───────────────────
  describe('3. Genuine self-correction vs ordinary adverbial "actually"', () => {
    it('does not truncate ordinary questions using "actually"', async () => {
      const queries = [
        'Okay, across all projects, what work is actually running?',
        'can you actually automate the inside of the project',
        'what did we actually finish yesterday?',
        'is that actually working right now?',
      ];

      for (const q of queries) {
        const { commandText } = stripWakeWord(q);
        const effective = commandText || q;
        // Verify regex does not truncate query to just the word after "actually"
        const selfCorrectionMatch = effective.match(
          /(?:^|[,;]\s*|\s+--\s+|\s+-\s+)(?:scratch\s+that|no\s+wait|correction|i\s+mean|actually\s+no|no[,\s]+actually|actually[,\s]+wait)\s*[,:]?\s+(.+)$/i
        );
        expect(selfCorrectionMatch).toBeNull();
      }
    });

    it('correctly extracts intent on genuine self-corrections with clear restart markers', () => {
      const cases = [
        {
          input: 'Start task 1, scratch that, start task 2',
          expected: 'start task 2',
        },
        {
          input: 'Look at Free Cash, no wait, check project Apollo',
          expected: 'check project Apollo',
        },
        {
          input: 'Open YouTube, actually no, open the project dashboard',
          expected: 'open the project dashboard',
        },
        {
          input: 'Check project Alpha, correction: check project Gamma',
          expected: 'check project Gamma',
        },
      ];

      for (const c of cases) {
        const match = c.input.match(
          /(?:^|[,;]\s*|\s+--\s+|\s+-\s+)(?:scratch\s+that|no\s+wait|correction|i\s+mean|actually\s+no|no[,\s]+actually|actually[,\s]+wait)\s*[,:]?\s+(.+)$/i
        );
        expect(match).not.toBeNull();
        expect(match![1].trim().toLowerCase()).toBe(c.expected.toLowerCase());
      }
    });
  });

  // ── 4. Prerequisite questions vs status and start requests ─────────────────
  describe('4. Prerequisite questions vs status and start requests', () => {
    it('routes "What do you need for the free cash to start the project?" as prerequisite inquiry', async () => {
      const turn = await routeTurn({
        prompt: 'What do you need for the free cash to start the project?',
        conversationId: convId,
      });
      expect(turn.handled).toBe(true);
      // Must NOT be executed as a project operate / mutation
      expect(turn.route).toBe('fast_read');
      expect(turn.route).not.toBe('project_operate');
      expect(turn.executed).not.toBe(true); // Must NOT execute or mutate
    });

    it('routes "What do you need to start on Free Cash?" as prerequisite inquiry without operating project', async () => {
      const turn = await routeTurn({
        prompt: 'What do you need to start on Free Cash?',
        conversationId: convId,
      });
      expect(turn.handled).toBe(true);
      expect(turn.route).toBe('fast_read');
      expect(turn.route).not.toBe('project_operate');
      expect(turn.executed).not.toBe(true);
    });

    it('distinguishes start requests like "Start working on Free Cash"', async () => {
      const turn = await routeTurn({
        prompt: 'Start working on Free Cash',
        conversationId: convId,
      });
      expect(turn.handled).toBe(true);
      expect(turn.route).toBe('project_operate');
    });
  });

  // ── 5. Echo filter precision ────────────────────────────────────────────────
  describe('5. Echo filter: protects legitimate user questions and control commands', () => {
    const assistantSpeech = 'Free Cash is active. Thirty tasks are marked in progress in stored records. One item is blocked.';

    it('never drops user questions as echo even when mentioning assistant words', () => {
      const questions = [
        'What do you need for the free cash to start the project?',
        'What do you need to start on Free Cash?',
        'How many tasks are running in Free Cash?',
        'Which item is blocked?',
        'Can you tell me about the blocked tasks in Free Cash?',
      ];

      for (const q of questions) {
        const isEcho = isSelfHearingEcho(q, assistantSpeech);
        expect(isEcho).toBe(false);
      }
    });

    it('never drops user control and interruption commands as echo', () => {
      const controlCommands = [
        'Stop working on it, stop working.',
        'stop working',
        'Can you stop speaking?',
        'stop speaking',
        'shut up',
        'be quiet',
        'pause',
        'halt',
        'cancel',
        'start working',
      ];

      for (const cmd of controlCommands) {
        const isEcho = isSelfHearingEcho(cmd, assistantSpeech);
        expect(isEcho).toBe(false);
      }
    });

    it('correctly drops verbatim speaker echo and known noise hallucinations', () => {
      // Substantial verbatim repetition from assistant speech
      const trueEcho = 'thirty tasks are marked in progress in stored records';
      expect(isSelfHearingEcho(trueEcho, assistantSpeech)).toBe(true);

      // Full sentence match
      expect(isSelfHearingEcho(assistantSpeech, assistantSpeech)).toBe(true);

      // Noise hallucination
      expect(isSelfHearingEcho('subtitles by', assistantSpeech)).toBe(true);
      expect(isSelfHearingEcho('amaraorg', assistantSpeech)).toBe(true);
    });
  });

  // ── 6. Speech stop without cancelling work ──────────────────────────────────
  describe('6. Speech stop decoupled from work cancellation', () => {
    it('detects "Can you stop speaking?" as speech stop without cancelling background tasks', async () => {
      // Create a dummy background task
      const created = backgroundTaskManager.createTask({
        title: 'Background test task',
        objective: 'Test objective',
        worker: 'codex',
        selectedAgent: 'jarvis',
        route: 'operate',
        type: 'test' as any,
        projectId: 'proj-free-cash',
      });
      expect(created.task).toBeDefined();

      const turn = await routeTurn({
        prompt: 'Can you stop speaking?',
        conversationId: convId,
      });

      expect(turn.handled).toBe(true);
      expect(turn.route).toBe('chat_trivial');
      expect((turn as any).goalId).toBe('stop');

      // The task must NOT be cancelled
      const activeTask = backgroundTaskManager.getTask(created.task.taskId);
      expect(activeTask?.status).not.toBe('cancelled');
    });

    it('cancels work when user explicitly says "stop working on it"', async () => {
      const created = backgroundTaskManager.createTask({
        title: 'Background work task',
        objective: 'Work objective',
        worker: 'codex',
        selectedAgent: 'jarvis',
        route: 'operate',
        type: 'test' as any,
        projectId: 'proj-free-cash',
      });
      expect(created.task).toBeDefined();

      const turn = await routeTurn({
        prompt: 'stop working on it',
        conversationId: convId,
      });

      expect(turn.handled).toBe(true);
      // Project operate / stop executed
      expect(turn.route).toBe('project_operate');
    });
  });

  // ── 7. Self-Heal detection for voice failure classes ────────────────────────
  describe('7. Self-Heal detection for voice failure classes', () => {
    it('detects ECHO_DROPPED_LEGITIMATE_SPEECH when control or question was dropped', () => {
      const fired = evaluateVoiceInvariants({
        terminal: true,
        turn: {
          turnId: 17,
          echoDropped: true,
          droppedAsEchoText: 'Stop working on it, stop working.',
          isProcessingUserTurn: false,
        },
      });

      const echoInvariant = fired.find((f) => f.id === 'ECHO_DROPPED_LEGITIMATE_SPEECH');
      expect(echoInvariant).toBeDefined();
      expect(echoInvariant?.detail).toContain('dropped candidate transcript');
    });

    it('detects VOICE_TURN_STUCK when turn never reaches terminal outcome', () => {
      const fired = evaluateVoiceInvariants({
        terminal: false,
        turn: {
          turnId: 18,
          isProcessingUserTurn: true,
          committedAt: Date.now() - 20000,
        },
      });

      const stuckInvariant = fired.find((f) => f.id === 'VOICE_TURN_STUCK');
      expect(stuckInvariant).toBeDefined();
    });
  });

  // ── 8. Recovery without reconnecting ────────────────────────────────────────
  describe('8. Recovery after unhandled turn without requiring reconnection', () => {
    it('allows subsequent turn to execute cleanly after a quiet recovery', async () => {
      // Turn 1: Quiet recovery / speech stop
      const turn1 = await routeTurn({
        prompt: 'Can you stop speaking?',
        conversationId: convId,
      });
      expect(turn1.handled).toBe(true);

      // Turn 2: Immediately follow up with a real question without reconnecting
      const turn2 = await routeTurn({
        prompt: 'What is Free Cash?',
        conversationId: convId,
      });
      expect(turn2.handled).toBe(true);
      expect(turn2.route).toBe('fast_read');
      expect(turn2.text).toContain('Free Cash');
    });
  });
});
