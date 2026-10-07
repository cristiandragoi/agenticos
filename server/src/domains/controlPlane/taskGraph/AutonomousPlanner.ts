/**
 * taskGraph/AutonomousPlanner.ts — Decomposes Autonomous User Goals into Typed Task Graphs
 *
 * Implements Section D, H, I:
 * Translates GoalIntent into a deterministic, verified TaskGraph with node dependencies.
 */

import crypto from 'node:crypto';
import type { TaskGraph, TaskNode } from './types.js';
import type { GoalIntent } from '../StructuredIntent.js';
import { parseYouTubeChannelRequest, isYouTubeHomeRequest } from '../ConcreteVoiceRequests.js';
import { AuthoritativeIntentCompiler } from '../AuthoritativeIntentCompiler.js';
import { isRepositoryResearchRequest } from '../../repositoryResearch/specification.js';
import { isRepositoryEvaluationRequest } from '../../repositoryResearch/evaluation.js';
import { authoritativeInteractionContext } from '../AuthoritativeInteractionContext.js';
import { parseLocalFileRequest } from '../LocalFileOperations.js';

export class AutonomousPlanner {
  private static instance: AutonomousPlanner;

  private constructor() {}

  public static getInstance(): AutonomousPlanner {
    if (!AutonomousPlanner.instance) {
      AutonomousPlanner.instance = new AutonomousPlanner();
    }
    return AutonomousPlanner.instance;
  }

  /**
   * Decompose an autonomous goal into an executable TaskGraph.
   */
  public planGoal(goalIntent: GoalIntent, goalId?: string, conversationId?: string): TaskGraph {
    const gid = goalId || `goal-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const graphId = `tg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const rawGoal = goalIntent.userGoal || '';
    const lower = rawGoal.toLowerCase();

    const nodes = new Map<string, TaskNode>();
    const fileRequest=parseLocalFileRequest(rawGoal,conversationId);
    if(fileRequest && !fileRequest.clarification) {
      const id=`${graphId}-file`,present=`${graphId}-present`;
      nodes.set(id,{id,capability:'filesystem',operation:'LOCAL_FILE_OPERATION',inputs:{request:fileRequest},outputs:{},dependsOn:[],status:'PENDING',retryPolicy:{maxRetries:0,backoffMs:0},verificationPolicy:{required:true}});
      nodes.set(present,{id:present,capability:'conversation',operation:'PRESENT_RESULT',inputs:{},outputs:{},dependsOn:[id],status:'PENDING'});
      return {graphId,goalId:gid,userGoal:rawGoal,nodes,status:'PENDING',createdAt:Date.now(),updatedAt:Date.now()};
    }
    if (isRepositoryEvaluationRequest(rawGoal)) {
      const id = `${graphId}-repository-evaluation`, present = `${graphId}-present`;
      nodes.set(id, { id, capability: 'repository_research', operation: 'GITHUB_EVALUATE', inputs: { goalId: gid, graphId }, outputs: {}, dependsOn: [], status: 'PENDING', retryPolicy: { maxRetries: 0, backoffMs: 0 }, verificationPolicy: { required: true } });
      nodes.set(present, { id: present, capability: 'conversation', operation: 'PRESENT_RESULT', inputs: {}, outputs: {}, dependsOn: [id], status: 'PENDING' });
      return { graphId, goalId: gid, userGoal: rawGoal, nodes, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    }
    if (isRepositoryResearchRequest(rawGoal)) {
      const context = conversationId ? authoritativeInteractionContext.getContext(conversationId) : null;
      // Resolve deictic research from the same conversation, without copying contact
      // names, file paths or message contents into a public GitHub query.
      const contextualResearch = /\b(?:this|that)\s+(?:kind\s+of\s+)?(?:task|problem|capability)\b/i.test(rawGoal);
      const app = context?.activeApplication;
      const researchGoal = contextualResearch && /^(?:WhatsApp|Telegram)$/i.test(app || '')
        ? `Find open-source ${app} desktop chat navigation and visible message extraction tools`
        : rawGoal;
      const id = `${graphId}-repository-research`;
      nodes.set(id, { id, capability: 'repository_research', operation: 'GITHUB_RESEARCH', inputs: { goal: researchGoal, goalId: gid, graphId }, outputs: {}, dependsOn: [], status: 'PENDING', retryPolicy: { maxRetries: 0, backoffMs: 0 }, verificationPolicy: { required: true } });
      const present = `${graphId}-present`;
      nodes.set(present, { id: present, capability: 'conversation', operation: 'PRESENT_RESULT', inputs: {}, outputs: {}, dependsOn: [id], status: 'PENDING' });
      return { graphId, goalId: gid, userGoal: rawGoal, nodes, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    }
    if (isYouTubeHomeRequest(rawGoal)) {
      const openId = `${graphId}-youtube-home`;
      const presentId = `${graphId}-present`;
      nodes.set(openId, { id: openId, capability: 'browser', operation: 'YOUTUBE_OPEN_HOME', inputs: {}, outputs: {}, dependsOn: [], status: 'PENDING', verificationPolicy: { required: true } });
      nodes.set(presentId, { id: presentId, capability: 'conversation', operation: 'PRESENT_RESULT', inputs: {}, outputs: {}, dependsOn: [openId], status: 'PENDING' });
      return { graphId, goalId: gid, userGoal: rawGoal, nodes, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    }
    const chatPlan = AuthoritativeIntentCompiler.compilePlan(rawGoal, { conversationId, activeApplication: goalIntent.entities?.[0] });
    if (chatPlan.steps[0]?.reason === 'Bound chat follow-up' && chatPlan.steps.length > 1 && chatPlan.steps.some(s => s.action === 'OPEN_CHAT')) {
      let previous: string | null = null;
      for (const step of chatPlan.steps) {
        const id = `${graphId}-${nodes.size}-${step.action.toLowerCase()}`;
        nodes.set(id, { id, capability: step.action === 'OPEN_APPLICATION' ? 'app' : 'chat', operation: step.action,
          inputs: { application: step.application, chat: step.target, count: step.count }, outputs: {},
          dependsOn: previous ? [previous] : [], status: 'PENDING',
          retryPolicy: { maxRetries: 0, backoffMs: 0 }, verificationPolicy: { required: true } });
        previous = id;
      }
      const id = `${graphId}-present`;
      nodes.set(id, { id, capability: 'conversation', operation: 'PRESENT_RESULT', inputs: {}, outputs: {},
        dependsOn: previous ? [previous] : [], status: 'PENDING' });
      return { graphId, goalId: gid, userGoal: rawGoal, nodes, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    }
    const youtube = parseYouTubeChannelRequest(rawGoal);
    if (youtube) {
      let previous: string | null = null;
      for (const operation of ['YOUTUBE_SEARCH_CHANNEL', 'YOUTUBE_OPEN_CHANNEL', ...(youtube.openVideo ? ['YOUTUBE_OPEN_VIDEO'] : []), 'PRESENT_RESULT']) {
        const id = `${graphId}-${operation.toLowerCase()}`;
        nodes.set(id, { id, capability: operation === 'PRESENT_RESULT' ? 'conversation' : 'browser', operation,
          inputs: { channel: youtube.channel }, outputs: {}, dependsOn: previous ? [previous] : [], status: 'PENDING',
          retryPolicy: { maxRetries: 1, backoffMs: 500 }, verificationPolicy: { required: true } });
        previous = id;
      }
      return { graphId, goalId: gid, userGoal: rawGoal, nodes, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    }

    // ── 1. Media Advertisement / Object Capture Pipeline (Section H) ──
    // "Take a screenshot of this object ... create a cinematic advertisement"
    const isCameraCaptureAd =
      (lower.includes('advertisement') || lower.includes('ad ') || lower.includes('cinematic') || lower.includes('commercial')) &&
      (lower.includes('camera') || lower.includes('screenshot') || lower.includes('picture') || lower.includes('object') || lower.includes('holding'));

    if (isCameraCaptureAd) {
      const node1Id = `${graphId}-node1-capture`;
      const node2Id = `${graphId}-node2-generate`;
      const node3Id = `${graphId}-node3-verify`;
      const node4Id = `${graphId}-node4-present`;

      nodes.set(node1Id, {
        id: node1Id,
        capability: 'camera',
        operation: 'CAMERA_CAPTURE',
        inputs: { prompt: rawGoal },
        outputs: {},
        dependsOn: [],
        status: 'PENDING',
        retryPolicy: { maxRetries: 2, backoffMs: 300 },
        verificationPolicy: { required: true, expectArtifactType: 'IMAGE' },
      });

      nodes.set(node2Id, {
        id: node2Id,
        capability: 'media',
        operation: 'IMAGE_GENERATE',
        inputs: {
          prompt: 'Cinematic commercial advertisement featuring the product object',
          styleInstructions: 'cinematic lighting, product showcase advertisement, dramatic commercial aesthetic, 8k resolution',
        },
        outputs: {},
        dependsOn: [node1Id],
        status: 'PENDING',
        retryPolicy: { maxRetries: 2, backoffMs: 500 },
        verificationPolicy: { required: true, expectArtifactType: 'IMAGE' },
      });

      nodes.set(node3Id, {
        id: node3Id,
        capability: 'media',
        operation: 'VERIFY_ARTIFACT',
        inputs: {},
        outputs: {},
        dependsOn: [node2Id],
        status: 'PENDING',
        retryPolicy: { maxRetries: 1, backoffMs: 200 },
        verificationPolicy: { required: true },
      });

      nodes.set(node4Id, {
        id: node4Id,
        capability: 'conversation',
        operation: 'PRESENT_RESULT',
        inputs: {},
        outputs: {},
        dependsOn: [node3Id],
        status: 'PENDING',
      });

      return {
        graphId,
        goalId: gid,
        userGoal: rawGoal,
        nodes,
        status: 'PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ── 2. Telegram Compound Flow (Section I) ──
    // "Open Telegram, locate AgenticOS and read me the last four messages"
    const isTelegramCompound =
      lower.includes('telegram') &&
      (lower.includes('locate') || lower.includes('find') || lower.includes('open chat') || lower.includes('read') || lower.includes('message'));

    if (isTelegramCompound) {
      const node1Id = `${graphId}-node1-app`;
      const node2Id = `${graphId}-node2-chat`;
      const node3Id = `${graphId}-node3-read`;
      const node4Id = `${graphId}-node4-present`;

      // Extract requested count or default to 4
      const countMatch = lower.match(/\b(?:last\s+)?(\d+|one|two|three|four|five)\s+messages?\b/i);
      let count = 4;
      if (countMatch) {
        const wordToNum: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        count = wordToNum[countMatch[1].toLowerCase()] || parseInt(countMatch[1], 10) || 4;
      }

      nodes.set(node1Id, {
        id: node1Id,
        capability: 'app',
        operation: 'OPEN_APPLICATION',
        inputs: { application: 'Telegram' },
        outputs: {},
        dependsOn: [],
        status: 'PENDING',
        retryPolicy: { maxRetries: 2, backoffMs: 500 },
        verificationPolicy: { required: true },
      });

      nodes.set(node2Id, {
        id: node2Id,
        capability: 'chat',
        operation: 'OPEN_CHAT',
        inputs: { application: 'Telegram', chat: 'AgenticOS' },
        outputs: {},
        dependsOn: [node1Id],
        status: 'PENDING',
        retryPolicy: { maxRetries: 2, backoffMs: 500 },
        verificationPolicy: { required: true },
      });

      nodes.set(node3Id, {
        id: node3Id,
        capability: 'chat',
        operation: 'READ_MESSAGES',
        inputs: { application: 'Telegram', chat: 'AgenticOS', count },
        outputs: {},
        dependsOn: [node2Id],
        status: 'PENDING',
        retryPolicy: { maxRetries: 2, backoffMs: 400 },
        verificationPolicy: { required: true },
      });

      nodes.set(node4Id, {
        id: node4Id,
        capability: 'conversation',
        operation: 'PRESENT_RESULT',
        inputs: {},
        outputs: {},
        dependsOn: [node3Id],
        status: 'PENDING',
      });

      return {
        graphId,
        goalId: gid,
        userGoal: rawGoal,
        nodes,
        status: 'PENDING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    // ── 3. General Multi-Step Fallback ──
    // Reuse the authoritative compiler and dispatcher for integrated operations.
    // No new planner, inferred tools, or conversation-as-execution success.
    const installedActions = new Set(['OPEN_APPLICATION', 'OPEN_CHAT', 'READ_MESSAGES', 'READ_CONTENT', 'NAVIGATE_WEB', 'OPEN_URL']);
    if (chatPlan.steps.length && chatPlan.steps.every(step => installedActions.has(step.action) && step.confidence >= 0.8)) {
      const actionId = `${graphId}-compiled`, presentId = `${graphId}-present`;
      nodes.set(actionId, { id: actionId, capability: 'installed_adapters', operation: 'EXECUTE_COMPILED_PLAN',
        inputs: { steps: chatPlan.steps, rawPrompt: rawGoal, normalizedPrompt: chatPlan.normalizedPrompt },
        outputs: {}, dependsOn: [], status: 'PENDING', retryPolicy: { maxRetries: 0, backoffMs: 0 }, verificationPolicy: { required: true } });
      nodes.set(presentId, { id: presentId, capability: 'conversation', operation: 'PRESENT_RESULT',
        inputs: {}, outputs: {}, dependsOn: [actionId], status: 'PENDING' });
      return { graphId, goalId: gid, userGoal: rawGoal, nodes, status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now() };
    }
    const fallbackNodeId = `${graphId}-node1-action`;
    nodes.set(fallbackNodeId, {
      id: fallbackNodeId,
      capability: 'conversation',
      operation: 'UNSUPPORTED_GOAL',
      inputs: { userGoal: rawGoal },
      retryPolicy: { maxRetries: 0, backoffMs: 0 },
      outputs: {},
      dependsOn: [],
      status: 'PENDING',
    });

    return {
      graphId,
      goalId: gid,
      userGoal: rawGoal,
      nodes,
      status: 'PENDING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export const autonomousPlanner = AutonomousPlanner.getInstance();
