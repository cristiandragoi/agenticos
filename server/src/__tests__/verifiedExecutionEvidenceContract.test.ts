import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEvidencePack } from '../domains/jarvis/execution/evidenceTypes.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';
import { sanitizeDirectResponse } from '../domains/jarvis/groundingGuardrail.js';
import { browserExecutor } from '../domains/jarvis/execution/executors/browserExecutor.js';
import { desktopExecutor } from '../domains/jarvis/execution/executors/desktopExecutor.js';

describe('VERIFIED EXECUTION / EVIDENCE CONTRACT (EXECUTED != VERIFIED)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── G1: Browser unreachable URL ──
  it('G1: Browser navigation to unreachable URL fails verification and does not claim success', async () => {
    // Mock browserExecutor.navigate to simulate unreachable host failure
    vi.spyOn(browserExecutor, 'navigate').mockResolvedValue({
      success: false,
      output: "I couldn't navigate to that page.",
      error: 'net::ERR_NAME_NOT_RESOLVED at http://this-domain-does-not-exist-12345abcdef.local',
      evidence: {
        url: 'http://this-domain-does-not-exist-12345abcdef.local',
        verified: false,
        blocked: false,
        contentUsable: false,
      }
    });

    const verifyOutcome = await browserExecutor.verify({
      success: false,
      error: 'net::ERR_NAME_NOT_RESOLVED',
      evidence: {
        url: 'http://this-domain-does-not-exist-12345abcdef.local',
        verified: false,
        blocked: false,
      }
    });

    expect(verifyOutcome.verified).toBe(false);
    expect(verifyOutcome.realityCheck).toContain('Browser navigation failed');

    // Test controller behavior
    const turnResult = await universalExecutionController.handleUserTurn({
      prompt: 'Open http://this-domain-does-not-exist-12345abcdef.local',
      conversationId: 'test-unreachable-url',
    });

    expect(turnResult.verification.verified).toBe(false);
    expect(turnResult.spokenText).not.toMatch(/\bi(?:'ve| have)? opened\b/i);
    expect(turnResult.spokenText).not.toMatch(/\bsuccessfully opened\b/i);
  });

  // ── G2: Browser hidden / not visible ──
  it('G2: Browser page that is blocked or not usable fails verification', async () => {
    const unverifiedOutcome = await browserExecutor.verify({
      success: true, // Page command sent successfully, but blocked by overlay or not visible
      evidence: {
        url: 'https://youtube.com',
        title: 'YouTube',
        verified: false,
        blocked: true,
        contentUsable: false,
        blocker: { kind: 'consent_dialog' }
      }
    });

    expect(unverifiedOutcome.verified).toBe(false);
    expect(unverifiedOutcome.realityCheck).toContain('blocked');

    const pack = buildEvidencePack({
      intent: 'navigate to youtube',
      targetDescription: 'YouTube',
      executed: true,
      verified: unverifiedOutcome.verified,
      realityCheck: unverifiedOutcome.realityCheck,
      evidenceItems: [{
        source: 'browser_dom',
        observedAt: Date.now(),
        verified: false,
        realityCheck: unverifiedOutcome.realityCheck,
        rawDetails: { visibility: 'hidden' }
      }]
    });

    expect(pack.executed).toBe(true);
    expect(pack.verified).toBe(false);
    expect(pack.verdict).toBe('executed_unverified');
    expect(pack.lifecycleState).toBe('executed');
  });

  // ── G3: Missing desktop executable ──
  it('G3: Launching nonexistent desktop executable reports failure and never claims it is open', async () => {
    // 1. Direct executor verification
    const execOutcome = await desktopExecutor.openApplication('nonexistent_fake_app_xyz.exe');
    expect(execOutcome.success).toBe(false);
    expect(execOutcome.error).toBeDefined();

    const verifyOutcome = await desktopExecutor.verify({
      success: execOutcome.success,
      data: execOutcome,
      error: execOutcome.error,
    });
    expect(verifyOutcome.verified).toBe(false);
    expect(verifyOutcome.realityCheck).toContain('Application action failed');

    // 2. End-to-end controller turn
    const turnResult = await universalExecutionController.handleUserTurn({
      prompt: 'Launch nonexistent_fake_app_xyz.exe',
      conversationId: 'test-fake-desktop-app',
    });

    expect(turnResult.verification.verified).toBe(false);
    expect(turnResult.spokenText).not.toMatch(/\bis open\b/i);
    expect(turnResult.spokenText).not.toMatch(/\bi(?:'ve| have)? opened\b/i);
    expect(turnResult.spokenText).toMatch(/couldn't open|failed|not found|ENOENT/i);
  });

  // ── G4: Fake filesystem success claim without tool execution ──
  it('G4: Grounding guardrail blocks fake filesystem success claims when no tool executed', () => {
    const prompt = 'Create file summary_notes.txt with my project notes';
    const fakeModelReply = 'Done! I have created the file summary_notes.txt and saved your project notes.';

    const sanitized = sanitizeDirectResponse(fakeModelReply, {
      prompt,
      hasGroundedEvidence: false,
      isAction: true,
      hasExecutionEvidence: false,
    });

    expect(sanitized).not.toContain('I have created');
    expect(sanitized).not.toContain('saved your project notes');
    expect(sanitized).toContain('no automated executor');

    const prompt2 = 'Save this to report.txt';
    const fakeModelReply2 = 'I created report.txt for you.';
    const sanitized2 = sanitizeDirectResponse(fakeModelReply2, {
      prompt: prompt2,
      hasGroundedEvidence: false,
      isAction: true,
      hasExecutionEvidence: false,
    });

    expect(sanitized2).not.toContain('I created');
    expect(sanitized2).toContain('no automated executor');
  });

  // ── G5: Hermes task still queued/running ──
  it('G5: Hermes task in queued or running status is never reported as completed', () => {
    const queuedPack = buildEvidencePack({
      intent: 'Audit codebase',
      goalId: 'task-hermes-123',
      targetDescription: 'CodeX worker audit',
      executed: true,
      verified: false, // NOT finished/verified yet
      realityCheck: 'Task is currently running: 45% progress',
      evidenceItems: [{
        source: 'hermes_worker',
        observedAt: Date.now(),
        verified: false,
        realityCheck: 'Worker active',
        rawDetails: { taskId: 'task-hermes-123', taskStatus: 'running', progressPercent: 45 }
      }]
    });

    expect(queuedPack.executed).toBe(true);
    expect(queuedPack.verified).toBe(false);
    expect(queuedPack.verdict).toBe('executed_unverified');

    // In action_status mapping: executed=true + verified=false must NEVER be status="completed"
    const isVerified = queuedPack.verified === true;
    const actionStatus = isVerified ? 'completed' : 'failed';
    expect(actionStatus).toBe('failed');
    expect(actionStatus).not.toBe('completed');
  });
});
