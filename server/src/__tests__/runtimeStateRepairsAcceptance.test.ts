import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { authoritativeIntentCompiler, AuthoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { targetResolver } from '../domains/controlPlane/TargetResolver.js';
import { conversationCapabilityAdapter } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import { universalCapabilityRuntime } from '../domains/controlPlane/UniversalCapabilityRuntime.js';

describe('Runtime State Repairs Acceptance', () => {
  const convId = 'conv-runtime-state-' + Date.now();

  beforeEach(() => {
    authoritativeInteractionContext.reset(convId);
    targetResolver.setMockWindows(null);
  });

  afterEach(() => {
    targetResolver.setMockWindows(null);
  });

  describe('1. Telegram Sub-Message Playback Cursor & Continuation', () => {
    it('initializes ActivePlaybackTask with sub-message tracking fields', () => {
      const longMessage1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes? Do not create a new task. Tell me the existing task ID, worker status, last real event, blocker, and verification state.';
      const message2 = 'Hermes is currently analyzing the repository.';
      const message3 = 'No blocking issues detected.';
      const message4 = 'Verification state is pending completion of the test suite.';

      const task = authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-1',
        4,
        0,
        [
          { id: 'm1', text: longMessage1, sender: 'User' },
          { id: 'm2', text: message2, sender: 'Hermes' },
          { id: 'm3', text: message3, sender: 'Hermes' },
          { id: 'm4', text: message4, sender: 'Hermes' },
        ]
      ).activePlaybackTask!;

      expect(task.currentMessageIndex).toBe(0);
      expect(task.sentenceIndex).toBe(0);
      expect(task.chunkIndex).toBe(0);
      expect(task.characterOffset).toBe(0);
      expect(task.lastSuccessfullyPlayedChunk).toBeNull();
      expect(task.messageCompleted).toBe(false);
      expect(task.playbackStatus).toBe('PLAYING');
      expect(task.totalMessages || task.requestedCount).toBe(4);
    });

    it('advances playback cursor at sub-message granularity only upon chunk completion', () => {
      const longMessage1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes? Do not create a new task. Tell me the existing task ID, worker status, last real event, blocker, and verification state.';
      
      authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-1',
        1,
        0,
        [{ id: 'm1', text: longMessage1, sender: 'User' }]
      );

      // Sentence 1 played
      const s1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes?';
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, s1);

      let currentTask = authoritativeInteractionContext.getContext(convId).activePlaybackTask!;
      expect(currentTask.sentenceIndex).toBe(1);
      expect(currentTask.chunkIndex).toBe(1);
      expect(currentTask.characterOffset).toBe(s1.length);
      expect(currentTask.lastSuccessfullyPlayedChunk).toBe(s1);
      expect(currentTask.messageCompleted).toBe(false);

      // Sentence 2 played: "Do not create a new task."
      const s2 = 'Do not create a new task.';
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 1, s2);

      currentTask = authoritativeInteractionContext.getContext(convId).activePlaybackTask!;
      expect(currentTask.sentenceIndex).toBe(2);
      expect(currentTask.chunkIndex).toBe(2);
      expect(currentTask.characterOffset).toBe(longMessage1.indexOf(s2) + s2.length);
      expect(currentTask.lastSuccessfullyPlayedChunk).toBe(s2);
      expect(currentTask.messageCompleted).toBe(false);
    });

    it('on interruption, retains exact sub-message cursor and records interruption reason without resetting', () => {
      const longMessage1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes? Do not create a new task. Tell me the existing task ID, worker status, last real event, blocker, and verification state.';
      
      authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-1',
        1,
        0,
        [{ id: 'm1', text: longMessage1, sender: 'User' }]
      );

      // First two sentences played
      const s1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes?';
      const s2 = 'Do not create a new task.';
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, s1);
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 1, s2);

      // User interrupted by speaking or pause
      authoritativeInteractionContext.recordPlaybackInterrupted(convId, 'User interrupted playback');

      const currentTask = authoritativeInteractionContext.getContext(convId).activePlaybackTask!;
      expect(currentTask.playbackStatus).toBe('INTERRUPTED');
      expect(currentTask.interruptionReason).toBe('User interrupted playback');
      // Sub-message position is strictly retained
      expect(currentTask.currentMessageIndex).toBe(0);
      expect(currentTask.sentenceIndex).toBe(2);
      expect(currentTask.chunkIndex).toBe(2);
      expect(currentTask.characterOffset).toBeGreaterThan(0);
      expect(currentTask.lastSuccessfullyPlayedChunk).toBe(s2);
    });

    it('resumes from unspoken sub-message chunk on "continue" without repeating from beginning', async () => {
      const longMessage1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes? Do not create a new task. Tell me the existing task ID, worker status, last real event, blocker, and verification state.';
      const message2 = 'Hermes worker status is active.';

      authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-1',
        2,
        0,
        [
          { id: 'm1', text: longMessage1, sender: 'User' },
          { id: 'm2', text: message2, sender: 'Hermes' },
        ]
      );

      // Plays up to "Do not create a new task." and is interrupted
      const s1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes?';
      const s2 = 'Do not create a new task.';
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, s1);
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 1, s2);
      authoritativeInteractionContext.recordPlaybackInterrupted(convId, 'User asked a question');

      // User says "continue"
      const plan = AuthoritativeIntentCompiler.compileIntentPlan('continue', { conversationId: convId });
      expect(plan.steps[0].action).toBe('READ_MESSAGES');
      expect(plan.steps[0].contentRequest).toBe('continue_messages');

      // Execute continue_messages via UniversalCapabilityRuntime
      const result = await universalCapabilityRuntime.executeStep(plan.steps[0], 1, convId);
      expect(result.success).toBe(true);

      // Must contain unspoken remainder, NOT repeat the beginning of message 1!
      expect(result.outputText).toMatch(/Tell me the existing task ID, worker status, last real event, blocker, and verification state/i);
      expect(result.outputText).not.toMatch(/What is the status of the Agentico OS GitHub repository update task/i);
      expect(result.outputText).toMatch(/Hermes worker status is active/i);
    });
  });

  describe('2. Causal "Why" / Failure Introspection', () => {
    it('isExplanatoryWhyRequest detects various failure and stoppage questions', () => {
      expect(AuthoritativeIntentCompiler.isExplanatoryWhyRequest('Why did you stop?')).toBe(true);
      expect(AuthoritativeIntentCompiler.isExplanatoryWhyRequest('Why are you not able to finish the message?')).toBe(true);
      expect(AuthoritativeIntentCompiler.isExplanatoryWhyRequest('Why didn\'t it work?')).toBe(true);
      expect(AuthoritativeIntentCompiler.isExplanatoryWhyRequest('What happened?')).toBe(true);
    });

    it('explainPreviousOutcome prioritizes interrupted/incomplete playback state over past success', async () => {
      const longMessage1 = 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes? Do not create a new task. Tell me the existing task ID, worker status, last real event, blocker, and verification state.';

      authoritativeInteractionContext.recordActionOutcome(convId, {
        stepId: 'step-1',
        action: 'OPEN_CHAT',
        target: 'Agentico OS',
        success: true,
        summary: 'Located conversation Agentico OS in Telegram and read recent messages.',
      });

      authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-1',
        4,
        0,
        [
          { id: 'm1', text: longMessage1, sender: 'User' },
          { id: 'm2', text: 'Hermes status message', sender: 'Hermes' },
        ]
      );

      // Played up to "Do not create a new task."
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, 'What is the status of the Agentico OS GitHub repository update task that I delegated to Hermes?');
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 1, 'Do not create a new task.');
      authoritativeInteractionContext.recordPlaybackInterrupted(convId, 'Speech playout was cancelled before all chunks completed');

      const plan = AuthoritativeIntentCompiler.compileIntentPlan('Why are you not able to finish the message?', { conversationId: convId });
      expect(plan.steps[0].action).toBe('CONVERSATIONAL');
      expect(plan.steps[0].target).toBe('explain_previous_outcome');

      const result = await conversationCapabilityAdapter.execute(plan.steps[0], 1, convId);
      expect(result.success).toBe(true);
      // Explains the incomplete playback and interruption, not the Telegram window acquisition!
      expect(result.outputText).toMatch(/stopped reading because|speech playout was cancelled|playback was interrupted|incomplete|unspoken/i);
      expect(result.outputText).not.toMatch(/I was able to read it because Telegram had the Agentico OS conversation open/i);
    });
  });

  describe('3. Visible Desktop Window Resolution', () => {
    it('compiles "Open Hermes 1 on my desktop" and "Read what you see on Hermes 1" with hermes target', () => {
      const plan1 = AuthoritativeIntentCompiler.compileIntentPlan('Open Hermes 1 on my desktop.', { conversationId: convId });
      expect(plan1.steps[0].action).toBe('OPEN_APPLICATION');
      expect(plan1.steps[0].application?.toLowerCase()).toMatch(/hermes/);

      const plan2 = AuthoritativeIntentCompiler.compileIntentPlan('Read what you see on Hermes 1.', { conversationId: convId });
      expect(plan2.steps[0].action).toBe('READ_CONTENT');
      expect(plan2.steps[0].application?.toLowerCase()).toMatch(/hermes/);
    });

    it('compiles "Open ChatGPT and read what you see" into compound plan targeting ChatGPT and screen content', () => {
      const plan = AuthoritativeIntentCompiler.compileIntentPlan('Open ChatGPT and read what you see.', { conversationId: convId });
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[0].action).toBe('OPEN_APPLICATION');
      expect(plan.steps[0].application?.toLowerCase()).toMatch(/chatgpt/);
      expect(plan.steps[1].action).toBe('READ_CONTENT');
      expect(plan.steps[1].contentRequest).toBe('window_content');
    });

    it('resolves running desktop window with matchType running_window without launching', async () => {
      // Mock window table observation with Hermes One and ChatGPT
      const mockWindows = [
        {
          hwnd: 13634408,
          title: 'Hermes One',
          process: 'hermes-agent',
          pid: 1400,
        },
        {
          hwnd: 525170,
          title: 'ChatGPT',
          process: 'ChatGPT',
          pid: 21420,
        },
      ];

      targetResolver.setMockWindows(mockWindows);
      const context = authoritativeInteractionContext.getContext(convId);

      // Test TargetResolver resolving Hermes 1 to existing Hermes One window
      const intentHermes = AuthoritativeIntentCompiler.compile('Open Hermes 1 on my desktop.');
      const resolvedHermes = await targetResolver.resolve(intentHermes, context);
      expect(resolvedHermes).not.toBeNull();
      expect(resolvedHermes.matchType).toBe('running_window');
      expect(resolvedHermes.windowHandle).toBe(13634408);
      expect(resolvedHermes.resolvedApplication).toBe('hermes-agent');

      // Test TargetResolver resolving ChatGPT to existing ChatGPT window
      const intentChatGPT = AuthoritativeIntentCompiler.compile('Open ChatGPT and read what you see.');
      const resolvedChatGPT = await targetResolver.resolve(intentChatGPT, context);
      expect(resolvedChatGPT).not.toBeNull();
      expect(resolvedChatGPT.matchType).toBe('running_window');
      expect(resolvedChatGPT.windowHandle).toBe(525170);
      expect(resolvedChatGPT.resolvedApplication).toBe('ChatGPT');
    });
  });

  describe('4. Authoritative Client Playout Acknowledgment Lifecycle Contract', () => {
    it('verifies CHUNK_SENT does NOT advance the heard-content cursor', () => {
      const messages = [
        { id: 'm1', text: 'Message one first sentence. Message one second sentence.', sender: 'Alice' },
        { id: 'm2', text: 'Message two text.', sender: 'Bob' },
        { id: 'm3', text: 'Message three text.', sender: 'Charlie' },
        { id: 'm4', text: 'Message four text.', sender: 'Dave' },
      ];

      const initial = authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-4',
        4,
        0,
        messages
      ).activePlaybackTask!;

      expect(initial.currentMessageIndex).toBe(0);
      expect(initial.chunkIndex).toBe(0);

      // Server sends frame packets to network / WebRTC
      authoritativeInteractionContext.recordChunkSent(convId, {
        playbackTaskId: initial.playbackTaskId,
        messageIndex: 0,
        sentenceIndex: 0,
        chunkIndex: 0,
        characterStart: 0,
        characterEnd: 26,
        chunkText: 'Message one first sentence.',
        durationMs: 1500,
        isFinal: false,
      });

      // Cursor MUST remain at 0 - network write MUST NOT advance heard-content cursor!
      const afterSend = authoritativeInteractionContext.getActivePlaybackTask(convId)!;
      expect(afterSend.currentMessageIndex).toBe(0);
      expect(afterSend.chunkIndex).toBe(0);
      expect(afterSend.characterOffset).toBe(0);
      expect(afterSend.status).toBe('PLAYING');
    });

    it('advances playback cursor ONLY upon CLIENT_PLAYOUT_COMPLETED', () => {
      const messages = [
        { id: 'm1', text: 'Message one first sentence. Message one second sentence.', sender: 'Alice' },
        { id: 'm2', text: 'Message two text.', sender: 'Bob' },
      ];

      const task = authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-2',
        2,
        0,
        messages
      ).activePlaybackTask!;

      // Client begins physical playout of chunk 0
      authoritativeInteractionContext.recordClientPlayoutStarted(convId, task.playbackTaskId, 0);
      let current = authoritativeInteractionContext.getActivePlaybackTask(convId)!;
      expect(current.status).toBe('PLAYING');
      expect(current.currentMessageIndex).toBe(0);

      // Client physically completes chunk 0 on speaker
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, 'Message one first sentence.', {
        playbackTaskId: task.playbackTaskId,
        messageIndex: 0,
        sentenceIndex: 0,
        characterEnd: 26,
        isFinal: false,
      });

      current = authoritativeInteractionContext.getActivePlaybackTask(convId)!;
      expect(current.chunkIndex).toBe(1);
      expect(current.lastCompletedChunkIndex).toBe(0);
      expect(current.characterOffset).toBe(26);
      expect(current.currentMessageIndex).toBe(0);
      expect(current.status).toBe('PLAYING');
    });

    it('handles interruption and resumes from the first unconfirmed chunk on continue', async () => {
      const messages = [
        { id: 'm1', text: 'Sentence one of message one. Sentence two of message one.', sender: 'Alice' },
        { id: 'm2', text: 'Sentence one of message two.', sender: 'Bob' },
        { id: 'm3', text: 'Sentence one of message three.', sender: 'Charlie' },
        { id: 'm4', text: 'Sentence one of message four.', sender: 'Dave' },
      ];

      const task = authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-multi',
        4,
        0,
        messages
      ).activePlaybackTask!;

      // Chunk 0 completed
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, 'Sentence one of message one.', {
        playbackTaskId: task.playbackTaskId,
        messageIndex: 0,
        sentenceIndex: 0,
        characterEnd: 27,
        isFinal: false,
      });

      // Interrupted while playing chunk 1
      authoritativeInteractionContext.recordPlaybackInterrupted(convId, {
        playbackTaskId: task.playbackTaskId,
        lastCompletedChunkIndex: 0,
        currentChunkIndex: 1,
        reason: 'User voice barge-in',
      });

      let current = authoritativeInteractionContext.getActivePlaybackTask(convId)!;
      expect(current.status).toBe('INTERRUPTED');
      expect(current.interruptionReason).toBe('User voice barge-in');
      expect(current.lastCompletedChunkIndex).toBe(0);
      expect(current.currentMessageIndex).toBe(0);
      expect(current.remainingMessages.length).toBe(4);

      // Say "continue"
      const plan = AuthoritativeIntentCompiler.compileIntentPlan('continue reading the message', { conversationId: convId });
      expect(plan.steps[0].action).toBe('READ_MESSAGES');
      expect(plan.steps[0].contentRequest).toBe('continue_messages');

      const result = await universalCapabilityRuntime.executeStep(plan.steps[0], 1, convId);
      expect(result.success).toBe(true);
      // Resumes with unspoken sentence 2 of message 1, followed by messages 2, 3, 4
      expect(result.outputText).toMatch(/Sentence two of message one/i);
      expect(result.outputText).not.toMatch(/Sentence one of message one/i);
      expect(result.outputText).toMatch(/Sentence one of message two/i);
    });

    it('marks playback task COMPLETED only after client confirms final chunk of final message', () => {
      const messages = [
        { id: 'm1', text: 'Only message here.', sender: 'Alice' },
      ];

      const task = authoritativeInteractionContext.startPlaybackTask(
        convId,
        'telegram-chat-final',
        1,
        0,
        messages
      ).activePlaybackTask!;

      // Server send frames finishes - must NOT be COMPLETED
      authoritativeInteractionContext.recordChunkSent(convId, {
        playbackTaskId: task.playbackTaskId,
        messageIndex: 0,
        sentenceIndex: 0,
        chunkIndex: 0,
        characterStart: 0,
        characterEnd: 18,
        chunkText: 'Only message here.',
        durationMs: 1200,
        isFinal: true,
      });

      let current = authoritativeInteractionContext.getActivePlaybackTask(convId)!;
      expect(current.status).not.toBe('COMPLETED');

      // Client confirms physical playout completed for final chunk
      authoritativeInteractionContext.recordChunkPlayoutCompleted(convId, 0, 'Only message here.', {
        playbackTaskId: task.playbackTaskId,
        messageIndex: 0,
        sentenceIndex: 0,
        characterEnd: 18,
        isFinal: true,
      });

      const finished = authoritativeInteractionContext.getContext(convId).activePlaybackTask!;
      expect(finished.status).toBe('COMPLETED');
      expect(finished.playbackStatus).toBe('COMPLETED');
      expect(finished.messageCompleted).toBe(true);
      expect(finished.currentMessageIndex).toBe(1);
    });
  });
});
