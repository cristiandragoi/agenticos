/**
 * systemSelfDiagnose.test.ts — the FreeCash context-hijack class.
 *
 * Live defect reproduced on the installed runtime (build d14253df-dirty):
 * with Free Cash as the active project, the utterance
 *   "Run a status check to see where you can heal yourself and where the problem is."
 * was answered with
 *   "What would you like me to do with Free Cash?"
 * because the clarification gate in universalExecutionController substituted
 * `ctx.activeProjectName` for an utterance that named no entity at all.
 *
 * These tests drive the REAL entry point (`handleUserTurn`) with stale project
 * context and assert the invariants:
 *   1. an explicit system command is detected and routed to system_self_diagnose
 *   2. a project-named or project-continuation utterance still behaves as before
 *   3. an entity-free utterance never becomes a question about the active project
 *   4. the spoken answer carries no project statistics
 */

import { describe, expect, it } from 'vitest';
import {
  detectExplicitSystemCommand,
  formatSystemDiagnosisSpeech,
  runSystemSelfDiagnosis,
  type DiagnosticCheck,
  type SystemDiagnosisReport,
} from '../domains/jarvis/systemDiagnostics.js';
import { universalExecutionController } from '../domains/jarvis/execution/universalExecutionController.js';

const TARGET = 'Run a status check to see where you can heal yourself and where the problem is.';

/** The live conversation state at the moment of the failure. */
function staleFreeCashContext() {
  return {
    activeEntityId: 'proj-free-cash',
    activeEntityName: 'Free Cash',
    activeEntityType: 'project',
    activeProjectId: 'proj-free-cash',
    activeProjectName: 'Free Cash',
    lastRequestedAction: 'OPERATE_PROJECT',
    lastUserTurn: 'Start working on FreeCash',
    lastAssistantTurn: 'Started work on Free Cash.',
    lastResolvedEntityId: 'proj-free-cash',
    lastResolvedEntityName: 'Free Cash',
    lastResolvedEntityType: 'project',
    lastResolvedAction: 'operate_project',
  };
}

async function turn(prompt: string, conversationId: string) {
  return universalExecutionController.handleUserTurn({
    prompt,
    conversationId,
    turnId: `${conversationId}-1`,
    workspacePath: process.cwd(),
    activeProjectId: 'proj-free-cash',
    activeProjectName: 'Free Cash',
    sttConfidence: 1.0,
    rawStt: prompt,
    isBargeIn: false,
    context: staleFreeCashContext(),
  });
}

// ── Intent detection ────────────────────────────────────────────────────────

describe('detectExplicitSystemCommand — explicit system commands', () => {
  const shouldMatch = [
    TARGET,
    'run a status check',
    'check yourself',
    'diagnose yourself',
    "find what's wrong",
    'see where you can heal yourself',
    'check what capabilities are broken',
    "inspect why you're not working correctly",
    // §5 of the defect report — the voice example that must never become FreeCash
    'Check why your voice keeps cutting me off.',
    'check your capabilities',
    'do a self diagnostic',
  ];

  for (const utterance of shouldMatch) {
    it(`matches: "${utterance}"`, () => {
      const cmd = detectExplicitSystemCommand(utterance);
      expect(cmd, `not recognised as a system command: ${utterance}`).not.toBeNull();
      expect(cmd!.intent).toBe('system_self_diagnose');
      expect(cmd!.confidence).toBeGreaterThanOrEqual(0.9);
    });
  }

  const shouldNotMatch = [
    // A question that names a project IS a project question.
    'What is the status of Free Cash?',
    'Start working on Free Cash',
    'What would you like me to do with Free Cash?',
    'open the Free Cash project',
    'continue that',
    'what are you doing on Shopify',
    // A diagnostic verb about someone else's file/project, not the runtime.
    'check the Free Cash login flow',
  ];

  for (const utterance of shouldNotMatch) {
    it(`does not match: "${utterance}"`, () => {
      expect(detectExplicitSystemCommand(utterance)).toBeNull();
    });
  }
});

// ── The reproduction ────────────────────────────────────────────────────────

describe('FreeCash context hijack — explicit command outranks active project', () => {
  it('routes the status-check sentence to system_self_diagnose, not to Free Cash', async () => {
    const r = await turn(TARGET, 'test-fc-hijack-1');

    expect(r.route).toBe('system_self_diagnose');
    expect(r.goalId).toBe('system_self_diagnose');
    // The exact live failure string must be gone.
    expect(r.spokenText).not.toMatch(/what would you like me to do with free ?cash/i);
    expect(r.spokenText).not.toMatch(/free ?cash/i);
    expect(r.verification.verified).toBe(true);
    expect(r.execution.success).toBe(true);
  });

  it('never leaves Free Cash as the pending clarification for a system command', async () => {
    const r = await turn(TARGET, 'test-fc-hijack-2');
    expect(r.clearPendingClarification).toBe(true);
    // Whatever pending exists must not be a question about the project.
    if (r.pendingClarification) {
      expect(String(r.pendingClarification.targetName || '')).not.toMatch(/free ?cash/i);
    }
  });

  it('routes the voice complaint to the runtime, not to Free Cash (§5)', async () => {
    const r = await turn('Check why your voice keeps cutting me off.', 'test-fc-hijack-3');
    expect(r.route).toBe('system_self_diagnose');
    expect(r.spokenText).not.toMatch(/what would you like me to do with free ?cash/i);
  });
});

// ── The class fix ───────────────────────────────────────────────────────────

describe('entity-free utterances never become an active-project question', () => {
  it('an unroutable entity-free sentence does not produce "What would you like me to do with Free Cash?"', async () => {
    const r = await turn('Zorblex quentris marnify.', 'test-fc-hijack-4');
    expect(r.spokenText).not.toMatch(/what would you like me to do with free ?cash/i);
  });

  it('a back-reference still resolves against context (context must keep working)', async () => {
    // "it" IS a genuine reference, so context resolution must still apply.
    const r = await turn('check its status', 'test-fc-hijack-5');
    expect(r.spokenText).not.toMatch(/what would you like me to do with free ?cash/i);
    expect(r.route).not.toBe('system_self_diagnose');
  });
});

// ── The diagnostic report itself ────────────────────────────────────────────

describe('runSystemSelfDiagnosis — real runtime inspection', () => {
  it('reports on every required runtime surface', async () => {
    const report = await runSystemSelfDiagnosis();
    const ids = report.checks.map((c) => c.id);
    for (const required of [
      'backend',
      'hermes_gateway',
      'supervisor',
      'incidents',
      'failed_capabilities',
      'voice_stt',
      'browser',
      'desktop',
      'runtime_state',
      'execution_failures',
    ]) {
      expect(ids, `missing diagnostic check: ${required}`).toContain(required);
    }
    expect(['healthy', 'degraded', 'faulty']).toContain(report.overall);
    // Every check carries an observed detail string.
    for (const c of report.checks) expect(c.detail.length).toBeGreaterThan(0);
  });
});

describe('formatSystemDiagnosisSpeech — facts, never project statistics', () => {
  const report: SystemDiagnosisReport = {
    generatedAt: new Date().toISOString(),
    buildId: 'test-build',
    pid: 1234,
    overall: 'healthy',
    defects: [],
    checks: [
      { id: 'backend', label: 'AgenticOS backend', status: 'ok', detail: 'backend running' },
      { id: 'hermes_gateway', label: 'Hermes gateway / model providers', status: 'ok', detail: 'ollama reachable' },
    ],
  };

  it('acknowledges the actual task and names the checked surfaces', () => {
    const speech = formatSystemDiagnosisSpeech(report);
    expect(speech).toMatch(/checked my own runtime/i);
    expect(speech).toMatch(/voice/i);
    expect(speech).toMatch(/supervisor/i);
    expect(speech).toMatch(/gateway/i);
    expect(speech).toMatch(/incidents/i);
  });

  it('does not report project statistics', () => {
    const speech = formatSystemDiagnosisSpeech(report);
    expect(speech).not.toMatch(/free ?cash/i);
    expect(speech).not.toMatch(/\b\d+\s+projects?\b/i);
    expect(speech).not.toMatch(/blocked tasks/i);
  });

  it('states the real defect and the real incident handoff', () => {
    const failedCheck: DiagnosticCheck = {
      id: 'hermes_gateway',
      label: 'Hermes gateway / model providers',
      status: 'failed',
      detail: 'no provider reachable',
      repairable: true,
    };
    const faulty: SystemDiagnosisReport = {
      ...report,
      overall: 'faulty',
      checks: [report.checks[0], failedCheck],
      defects: [failedCheck],
    };
    const speech = formatSystemDiagnosisSpeech(faulty, { incidentIds: ['SELFHEAL-007'] });
    expect(speech).toMatch(/Failed — Hermes gateway/);
    expect(speech).toMatch(/opened 1 Self-Heal incident/);
  });

  it('speaks a defect even when it is only present in the defects list', () => {
    const failedCheck: DiagnosticCheck = {
      id: 'hermes_gateway',
      label: 'Hermes gateway / model providers',
      status: 'failed',
      detail: 'no provider reachable',
      repairable: true,
    };
    const speech = formatSystemDiagnosisSpeech(
      { ...report, overall: 'faulty', defects: [failedCheck] },
      { incidentIds: ['SELFHEAL-008'] },
    );
    expect(speech).toMatch(/no provider reachable/);
  });

  it('redacts a project name that leaked in through a raw record', () => {
    const leaky: SystemDiagnosisReport = {
      ...report,
      overall: 'degraded',
      checks: [
        report.checks[0],
        {
          id: 'incidents',
          label: 'Active incidents',
          status: 'degraded',
          detail: 'Free Cash is now the active context, but the interface did not navigate successfully.',
        },
      ],
      defects: [],
    };
    const speech = formatSystemDiagnosisSpeech(leaky);
    expect(speech).not.toMatch(/free ?cash/i);
    expect(speech).toMatch(/a project/i);
  });

  it('stays short enough to speak, even with many degraded checks', () => {
    const many: SystemDiagnosisReport = {
      ...report,
      overall: 'degraded',
      checks: Array.from({ length: 10 }, (_, i) => ({
        id: `check_${i}`,
        label: `Surface ${i}`,
        status: i === 0 ? 'failed' : 'degraded',
        detail: 'x'.repeat(400),
      })),
      defects: [],
    };
    const speech = formatSystemDiagnosisSpeech(many, { incidentIds: ['SELFHEAL-009'] });
    expect(speech.length).toBeLessThan(1200);
  });

  it('never claims a repair it did not start', () => {
    const failedCheck: DiagnosticCheck = {
      id: 'hermes_gateway',
      label: 'Hermes gateway / model providers',
      status: 'failed',
      detail: 'no provider reachable',
      repairable: true,
    };
    const faulty: SystemDiagnosisReport = {
      ...report,
      overall: 'faulty',
      checks: [report.checks[0], failedCheck],
      defects: [failedCheck],
    };
    const speech = formatSystemDiagnosisSpeech(faulty, { incidentIds: [] });
    expect(speech).toMatch(/could not be handed to Self-Heal/i);
    expect(speech).not.toMatch(/I have opened/i);
  });
});
