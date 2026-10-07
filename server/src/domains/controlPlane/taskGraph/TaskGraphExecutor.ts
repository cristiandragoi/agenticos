/**
 * taskGraph/TaskGraphExecutor.ts — Dependency-Aware Task Graph Execution Engine
 *
 * Implements Section D, J, K, L:
 * - Actions require verified dependencies; presentation may report unverified success.
 * - State and artifact propagation across graph nodes.
 * - Bounded retries per node.
 * - Meaningful user milestone progress broadcasting.
 * - Strict verification gates before advancing.
 * - Cancellation support via AbortSignal.
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { logger } from '../../../utils/logger.js';
import type { TaskGraph, TaskNode, TaskProgressEvent } from './types.js';
import { artifactStore } from '../artifacts/ArtifactStore.js';
import type { ArtifactRef } from '../artifacts/types.js';
import { mediaCapabilityAdapter } from '../adapters/MediaCapabilityAdapter.js';
import { perceptionCapabilityAdapter } from '../adapters/PerceptionCapabilityAdapter.js';
import { appCapabilityAdapter } from '../adapters/AppCapabilityAdapter.js';
import { chatCapabilityAdapter } from '../adapters/ChatCapabilityAdapter.js';
import { browserCapabilityAdapter } from '../adapters/BrowserCapabilityAdapter.js';
import { universalPerceptionService } from '../UniversalPerceptionService.js';
import { authoritativeInteractionContext } from '../AuthoritativeInteractionContext.js';
import { capabilityDispatcher } from '../CapabilityDispatcher.js';
import type { CompiledTurnIntent } from '../AuthoritativeIntentCompiler.js';
import { executeLocalFileRequest } from '../LocalFileOperations.js';
import { appendGraphEvidence } from './TaskGraphJournal.js';
import { withNodeExecution } from './ExecutionIdentity.js';

export interface TaskGraphExecutionOptions {
  signal?: AbortSignal;
  onProgress?: (event: TaskProgressEvent) => void;
  conversationId?: string;
}

export class TaskGraphExecutor extends EventEmitter {
  private static instance: TaskGraphExecutor;
  private readonly workerId = `task-graph-supervisor:${process.pid}:${randomUUID()}`;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): TaskGraphExecutor {
    if (!TaskGraphExecutor.instance) {
      TaskGraphExecutor.instance = new TaskGraphExecutor();
    }
    return TaskGraphExecutor.instance;
  }

  /**
   * Execute a TaskGraph to completion.
   */
  public async executeGraph(
    graph:TaskGraph, options:TaskGraphExecutionOptions={}
  ) {
    appendGraphEvidence(graph,'EXECUTION_REQUESTED');
    try { return await this.executeGraphInternal(graph,options); }
    finally { appendGraphEvidence(graph,'EXECUTION_RETURNED'); }
  }

  private async executeGraphInternal(
    graph: TaskGraph,
    options: TaskGraphExecutionOptions = {}
  ): Promise<{
    success: boolean;
    graph: TaskGraph;
    finalArtifact?: ArtifactRef;
    resultSummary: string;
    error?: string;
  }> {
    graph.status = 'RUNNING';
    graph.updatedAt = Date.now();
    logger.info(`[TaskGraphExecutor] Starting execution for graph ${graph.graphId} (nodes=${graph.nodes.size})`);

    const emitEvent = (ev: Omit<TaskProgressEvent, 'graphId' | 'goalId' | 'timestamp'>) => {
      const full: TaskProgressEvent = {
        ...ev,
        graphId: graph.graphId,
        goalId: graph.goalId,
        timestamp: Date.now(),
      };
      this.emit('progress', full);
      options.onProgress?.(full);
    };

    emitEvent({
      phase: 'PLANNING',
      userFacingMessage: `Starting: ${graph.userGoal}`,
    });

    const activeNodes = new Map(graph.nodes);
    let hasProgress = true;
    let lastError: string | undefined;

    while (hasProgress) {
      if (options.signal?.aborted) {
        graph.status = 'CANCELLED';
        emitEvent({
          phase: 'FAILED',
          userFacingMessage: 'Task was cancelled.',
        });
        return { success: false, graph, resultSummary: 'Task cancelled.', error: 'ABORTED' };
      }

      // Completion of execution is separate from independent verification.
      const allCompleted = Array.from(activeNodes.values()).every(n => n.status === 'SUCCEEDED' || n.status === 'VERIFIED' || n.status === 'SKIPPED');
      if (allCompleted) {
        graph.status = 'COMPLETED';
        graph.updatedAt = Date.now();

        // Find last verified artifact
        let finalArt: ArtifactRef | undefined;
        if (graph.finalArtifactId) {
          finalArt = artifactStore.getArtifact(graph.finalArtifactId);
        } else {
          for (const node of activeNodes.values()) {
            if (node.outputs?.artifact) {
              finalArt = node.outputs.artifact;
            } else if (node.outputs?.artifactId) {
              finalArt = artifactStore.getArtifact(node.outputs.artifactId);
            }
          }
        }

        const presentation = Array.from(activeNodes.values()).find(n => n.operation === 'PRESENT_RESULT')?.outputs?.presentationText;
        const summary = graph.resultSummary || presentation || (finalArt ? `Completed: created artifact ${finalArt.artifactId}` : 'Task completed successfully.');
        emitEvent({
          phase: 'COMPLETED',
          userFacingMessage: summary,
          technicalDetail: { finalArtifactId: finalArt?.artifactId },
        });

        return {
          success: true,
          graph,
          finalArtifact: finalArt,
          resultSummary: summary,
        };
      }

      // Only presentation can consume a handler success without verification.
      const readyNodes: TaskNode[] = [];
      for (const node of activeNodes.values()) {
        if (node.status === 'PENDING') {
          const depsOk = node.dependsOn.every(depId => {
            const depNode = activeNodes.get(depId);
            return depNode && (depNode.status === 'VERIFIED' || depNode.status === 'SKIPPED' ||
              (node.operation === 'PRESENT_RESULT' && depNode.status === 'SUCCEEDED'));
          });
          if (depsOk) {
            readyNodes.push(node);
          }
        }
      }

      if (readyNodes.length === 0) {
        // Deadlock or unresolvable failure
        const failedNodes = Array.from(activeNodes.values()).filter(n => n.status === 'FAILED');
        if (failedNodes.length > 0) {
          graph.status = 'FAILED';
          const err = `Node execution failed: ${failedNodes.map(n => `${n.id} (${n.error})`).join(', ')}`;
          emitEvent({
            phase: 'FAILED',
            userFacingMessage: `Task failed: ${failedNodes[0].error || 'step failure'}`,
          });
          return { success: false, graph, resultSummary: 'Task failed.', error: err };
        }
        // Blocked cycle
        graph.status = 'FAILED';
        return { success: false, graph, resultSummary: 'Task blocked on unresolvable dependencies.', error: 'DEPENDENCY_DEADLOCK' };
      }

      hasProgress = false;

      // Execute ready nodes sequentially (or topologically)
      for (const node of readyNodes) {
        if (options.signal?.aborted) break;
        hasProgress = true;
        node.status = 'RUNNING';
        node.startedAt = Date.now();

        // 1. Resolve inputs from upstream dependencies
        this.resolveNodeInputs(node, activeNodes);

        // Milestone progress
        const milestoneMsg = this.describeNodeMilestone(node);
        if (milestoneMsg) {
          emitEvent({
            nodeId: node.id,
            phase: 'MILESTONE',
            userFacingMessage: milestoneMsg,
          });
        }

        // 2. Execute node with bounded retries
        const maxRetries = node.retryPolicy?.maxRetries ?? 2;
        let attempt = 0;
        let nodeSuccess = false;

        while (attempt <= maxRetries && !nodeSuccess) {
          if (options.signal?.aborted) break;
          attempt++;
          node.retryCount = attempt;
          node.workerId = this.workerId;
          // This policy permits reporting handler results, never independent promotion.
          node.executionPolicy = { reference: 'task-graph-handler-result', version: 1,
            approvalState: (node.operation === 'LOCAL_FILE_OPERATION' && ['read', 'verify', 'locate', 'create', 'update'].includes(node.inputs.request?.action)) || node.operation === 'PRESENT_RESULT'
              ? 'NOT_REQUIRED' : 'REQUIRED_NOT_VERIFIED' };
          appendGraphEvidence(graph,'NODE_ATTEMPT_STARTED');

          try {
            const result = await withNodeExecution(graph, node, options.signal, () => this.executeNodeOperation(node, options), this.workerId);
            if (result.success && !options.signal?.aborted) {
              node.outputs = { ...(node.outputs || {}), ...result.outputs };
              // Handler output (including outputs.verified) is untrusted for promotion.
              // No independent observer is enrolled in this execution path yet.
              node.status = 'SUCCEEDED';
              node.completedAt = Date.now();
              nodeSuccess = true;
              appendGraphEvidence(graph,'NODE_SUCCEEDED_WITHOUT_INDEPENDENT_VERIFICATION');
              logger.info(`[TaskGraphExecutor] Node ${node.id} SUCCEEDED without independent verification on attempt ${attempt}`);
            } else {
              node.error = result.error || 'Execution failed';
              appendGraphEvidence(graph,'NODE_ATTEMPT_FAILED');
              logger.warn(`[TaskGraphExecutor] Node ${node.id} attempt ${attempt} failed:`, node.error);
              if (attempt <= maxRetries) {
                const backoff = node.retryPolicy?.backoffMs ?? 500;
                await new Promise(r => setTimeout(r, backoff));
              }
            }
          } catch (err: any) {
            node.error = err?.message || String(err);
            appendGraphEvidence(graph,'NODE_ATTEMPT_ERROR');
            logger.warn(`[TaskGraphExecutor] Node ${node.id} error:`, node.error);
            if (attempt <= maxRetries) {
              await new Promise(r => setTimeout(r, 500));
            }
          }
        }

        if (options.signal?.aborted) break;
        if (!nodeSuccess) {
          node.status = 'FAILED';
          lastError = node.error;
          graph.status = 'FAILED';
          emitEvent({
            nodeId: node.id,
            phase: 'FAILED',
            userFacingMessage: `Failed while ${node.operation}: ${node.error}`,
          });
          return { success: false, graph, resultSummary: `Step ${node.id} failed.`, error: lastError };
        }
      }
    }

    if (options.signal?.aborted) {
      graph.status = 'CANCELLED';
      return { success: false, graph, resultSummary: 'Task cancelled.', error: 'ABORTED' };
    }
    graph.status = 'FAILED';
    return { success: false, graph, resultSummary: 'Task failed to complete.', error: lastError || 'UNKNOWN' };
  }

  /**
   * Resolve typed inputs and artifact references from upstream completed nodes.
   */
  private resolveNodeInputs(node: TaskNode, allNodes: Map<string, TaskNode>): void {
    for (const depId of node.dependsOn) {
      const depNode = allNodes.get(depId);
      if (!depNode || !depNode.outputs) continue;

      // Pass forward any artifact references
      if (depNode.outputs.artifact && !node.inputs.sourceArtifact) {
        node.inputs.sourceArtifact = depNode.outputs.artifact;
      }
      if (depNode.outputs.artifactId && !node.inputs.sourceArtifactId) {
        node.inputs.sourceArtifactId = depNode.outputs.artifactId;
      }
      if (depNode.outputs.messages && !node.inputs.messages) {
        node.inputs.messages = depNode.outputs.messages;
      }
      if (depNode.outputs.messagesText && !node.inputs.messagesText) {
        node.inputs.messagesText = depNode.outputs.messagesText;
      }
      if (depNode.outputs.chatTitle && !node.inputs.chatTitle) {
        node.inputs.chatTitle = depNode.outputs.chatTitle;
      }
      if (depNode.outputs.presentationText) node.inputs.presentationText = depNode.outputs.presentationText;
    }
  }

  /**
   * Execute physical operation for a node.
   */
  private async executeNodeOperation(
    node: TaskNode,
    options: TaskGraphExecutionOptions
  ): Promise<{ success: boolean; outputs?: Record<string, any>; error?: string }> {
    const { capability, operation, inputs } = node;

      switch (operation) {
      case 'GITHUB_EVALUATE': {
        const { evaluateSelectedRepository } = await import('../../repositoryResearch/evaluation.js');
        const report = await evaluateSelectedRepository({ conversationId: options.conversationId || '', goalId: inputs.goalId, signal: options.signal,
          onProgress: message => options.onProgress?.({ graphId: inputs.graphId, goalId: inputs.goalId, nodeId: node.id, phase: 'MILESTONE', userFacingMessage: message, timestamp: Date.now() }) });
        return { success: true, outputs: { presentationText: report.presentationText, evaluationReport: report } };
      }
      case 'GITHUB_RESEARCH': {
        const { runRepositoryResearch } = await import('../../repositoryResearch/service.js');
        const focused = /\b(?:one|single|1)\b.{0,45}\b(?:repository|repo|candidate)\b/i.test(inputs.goal);
        const report = await runRepositoryResearch({ goalId: inputs.goalId, goal: inputs.goal, depth: 'source', signal: options.signal,
          ...(focused ? { candidateLimit: 20, sourceReviewLimit: 1, budgetMs: 60_000 } : {}),
          onProgress: message => options.onProgress?.({ graphId: inputs.graphId, goalId: inputs.goalId, nodeId: node.id,
            phase: 'MILESTONE', userFacingMessage: message, timestamp: Date.now() }) });
        return { success: true, outputs: { presentationText: report.presentationText, researchReportId: report.id, researchReport: report } };
      }
      case 'YOUTUBE_OPEN_HOME':
      case 'YOUTUBE_SEARCH_CHANNEL':
      case 'YOUTUBE_OPEN_CHANNEL':
      case 'YOUTUBE_OPEN_VIDEO': {
        const result = await browserCapabilityAdapter.executeYouTubeStage(operation, inputs.channel, options.signal, options.conversationId);
        return result.success && result.verified
          ? { success: true, outputs: { presentationText: result.outputText, browserEvidence: result.verificationEvidence } }
          : { success: false, error: result.failureReason || 'YouTube step could not be verified.' };
      }
      // ── CAMERA CAPTURE ──
      case 'CAMERA_CAPTURE': {
        const prompt = inputs.prompt || 'Capture current object';
        const captureRes = await universalPerceptionService.captureCameraArtifact({
          taskId: node.id,
          prompt,
        });

        if (!captureRes.success || !captureRes.artifact) {
          return { success: false, error: captureRes.error || 'Failed to capture frame from camera sensor' };
        }

        return {
          success: true,
          outputs: {
            artifact: captureRes.artifact,
            artifactId: captureRes.artifact.artifactId,
            location: captureRes.artifact.location,
            sha256: captureRes.artifact.sha256,
          },
        };
      }

      // ── IMAGE GENERATE / EDIT ──
      case 'IMAGE_GENERATE':
      case 'IMAGE_EDIT': {
        const prompt = inputs.prompt || 'Cinematic advertisement for object';
        const sourceArt = inputs.sourceArtifact || (inputs.sourceArtifactId ? artifactStore.getArtifact(inputs.sourceArtifactId) : undefined);

        const genRes = await mediaCapabilityAdapter.generateImage({
          taskId: node.id,
          prompt,
          operation: operation === 'IMAGE_EDIT' ? 'IMAGE_EDIT' : 'IMAGE_GENERATE',
          sourceImageArtifact: sourceArt,
          styleInstructions: inputs.styleInstructions || 'cinematic lighting, professional commercial, 8k',
          dimensions: inputs.dimensions || { width: 1024, height: 1024 },
          signal: options.signal,
        });

        if (!genRes.success || !genRes.artifact) {
          return { success: false, error: genRes.error || 'Media generation failed' };
        }

        return {
          success: true,
          outputs: {
            artifact: genRes.artifact,
            artifactId: genRes.artifact.artifactId,
            location: genRes.artifact.location,
          },
        };
      }

      // ── ARTIFACT VERIFICATION ──
      case 'VERIFY_ARTIFACT': {
        const artifactId = inputs.artifactId || inputs.sourceArtifactId || inputs.sourceArtifact?.artifactId;
        if (!artifactId) {
          return { success: false, error: 'No artifactId provided to verify' };
        }
        const verifyRes = artifactStore.verifyArtifactOnDisk(artifactId);
        if (!verifyRes.verified) {
          return { success: false, error: verifyRes.error || 'Artifact missing on disk' };
        }
        return {
          success: true,
          outputs: { verified: true, artifact: verifyRes.artifact },
        };
      }

      // ── APPLICATION ACTIVATION / LAUNCH ──
      case 'OPEN_APPLICATION': {
        const app = inputs.application || inputs.target || 'Telegram';
        const stepIntent = {
          action: 'OPEN_APPLICATION' as const,
          application: app,
          target: app,
          rawPrompt: `Open ${app}`,
          confidence: 1.0,
        };

        const res = await appCapabilityAdapter.execute(stepIntent as any, node.id, options.conversationId || 'default');
        if (!res.success || !res.verified || options.signal?.aborted) {
          return { success: false, error: res.failureReason || `Could not open ${app}` };
        }
        if (res.contextMutation) authoritativeInteractionContext.recordVerifiedStepSuccess(options.conversationId || 'default', -1, res.contextMutation);
        return {
          success: true,
          outputs: { application: app, hwnd: (res.verificationEvidence?.data as any)?.hwnd, presentationText: res.outputText },
        };
      }

      // ── CHAT OPEN / LOCATE ──
      case 'OPEN_CHAT': {
        const app = inputs.application || 'Telegram';
        const chat = inputs.chat || inputs.target || 'AgenticOS';
        const stepIntent = {
          action: 'OPEN_CHAT' as const,
          application: app,
          target: chat,
          rawPrompt: `Open chat ${chat}`,
          confidence: 1.0,
        };

        const res = await chatCapabilityAdapter.execute(stepIntent as any, node.id, options.conversationId || 'default');
          if (!res.success || !res.verified || options.signal?.aborted) {
            return { success: false, error: res.failureReason || `Could not locate chat ${chat}` };
          }
          if (res.contextMutation) authoritativeInteractionContext.recordVerifiedStepSuccess(options.conversationId || 'default', -1, res.contextMutation);
        return {
          success: true,
          outputs: { chat, verified: res.verified, presentationText: res.outputText },
        };
      }

      // ── READ MESSAGES ──
      case 'READ_MESSAGES': {
        const app = inputs.application || 'Telegram';
        const chat = inputs.chat || inputs.target || 'AgenticOS';
        const count = inputs.count || 4;
        const stepIntent = {
          action: 'READ_MESSAGES' as const,
          application: app,
          target: chat,
          count,
          rawPrompt: `Read last ${count} messages`,
          confidence: 1.0,
        };

        const res = await chatCapabilityAdapter.execute(stepIntent as any, node.id, options.conversationId || 'default');
          if (!res.success || !res.verified || options.signal?.aborted) {
            return { success: false, error: res.failureReason || `Could not read messages in ${chat}` };
          }
          if (res.contextMutation) authoritativeInteractionContext.recordVerifiedStepSuccess(options.conversationId || 'default', -1, res.contextMutation);
        return {
          success: true,
          outputs: {
            messagesText: res.outputText,
            messagesCount: count,
          },
        };
      }

      case 'LOCAL_FILE_OPERATION': return executeLocalFileRequest(inputs.request, options.conversationId || 'default', options.signal);
      case 'EXECUTE_COMPILED_PLAN': {
        options.signal?.throwIfAborted();
        const steps = inputs.steps as readonly CompiledTurnIntent[];
        const conversationId = options.conversationId || 'default';
        const result = await capabilityDispatcher.executePlan(Object.freeze({
          turnId: node.id, conversationId, source: 'system' as const,
          rawText: inputs.rawPrompt, normalizedText: inputs.normalizedPrompt,
          timestamp: new Date().toISOString(), interactionContextId: conversationId,
          compiledIntent: steps[0], compiledPlan: steps,
        }), { signal: options.signal, isStale: () => Boolean(options.signal?.aborted) });
        options.signal?.throwIfAborted();
        return result.completedSuccessfully && result.verifiedSteps.length === steps.length
          ? { success: true, outputs: { verified: true, presentationText: result.responseText } }
          : { success: false, error: result.failedStep?.reason || 'The installed operation could not be verified.' };
      }
      case 'UNSUPPORTED_GOAL':
        return { success: false, error: 'No executable workflow is available for this autonomous request.' };

      // ── PRESENT RESULT ──
      case 'PRESENT_RESULT': {
        const art = inputs.sourceArtifact || (inputs.sourceArtifactId ? artifactStore.getArtifact(inputs.sourceArtifactId) : undefined);
        const msg = inputs.messagesText;
        const speech = art
          ? 'The generated image is ready for you to review.'
          : (inputs.presentationText || msg || 'Your request is complete.');

        return {
          success: true,
          outputs: { presentationText: speech },
        };
      }

      default: {
        if (process.env.NODE_ENV === 'test' && (operation.startsWith('STEP_') || operation.startsWith('TEST_') || operation === 'CUSTOM')) {
          return { success: true, outputs: { operation, completedAt: Date.now() } };
        }
        return { success: false, error: `Unknown TaskNode operation: ${operation}` };
      }
    }
  }

  /**
   * Generates meaningful human progress announcements for milestones.
   */
  private describeNodeMilestone(node: TaskNode): string | null {
    switch (node.operation) {
      case 'LOCAL_FILE_OPERATION': return 'I am checking the requested file on this computer.';
      case 'EXECUTE_COMPILED_PLAN': return 'I am using the installed tools and will verify the result.';
      case 'GITHUB_EVALUATE': return null; // The executor reports actual container stages.
      case 'GITHUB_RESEARCH': return 'I am researching matching repositories. I will report the best supported candidate and what remains untested.';
      case 'YOUTUBE_OPEN_HOME': return 'Opening YouTube.';
      case 'YOUTUBE_SEARCH_CHANNEL': return `Searching YouTube for ${node.inputs.channel}.`;
      case 'YOUTUBE_OPEN_CHANNEL': return `I'm locating the matching YouTube channel.`;
      case 'YOUTUBE_OPEN_VIDEO': return `The channel is verified. I'm opening one of its videos.`;
      case 'CAMERA_CAPTURE':
        return "I'm capturing the frame from the camera.";
      case 'IMAGE_GENERATE':
      case 'IMAGE_EDIT':
        return "The camera frame is saved. I'm checking whether a real generator can use it.";
      case 'OPEN_APPLICATION':
        return `Opening ${node.inputs.application || 'the application'}.`;
      case 'OPEN_CHAT':
        return `I'm locating ${node.inputs.chat || node.inputs.target || 'the conversation'} in ${node.inputs.application || 'Telegram'}.`;
      case 'READ_MESSAGES':
        return `I found the conversation. I'm reading the last ${node.inputs.count || 4} messages.`;
      case 'VERIFY_ARTIFACT':
        return "Verifying the generated artifact.";
      default:
        return null;
    }
  }
}

export const taskGraphExecutor = TaskGraphExecutor.getInstance();
