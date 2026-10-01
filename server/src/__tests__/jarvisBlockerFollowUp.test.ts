/**
 * jarvisBlockerFollowUp.test.ts
 *
 * Verifies structured blocker conversational context, follow-up queries,
 * truthful specification handling, and deterministic blocker resolution.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { routeTurn } from '../domains/jarvisNext/turnRouter.js';
import { backgroundTaskManager } from '../services/backgroundTasks/manager.js';
import { projectsStore } from '../services/projectsStore.js';

describe('JARVIS Blocker Context & Follow-Up Queries', () => {
  const conversationId = 'conv-test-blocker-' + Date.now();
  const projectId = 'proj-free-cash';

  beforeAll(async () => {
    projectsStore.ensureRevenueProjects();
    projectsStore.setActiveProjectId(projectId);
    const existing = backgroundTaskManager.listTasks({ projectId });
    const hasBlockedCredentialTask = existing.some(
      (t) => t.status === 'blocked' && t.title.includes('External Account Credential Setup')
    );

    if (!hasBlockedCredentialTask) {
      const created = backgroundTaskManager.createTask({
        title: 'Free Cash: External Account Credential Setup',
        objective: 'Configure external FreeCash API credentials and account connectivity for live earnings tracking',
        originalRequest: 'Start Free Cash',
        route: 'setup_required',
        selectedAgent: 'jarvis',
        worker: 'automation',
        projectId,
        conversationId,
      });
      if (created.task) {
        backgroundTaskManager.blockTask(created.task.taskId, 'Missing external FreeCash API keys / credentials');
      }
    }

    // Establish conversation focus on Free Cash
    await routeTurn({
      prompt: 'Open Free Cash.',
      conversationId,
      navigationVerifier: async () => ({ verified: true, actualRoute: '/projects?project=proj-free-cash' }),
    });
  });

  it('Turn 1: What is blocked? identifies real blocker and stores context', async () => {
    const res = await routeTurn({
      prompt: 'What is blocked?',
      conversationId,
    });
    expect(res.handled).toBe(true);
    expect(res.route).toBe('fast_read');
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.text).toMatch(/blocked/i);
    expect(res.text).toMatch(/Missing external FreeCash API keys \/ credentials/i);
  });

  it('Turn 2: Which one is missing the API keys? identifies exact task', async () => {
    const res = await routeTurn({
      prompt: 'Which one is missing the API keys?',
      conversationId,
    });
    expect(res.handled).toBe(true);
    expect(res.route).toBe('blocker_detail_read');
    expect(res.text).toContain('Free Cash: External Account Credential Setup');
    expect(res.text).toMatch(/Missing external FreeCash API keys \/ credentials/i);
  });

  it('Turn 3: Which API keys exactly? truthfully states provider is unspecified', async () => {
    const res = await routeTurn({
      prompt: 'Which API keys exactly?',
      conversationId,
    });
    expect(res.handled).toBe(true);
    expect(res.route).toBe('blocker_detail_read');
    expect(res.text).toMatch(/does not currently specify which provider or API/i);
  });

  it('Turn 4: Why does it need them? answers from task objective', async () => {
    const res = await routeTurn({
      prompt: 'Why does it need them?',
      conversationId,
    });
    expect(res.handled).toBe(true);
    expect(res.route).toBe('blocker_detail_read');
    expect(res.text).toMatch(/Configure external FreeCash API credentials and account connectivity/i);
  });

  it('Turn 5: Can you resolve it? reuses active blocker and states credential requirement', async () => {
    const res = await routeTurn({
      prompt: 'Can you resolve it?',
      conversationId,
    });
    expect(res.handled).toBe(true);
    expect(res.route).toBe('action');
    expect(res.text).toMatch(/requires external FreeCash API keys or account credentials/i);
  });

  it('Natural language references resolve to the active blocker', async () => {
    const res1 = await routeTurn({
      prompt: 'Why is that blocker there?',
      conversationId,
    });
    expect(res1.route).toBe('blocker_detail_read');
    expect(res1.text).toMatch(/Missing external FreeCash API keys \/ credentials/i);

    const res2 = await routeTurn({
      prompt: 'Who needs the credentials?',
      conversationId,
    });
    expect(res2.route).toBe('blocker_detail_read');
    expect(res2.text).toMatch(/Free Cash: External Account Credential Setup/i);
  });

  it('Turn invariant: responses are never empty or silent', async () => {
    const res = await routeTurn({
      prompt: 'What exactly is missing?',
      conversationId,
    });
    expect(res.handled).toBe(true);
    expect(res.text.trim().length).toBeGreaterThan(10);
    expect(res.text).not.toContain('No matching task exists.');
  });
});
