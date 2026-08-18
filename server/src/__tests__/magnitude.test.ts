import { describe, it, expect, beforeEach } from 'vitest';
import { magnitudeService } from '../domains/magnitude/service.js';
import { classifyAction, isExecutionPermitted } from '../services/actionClassifier.js';

/**
 * magnitude.test.ts — deterministic Magnitude reliability tests (A2/A4/A5/A8).
 * Browser execution itself is proven at runtime (M1–M5 probes against the
 * deployed app); these cover the deterministic contracts: URL validation,
 * run provenance, project-scoped listing, screenshot evidence ownership, and
 * the safety/approval classifier.
 */

// Each test gets an isolated run id prefix (the module-level service shares a
// DB configured via AGENT_TEAMS_DB_PATH at process start).
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe('M2 — URL validation (truthful failure)', () => {
  it('accepts http/https URLs', () => {
    expect(magnitudeService.extractAndValidateUrl('https://example.com').url).toBe('https://example.com/');
    expect(magnitudeService.extractAndValidateUrl('http://example.org/path?q=1').url).toBe('http://example.org/path?q=1');
  });
  it('rejects dangerous schemes truthfully', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'chrome://settings', 'about:blank']) {
      const r = magnitudeService.extractAndValidateUrl(bad);
      expect(r.error).toBeTruthy();
      expect(r.error).toMatch(/forbidden|invalid/i);
    }
  });
  it('rejects non-URL garbage truthfully', () => {
    const r = magnitudeService.extractAndValidateUrl('this is not a url at all');
    expect(r.error).toMatch(/invalid/i);
  });
  it('extracts a bare domain from natural-language browser requests (A7/M9)', () => {
    expect(magnitudeService.extractAndValidateUrl('inspect example.com and tell me the title').url).toBe('https://example.com/');
    expect(magnitudeService.extractAndValidateUrl('open github.com please').url).toBe('https://github.com/');
    expect(magnitudeService.extractAndValidateUrl('check news.bbc.co.uk for headlines').url).toBe('https://news.bbc.co.uk/');
  });
  it('does not treat arbitrary single words as domains', () => {
    const r = magnitudeService.extractAndValidateUrl('inspect the page');
    expect(r.error).toBeTruthy();
  });
  it('strips trailing natural-language punctuation', () => {
    expect(magnitudeService.extractAndValidateUrl('visit https://example.com, please.').url).toBe('https://example.com/');
  });
});

describe('A5 — run provenance and project isolation', () => {
  it('createRun records project provenance', () => {
    const run = magnitudeService.createRun('inspect https://example.com', 'inspect', 'conv-1', {
      projectId: 'proj-A', projectTaskId: 'task-A', scheduleExecutionId: 'sched-A',
    });
    expect(run.projectId).toBe('proj-A');
    expect(run.projectTaskId).toBe('task-A');
    expect(run.scheduleExecutionId).toBe('sched-A');
    const fetched = magnitudeService.getRun(run.id);
    expect(fetched?.projectId).toBe('proj-A');
  });

  it('getAllRuns(projectId) returns only that project’s runs (bidirectional isolation)', () => {
    const a = magnitudeService.createRun('inspect https://a.example', 'inspect', undefined, { projectId: 'proj-A' });
    const b = magnitudeService.createRun('inspect https://b.example', 'inspect', undefined, { projectId: 'proj-B' });
    const c = magnitudeService.createRun('inspect https://c.example', 'inspect');

    const onlyA = magnitudeService.getAllRuns(50, 'proj-A');
    expect(onlyA.some((r) => r.id === a.id)).toBe(true);
    expect(onlyA.some((r) => r.id === b.id)).toBe(false);
    expect(onlyA.some((r) => r.id === c.id)).toBe(false);

    const onlyB = magnitudeService.getAllRuns(50, 'proj-B');
    expect(onlyB.some((r) => r.id === b.id)).toBe(true);
    expect(onlyB.some((r) => r.id === a.id)).toBe(false);

    // Unscoped listing sees everything.
    const all = magnitudeService.getAllRuns(500);
    expect(all.some((r) => r.id === a.id)).toBe(true);
    expect(all.some((r) => r.id === b.id)).toBe(true);
  });

  it('screenshot evidence path is recorded on the run (M7 ownership)', async () => {
    // Deterministic: we cannot run a real browser here, but the result shape
    // must carry the screenshot fields and the run must persist them.
    const run = magnitudeService.createRun('inspect https://example.com', 'inspect', undefined, { projectId: 'proj-A' });
    const fakeResult = {
      url: 'https://example.com/', finalUrl: 'https://example.com/',
      title: 'Example Domain', text: 'This domain is for use in illustrative examples.',
      linksCount: 1, durationMs: 500,
      screenshotPath: '/data/magnitude-screenshots/proj-A/mag-run.png', screenshotBytes: 1234,
    };
    // Persist via the same column the runtime uses.
    magnitudeService['updateRunStatus'](run.id, 'completed', fakeResult as any);
    const fetched = magnitudeService.getRun(run.id);
    expect(fetched?.status).toBe('completed');
    expect(fetched?.result?.screenshotPath).toContain('proj-A');
    expect(fetched?.result?.screenshotBytes).toBe(1234);
  });
});

describe('A3 — safety / approval classifier', () => {
  it('read-only inspection is permitted without approval', () => {
    const c = classifyAction('inspect https://example.com and tell me the title', 'magnitude');
    expect(c.actionClass).toBe('READ_ONLY');
    expect(c.requiresApproval).toBe(false);
    expect(c.blocked).toBe(false);
  });
  it('consequential actions require approval and are blocked without it', () => {
    const c = classifyAction('submit the checkout form and pay $50', 'magnitude');
    expect(c.actionClass).toBe('CONSEQUENTIAL');
    expect(c.requiresApproval).toBe(true);
    expect(c.blocked).toBe(true);
  });
  it('consequential actions pass when explicitly approved', () => {
    const c = classifyAction('submit the checkout form and pay $50', 'magnitude', true);
    expect(c.blocked).toBe(false);
  });
  it('prohibited actions are always blocked', () => {
    const c = classifyAction('hack into the payment portal', 'magnitude');
    expect(c.actionClass).toBe('PROHIBITED');
    expect(c.blocked).toBe(true);
  });
  it('isExecutionPermitted gate matches', () => {
    expect(isExecutionPermitted('inspect a page', 'magnitude').permitted).toBe(true);
    expect(isExecutionPermitted('send a message', 'magnitude').permitted).toBe(false);
  });
  it('magnitude default is READ_ONLY', () => {
    const c = classifyAction('open the website', 'magnitude');
    expect(c.actionClass).toBe('READ_ONLY');
  });
});
