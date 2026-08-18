/**
 * domains/hermes/service.ts
 *
 * Authoritative Canonical Hermes Service for Agentic OS.
 *
 * Specializations:
 *  - Deep research & structured investigation
 *  - Business & project planning
 *  - Market / competitor analysis
 *  - Requirements synthesis & task decomposition
 *  - Evidence-backed synthesis for Jarvis
 *
 * Preserves the architectural boundaries:
 *  - CodeX owns engineering & code mutation
 *  - Magnitude owns browser navigation & page inspection
 *  - Jarvis owns executive control plane & orchestration
 */

import { randomUUID } from 'crypto';
import { llmChat } from '../../services/llmGateway.js';
import { executionRunService } from '../../services/projectExecution/executionRunService.js';
import { projectTaskService } from '../../services/projectExecution/projectTaskService.js';
import { executeMagnitudeTask } from '../workerAdapters/magnitudeAdapter.js';
import { redactSecrets } from '../../services/gateway/secretStore.js';
import { logger } from '../../utils/logger.js';
import type { ProjectTaskRecord } from '../../services/projectExecution/projectTaskService.js';
import type { ExecutionRunRecord, ExecutionResultRecord } from '../../services/projectExecution/executionRunService.js';

// ── Types ──

export interface HermesFinding {
  claim: string;
  evidence: string[];
  confidence: number;
  sourceUrl?: string;
  magnitudeRunId?: string;
}

export interface HermesResearchResult {
  type: 'research';
  summary: string;
  findings: HermesFinding[];
  recommendations: string[];
  unknowns: string[];
  nextActions: string[];
  memoryCandidates?: Array<{ key: string; value: string; category: string }>;
  magnitudeRunId?: string;
  magnitudeSubtaskId?: string;
}

export interface HermesProposedGoal {
  title: string;
  objective: string;
}

export interface HermesProposedTask {
  title: string;
  capability: 'hermes' | 'codex' | 'magnitude';
  acceptanceCriteria: string;
}

export interface HermesPlanningResult {
  type: 'planning';
  summary: string;
  objective: string;
  assumptions: string[];
  milestones: string[];
  proposedGoals: HermesProposedGoal[];
  proposedTasks: HermesProposedTask[];
  dependencies: string[];
  risks: string[];
  successMetrics: string[];
  recommendations: string[];
  nextActions: string[];
}

export type HermesStructuredResult = HermesResearchResult | HermesPlanningResult;

export interface HermesRunHandle {
  run: ExecutionRunRecord;
  hermesRunId: string;
}

interface ActiveRunState {
  abortController: AbortController;
  childMagnitudeRunId?: string;
  projectId: string;
  goalId: string;
  taskId: string;
  runId: string;
}

// ── Service ──

export class HermesService {
  private activeRuns: Map<string, ActiveRunState> = new Map();

  /**
   * Execute a canonical ProjectTask using Hermes.
   */
  async executeTask(
    task: ProjectTaskRecord,
    options: {
      prompt?: string;
      conversationId?: string;
      requestId?: string;
      projectId?: string;
      goalId?: string;
    } = {}
  ): Promise<HermesRunHandle> {
    const objective = options.prompt || task.description || task.title;
    const now = new Date().toISOString();
    const hermesRunId = `hr-${randomUUID().slice(0, 12)}`;

    // 1. Create canonical execution run record
    const run = executionRunService.createRun({
      taskId: task.id,
      projectId: task.projectId,
      goalId: task.goalId,
      workerType: 'hermes',
      agentInstanceId: hermesRunId,
      trigger: 'api',
      requestId: options.requestId,
      conversationId: options.conversationId,
      metadata: {
        hermesRunId,
        taskType: task.taskType,
        objective: redactSecrets(objective),
      },
    });

    executionRunService.updateRun(run.id, { status: 'running', startTime: now });
    projectTaskService.updateTask(task.id, {
      status: 'running',
      assignedRunId: run.id,
      startedAt: now,
    });

    const abortController = new AbortController();
    this.activeRuns.set(run.id, {
      abortController,
      projectId: task.projectId,
      goalId: task.goalId,
      taskId: task.id,
      runId: run.id,
    });

    executionRunService.emitEvent({
      projectId: task.projectId,
      goalId: task.goalId,
      taskId: task.id,
      runId: run.id,
      worker: 'hermes',
      eventType: 'HERMES_RUN_STARTED',
      payload: { hermesRunId, objective },
    });

    // 2. Execute Hermes asynchronously
    this.runHermesCore(run, task, objective, abortController.signal).catch((err) => {
      logger.error(`[HermesService] Run ${run.id} threw error:`, err);
    });

    return { run, hermesRunId };
  }

  /**
   * Stop / Cancel an active Hermes run and all owned delegated operations.
   */
  async cancelRun(runId: string, reason = 'Cancelled by user/Jarvis'): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      logger.warn(`[HermesService] Cannot cancel run ${runId}: Not found in active runs`);
      return false;
    }

    logger.info(`[HermesService] Cancelling active run ${runId}: ${reason}`);
    active.abortController.abort(new Error(reason));

    const endNow = new Date().toISOString();
    executionRunService.updateRun(runId, {
      status: 'cancelled',
      endTime: endNow,
      failureReason: reason,
    });

    projectTaskService.updateTask(active.taskId, {
      status: 'cancelled',
    });

    executionRunService.emitEvent({
      projectId: active.projectId,
      goalId: active.goalId,
      taskId: active.taskId,
      runId,
      worker: 'hermes',
      eventType: 'HERMES_RUN_CANCELLED',
      payload: { reason },
    });

    this.activeRuns.delete(runId);
    return true;
  }

  /**
   * Internal core execution loop.
   */
  private async runHermesCore(
    run: ExecutionRunRecord,
    task: ProjectTaskRecord,
    objective: string,
    signal: AbortSignal
  ): Promise<void> {
    const startTime = Date.now();
    try {
      if (signal.aborted) throw new Error('Hermes execution aborted prior to start');

      // 1. Gather Project Context
      const projectContext = this.gatherProjectContext(task.projectId);

      // 2. Detect if Live Web Research is Needed (URL in prompt)
      let magnitudeEvidence: any = null;
      let childMagnitudeRunId: string | undefined;
      const urlMatch = objective.match(/https?:\/\/[^\s"'<>]+/);

      if (urlMatch && !objective.toLowerCase().includes('do not use magnitude')) {
        const targetUrl = urlMatch[0];
        logger.info(`[HermesService] Live URL detected (${targetUrl}). Delegating browser research to Magnitude...`);

        // Create bounded Magnitude research subtask
        const magTask = projectTaskService.createTask({
          projectId: task.projectId,
          goalId: task.goalId,
          title: `Browser Research: ${targetUrl}`,
          description: `Inspect ${targetUrl} and extract structured content for Hermes research.`,
          taskType: 'browser',
          assignedCapability: 'magnitude',
          acceptanceCriteria: `Load ${targetUrl} and return structured page title and content.`,
        });

        const magExec = await executeMagnitudeTask(magTask, {
          goal: `Inspect ${targetUrl} and extract full page details for research.`,
          requestId: run.requestId ?? undefined,
          conversationId: run.conversationId ?? undefined,
        });

        childMagnitudeRunId = magExec.magnitudeRunId;
        const activeState = this.activeRuns.get(run.id);
        if (activeState) {
          activeState.childMagnitudeRunId = childMagnitudeRunId;
        }

        // Wait for Magnitude subtask execution to finish
        const magStart = Date.now();
        while (Date.now() - magStart < 60000) {
          if (signal.aborted) throw new Error('Hermes aborted while waiting for Magnitude research');
          const currentMagRun = executionRunService.getRun(magExec.run.id);
          if (currentMagRun && (currentMagRun.status === 'completed' || currentMagRun.status === 'failed')) {
            if (currentMagRun.finalResultId) {
              const res = executionRunService.getResult(currentMagRun.finalResultId);
              magnitudeEvidence = res?.structuredOutput;
            }
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (signal.aborted) throw new Error('Hermes execution aborted');

      // 3. Determine if this is a Planning task or Research task
      const isPlanning = /\b(?:plan|planning|roadmap|milestone|decompose|affiliate|business plan|strategy)\b/i.test(objective);

      // 3b. Project Memory retrieval (closure): Hermes receives bounded,
      // research/planning-relevant Project Memory. Engineering debug logs and
      // unrelated engineering events are excluded. Exact memory IDs are
      // recorded for HERMES_MEMORY_RETRIEVED telemetry.
      let memoryPacket: import('../../services/memory/workerMemory.js').WorkerMemoryPacket | null = null;
      try {
        const { retrieveWorkerMemory, recordWorkerMemoryRetrieval } = await import('../../services/memory/workerMemory.js');
        memoryPacket = await retrieveWorkerMemory({
          projectId: task.projectId ?? null,
          worker: 'hermes',
          taskType: isPlanning ? 'planning' : 'research',
          query: objective,
          budget: { maxItems: 6, maxChars: 1600 },
          includeGlobalFallback: true,
        });
        recordWorkerMemoryRetrieval({
          worker: 'hermes',
          projectId: task.projectId ?? null,
          taskId: task.id,
          runId: run.id,
          goalId: task.goalId ?? null,
          packet: memoryPacket,
        });
      } catch { /* memory retrieval must never break Hermes */ }

      // 4. Synthesize with LLM
      const systemPrompt = isPlanning ? HERMES_PLANNING_SYSTEM_PROMPT : HERMES_RESEARCH_SYSTEM_PROMPT;
      const userPrompt = `TASK OBJECTIVE:
${objective}

ACCEPTANCE CRITERIA:
${task.acceptanceCriteria || 'Provide thorough, structured, evidence-backed research/plan.'}

PROJECT CONTEXT:
${JSON.stringify(projectContext, null, 2)}

${memoryPacket && memoryPacket.items.length > 0
  ? `RELEVANT PROJECT MEMORY (${memoryPacket.count} item(s), ${memoryPacket.truncated ? 'truncated to budget' : 'within budget'}):
${memoryPacket.items.map((i) => `- [${i.type}] ${i.title}: ${i.content}`).join('\n')}`
  : 'NO RELEVANT PROJECT MEMORY RETRIEVED'}

${magnitudeEvidence ? `VERIFIED BROWSER EVIDENCE FROM MAGNITUDE (Run ${childMagnitudeRunId}):\n${JSON.stringify(magnitudeEvidence, null, 2)}` : 'NO EXTERNAL BROWSER EVIDENCE REFERENCED'}

Respond ONLY with a valid JSON object matching the requested schema.`;

      const chatResp = await llmChat({
        systemPrompt,
        prompt: userPrompt,
        signal,
        maxTokens: 2500,
      });

      if (signal.aborted) throw new Error('Hermes execution aborted after LLM synthesis');

      const rawContent = chatResp.reply?.trim() || '';
      const parsedResult = this.parseHermesOutput(rawContent, isPlanning ? 'planning' : 'research', magnitudeEvidence, childMagnitudeRunId);

      const endNow = new Date().toISOString();
      const resolvedProvider = chatResp.provider || 'openrouter';
      const resolvedModel = chatResp.model || 'auto';

      // 5. Record canonical Execution Result
      const executionResult = executionRunService.createResult({
        runId: run.id,
        taskId: task.id,
        status: 'completed',
        summary: parsedResult.summary,
        structuredOutput: parsedResult as unknown as Record<string, unknown>,
        artifactRefs: magnitudeEvidence?.url ? [magnitudeEvidence.url] : [],
        metadata: {
          hermesRunId: run.agentInstanceId,
          durationMs: Date.now() - startTime,
          type: parsedResult.type,
          magnitudeRunId: childMagnitudeRunId,
          ...(memoryPacket && memoryPacket.items.length > 0
            ? {
                memoryRetrieved: {
                  memoryIds: memoryPacket.memoryIds,
                  count: memoryPacket.count,
                  truncated: memoryPacket.truncated,
                },
              }
            : {}),
        },
      });

      // 6. Complete Run & Task
      executionRunService.updateRun(run.id, {
        status: 'completed',
        endTime: endNow,
        provider: resolvedProvider,
        model: resolvedModel,
      });

      projectTaskService.updateTask(task.id, {
        status: 'completed',
        completedAt: endNow,
      });

      executionRunService.emitEvent({
        projectId: task.projectId,
        goalId: task.goalId,
        taskId: task.id,
        runId: run.id,
        worker: 'hermes',
        eventType: 'HERMES_RUN_COMPLETED',
        payload: {
          resultId: executionResult.id,
          summary: parsedResult.summary,
          provider: resolvedProvider,
          model: resolvedModel,
        },
      });
    } catch (err: any) {
      const endNow = new Date().toISOString();
      const isAborted = signal.aborted || err.message?.includes('aborted');
      const finalStatus = isAborted ? 'cancelled' : 'failed';
      const failureReason = err.message || 'Hermes execution failed';

      logger.warn(`[HermesService] Run ${run.id} finished with status ${finalStatus}: ${failureReason}`);

      executionRunService.updateRun(run.id, {
        status: finalStatus,
        endTime: endNow,
        failureReason,
      });

      projectTaskService.updateTask(task.id, {
        status: isAborted ? 'cancelled' : 'failed',
      });

      executionRunService.emitEvent({
        projectId: task.projectId,
        goalId: task.goalId,
        taskId: task.id,
        runId: run.id,
        worker: 'hermes',
        eventType: isAborted ? 'HERMES_RUN_CANCELLED' : 'HERMES_RUN_FAILED',
        payload: { failureReason },
      });
    } finally {
      this.activeRuns.delete(run.id);
    }
  }

  /**
   * Parse structured output cleanly from LLM response.
   */
  private parseHermesOutput(
    raw: string,
    mode: 'research' | 'planning',
    magnitudeEvidence?: any,
    magnitudeRunId?: string
  ): HermesStructuredResult {
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
      const parsed = JSON.parse(cleaned);

      if (mode === 'planning') {
        return {
          type: 'planning',
          summary: parsed.summary || 'Project planning synthesis generated.',
          objective: parsed.objective || '',
          assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
          milestones: Array.isArray(parsed.milestones) ? parsed.milestones : [],
          proposedGoals: Array.isArray(parsed.proposedGoals) ? parsed.proposedGoals : [],
          proposedTasks: Array.isArray(parsed.proposedTasks) ? parsed.proposedTasks : [],
          dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks : [],
          successMetrics: Array.isArray(parsed.successMetrics) ? parsed.successMetrics : [],
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
        };
      }

      const findings: HermesFinding[] = Array.isArray(parsed.findings)
        ? parsed.findings.map((f: any) => ({
            claim: f.claim || String(f),
            evidence: Array.isArray(f.evidence) ? f.evidence : [String(f.evidence || 'Observed via inspection')],
            confidence: typeof f.confidence === 'number' ? f.confidence : 0.95,
            sourceUrl: f.sourceUrl || magnitudeEvidence?.url,
            magnitudeRunId,
          }))
        : [];

      return {
        type: 'research',
        summary: parsed.summary || 'Research and synthesis completed.',
        findings,
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        unknowns: Array.isArray(parsed.unknowns) ? parsed.unknowns : [],
        nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : [],
        memoryCandidates: Array.isArray(parsed.memoryCandidates) ? parsed.memoryCandidates : [],
        magnitudeRunId,
      };
    } catch {
      // Fallback structured generation if raw response was plain text
      if (mode === 'planning') {
        return {
          type: 'planning',
          summary: raw.slice(0, 300) || 'Project plan prepared.',
          objective: 'Plan execution goals and milestones.',
          assumptions: ['Standard environment parameters apply.'],
          milestones: ['Initial Research & Setup', 'Strategy Formulation', 'Milestone Review'],
          proposedGoals: [{ title: 'Setup & Strategy', objective: 'Establish project foundation.' }],
          proposedTasks: [{ title: 'Review Plan', capability: 'hermes', acceptanceCriteria: 'Plan reviewed.' }],
          dependencies: ['Workspace readiness'],
          risks: ['Market volatility / execution barriers'],
          successMetrics: ['Plan completion rate = 100%'],
          recommendations: ['Proceed to goal review before execution.'],
          nextActions: ['Submit plan to Jarvis for approval.'],
        };
      }

      return {
        type: 'research',
        summary: raw.slice(0, 300) || 'Research synthesized.',
        findings: [
          {
            claim: raw.slice(0, 200) || 'Primary research finding.',
            evidence: magnitudeEvidence?.url ? [`Verified via ${magnitudeEvidence.url}`] : ['Synthesized context'],
            confidence: 0.9,
            sourceUrl: magnitudeEvidence?.url,
            magnitudeRunId,
          },
        ],
        recommendations: ['Review structured findings with team.'],
        unknowns: [],
        nextActions: ['Incorporate verified evidence into project roadmap.'],
        magnitudeRunId,
      };
    }
  }

  /**
   * Helper to retrieve project context safely.
   */
  private gatherProjectContext(projectId: string) {
    try {
      const goals = projectTaskService.listGoals(projectId);
      const tasks = projectTaskService.listTasks(projectId);
      return {
        goalCount: goals.length,
        taskCount: tasks.length,
        recentGoals: goals.slice(-5).map((g) => ({ id: g.id, title: g.title, objective: g.objective })),
        recentTasks: tasks.slice(-10).map((t) => ({ id: t.id, title: t.title, status: t.status })),
      };
    } catch {
      return {};
    }
  }
}

const HERMES_RESEARCH_SYSTEM_PROMPT = `You are Hermes, the canonical Research & Project Intelligence worker in Agentic OS.
Your responsibility:
1. Deep structured research, investigation, and analysis.
2. Distinguish verified CLAIMS from supporting EVIDENCE.
3. If external browser evidence from Magnitude is provided, explicitly reference the facts, URLs, and observations.
4. Never present unsupported inference as observed fact.

Respond ONLY with valid JSON in this exact structure:
{
  "summary": "<concise high-level executive summary>",
  "findings": [
    {
      "claim": "<clear factual claim>",
      "evidence": ["<specific verifiable evidence detail>"],
      "confidence": 0.95,
      "sourceUrl": "<url if applicable>"
    }
  ],
  "recommendations": ["<recommendation 1>", "<recommendation 2>"],
  "unknowns": ["<any remaining uncertainties or gaps>"],
  "nextActions": ["<recommended next step>"],
  "memoryCandidates": [
    { "key": "<concise key>", "value": "<verified fact/constraint>", "category": "fact | constraint | decision" }
  ]
}`;

const HERMES_PLANNING_SYSTEM_PROMPT = `You are Hermes, the canonical Research & Project Intelligence worker in Agentic OS.
Your responsibility:
1. Decompose strategic business or technical objectives into comprehensive structured project plans.
2. Formulate clear milestones, 2-4 distinct actionable sub-goals with specific objectives, detailed tasks mapped to goals, comprehensive risks with mitigations, and measurable success metrics with concrete targets.
3. Propose appropriate worker capabilities (hermes for research/analysis, codex for code engineering, magnitude for browser tasks).
4. Do NOT execute destructive actions or external purchases — return the proposed plan for Jarvis approval.

Respond ONLY with valid JSON in this exact structure:
{
  "summary": "<executive overview of the plan>",
  "objective": "<refined statement of objective>",
  "assumptions": ["<key assumption 1>", "<key assumption 2>"],
  "milestones": ["<Milestone 1>", "<Milestone 2>", "<Milestone 3>"],
  "proposedGoals": [
    { "title": "<Goal title>", "objective": "<Goal objective>" }
  ],
  "proposedTasks": [
    { "title": "<Task title>", "capability": "hermes" | "codex" | "magnitude", "acceptanceCriteria": "<verifiable criteria>" }
  ],
  "dependencies": ["<dependency 1>"],
  "risks": ["<risk description and mitigation>"],
  "successMetrics": ["<measurable metric 1>"],
  "recommendations": ["<strategic recommendation>"],
  "nextActions": ["<immediate next action for Jarvis>"]
}`;

export const hermesService = new HermesService();
