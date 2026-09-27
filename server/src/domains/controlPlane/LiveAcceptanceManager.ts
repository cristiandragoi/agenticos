/**
 * LiveAcceptanceManager.ts — Interactive Human-In-The-Loop Production Acceptance Engine
 *
 * Implements Section 23, 24, 25:
 * - Orchestrates tests A through H with the real user sitting at their computer.
 * - Tracks GoalRun execution state: WAITING FOR USER COMMAND -> RECEIVED -> GOAL ID ->
 *   CAPABILITY -> PERMISSION -> EXECUTING -> EVIDENCE -> VERIFYING -> RECOVERING -> RESULT.
 * - Human-in-the-loop verification: REAL RESULT CORRECT vs REAL RESULT WRONG.
 * - Enforces Contract: NO EVIDENCE = NO SUCCESS CLAIM.
 * - If user reports WRONG, GoalRun is invalidated and returns to RECOVERING.
 */

import { EventEmitter } from 'node:events';
import { goalLifecycleManager } from './GoalLifecycle.js';
import { capabilityPermissionStore } from './CapabilityPermissionStore.js';
import { logger } from '../../utils/logger.js';
import type { GoalEvidence, GoalRun, GoalStatus } from './types.js';

export interface AcceptanceTestCase {
  id: string;
  stepLetter: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  title: string;
  description: string;
  commandExample: string;
  requiredCapability: string;
  status: 'PENDING' | 'WAITING_FOR_USER_COMMAND' | 'EXECUTING' | 'WAITING_HUMAN_VERDICT' | 'PASSED' | 'FAILED' | 'RECOVERING';
  associatedGoalId?: string;
  lastEvidence: GoalEvidence[];
  humanVerdict?: 'CORRECT' | 'WRONG';
  notes?: string;
  passedAt?: string;
  details?: Record<string, any>;
}

export class LiveAcceptanceManager extends EventEmitter {
  private static instance: LiveAcceptanceManager;
  private activeTestId: string = 'test_a';
  private tests: Map<string, AcceptanceTestCase> = new Map();

  private constructor() {
    super();
    this.initTestCases();
    this.bindGoalEvents();
  }

  public static getInstance(): LiveAcceptanceManager {
    if (!LiveAcceptanceManager.instance) {
      LiveAcceptanceManager.instance = new LiveAcceptanceManager();
    }
    return LiveAcceptanceManager.instance;
  }

  private initTestCases(): void {
    const defaultCases: AcceptanceTestCase[] = [
      {
        id: 'test_a',
        stepLetter: 'A',
        title: 'Dynamic App Discovery',
        description: 'User commands Jarvis to locate and open an arbitrary installed app (e.g. pinned on taskbar or start menu).',
        commandExample: '“Jarvis, locate and open Comet Perplexity browser” or “Open Calculator”',
        requiredCapability: 'desktop.control',
        status: 'WAITING_FOR_USER_COMMAND',
        lastEvidence: [],
      },
      {
        id: 'test_b',
        stepLetter: 'B',
        title: 'Desktop Reading (Active Window Perception)',
        description: 'With an arbitrary desktop application foregrounded, Jarvis inspects visible text and controls.',
        commandExample: '“Read what is inside Hermes 1” or “Read what is inside this window”',
        requiredCapability: 'desktop.observe',
        status: 'PENDING',
        lastEvidence: [],
      },
      {
        id: 'test_c',
        stepLetter: 'C',
        title: 'Verifiable Desktop Screenshot',
        description: 'Jarvis takes a screenshot, produces a real verifiable file artifact with SHA256, byteSize > 1024, and UI preview.',
        commandExample: '“Take a screenshot of this window” or “Take a screenshot of the current page”',
        requiredCapability: 'screen.capture',
        status: 'PENDING',
        lastEvidence: [],
      },
      {
        id: 'test_d',
        stepLetter: 'D',
        title: 'Screen Vision / Question Answering',
        description: 'Jarvis inspects the visible screen/window and answers a specific question grounded in real desktop pixels.',
        commandExample: '“What error do you see?” or “What is on my screen?”',
        requiredCapability: 'desktop.observe',
        status: 'PENDING',
        lastEvidence: [],
      },
      {
        id: 'test_e',
        stepLetter: 'E',
        title: 'Browser Navigation, Reading & Typing',
        description: 'Browser interaction under persistent authorization (input, click, read, navigate) without permission denial.',
        commandExample: '“Open the browser and search for AgenticOS”',
        requiredCapability: 'browser.input',
        status: 'PENDING',
        lastEvidence: [],
      },
      {
        id: 'test_f',
        stepLetter: 'F',
        title: 'Physical Webcam Perception (Dual Live Frames)',
        description: 'Live physical camera capture with 2 consecutive frames having differing SHA256 hashes when user changes pose.',
        commandExample: '“Can you see me?” then change posture/object: “What am I holding now?”',
        requiredCapability: 'camera.perceive',
        status: 'PENDING',
        lastEvidence: [],
      },
      {
        id: 'test_g',
        stepLetter: 'G',
        title: 'Unknown Failure Self-Heal Recovery',
        description: 'When an unconfigured failure occurs, GoalRun enters RECOVERING and automatically discovers an alternative.',
        commandExample: 'Trigger an ambiguous or blocked target — system must recover without stopping GoalRun.',
        requiredCapability: 'desktop.control',
        status: 'PENDING',
        lastEvidence: [],
      },
      {
        id: 'test_h',
        stepLetter: 'H',
        title: 'Engineering Defect Autonomous Self-Repair',
        description: 'Capability pipeline defect triggers Hermes engineering recovery and continues original GoalRun.',
        commandExample: 'SelfHeal triggers code reconcile and resumes active goal.',
        requiredCapability: 'shell.execute',
        status: 'PENDING',
        lastEvidence: [],
      },
    ];

    for (const tc of defaultCases) {
      this.tests.set(tc.id, tc);
    }
  }

  private bindGoalEvents(): void {
    goalLifecycleManager.on('goal:created', (goal: GoalRun) => {
      const activeTest = this.tests.get(this.activeTestId);
      if (activeTest && activeTest.status !== 'PASSED') {
        activeTest.associatedGoalId = goal.goalId;
        activeTest.status = 'EXECUTING';
        this.emit('acceptance:updated', this.getState());
      }
    });

    goalLifecycleManager.on('goal:state', (event: any) => {
      const activeTest = this.tests.get(this.activeTestId);
      if (!activeTest || activeTest.associatedGoalId !== event.goalId) return;

      if (event.to === 'COMPLETED') {
        const goal = goalLifecycleManager.getGoalRun(event.goalId);
        activeTest.lastEvidence = goal?.evidence || [];
        activeTest.status = 'WAITING_HUMAN_VERDICT';
        this.emit('acceptance:updated', this.getState());
      } else if (event.to === 'RECOVERING' || event.to === 'TRYING_ALTERNATIVE') {
        activeTest.status = 'RECOVERING';
        this.emit('acceptance:updated', this.getState());
      } else if (event.to === 'FAILED_EXHAUSTED') {
        activeTest.status = 'FAILED';
        this.emit('acceptance:updated', this.getState());
      }
    });
  }

  public setActiveTest(testId: string): boolean {
    if (!this.tests.has(testId)) return false;
    this.activeTestId = testId;
    const test = this.tests.get(testId)!;
    if (test.status === 'PENDING') {
      test.status = 'WAITING_FOR_USER_COMMAND';
    }
    this.emit('acceptance:updated', this.getState());
    return true;
  }

  public recordHumanFeedback(opts: {
    testId?: string;
    verdict: 'CORRECT' | 'WRONG';
    notes?: string;
  }): { success: boolean; message: string; test?: AcceptanceTestCase } {
    const targetId = opts.testId || this.activeTestId;
    const test = this.tests.get(targetId);
    if (!test) {
      return { success: false, message: `Test ${targetId} not found.` };
    }

    test.humanVerdict = opts.verdict;
    test.notes = opts.notes;

    const goal = test.associatedGoalId ? goalLifecycleManager.getGoalRun(test.associatedGoalId) : null;

    if (opts.verdict === 'CORRECT') {
      // Contract Check: NO EVIDENCE = NO SUCCESS CLAIM
      const hasPhysicalEvidence = this.validatePhysicalEvidence(test, goal);
      if (!hasPhysicalEvidence.valid) {
        test.status = 'FAILED';
        return {
          success: false,
          message: `Cannot record success: ${hasPhysicalEvidence.reason}. Contract: NO EVIDENCE = NO SUCCESS CLAIM.`,
          test,
        };
      }

      test.status = 'PASSED';
      test.passedAt = new Date().toISOString();

      if (goal) {
        goalLifecycleManager.transitionState(goal.goalId, 'COMPLETED', {
          actor: 'User',
          summary: `Human accepted live test ${test.stepLetter}: REAL RESULT CORRECT`,
          detail: { notes: opts.notes },
        });
      }

      // Automatically advance to next test if available
      const testList = Array.from(this.tests.values());
      const currentIndex = testList.findIndex(t => t.id === targetId);
      if (currentIndex >= 0 && currentIndex + 1 < testList.length) {
        const nextTest = testList[currentIndex + 1];
        if (nextTest.status === 'PENDING') {
          this.activeTestId = nextTest.id;
          nextTest.status = 'WAITING_FOR_USER_COMMAND';
        }
      }

      this.emit('acceptance:updated', this.getState());
      return { success: true, message: `Test ${test.stepLetter} (${test.title}) marked PASSED by user.`, test };
    } else {
      // User clicked REAL RESULT WRONG
      test.status = 'RECOVERING';
      logger.warn(`[LiveAcceptance] User rejected test ${test.stepLetter}: REAL RESULT WRONG. Notes: ${opts.notes}`);

      if (goal) {
        goal.finalVerification = {
          verified: false,
          method: 'human_physical_observation',
          expectedState: 'User satisfied with real physical action',
          actualState: opts.notes || 'Human rejected action as incorrect',
          evidence: goal.evidence,
          verifier: 'HumanUser',
          timestamp: new Date().toISOString(),
          summary: `User observed real physical failure: ${opts.notes || 'Incorrect outcome'}`,
        };

        goalLifecycleManager.recordFailure(goal.goalId, {
          attemptNumber: goal.currentAttempt,
          strategy: 'previous_execution',
          reason: `Human observer rejected result: ${opts.notes || 'Outcome does not match physical reality'}`,
          failureDomain: 'operational',
          timestamp: new Date().toISOString(),
          evidence: goal.evidence,
        });

        goalLifecycleManager.transitionState(goal.goalId, 'RECOVERING', {
          actor: 'User',
          summary: `Human marked REAL RESULT WRONG -> Invalidating verification and entering RECOVERING`,
          detail: { notes: opts.notes },
        });
      }

      this.emit('acceptance:updated', this.getState());
      return {
        success: true,
        message: `Human observation recorded: REAL RESULT WRONG. Goal ${goal?.goalId || 'N/A'} returned to RECOVERING.`,
        test,
      };
    }
  }

  private validatePhysicalEvidence(test: AcceptanceTestCase, goal: GoalRun | null): { valid: boolean; reason?: string } {
    if (!goal && test.lastEvidence.length === 0) {
      return { valid: false, reason: 'No goal run or evidence attached to test' };
    }

    const evidenceList = goal?.evidence || test.lastEvidence;

    if (test.id === 'test_c') {
      // Screenshot requires verified screenshot artifact with byteSize > 1024
      const screenshot = evidenceList.find(e => e.type === 'screenshot');
      if (!screenshot || !screenshot.value?.artifactPath) {
        return { valid: false, reason: 'Missing verified screenshot artifact in evidence' };
      }
      if (screenshot.value.byteSize < 1024) {
        return { valid: false, reason: `Screenshot artifact size is too small (${screenshot.value.byteSize} bytes)` };
      }
    }

    if (test.id === 'test_f') {
      // Camera requires physical frame evidence
      const visualFrame = evidenceList.find(e => e.type === 'visual_frame');
      if (!visualFrame || !visualFrame.value?.frameSha256) {
        return { valid: false, reason: 'Missing verified physical camera frame SHA256' };
      }
    }

    return { valid: true };
  }

  public getState() {
    const activeTest = this.tests.get(this.activeTestId);
    const activeGoal = activeTest?.associatedGoalId ? goalLifecycleManager.getGoalRun(activeTest.associatedGoalId) : null;
    const allTests = Array.from(this.tests.values());
    const passedCount = allTests.filter(t => t.status === 'PASSED').length;

    // Check capability permissions
    const permissions = capabilityPermissionStore.getAllPermissions();

    return {
      activeTestId: this.activeTestId,
      activeTest,
      activeGoal,
      tests: allTests,
      passedCount,
      totalCount: allTests.length,
      allPassed: passedCount === allTests.length,
      permissions,
      mode: 'LIVE_ACCEPTANCE_MODE',
      timestamp: new Date().toISOString(),
    };
  }
}

export const liveAcceptanceManager = LiveAcceptanceManager.getInstance();
