/**
 * jarvisRealUiTransaction.test.ts
 *
 * Real UI + JARVIS integration tests covering the 3 primary defects:
 *   DEFECT 1: Acknowledged navigation transaction protocol (NAVIGATE_REQUEST -> UI ROUTER -> NAVIGATE_ACK).
 *             Truthful spoken claims: no "open" claim without verified UI ACK.
 *   DEFECT 2: Code inspection queries (e.g. "Where in the code is Revenue Operator implemented?")
 *             classified as read-only repository inspection (riskLevel: low, isReadOnly: true)
 *             rather than Unknown Action / critical.
 *   DEFECT 3: "Start Free Cash project" semantics & compound name resolution:
 *             resolves to proj-free-cash, not the child revenue opportunity, and speaks
 *             "Free Cash is already active. I've opened it." only after verified UI ACK.
 *   DEFECT 4: Corrective turns ("No, it's not open.", "I said open it.")
 *             inherit navigation intent and retry instead of returning "No matching task exists."
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { routeTurn } from '../domains/jarvisNext/turnRouter.js';
import { resolveEntity } from '../domains/jarvis/entityResolver.js';
import { normalizeApprovalAction } from '../services/backgroundTasks/approvalNormalization.js';
import { isReadOnlyCodexTask } from '../domains/codex/service.js';
import { projectsStore } from '../services/projectsStore.js';

describe('Real UI Navigation Transaction & Defect Remediation', () => {
  beforeEach(() => {
    projectsStore.ensureRevenueProjects();
  });

  // ── TEST 1: Open Free Cash with Verified UI ACK ───────────────────────────
  it('Test 1: Open Free Cash -> Backend NAVIGATE_REQUEST -> Frontend ACK -> Spoken "Free Cash is open."', async () => {
    let capturedReq: any = null;
    const conversationId = `conv-test-open-freecash-${Date.now()}`;

    const res = await routeTurn({
      prompt: 'Open Free Cash.',
      conversationId,
      navigationVerifier: async (req) => {
        capturedReq = req;
        return {
          verified: true,
          actualRoute: req.route,
          visibleEntityId: req.entityId,
        };
      },
    });

    expect(capturedReq).not.toBeNull();
    expect(capturedReq.entityId).toBe('proj-free-cash');
    expect(capturedReq.entityType).toBe('project');
    expect(capturedReq.route).toContain('/projects?project=proj-free-cash');
    expect(capturedReq.navigationId).toMatch(/^nav-/);

    expect(res.route).toBe('navigate');
    expect(res.executed).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.text).toBe('Free Cash is open.');
  });

  // ── TEST 2: Open Revenue Operator with Verified UI ACK ────────────────────
  it('Test 2: Open Revenue Operator -> Route /revenue-operator -> Verified ACK -> Spoken "Revenue Operator is open."', async () => {
    let capturedReq: any = null;
    const conversationId = `conv-test-open-ro-${Date.now()}`;

    const res = await routeTurn({
      prompt: 'Open Revenue Operator.',
      conversationId,
      navigationVerifier: async (req) => {
        capturedReq = req;
        return {
          verified: true,
          actualRoute: '/revenue-operator',
          visibleEntityId: 'revenue_operator',
        };
      },
    });

    expect(capturedReq).not.toBeNull();
    expect(capturedReq.route).toBe('/revenue-operator');
    expect(res.route).toBe('navigate');
    expect(res.verified).toBe(true);
    expect(res.text).toBe('Revenue Operator is open.');
  });

  // ── TEST 3: Open Shopify with Verified UI ACK ─────────────────────────────
  it('Test 3: Open Shopify -> Route /projects?project=proj-shopify -> Verified ACK -> Spoken "Shopify is open."', async () => {
    let capturedReq: any = null;
    const conversationId = `conv-test-open-shopify-${Date.now()}`;

    const res = await routeTurn({
      prompt: 'Open Shopify.',
      conversationId,
      navigationVerifier: async (req) => {
        capturedReq = req;
        return {
          verified: true,
          actualRoute: req.route,
          visibleEntityId: req.entityId,
        };
      },
    });

    expect(capturedReq).not.toBeNull();
    expect(capturedReq.entityId).toBe('proj-shopify');
    expect(capturedReq.route).toContain('/projects?project=proj-shopify');
    expect(res.verified).toBe(true);
    expect(res.text).toBe('Shopify is open.');
  });

  // ── TEST 4: Navigation Failure Truthfulness (Never Claim Success When Unverified) ─
  it('Test 4: Open Free Cash with simulated navigation failure -> Truthfully reports interface did not navigate', async () => {
    const conversationId = `conv-test-nav-fail-${Date.now()}`;

    const res = await routeTurn({
      prompt: 'Open Free Cash.',
      conversationId,
      navigationVerifier: async (req) => {
        // Simulate client not responding or router error
        return {
          verified: false,
          error: 'Navigation ACK timed out or client router failed',
        };
      },
    });

    expect(res.route).toBe('navigate');
    expect(res.verified).toBe(false);
    // Crucial rule: JARVIS MUST NOT claim "Free Cash is open."
    expect(res.text).not.toContain('Free Cash is open.');
    expect(res.text).toBe('Free Cash is now the active context, but the interface did not navigate successfully.');
  });

  // ── TEST 5: Navigation Correction Turn (No "No matching task exists") ──────
  it('Test 5: Navigation correction ("No, it\'s not open.") retries navigation and never returns "No matching task exists."', async () => {
    const conversationId = `conv-test-correction-${Date.now()}`;

    // Turn 1: Initial failed navigation
    await routeTurn({
      prompt: 'Open Free Cash.',
      conversationId,
      navigationVerifier: async () => ({ verified: false, error: 'simulated failure' }),
    });

    // Turn 2: User corrects "No, it's not open."
    let retryCaptured: any = null;
    const resCorrection = await routeTurn({
      prompt: "No, it's not open.",
      conversationId,
      navigationVerifier: async (req) => {
        retryCaptured = req;
        return {
          verified: true,
          actualRoute: req.route,
          visibleEntityId: req.entityId,
        };
      },
    });

    expect(retryCaptured).not.toBeNull();
    expect(retryCaptured.entityId).toBe('proj-free-cash');
    expect(resCorrection.route).toBe('navigate');
    expect(resCorrection.verified).toBe(true);
    expect(resCorrection.text).toBe('Free Cash is open.');
    expect(resCorrection.text).not.toContain('No matching task exists');
  });

  // ── TEST 6: "Start Free Cash project" Semantics ───────────────────────────
  it('Test 6: "Start Free Cash" project semantics: executes PROJECT_OPERATE intent, NOT navigate', async () => {
    const conversationId = `conv-test-start-freecash-${Date.now()}`;

    const res = await routeTurn({
      prompt: 'Start the Free Cash project.',
      conversationId,
    });

    expect(res.route).toBe('project_operate');
    expect(res.entityId).toBe('proj-free-cash');
    expect(res.executed).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.text).not.toContain('already active');
    expect(res.text).not.toContain("I've opened it");
    expect(res.text).toMatch(/\b(?:Started|running|queued|blocked)\b/);
  });

  // ── TEST 7: Compound Name "FreeCash" Resolves to Project, NOT Opportunity ──
  it('Test 7: "Find the FreeCash project and start it." resolves to proj-free-cash, NOT revenue opportunity', async () => {
    const ref = await resolveEntity('Find the FreeCash project and start it.');
    expect(ref).not.toBeNull();
    expect(ref?.id).toBe('proj-free-cash');
    expect(ref?.type).toBe('project');
    expect(ref?.displayName).toBe('Free Cash');
  });

  // ── TEST 8: Code Read Delegation Classification (Defect 2) ────────────────
  it('Test 8: "Where in the code is Revenue Operator implemented?" is recognized as read-only and low risk', () => {
    const query = 'Where in the code is Revenue Operator implemented?';

    // 1. Check codex service classification
    const isReadOnly = isReadOnlyCodexTask(query);
    expect(isReadOnly).toBe(true);

    // 2. Check approval normalization
    const norm = normalizeApprovalAction({
      action: query,
      workspaceRoot: 'D:\\AgenticOS',
    });

    expect(norm.canonicalAction).toBe('filesystem.read');
    expect(norm.label).toBe('Inspect Repository Code');
    expect(norm.riskLevel).toBe('low');
    expect(norm.isReadOnly).toBe(true);
    expect(norm.canonicalAction).not.toBe('unknown');
    expect(norm.riskLevel).not.toBe('critical');
  });

  // ── TEST 9: Rapid Target Switch ───────────────────────────────────────────
  it('Test 9: "Open Free Cash." then "No, open Revenue Operator instead." switches cleanly', async () => {
    const conversationId = `conv-test-switch-${Date.now()}`;
    const navHistory: string[] = [];

    const turn1 = await routeTurn({
      prompt: 'Open Free Cash.',
      conversationId,
      navigationVerifier: async (req) => {
        navHistory.push(req.route);
        return { verified: true, actualRoute: req.route, visibleEntityId: req.entityId };
      },
    });

    expect(turn1.route).toBe('navigate');
    expect(turn1.entityId).toBe('proj-free-cash');

    const turn2 = await routeTurn({
      prompt: 'No, open Revenue Operator instead.',
      conversationId,
      navigationVerifier: async (req) => {
        navHistory.push(req.route);
        return { verified: true, actualRoute: req.route, visibleEntityId: req.entityId };
      },
    });

    expect(turn2.route).toBe('navigate');
    expect(turn2.entityId).toBe('revenue_operator');
    expect(turn2.text).toBe('Revenue Operator is open.');
    expect(navHistory).toEqual([
      '/projects?project=proj-free-cash',
      '/revenue-operator',
    ]);
  });

  // ── TEST 10: "I would like to see the Free Cash project." ───────────────────
  it('Test 10: "I would like to see the Free Cash project." navigates and verifies UI', async () => {
    const conversationId = `conv-test-see-freecash-${Date.now()}`;
    let navSent = false;
    let navRoute = '';

    const turn = await routeTurn({
      prompt: 'I would like to see the Free Cash project.',
      conversationId,
      navigationVerifier: async (req) => {
        navSent = true;
        navRoute = req.route;
        return { verified: true, actualRoute: req.route, visibleEntityId: req.entityId };
      },
    });

    expect(navSent).toBe(true);
    expect(navRoute).toBe('/projects?project=proj-free-cash');
    expect(turn.route).toBe('navigate');
    expect(turn.entityId).toBe('proj-free-cash');
    expect(turn.entityType).toBe('project');
    expect(turn.text).toBe('Free Cash is open.');
    expect(turn.text).not.toContain('unable to display that workspace path');
  });

  // ── TEST 11: "Open the Free Cash project so I can see it." ──────────────────
  it('Test 11: "Open the Free Cash project so I can see it." navigates and verifies UI', async () => {
    const conversationId = `conv-test-open-so-see-${Date.now()}`;
    let navSent = false;

    const turn = await routeTurn({
      prompt: 'Open the Free Cash project so I can see it.',
      conversationId,
      navigationVerifier: async (req) => {
        navSent = true;
        return { verified: true, actualRoute: req.route, visibleEntityId: req.entityId };
      },
    });

    expect(navSent).toBe(true);
    expect(turn.route).toBe('navigate');
    expect(turn.entityId).toBe('proj-free-cash');
    expect(turn.entityType).toBe('project');
    expect(turn.text).toBe('Free Cash is open.');
  });

  // ── TEST 12: Full Operational Sequence: Open -> Start Operating Inside It ───
  it('Test 12: Full Sequence: Open Free Cash -> Start operating inside it -> What are you working on? -> What is blocked? -> Continue working -> Stop working', async () => {
    const conversationId = `conv-test-full-seq-${Date.now()}`;

    // 1. Open Free Cash
    const t1 = await routeTurn({
      prompt: 'Open Free Cash.',
      conversationId,
      navigationVerifier: async (req) => ({ verified: true, actualRoute: req.route, visibleEntityId: req.entityId }),
    });
    expect(t1.route).toBe('navigate');
    expect(t1.entityId).toBe('proj-free-cash');
    expect(t1.text).toBe('Free Cash is open.');

    // 2. Start operating inside it
    const t2 = await routeTurn({
      prompt: 'Start operating inside it.',
      conversationId,
    });
    expect(t2.route).toBe('project_operate');
    expect(t2.entityId).toBe('proj-free-cash');
    expect(t2.executed).toBe(true);
    expect(t2.verified).toBe(true);
    expect(t2.text).not.toContain('Already active');
    expect(t2.text).not.toContain("I've opened it");
    expect(t2.text).toMatch(/Started/i);

    // 3. What are you working on?
    const t3 = await routeTurn({
      prompt: 'What are you working on?',
      conversationId,
    });
    expect(t3.route).toBe('fast_read');
    expect(t3.entityId).toBe('proj-free-cash');
    expect(t3.text).toMatch(/\b(?:running|blocked)\b/i);

    // 4. What is blocked?
    const t4 = await routeTurn({
      prompt: 'What is blocked?',
      conversationId,
    });
    expect(t4.route).toBe('fast_read');
    expect(t4.entityId).toBe('proj-free-cash');
    expect(t4.text).toMatch(/\bblocked\b/i);

    // 5. Continue working
    const t5 = await routeTurn({
      prompt: 'Continue working.',
      conversationId,
    });
    expect(t5.route).toBe('project_operate');
    expect(t5.entityId).toBe('proj-free-cash');

    // 6. Stop working on Free Cash
    const t6 = await routeTurn({
      prompt: 'Stop working on Free Cash.',
      conversationId,
    });
    expect(t6.route).toBe('project_operate');
    expect(t6.entityId).toBe('proj-free-cash');
    expect(t6.text).toMatch(/Stopped/i);
  });
});
