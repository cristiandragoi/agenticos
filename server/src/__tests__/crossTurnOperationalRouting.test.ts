/**
 * crossTurnOperationalRouting.test.ts — verifies operational context across turns:
 * 1. Contextual browser search continuation (YouTube, Google, no active session)
 * 2. Explicit target overriding active context
 * 3. Explicit platform search retaining 'search' action
 * 4. Full query preservation in wake-word handling (Moritz Jarvis, Jarvis AI)
 * 5. Result reference / follow-up ('Open the first result')
 * 6. Filesystem folder routing ('Open the AgenticOS folder', 'Open D:\AgenticOS')
 * 7. Preserving internal AgenticOS navigation ('Open Free Cash', 'Open Revenue Operator')
 * 8. Bare 'AgenticOS' guard
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { semanticGoalParser } from '../domains/jarvis/execution/semanticGoalParser.js';
import { browserStateStore } from '../services/browser/browserActionContract.js';
import { stripWakeWord } from '../domains/jarvisNext/wakeWord.js';
import { getWorkspaceRoot } from '../services/workspaceStore.js';
import type { ActionPlan, TurnContext } from '../domains/jarvis/execution/types.js';

describe('Cross-Turn Operational Context & Capability Routing', () => {
  const convId = 'test-cross-turn-conv';
  const ctx: TurnContext = { conversationId: convId };

  beforeEach(() => {
    browserStateStore.clear(convId);
  });

  afterEach(() => {
    browserStateStore.clear(convId);
  });

  describe('Wake-Word Query Preservation (Phase 3)', () => {
    it('6. "Search for Moritz Jarvis" preserves trailing Jarvis in query', () => {
      const res = stripWakeWord('Search for Moritz Jarvis');
      expect(res.commandText).toBe('Search for Moritz Jarvis');
      browserStateStore.update(convId, {
        lastBrowserUrl: 'https://www.youtube.com',
        visibleTarget: 'YouTube',
      });
      const contextualPlan = semanticGoalParser.parseGoal(res.commandText, ctx);
      expect(contextualPlan.steps[0]?.parameters.query).toBe('Moritz Jarvis');
    });

    it('7. "Jarvis, search for Moritz Jarvis" preserves Moritz Jarvis as query', () => {
      const res = stripWakeWord('Jarvis, search for Moritz Jarvis');
      expect(res.wakePrefixRemoved).toBe(true);
      expect(res.commandText).toBe('search for Moritz Jarvis');
      browserStateStore.update(convId, {
        lastBrowserUrl: 'https://www.youtube.com',
        visibleTarget: 'YouTube',
      });
      const plan = semanticGoalParser.parseGoal(res.commandText, ctx);
      expect(plan.steps[0]?.parameters.query).toBe('Moritz Jarvis');
    });

    it('Preserves Jarvis in "Jarvis search YouTube for Jarvis AI"', () => {
      const res = stripWakeWord('Jarvis search YouTube for Jarvis AI');
      expect(res.wakePrefixRemoved).toBe(true);
      expect(res.commandText).toBe('search YouTube for Jarvis AI');
      const plan = semanticGoalParser.parseGoal(res.commandText, ctx);
      expect(plan.steps[0]?.parameters.query).toBe('Jarvis AI');
    });

    it('Still strips genuine suffix wake words like "Open YouTube, Jarvis"', () => {
      const res = stripWakeWord('Open YouTube, Jarvis');
      expect(res.commandText).toBe('Open YouTube');
    });
  });

  describe('Contextual Browser Search (Phase 2 & 4)', () => {
    it('1. active YouTube + "Search for Python agents" routes to YouTube browser search', () => {
      browserStateStore.update(convId, {
        lastBrowserUrl: 'https://www.youtube.com',
        visibleTarget: 'YouTube',
        lastBrowserAction: 'navigate:YouTube',
      });

      const plan = semanticGoalParser.parseGoal('Search for Python agents', ctx);
      expect(plan.clarificationRequired).toBe(false);
      expect(plan.primaryExecutor).toBe('browser');
      expect(plan.steps.length).toBe(1);

      const step = plan.steps[0];
      expect(step.executorId).toBe('browser');
      expect(step.action).toBe('search');
      expect(step.parameters.target).toBe('YouTube');
      expect(step.parameters.query).toBe('Python agents');
      expect(plan.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('2. active Google + "Search for Python agents" routes to Google browser search', () => {
      browserStateStore.update(convId, {
        lastBrowserUrl: 'https://www.google.com',
        visibleTarget: 'Google',
        lastBrowserAction: 'navigate:Google',
      });

      const plan = semanticGoalParser.parseGoal('Search for Python agents', ctx);
      expect(plan.clarificationRequired).toBe(false);
      expect(plan.primaryExecutor).toBe('browser');

      const step = plan.steps[0];
      expect(step.executorId).toBe('browser');
      expect(step.action).toBe('search');
      expect(step.parameters.target).toBe('Google');
      expect(step.parameters.query).toBe('Python agents');
    });

    it('3. no active browser + "Search for Python agents" does NOT match browser candidate', () => {
      // browserStateStore is empty for convId
      const candidates = semanticGoalParser.scoreCandidates('Search for Python agents', ctx);
      const browserCand = candidates.find((c) => c.executorId === 'browser');
      expect(browserCand?.matched).toBe(false);
      expect(browserCand?.confidence).toBe(0.0);
    });

    it('4. active YouTube + explicit "Search Google for Python agents" overrides active YouTube with Google', () => {
      browserStateStore.update(convId, {
        lastBrowserUrl: 'https://www.youtube.com',
        visibleTarget: 'YouTube',
      });

      const plan = semanticGoalParser.parseGoal('Search Google for Python agents', ctx);
      expect(plan.primaryExecutor).toBe('browser');
      expect(plan.steps[0]?.parameters.target).toBe('Google');
      expect(plan.steps[0]?.parameters.query).toBe('Python agents');
      expect(plan.steps[0]?.action).toBe('search');
    });

    it('5. "Search YouTube for AI agents" retains search action, not downgraded to navigate', () => {
      const plan = semanticGoalParser.parseGoal('Search YouTube for AI agents', ctx);
      expect(plan.clarificationRequired).toBe(false);
      expect(plan.primaryExecutor).toBe('browser');

      const step = plan.steps[0];
      expect(step.executorId).toBe('browser');
      expect(step.action).toBe('search');
      expect(step.parameters.target).toBe('YouTube');
      expect(step.parameters.query).toBe('AI agents');
    });
  });

  describe('Filesystem and Internal Routing (Phase 6 & 7)', () => {
    it('9. "Open the AgenticOS folder" routes to desktop executor with open_folder', () => {
      const plan = semanticGoalParser.parseGoal('Open the AgenticOS folder', ctx);
      expect(plan.clarificationRequired).toBe(false);
      expect(plan.primaryExecutor).toBe('desktop');

      const step = plan.steps[0];
      expect(step.executorId).toBe('desktop');
      expect(step.action).toBe('open_folder');
      expect(step.parameters.targetType).toBe('filesystem');
      expect(step.parameters.path).toBe(getWorkspaceRoot());
      expect(plan.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('10. "Open D:\\AgenticOS" routes to desktop executor with open_folder and explicit path', () => {
      const plan = semanticGoalParser.parseGoal('Open D:\\AgenticOS', ctx);
      expect(plan.clarificationRequired).toBe(false);
      expect(plan.primaryExecutor).toBe('desktop');

      const step = plan.steps[0];
      expect(step.executorId).toBe('desktop');
      expect(step.action).toBe('open_folder');
      expect(step.parameters.path).toBe('D:\\AgenticOS');
    });

    it('11. "Open Free Cash" routes to internal AgenticOS UI navigation, not filesystem or browser', () => {
      const plan = semanticGoalParser.parseGoal('Open Free Cash', ctx);
      expect(plan.primaryExecutor).toBe('internal_agenticos');

      const step = plan.steps[0];
      expect(step.executorId).toBe('internal_agenticos');
      expect(step.action).toBe('navigate_ui');
      expect(step.parameters.entityName).toMatch(/free\s*cash/i);
    });

    it('12. "Open Revenue Operator" routes to internal AgenticOS UI navigation, not filesystem or browser', () => {
      const plan = semanticGoalParser.parseGoal('Open Revenue Operator', ctx);
      expect(plan.primaryExecutor).toBe('internal_agenticos');

      const step = plan.steps[0];
      expect(step.executorId).toBe('internal_agenticos');
      expect(step.action).toBe('navigate_ui');
      expect(step.parameters.entityName).toMatch(/revenue\s*operator/i);
    });

    it('13. Bare "AgenticOS" does NOT route to open_folder without explicit open/folder signal', () => {
      const candidates = semanticGoalParser.scoreCandidates('AgenticOS', ctx);
      const desktopCand = candidates.find((c) => c.executorId === 'desktop');
      expect(desktopCand?.matched).toBe(false);
      expect(desktopCand?.plan?.steps.some((s) => s.action === 'open_folder')).toBeFalsy();
    });
  });

  describe('Result Reference / Follow-Up (Phase 5)', () => {
    it('8. "Open the first result" is recognized by resolveConversationalCorrection', async () => {
      const { resolveConversationalCorrection } = await import('../services/browser/browserActionContract.js');
      const state = browserStateStore.get(convId);
      state.lastBrowserUrl = 'https://www.youtube.com/results?search_query=Moritz+Jarvis';
      state.visibleTarget = 'YouTube';

      const res = resolveConversationalCorrection('Open the first result', state);
      expect(res.kind).toBe('open_first_result');
    });

    it('Recognizes "Click the first video" as open_first_result', async () => {
      const { resolveConversationalCorrection } = await import('../services/browser/browserActionContract.js');
      const state = browserStateStore.get(convId);
      state.lastBrowserUrl = 'https://www.youtube.com/results?search_query=Moritz+Jarvis';

      const resFirst = resolveConversationalCorrection('Click the first video', state);
      expect(resFirst.kind).toBe('open_first_result');
    });
  });
});
