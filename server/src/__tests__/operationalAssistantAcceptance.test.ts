import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveConversationalCorrection,
  extractContentResults,
  emptyBrowserState,
  type BrowserStateSnapshot,
} from '../services/browser/browserActionContract.js';
import { desktopExecutor } from '../domains/jarvis/execution/executors/desktopExecutor.js';
import { semanticGoalParser } from '../domains/jarvis/execution/semanticGoalParser.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';

describe('Operational Assistant Coherence Acceptance', () => {
  describe('Phase 3: Semantic Result Selection', () => {
    it('filters out category chips like "Musik" and extracts real video results', () => {
      const mockElements = [
        { name: 'YouTube Home', role: 'link', href: 'https://www.youtube.com/' },
        { name: 'Musik', role: 'link', href: 'https://www.youtube.com/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ' },
        { name: 'Gaming', role: 'link', href: 'https://www.youtube.com/gaming' },
        { name: 'Building Python AI Agents From Scratch', role: 'link', href: 'https://www.youtube.com/watch?v=abc123xyz' },
        { name: 'Building Python AI Agents From Scratch thumbnail', role: 'link', href: 'https://www.youtube.com/watch?v=abc123xyz' },
        { name: 'Autonomous Multi-Agent Systems in Python', role: 'link', href: 'https://www.youtube.com/watch?v=def456uvw' },
        { name: 'Agentic AI Tutorial', role: 'link', href: 'https://www.youtube.com/watch?v=ghi789rst' },
      ];

      const results = extractContentResults(mockElements, 'https://www.youtube.com/results?search_query=python+agents');
      expect(results.length).toBe(3);
      expect(results[0].name).toBe('Building Python AI Agents From Scratch');
      expect(results[0].href).toBe('https://www.youtube.com/watch?v=abc123xyz');
      expect(results[1].name).toBe('Autonomous Multi-Agent Systems in Python');
      expect(results[2].name).toBe('Agentic AI Tutorial');
    });

    it('handles ordinal resolution (1st, 2nd, 3rd)', () => {
      const state: BrowserStateSnapshot = {
        ...emptyBrowserState(),
        lastBrowserUrl: 'https://www.youtube.com/results?search_query=python+agents',
        visibleTarget: 'YouTube',
      };

      const first = resolveConversationalCorrection('Open the first result', state);
      expect(first.kind).toBe('open_first_result');
      expect((first as any).ordinalIndex).toBe(1);

      const second = resolveConversationalCorrection('Open the second result', state);
      expect(second.kind).toBe('open_first_result');
      expect((second as any).ordinalIndex).toBe(2);

      const third = resolveConversationalCorrection('Open the third one', state);
      expect(third.kind).toBe('open_first_result');
      expect((third as any).ordinalIndex).toBe(3);
    });
  });

  describe('Phase 4 & 5: Natural Browser Continuations & Conversational Corrections', () => {
    it('resolves destination corrections ("No, Google")', () => {
      const state: BrowserStateSnapshot = {
        ...emptyBrowserState(),
        lastBrowserUrl: 'https://www.youtube.com',
        visibleTarget: 'YouTube',
      };

      const res = resolveConversationalCorrection('No, Google', state);
      expect(res.kind).toBe('redirect_destination');
      expect((res as any).newDestination?.toLowerCase()).toBe('google');
    });

    it('resolves query corrections ("No, I meant AI coding agents")', () => {
      const state: BrowserStateSnapshot = {
        ...emptyBrowserState(),
        lastBrowserUrl: 'https://www.youtube.com/results?search_query=ai+agents',
        visibleTarget: 'YouTube',
        lastBrowserGoal: 'search for ai agents',
      };

      const res = resolveConversationalCorrection('No, I meant AI coding agents', state);
      expect(res.kind).toBe('correct_search_query');
      expect((res as any).newQuery).toBe('AI coding agents');
    });

    it('resolves result corrections ("Actually the first one")', () => {
      const state: BrowserStateSnapshot = {
        ...emptyBrowserState(),
        lastBrowserUrl: 'https://www.youtube.com/results?search_query=python+agents',
        visibleTarget: 'YouTube',
      };

      const res = resolveConversationalCorrection('Actually the first one', state);
      expect(res.kind).toBe('open_first_result');
      expect((res as any).ordinalIndex).toBe(1);
    });

    it('resolves navigation continuations (go back, go forward, scroll down, scroll up)', () => {
      const state: BrowserStateSnapshot = {
        ...emptyBrowserState(),
        lastBrowserUrl: 'https://www.youtube.com',
        visibleTarget: 'YouTube',
      };

      expect(resolveConversationalCorrection('Go back', state).kind).toBe('go_back');
      expect(resolveConversationalCorrection('Go forward', state).kind).toBe('go_forward');
      expect(resolveConversationalCorrection('Scroll down', state).kind).toBe('scroll');
      expect(resolveConversationalCorrection('Scroll up', state).kind).toBe('scroll');
    });
  });

  describe('Phase 6: Multi-Step Execution Planning', () => {
    it('splits compound goal into 3 explicit ordered steps', async () => {
      const compound = 'Open YouTube, search for Python AI agents, and open the first result';
      const plan = await semanticGoalParser.parseGoal(compound, {
        conversationId: 'conv-multistep-test',
      });

      expect(plan.steps.length).toBe(3);
      expect(plan.steps[0].action).toBe('navigate');
      expect(plan.steps[0].parameters.target).toBe('YouTube');
      expect(plan.steps[1].action).toBe('search');
      expect(plan.steps[1].parameters.query).toBe('Python AI agents');
      expect(plan.steps[2].action).toBe('open_result');
    });
  });

  describe('Phase 7 & 8: Desktop & Filesystem Context', () => {
    it('tracks last opened folder and responds to "What did you just open?"', async () => {
      // Simulate opening a folder
      await desktopExecutor.openFolder(process.cwd());
      expect(desktopExecutor.getLastOpenedFolder()).toBeDefined();
      expect(desktopExecutor.getLastActionType()).toBe('folder');

      const response = await universalExecutionController.handleUserTurn({
        prompt: 'What did you just open?',
        conversationId: 'conv-desktop-context-test',
      });

      expect(response.handled).toBe(true);
      expect(response.spokenText).toMatch(/I just opened/i);
      expect(response.spokenText).toMatch(/File Explorer|AgenticOS/i);
    });

    it('resolves "Close it" for desktop applications', async () => {
      const plan = await semanticGoalParser.parseGoal('Close Notepad', {
        conversationId: 'conv-close-test',
      });

      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].executorId).toBe('desktop');
      expect(plan.steps[0].action).toBe('close_app');
    });
  });
});
