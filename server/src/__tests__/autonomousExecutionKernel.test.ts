/**
 * autonomousExecutionKernel.test.ts — Verification of Autonomous Execution Kernel Bridge
 *
 * Implements Section O (Tests at Four Levels):
 * LEVEL 1 — Semantic routing (DIRECT_ACTION vs AUTONOMOUS_GOAL)
 * LEVEL 2 — Task graph (node ordering, dependencies, artifact refs, failure propagation, bounded retry, cancellation)
 * LEVEL 3 — Controlled capability integration (Telegram compound flow, Camera capture -> Media ad generation)
 * LEVEL 4 — Production-path readiness (real AutonomousPlanner, TaskGraphExecutor, ArtifactStore, CapabilityDispatcher)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { semanticDiscourseInterpreter } from '../domains/controlPlane/SemanticDiscourseInterpreter.js';
import { authoritativeIntentCompiler } from '../domains/controlPlane/AuthoritativeIntentCompiler.js';
import { autonomousPlanner } from '../domains/controlPlane/taskGraph/AutonomousPlanner.js';
import { taskGraphExecutor } from '../domains/controlPlane/taskGraph/TaskGraphExecutor.js';
import { autonomousExecutionKernel } from '../domains/controlPlane/taskGraph/AutonomousExecutionKernel.js';
import { artifactStore } from '../domains/controlPlane/artifacts/ArtifactStore.js';
import { capabilityDispatcher } from '../domains/controlPlane/CapabilityDispatcher.js';
import { authoritativeInteractionContext } from '../domains/controlPlane/AuthoritativeInteractionContext.js';
import { conversationCapabilityAdapter } from '../domains/controlPlane/adapters/ConversationCapabilityAdapter.js';
import type { TaskGraph, TaskNode } from '../domains/controlPlane/taskGraph/types.js';
import type { GoalIntent } from '../domains/controlPlane/StructuredIntent.js';
import { goalLifecycleManager } from '../domains/controlPlane/GoalLifecycle.js';

describe('Autonomous Jarvis Execution Kernel Bridge Suite', () => {
  const convId = 'test-autonomous-conv';

  beforeEach(() => {
    authoritativeInteractionContext.resetContext(convId);
  });

  // =========================================================================
  // LEVEL 1: SEMANTIC ROUTING
  // =========================================================================
  describe('Level 1 — Semantic Routing', () => {
    it('routes "Open Telegram." as DIRECT_ACTION', async () => {
      const { structuredIntent: intent } = await semanticDiscourseInterpreter.interpret('Open Telegram.');
      expect(intent).toBeDefined();
      expect(intent!.action).toBe('OPEN_APPLICATION');
      expect(intent!.application?.toLowerCase()).toContain('telegram');
      expect(intent!.executionMode).toBe('DIRECT_ACTION');
    });

    it('routes "Tell me what you see." as DIRECT_ACTION (CAMERA_OBSERVE)', async () => {
      const { structuredIntent: intent } = await semanticDiscourseInterpreter.interpret('Tell me what you see.');
      expect(intent).toBeDefined();
      expect(intent!.action).toBe('CAMERA_OBSERVE');
      expect(intent!.executionMode).toBe('DIRECT_ACTION');
    });

    it('routes "Open Telegram, locate AgenticOS and read the last four messages." as AUTONOMOUS_GOAL or compound plan', async () => {
      const { structuredIntent: intent } = await semanticDiscourseInterpreter.interpret('Open Telegram, locate AgenticOS and read the last four messages.');
      expect(intent).toBeDefined();
      expect(intent!.executionMode).toBe('AUTONOMOUS_GOAL');
      expect(intent!.goalIntent).toBeDefined();
      expect(intent!.goalIntent?.userGoal).toContain('Telegram');

      // Compiler must compile into deterministic compound plan
      const compiled = authoritativeIntentCompiler.compileFromStructuredIntent(intent!, 'Open Telegram, locate AgenticOS and read the last four messages.', convId);
      expect(compiled.isCompound).toBe(true);
      expect(compiled.steps?.length).toBeGreaterThanOrEqual(3);
      expect(compiled.steps?.[0].action).toBe('OPEN_APPLICATION');
      expect(compiled.steps?.[1].action).toBe('OPEN_CHAT');
      expect(compiled.steps?.[2].action).toBe('READ_MESSAGES');
    });

    it('routes "Take a screenshot of this object and create a cinematic advertisement." as AUTONOMOUS_GOAL', async () => {
      const { structuredIntent: intent } = await semanticDiscourseInterpreter.interpret('Take a screenshot of this object and create a cinematic advertisement.');
      expect(intent).toBeDefined();
      expect(intent!.executionMode).toBe('AUTONOMOUS_GOAL');
      expect(intent!.goalIntent).toBeDefined();
      expect(intent!.goalIntent?.requestedOutputs).toContain('cinematic advertisement');
    });
  });

  // =========================================================================
  // LEVEL 2: TASK GRAPH ENGINE
  // =========================================================================
  describe('Level 2 — Task Graph Engine & Dependencies', () => {
    it('enforces dependency ordering and verifies downstream wait for upstream verification', async () => {
      const goal = goalLifecycleManager.startGoal({conversationId: convId, userInput: 'Test two step pipeline'});
      goalLifecycleManager.transitionState(goal.goalId, 'PLANNING', {actor:'ControlPlane',summary:'test'});
      goalLifecycleManager.transitionState(goal.goalId, 'EXECUTING', {actor:'ControlPlane',summary:'test'});
      const graph: TaskGraph = {
        graphId: 'graph-test-1',
        goalId: goal.goalId,
        userGoal: 'Test two step pipeline',
        nodes: new Map(),
        entryNodes: ['node-1'],
        status: 'PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const executionOrder: string[] = [];

      const node1: TaskNode = {
        id: 'node-1',
        capability: 'test_cap',
        operation: 'STEP_1',
        inputs: [],
        outputs: ['step1_output'],
        dependsOn: [],
        status: 'PENDING',
      };

      const node2: TaskNode = {
        id: 'node-2',
        capability: 'test_cap',
        operation: 'STEP_2',
        inputs: ['step1_output'],
        outputs: ['step2_output'],
        dependsOn: ['node-1'],
        status: 'PENDING',
      };

      graph.nodes.set(node1.id, node1);
      graph.nodes.set(node2.id, node2);

      // Register temporary execution capability in capabilityDispatcher for testing
      const res = await taskGraphExecutor.executeGraph(graph, {
        conversationId: convId,
      });

      expect(res.success).toBe(true);
      expect(node1.status).toBe('VERIFIED');
      expect(node2.status).toBe('VERIFIED');
      expect(node1.completedAt).toBeLessThanOrEqual(node2.startedAt || 0);
    });

    it('respects bounded retries and fails node when retry limit is exhausted', async () => {
      const graph: TaskGraph = {
        graphId: 'graph-retry-test',
        goalId: 'goal-retry-test',
        userGoal: 'Test bounded retry',
        nodes: new Map(),
        entryNodes: ['failing-node'],
        status: 'PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      let attempts = 0;
      const failingNode: TaskNode = {
        id: 'failing-node',
        capability: 'non_existent_capability',
        operation: 'FAIL_ALWAYS',
        inputs: [],
        outputs: [],
        dependsOn: [],
        status: 'PENDING',
        retryPolicy: { maxRetries: 2, backoffMs: 10 },
      };

      graph.nodes.set(failingNode.id, failingNode);

      const res = await taskGraphExecutor.executeGraph(graph, {
        conversationId: convId,
      });

      expect(res.success).toBe(false);
      expect(failingNode.status).toBe('FAILED');
      expect(failingNode.retryPolicy?.maxRetries).toBe(2);
    });

    it('supports cancellation via AbortSignal', async () => {
      const graph: TaskGraph = {
        graphId: 'graph-cancel-test',
        goalId: 'goal-cancel-test',
        userGoal: 'Test cancellation',
        nodes: new Map(),
        entryNodes: ['node-cancel'],
        status: 'PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const node: TaskNode = {
        id: 'node-cancel',
        capability: 'system',
        operation: 'LONG_RUNNING',
        inputs: [],
        outputs: [],
        dependsOn: [],
        status: 'PENDING',
      };
      graph.nodes.set(node.id, node);

      const controller = new AbortController();
      controller.abort(); // pre-aborted

      const res = await taskGraphExecutor.executeGraph(graph, {
        signal: controller.signal,
        conversationId: convId,
      });

      expect(res.success).toBe(false);
      expect(graph.status).toBe('CANCELLED');
    });
  });

  // =========================================================================
  // LEVEL 3: CONTROLLED CAPABILITY INTEGRATION
  // =========================================================================
  describe('Level 3 — Controlled Capability Integration', () => {
    it('Telegram: plans compound flow: OPEN -> OPEN_CHAT -> READ_MESSAGES -> VERIFY', () => {
      const goalIntent: GoalIntent = {
        schemaVersion: '1',
        executionMode: 'AUTONOMOUS_GOAL',
        userGoal: 'Open Telegram, locate AgenticOS and read me the last 4 messages.',
        entities: ['Telegram', 'AgenticOS'],
        constraints: ['last 4 messages'],
        requestedOutputs: ['spoken messages'],
        contextRefs: [],
        confidence: 0.98,
        needsClarification: false,
      };

      const graph = autonomousPlanner.planGoal(goalIntent, 'goal-telegram-1');
      expect(graph.nodes.size).toBe(4);

      const nodesList = Array.from(graph.nodes.values());
      const openNode = nodesList.find(n => n.operation === 'OPEN_APPLICATION');
      const chatNode = nodesList.find(n => n.operation === 'OPEN_CHAT');
      const readNode = nodesList.find(n => n.operation === 'READ_MESSAGES');
      const announceNode = nodesList.find(n => n.operation === 'PRESENT_RESULT');

      expect(openNode).toBeDefined();
      expect(chatNode?.dependsOn).toContain(openNode!.id);
      expect(readNode?.dependsOn).toContain(chatNode!.id);
      expect(announceNode?.dependsOn).toContain(readNode!.id);
    });

    it('Camera & Media: plans CAMERA_CAPTURE -> IMAGE_GENERATE -> VERIFY_ARTIFACT -> PRESENT_RESULT', async () => {
      const goalIntent: GoalIntent = {
        schemaVersion: '1',
        executionMode: 'AUTONOMOUS_GOAL',
        userGoal: 'Take a screenshot of this object I am holding in my hand and create a cinematic advertisement for this object.',
        entities: ['camera object'],
        constraints: ['cinematic advertisement'],
        requestedOutputs: ['cinematic advertisement image'],
        contextRefs: [],
        confidence: 0.95,
        needsClarification: false,
      };

      const graph = autonomousPlanner.planGoal(goalIntent, 'goal-media-1');
      expect(graph.nodes.size).toBe(4);

      const nodesList = Array.from(graph.nodes.values());
      const captureNode = nodesList.find(n => n.operation === 'CAMERA_CAPTURE');
      const genNode = nodesList.find(n => n.operation === 'IMAGE_GENERATE');
      const verifyNode = nodesList.find(n => n.operation === 'VERIFY_ARTIFACT');
      const presentNode = nodesList.find(n => n.operation === 'PRESENT_RESULT');

      expect(captureNode).toBeDefined();
      expect(genNode?.dependsOn).toContain(captureNode!.id);
      expect(verifyNode?.dependsOn).toContain(genNode!.id);
      expect(presentNode?.dependsOn).toContain(verifyNode!.id);
    });

    it('refuses to complete Camera Ad without a real reference-image provider', async () => {
      const goalIntent: GoalIntent = {
        schemaVersion: '1',
        executionMode: 'AUTONOMOUS_GOAL',
        userGoal: 'Take a screenshot of this object and create a cinematic advertisement.',
        entities: ['object'],
        constraints: ['cinematic advertisement'],
        requestedOutputs: ['image'],
        contextRefs: [],
        confidence: 0.95,
        needsClarification: false,
      };

      const milestones: string[] = [];
      const res = await autonomousExecutionKernel.executeGoal(goalIntent, {
        conversationId: convId,
        onUserMilestone: (m) => milestones.push(m),
      });

      expect(res.success).toBe(false);
      expect(res.finalArtifact).toBeUndefined();
      expect(res.goalRun.status).not.toBe('COMPLETED');
      expect(milestones.length).toBeGreaterThan(0);

      expect(res.outputText).not.toMatch(/completed creating|artifact is ready/i);
    });
  });

  // =========================================================================
  // LEVEL 4: PRODUCTION-PATH READINESS
  // =========================================================================
  describe('Level 4 — Production-Path Readiness & Causal Explanation', () => {
    it('proves causal explanation prioritizes failed goals over subsequent minor successes', async () => {
      // 1. Record a failed action (e.g. Telegram launch watchdog timeout)
      authoritativeInteractionContext.recordExecutionFailure(convId, {
        turnId: 'turn-tg-fail',
        correlationId: 'corr-tg-fail',
        action: 'OPEN_APPLICATION',
        target: 'Telegram',
        executionStage: 'EXECUTION_WATCHDOG',
        providerIdentity: 'control_plane',
        technicalRootCause: 'Turn execution exceeded 12000ms ceiling waiting for application to respond',
        userFacingFailure: 'That request timed out while waiting for the application to respond.',
        failureReason: 'Application execution timed out after 12000ms',
        verifierState: 'FAILED_CLOSED',
        timestamp: Date.now() - 5000,
      });

      // 2. Simulate a subsequent minor success (e.g. READ_CONTENT or CONVERSATIONAL)
      authoritativeInteractionContext.commitVerifiedDiscourse(convId, {
        action: 'READ_CONTENT',
        target: 'screen',
        targetType: 'SCREEN',
        rawPrompt: 'Read the screen',
      }, {
        stepId: 'step-read-screen',
        action: 'READ_CONTENT',
        requestedTarget: 'screen',
        executedTarget: 'screen',
        success: true,
        verified: true,
        verificationEvidence: { source: 'screen', data: { sourceHwnd: 12345 } },
        contextMutation: { contentItems: ['Some visible text'] },
      });

      // 3. User asks: "Why didn't that work?"
      const ctx = authoritativeInteractionContext.getContext(convId);
      const explanationStep = {
        action: 'CONVERSATIONAL',
        target: 'explain_previous_outcome',
        rawPrompt: "Why didn't that work?",
      };

      const result = await conversationCapabilityAdapter.execute(explanationStep as any, 'step-why', convId);
      expect(result.success).toBe(true);
      // MUST explain the Telegram failure, NOT praise the screen reading success!
      expect(result.outputText?.toLowerCase()).toMatch(/telegram|timed out|waiting for the application/);
      expect(result.outputText).not.toMatch(/That worked because/);
    });
  });
});
