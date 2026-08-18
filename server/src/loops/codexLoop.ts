import { logger } from '../utils/logger.js';
import { AgentProviderAssignmentService, mapCatalogToGatewayId } from '../services/agent/assignments.js';
import fs from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import { parseToolCall, type ParsedToolCall } from './toolCallParser.js';
import { llmChat, type LlmChatOptions } from '../services/llmGateway.js';

import { goalStore } from '../services/goalStore.js';
import { enforceWorkspacePath, validatePostWrite, runSandboxedCommand, captureWorkspaceSnapshot } from '../utils/sandbox.js';
import { getWorkspaceRoot, resolveFileReference, resolveWorkspacePath } from '../services/workspaceStore.js';
import { detectShellFileIo } from '../utils/nativeToolGuard.js';
import type { GoalState, GoalEvent, AgentExecutionContext } from '../types.js';
import { goalControllers } from '../services/goalStore.js';
import { db } from '../db/index.js';
import { providerCircuitBreakers, agentTeamArtifacts, verificationReports, agentTeamHandoffs } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
const CODEX_LLM_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.AGENT_TEAMS_AGENT_TIMEOUT_MS ?? '90000', 10);
  return Number.isNaN(parsed) ? 90000 : parsed;
})();

const CODEX_LEASE_DURATION_MS = CODEX_LLM_TIMEOUT_MS + 30000;

// Log lease configuration for debugging
logger.info('CodeX lease configuration', JSON.stringify({
  llmTimeoutMs: CODEX_LLM_TIMEOUT_MS,
  leaseDurationMs: CODEX_LEASE_DURATION_MS
}));
interface ToolCall {
  tool: 'writeFile' | 'readFile' | 'runCommand' | 'reasoningQuery' | 'finish';
  path?: string;
  content?: string;
  cmd?: string;
  args?: string[];
  prompt?: string;
  message?: string;
}

type ResponseExpectation = 'tool_decision' | 'final_answer';

const WRITE_INTENT_RE = /\b(write|modify|edit|update|change|create|delete|remove|patch|replace|append|insert|install|execute|run)\b/i;
const READ_INTENT_RE = /\b(inspect|explain|read|review|analy[sz]e|summari[sz]e|describe|look at|show|tell me how)\b/i;
const FILE_PATH_RE = /\b(?:[A-Za-z]:[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+\b/g;

function removeProtectiveNegations(text: string): string {
  return text
    .replace(/\b(?:do not|does not|don't|doesn't|never|no)\s+(?:require|modify|write|edit|change|create|delete|remove|patch|replace|append|insert|run|execute)\b[^.?!]*/gi, '')
    .replace(/\bwithout\s+(?:modifying|writing|editing|changing|creating|deleting|removing|patching|replacing|appending|inserting|running|executing)\b[^.?!]*/gi, '');
}

function isReadOnlyGoal(goalText: string): boolean {
  if (/\bread-only\b/i.test(goalText)) return true;
  const intentText = removeProtectiveNegations(goalText);
  return READ_INTENT_RE.test(goalText) && !WRITE_INTENT_RE.test(intentText);
}

function extractExplicitReadPath(goalText: string, workspaceRoot?: string): string | null {
  const matches = goalText.match(FILE_PATH_RE) || [];
  for (const raw of matches) {
    const normalized = raw.replace(/\\/g, '/').replace(/[),.;:'"]+$/g, '');
    if (/^[A-Za-z]:\//.test(normalized)) {
      if (!workspaceRoot) continue;
      const relative = path.relative(workspaceRoot, normalized);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replace(/\\/g, '/');
      continue;
    }
    return normalized;
  }
  return null;
}

function responseRequestsFileInspection(response: string): boolean {
  return /\b(need|needs|must|should|would|first|before|unable|cannot|can't)\b[\s\S]{0,120}\b(read|inspect|open|see|access|look at)\b/i.test(response);
}

function isUsefulPlainTextAnalysis(response: string): boolean {
  const trimmed = response.trim();
  if (trimmed.length < 20) return false;
  return !/\b(need|needs|must|should|would|first|before|unable|cannot|can't)\b[\s\S]{0,120}\b(read|inspect|open|see|access|look at)\b/i.test(trimmed);
}

function fallbackToolCallAfterParseFailure(goalText: string, response: string, allowedTools: string[], usedReadFallbacks: Set<string>, workspaceRoot?: string): ParsedToolCall | null {
  if (!isReadOnlyGoal(goalText)) return null;

  const explicitPath = extractExplicitReadPath(goalText, workspaceRoot);
  if (explicitPath && allowedTools.includes('readFile') && !usedReadFallbacks.has(explicitPath) && responseRequestsFileInspection(response)) {
    usedReadFallbacks.add(explicitPath);
    return {
      type: 'tool_call',
      tool: 'readFile',
      arguments: { path: explicitPath }
    };
  }

  if (isUsefulPlainTextAnalysis(response)) {
    return {
      type: 'tool_call',
      tool: 'finish',
      arguments: { message: response.trim() }
    };
  }

  return null;
}

function shouldRequestFinalAnswerAfterTool(goalText: string, tool: string, toolStepCount: number = 1): boolean {
  // Never force final answer prematurely. Allow the model to inspect multiple files naturally.
  // Only suggest synthesis if step count is very high (>= 15 steps) to prevent runaway loops.
  return toolStepCount >= 15;
}

function looksLikeExplicitToolCall(response: string): boolean {
  const trimmed = response.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('```');
}

function isAllowedReadOnlyToolCall(toolCall: ParsedToolCall): boolean {
  return ['readFile', 'searchFiles', 'search_files', 'finish'].includes(toolCall.tool);
}

function buildFinalAnswerPrompt(toolResult: string): string {
  return `Using the tool result below, emit the finish tool call with your complete answer and summary:
{ "type": "tool_call", "tool": "finish", "arguments": { "message": "Your complete answer and summary here" } }

Tool result:
${toolResult}`;
}

function boundToolResult(result: string, maxLength: number = 3000): string {
  if (!result || result.length <= maxLength) return result;
  const headLen = Math.floor(maxLength * 0.6);
  const tailLen = Math.floor(maxLength * 0.35);
  const truncatedChars = result.length - (headLen + tailLen);
  return `${result.substring(0, headLen)}\n\n...[Truncated ${truncatedChars} characters for context efficiency]...\n\n${result.substring(result.length - tailLen)}`;
}

function buildBoundedPrompt(conversation: Array<{ role: string; content: string }>, maxPromptChars: number = 35000): string {
  if (conversation.length <= 4) {
    const full = conversation.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
    if (full.length <= maxPromptChars) return full;
  }

  const first = conversation[0];
  const tail: Array<{ role: string; content: string }> = [];
  let currentLen = `${first.role.toUpperCase()}:\n${first.content}`.length;

  for (let i = conversation.length - 1; i >= 1; i--) {
    const item = conversation[i];
    const itemStr = `${item.role.toUpperCase()}:\n${item.content}`;
    if (currentLen + itemStr.length > maxPromptChars && tail.length >= 2) {
      break;
    }
    tail.unshift(item);
    currentLen += itemStr.length;
  }

  const selected = [first, ...tail];
  return selected.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
}

const DEFAULT_SYSTEM_PROMPT = `You are CodeX, a Restricted Process Runner. Achieve the user's goal autonomously.
CRITICAL: You MUST respond with exactly one valid JSON tool call object and NOTHING ELSE.
Do not use XML tags.
Do not use markdown code fences.
Do not include conversational preamble or explanations before or after the JSON.

Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.

Native tool rules (mandatory):
- To create or modify a file, ALWAYS use the writeFile tool.
- To read or inspect a file, ALWAYS use the readFile tool.
- To discover files in a directory, use listDirectory.
- Use runCommand only for commands that genuinely require a process (builds, tests, package managers, git).
- NEVER use echo, printf, cat, type, Get-Content, PowerShell redirection, or shell redirection for normal file reads/writes. They are blocked by the sandbox.

Tools:
1. writeFile: { "type": "tool_call", "tool": "writeFile", "arguments": { "path": "relative/path/to/file", "content": "file contents" } }
2. readFile: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "relative/path/to/file" } }
3. listDirectory: { "type": "tool_call", "tool": "listDirectory", "arguments": { "path": "relative/path" } }
4. runCommand: { "type": "tool_call", "tool": "runCommand", "arguments": { "cmd": "npm", "args": ["test"] } }
5. reasoningQuery: { "type": "tool_call", "tool": "reasoningQuery", "arguments": { "prompt": "ask OmniRoute for validation" } }
6. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Goal completed." } }
`;

const STRICT_JSON_SYSTEM_PROMPT_SUFFIX = `

CRITICAL RETRY INSTRUCTION: You must return exactly one valid JSON object and nothing else.

Required structure:
{
  "type": "tool_call",
  "tool": "writeFile | readFile | listDirectory | runCommand | reasoningQuery | finish",
  "arguments": {}
}

Do not use XML tags.
Do not use markdown code fences.
Do not include conversational preamble or explanations before or after the JSON.
Use the finish tool only when the requested task has actually been completed.
`;

function buildAgentPrompt(agent: any, originalGoal: string): string {
  const toolsList = agent.allowedTools.map((t: string, i: number) => {
    if (t === 'writeFile' || t === 'write_file') return `${i + 1}. writeFile: { "type": "tool_call", "tool": "writeFile", "arguments": { "path": "relative/path/to/file", "content": "file contents" } }`;
    if (t === 'readFile' || t === 'read_file') return `${i + 1}. readFile: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "relative/path/to/file" } }`;
    if (t === 'runCommand' || t === 'terminal') return `${i + 1}. runCommand: { "type": "tool_call", "tool": "runCommand", "arguments": { "cmd": "npm", "args": ["install", "express"] } }`;
    if (t === 'reasoningQuery') return `${i + 1}. reasoningQuery: { "type": "tool_call", "tool": "reasoningQuery", "arguments": { "prompt": "ask OmniRoute for validation" } }`;
    if (t === 'finish') {
      if (agent.role === 'Verifier') {
        return `${i + 1}. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Verification complete.", "handoff": { "agentId": "verifier", "status": "completed", "summary": "...", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": [] }, "verificationReport": { "passed": true, "summary": "...", "checks": [{ "name": "...", "passed": true, "evidence": "..." }], "blockingIssues": [], "recommendedFixes": [] } } }`;
      }
      return `${i + 1}. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Goal completed.", "handoff": { "agentId": "${agent.id}", "status": "completed", "summary": "...", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": [] } } }`;
    }
    return '';
  }).filter(Boolean);

  return `You are ${agent.name} (${agent.role}). Achieve the user's goal autonomously.
Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.

Goal Context:
${originalGoal}

Instructions:
${agent.instructions}

Responsibilities:
${agent.responsibilities.join('\n')}

Tools:
${toolsList.join('\n')}
${agent.allowedTools.length + 1}. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Verification report or summary" } }
`;
}

interface PushEventOptions {
  operationId?: string;
  eventType?: import('../types.js').EventType;
  normalizedStatus?: import('../types.js').NormalizedStatus;
  lifecycleState?: import('../types.js').LifecycleState;
  userMessage?: string;
  durationMs?: number;
  filePath?: string;
  command?: string;
  provider?: string;
  model?: string;
  nextAction?: string;
  retryCount?: number;
  requiresUserAction?: boolean;
  errorCode?: string;
  errorDetails?: string;
  teamId?: string;
  agentId?: string;
  payload?: any;
}

function pushEventToWriter(writer: any, state: GoalState, message: string, tool?: string, error?: string, opts?: PushEventOptions) {
  writer.push({
    state,
    message,
    provider: opts?.provider,
    model: opts?.model,
    tool,
    error,
    eventType: opts?.eventType,
    normalizedStatus: opts?.normalizedStatus,
    lifecycleState: opts?.lifecycleState,
    userMessage: opts?.userMessage,
    technicalMessage: message,
    durationMs: opts?.durationMs,
    filePath: opts?.filePath,
    command: opts?.command,
    nextAction: opts?.nextAction,
    retryCount: opts?.retryCount,
    requiresUserAction: opts?.requiresUserAction,
    errorCode: opts?.errorCode,
    errorDetails: opts?.errorDetails,
    eventSchemaVersion: 1,
    operationId: opts?.operationId,
    payload: opts?.payload
  });
}

function checkCircuitBreaker(id: string): 'open' | 'half-open' | 'closed' {
  const cb = db.select().from(providerCircuitBreakers).where(eq(providerCircuitBreakers.id, id)).get();
  if (!cb) {
    db.insert(providerCircuitBreakers).values({
      id, provider: id.split('-')[0], model: id.split('-')[1] || 'unknown',
      errorCount: 0, cooldownUntil: null, updatedAt: Date.now().toString()
    }).run();
    return 'closed';
  }
  if (cb.cooldownUntil) {
    if (parseInt(cb.cooldownUntil) > Date.now()) {
      return 'open';
    } else {
      const result = db.run(sql`UPDATE provider_circuit_breakers SET cooldown_until = ${(Date.now() + 10000).toString()}, updated_at = ${Date.now().toString()} WHERE id = ${id} AND cooldown_until = ${cb.cooldownUntil}`);
      if (result.changes > 0) return 'half-open';
      return 'open';
    }
  }
  return 'closed';
}

function recordCircuitBreakerError(id: string) {
  db.run(sql`UPDATE provider_circuit_breakers SET error_count = error_count + 1, updated_at = ${Date.now().toString()} WHERE id = ${id}`);
  const cb = db.select().from(providerCircuitBreakers).where(eq(providerCircuitBreakers.id, id)).get();
  if (cb && cb.errorCount > 3) {
    const cooldown = (Date.now() + 60000).toString();
    db.update(providerCircuitBreakers).set({ cooldownUntil: cooldown, updatedAt: Date.now().toString() }).where(eq(providerCircuitBreakers.id, id)).run();
  }
}

function recordCircuitBreakerSuccess(id: string) {
  db.update(providerCircuitBreakers).set({ errorCount: 0, cooldownUntil: null, updatedAt: Date.now().toString() }).where(eq(providerCircuitBreakers.id, id)).run();
}

async function generateCheckpoint(goalId: string, phase: string, stepId?: string, stepIndex?: number, workspaceRoot?: string) {
  const goal = goalStore.get(goalId);
  if (!goal) return undefined;
  const snapshot = await captureWorkspaceSnapshot(workspaceRoot);
  const ckptId = `ckpt-${goalId}-${Date.now()}`;
  goalStore.createCheckpoint({
    id: ckptId,
    goalId,
    sequenceId: goal.history.length,
    stepId,
    stepIndex,
    goalStatus: goal.status,
    executionPhase: phase,
    workspaceSnapshot: { status: snapshot.status, branch: snapshot.branch },
    workspaceHash: snapshot.hash,
    changedFiles: snapshot.status.split('\n').filter(Boolean).map(l => l.substring(3).trim())
  });
  return ckptId;
}

export async function resumeCodexGoalLoop(goalId: string, context?: AgentExecutionContext) { console.trace('Resuming loop for goal:', goalId);
  const workerId = randomUUID();
  const currentTeamId = context?.teamId;
  const currentAgentId = context?.agentId;
  const writer = goalStore.createEventWriter({ goalId, teamId: currentTeamId, agentId: currentAgentId });

  const initialGoal = goalStore.get(goalId);
  if (!initialGoal) return;
  if (['stopped', 'completed', 'cancelled', 'failed'].includes(initialGoal.status)) {
    logger.info(`[GoalMode] Goal ${goalId} is ${initialGoal.status}; resume skipped until an explicit eligible resume is requested.`);
    return;
  }
  if (!initialGoal.originalGoal?.trim()) {
    goalStore.update(goalId, { status: 'failed' });
    writer.push({
      state: 'failed',
      message: 'CodeX cannot start without a task description.',
      provider: 'ollama',
      // model field removed, rely on routing logic
      eventType: 'task_failed',
      normalizedStatus: 'failed',
      lifecycleState: 'failed',
      errorCode: 'CODEX_EMPTY_TASK'
    });
    return;
  }
  if (initialGoal.status === 'waiting_for_approval') {
    logger.info(`[GoalMode] Goal ${goalId} is waiting for approval; resume skipped until approval is received.`);
    return;
  }

  if (!goalStore.acquireLease(goalId, workerId, CODEX_LEASE_DURATION_MS)) {
    logger.info(`[GoalMode] Goal ${goalId} is already running elsewhere.`);
    return;
  }

  const controller = new AbortController();
  goalControllers.set(goalId, controller);

  // Canonical execution record (coherence milestone): the goal is the
  // operation; the UI reads this record only.
  const exec = await import('../services/executionState.js');
  exec.begin({
    operationId: goalId,
    worker: 'codex',
    status: 'PLANNING',
    currentAction: 'Planning the approach',
    requestedProvider: null,
    requestedModel: null,
    cancel: { kind: 'goal', id: goalId },
  });
  const updateGoalExec = (patch: Parameters<typeof exec.update>[1]) => exec.update(goalId, patch);
  const endGoalExec = (status: 'COMPLETED' | 'FAILED' | 'CANCELLED', result?: string) => exec.end(goalId, status, result);

  let goal: ReturnType<typeof goalStore.get> = initialGoal;

  // Resolve the workspace root for this run: an explicit team/execution context
  // wins; otherwise fall back to the repository the goal was created with.
  // Goals created before workspace persistence (or with the legacy 'default'
  // placeholder) fall back to the CANONICAL workspace root (§3: never trust
  // process.cwd() as repository truth).
  const goalWorkspace = (goal as any).workspacePath;
  const workspaceRoot = context?.workspaceRoot
    || (typeof goalWorkspace === 'string' && goalWorkspace && goalWorkspace !== 'default' && fs.existsSync(goalWorkspace)
      ? goalWorkspace
      : getWorkspaceRoot() || undefined);

  if (['executing', 'planning', 'reasoning', 'retrying'].includes(goal.status)) {
    const lastStep = goalStore.getStep(goalId, goal.history.length);
    if (lastStep && lastStep.status === 'started' && lastStep.toolCall) {
      const toolCall = JSON.parse(lastStep.toolCall as string);
        if (toolCall.tool === 'writeFile' || toolCall.tool === 'write_file') {
          const absolutePath = enforceWorkspacePath(toolCall.arguments?.path || toolCall.path, undefined, workspaceRoot);
        if (fs.existsSync(absolutePath)) {
          const content = fs.readFileSync(absolutePath, 'utf-8');
          if (content === toolCall.content) {
            goalStore.upsertStep(goalId, lastStep.stepNumber, 'completed', toolCall, 'Recovered: File write was already completed before crash.');
            pushEventToWriter(writer, 'tool_completed', `Tool Result:\nRecovered: File write was already completed.`, toolCall.tool);
          } else {
            goalStore.upsertStep(goalId, lastStep.stepNumber, 'failed', toolCall, undefined, 'File content mismatch after crash.');
          }
        } else {
          goalStore.upsertStep(goalId, lastStep.stepNumber, 'failed', toolCall, undefined, 'File was not written before crash.');
        }
      } else if (toolCall.tool === 'runCommand') {
        goalStore.upsertStep(goalId, lastStep.stepNumber, 'waiting_for_approval', toolCall, undefined, 'Command orphaned by server crash. Requires review.');
        pushEventToWriter(writer, 'waiting_for_approval', 'Previous worker crashed mid-command. Requires review.', undefined, undefined, { normalizedStatus: 'attention', lifecycleState: 'waiting_for_approval', userMessage: 'The server restarted while executing a terminal command. Please review the state.', eventType: 'approval_requested' });
      }
    }
    goal.status = 'queued';
  }

  if (context?.isTeamExecution && (!context.instructions || !context.allowedTools || !context.readScopes || !context.writeScopes)) {
    logger.error(`[GoalMode] Goal ${goalId} is a team execution but missing required context boundaries. Controlled failure initiated.`);
    goal.status = 'failed';
    goalStore.update(goalId, { status: 'failed' });
    const errorWriter = goalStore.createEventWriter({ goalId, teamId: context.teamId, agentId: context.agentId });
    errorWriter.push({
      state: 'failed',
      message: 'Team execution rejected due to missing mandatory security context.',
      provider: 'system',
      model: 'system',
      eventType: 'task_failed',
      normalizedStatus: 'failed',
      lifecycleState: 'failed'
    });
    goalControllers.delete(goalId);
    goalStore.releaseLease(goalId, workerId);
    return;
  }

  let systemPrompt = context?.instructions || DEFAULT_SYSTEM_PROMPT;
  let allowedTools = context?.allowedTools || ['writeFile', 'readFile', 'listDirectory', 'listFiles', 'runCommand', 'reasoningQuery', 'finish'];
  let readScopes = context?.readScopes;
  let writeScopes = context?.writeScopes;

  if (context?.isTeamExecution) {
    systemPrompt += `\n\nYour Role: ${context.role}\nResponsibilities: ${context.responsibilities?.join(', ')}\nAcceptance Criteria: ${context.acceptanceCriteria?.join('\n')}\n\n`;
    systemPrompt += `You must output EXACTLY ONE valid JSON object per turn.\nThe JSON must follow this exact format:\n\n` +
    `{\n  "type": "tool_call",\n  "tool": "toolName",\n  "arguments": { ... }\n}\n\n` +
    `Available Tools:\n`;
    if (allowedTools.includes('writeFile') || allowedTools.includes('write_file')) systemPrompt += `1. writeFile: { "type": "tool_call", "tool": "writeFile", "arguments": { "path": "relative/path", "content": "file content" } }\n`;
    if (allowedTools.includes('readFile') || allowedTools.includes('read_file')) systemPrompt += `2. readFile: { "type": "tool_call", "tool": "readFile", "arguments": { "path": "relative/path" } }\n`;
    if (allowedTools.includes('runCommand') || allowedTools.includes('terminal')) systemPrompt += `3. runCommand: { "type": "tool_call", "tool": "runCommand", "arguments": { "cmd": "command", "args": ["args"] } }\n`;
    if (allowedTools.includes('finish')) {
      if (context.role === 'Verifier') {
        systemPrompt += `4. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "done", "handoff": { "agentId": "verifier", "status": "completed", "summary": "...", "decisions": [], "artifacts": [ { "path": "relative/path" } ], "openIssues": [], "recommendedNextActions": [] }, "verificationReport": { "passed": true, "summary": "...", "checks": [{ "name": "...", "passed": true, "evidence": "..." }], "blockingIssues": [], "recommendedFixes": [] } } }\n`;
      } else {
        systemPrompt += `4. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "done", "handoff": { "agentId": "${context.agentId || 'unknown'}", "status": "completed", "summary": "...", "decisions": [], "artifacts": [ { "path": "relative/path" } ], "openIssues": [], "recommendedNextActions": [] } } }\n`;
      }
    }
    systemPrompt += `\nAllowed Read Scopes: ${context.readScopes?.join(', ')}\nAllowed Write Scopes: ${context.writeScopes?.join(', ')}`;
    systemPrompt += `\n\nNative tool rules (mandatory):
- To create or modify a file, ALWAYS use the writeFile tool — never echo, printf, or shell/PowerShell redirection.
- To read or inspect a file, ALWAYS use the readFile tool — never cat, type, or Get-Content.
- Use runCommand only for commands that genuinely require a process (builds, tests, package managers, git).
- Shell file I/O is blocked by the sandbox and will fail.`;
    if (context.role === 'Verifier') {
      systemPrompt += `\n- When the goal requires exact file contents, verify by reading the real file with readFile and include one check per file in your verificationReport with "path" and "expectedContent" (the exact expected bytes). The runtime independently recomputes bytes and SHA-256 — do not claim a pass you cannot prove.`;
    }
    if (context.repairContext) {
      systemPrompt += `\n\nREPAIR TASK (attempt ${context.repairContext.attempt}): The previous verification FAILED. Fix ONLY the following blocking issues using native tools, then finish normally.\nBlocking issues:\n${context.repairContext.blockingIssues.map(i => `- ${i}`).join('\n')}\nRecommended fixes:\n${context.repairContext.recommendedFixes.map(i => `- ${i}`).join('\n')}`;
    }
    if (context.role?.toLowerCase().includes('planner')) {
      systemPrompt += `\nCRITICAL: You are a Planner. Do NOT attempt to read files that are supposed to be created by the Builder. Just create the plan in the handoff summary and use the 'finish' tool to hand off.`;
    }
  }

  const conversation = [
    { role: 'user', content: `Goal: ${goal.originalGoal}` }
  ];

  const latestCheckpoint = goalStore.getLatestCheckpoint(goalId);
  let startSequenceId = 0;

  const resumedFromCheckpoint = !!latestCheckpoint;
  if (latestCheckpoint) {
    const currentSnapshot = await captureWorkspaceSnapshot(workspaceRoot);
    if (currentSnapshot.hash !== latestCheckpoint.workspaceHash && latestCheckpoint.workspaceHash !== 'no-git-available') {
      goalStore.update(goalId, { status: 'waiting_for_approval' });
      pushEventToWriter(writer, 'waiting_for_approval', 'Workspace modified since last checkpoint. Recovery required.', undefined, undefined, { normalizedStatus: 'attention', lifecycleState: 'waiting_for_approval', userMessage: 'The files on disk have changed since I last ran. Please approve recovery.', eventType: 'approval_requested' });
      goalControllers.delete(goalId);
      goalStore.releaseLease(goalId, workerId);
      return;
    }
    conversation.push({ role: 'system', content: `Resumed from checkpoint. The goal is partially complete.` });
    startSequenceId = latestCheckpoint.sequenceId;
  }
  if (context?.dependencyArtifacts && context.dependencyArtifacts.length > 0) {
    conversation.push({ role: 'system', content: `Dependency Artifacts:\n${JSON.stringify(context.dependencyArtifacts, null, 2)}` });
  }
  if (context?.handoffs && context.handoffs.length > 0) {
    conversation.push({ role: 'system', content: `Previous Agent Handoffs:\n${JSON.stringify(context.handoffs, null, 2)}` });
  }

  const safeHistory = context?.isTeamExecution 
    ? goal.history.filter(e => e.agentId === context.agentId)
    : goal.history;

  for (const event of safeHistory) {
    if (event.state === 'executing' || event.state === 'reasoning') {
      const toolPayload = event.payload && typeof event.payload === 'object' && event.payload.tool
        ? event.payload
        : { type: 'tool_call', tool: event.tool || 'reasoningQuery', arguments: {} };
      conversation.push({ role: 'assistant', content: JSON.stringify(toolPayload) });
    } else if (event.message.startsWith('Tool Result:')) {
      conversation.push({ role: 'system', content: boundToolResult(event.message) });
    } else if (event.state === 'user_action_required') {
      conversation.push({ role: 'user', content: event.message });
    }
  }

  let currentProvider = 'unassigned';
  let currentModel = 'unassigned';

  let codexAssignment:
    Awaited<
      ReturnType<
        typeof AgentProviderAssignmentService.getAssignment
      >
    > | undefined;

  try {
    codexAssignment =
      await AgentProviderAssignmentService.getAssignment(
        'agent-codex'
      );
  } catch (error) {
    logger.warn(
      '[codexLoop] Optional agent-codex assignment unavailable',
      {
        message:
          error instanceof Error ? error.message : String(error),
        code:
          typeof error === 'object' &&
          error !== null &&
          'code' in error
            ? String((error as any).code)
            : undefined
      }
    );
    codexAssignment = undefined;
  }

  if (codexAssignment) {
    // Recovery/execution pinning (RecoveryPolicy V1): explicit overrides WIN
    // over the normal assignment — this is the EFFECTIVE model used by the
    // run. The original ASSIGNMENT is never rewritten (RunLedger truth
    // shows assigned vs effective). Policy revalidation happens at dispatch.
    const explicitProvider = goal.executionOptions?.providerOverride 
      || (goal.executionOptions?.executionProviderId && !['auto', 'none'].includes(goal.executionOptions.executionProviderId) ? goal.executionOptions.executionProviderId : undefined);
    currentProvider = explicitProvider || codexAssignment.providerId;
    currentModel = goal.executionOptions?.modelOverride || goal.executionOptions?.executionModelId || codexAssignment.modelId || 'deepseek-v4-flash';
  }

  // Detect whether the assigned provider is a local Ollama model based on resolved planning provider.
  const resolvedPlanningProviderId = (goal.executionOptions?.providerOverride || codexAssignment?.providerId)
    ? mapCatalogToGatewayId(goal.executionOptions?.providerOverride || codexAssignment!.providerId)
    : undefined;
  const isLocalPlanningProvider = resolvedPlanningProviderId === 'ollama';

  const execProviderSetting = goal.executionOptions?.executionProviderId;
  const executionRouting = {
    mode: execProviderSetting === 'auto' ? 'automatic' 
          : execProviderSetting === 'none' ? 'disabled' 
          : 'forced',
    providerId: execProviderSetting && !['auto', 'none'].includes(execProviderSetting) 
                ? execProviderSetting 
                : undefined,
    source: execProviderSetting ? 'run-setting' : 'gateway-default'
  };

  if (isLocalPlanningProvider) {
    logger.info('[codexLoop] Local model detected', JSON.stringify({
      provider: currentProvider,
      model: currentModel,
      executionRouting
    }));
  }

  pushEventToWriter(
    writer,
    'planning',
    resumedFromCheckpoint ? 'Resuming from checkpoint...' : 'Starting CodeX task...',
    undefined,
    undefined,
    {
      normalizedStatus: 'active',
      lifecycleState: 'planning',
      userMessage: resumedFromCheckpoint ? 'Continuing the task from the previous checkpoint.' : 'Starting the task.',
      eventType: resumedFromCheckpoint ? 'task_resumed' : 'task_started',
      provider: currentProvider,
      model: currentModel
    }
  );
  let stepCounter = goal.history.length;

  // ── CodeX Project Memory retrieval (closure) ──────────────────────────────
  // Before any model execution, retrieve bounded ENGINEERING-relevant Project
  // Memory (architecture decisions, constraints, conventions, deployment
  // rules, verified bugs/fixes). Marketing/recruiting memories are excluded.
  // Exact memory IDs are recorded as CODEX_MEMORY_RETRIEVED telemetry and
  // injected into the system prompt under a strict context budget.
  let codexMemoryPacket: import('../services/memory/workerMemory.js').WorkerMemoryPacket | null = null;
  let codexMemoryContext = '';
  try {
    const { projectsStore } = await import('../services/projectsStore.js');
    let codexProjectId: string | null = null;
    if (workspaceRoot) {
      const normWs = workspaceRoot.replace(/[\\/]+$/, '');
      const match = projectsStore.listProjects().find((p) => {
        const pw = (p.workspacePath || '').replace(/[\\/]+$/, '');
        return pw && (pw === normWs || normWs.startsWith(pw + '\\') || normWs.startsWith(pw + '/'));
      });
      if (match) codexProjectId = match.id;
    }
    if (!codexProjectId) {
      const active = projectsStore.getActiveProjectId?.();
      if (active && projectsStore.getProject(active)) codexProjectId = active;
    }
    if (codexProjectId) {
      const { retrieveWorkerMemory, recordWorkerMemoryRetrieval, formatWorkerMemoryPacket } = await import('../services/memory/workerMemory.js');
      codexMemoryPacket = await retrieveWorkerMemory({
        projectId: codexProjectId,
        worker: 'codex',
        taskType: 'engineering',
        query: goal.originalGoal || '',
        budget: { maxItems: 6, maxChars: 1500 },
        includeGlobalFallback: false,
      });
      codexMemoryContext = formatWorkerMemoryPacket(codexMemoryPacket);
      recordWorkerMemoryRetrieval({
        worker: 'codex',
        projectId: codexProjectId,
        goalId,
        packet: codexMemoryPacket,
      });
      if (codexMemoryContext) {
        systemPrompt += `\n\nRelevant Project Memory (engineering context — use it to respect architecture decisions, constraints, and conventions):\n${codexMemoryContext}`;
      }
      // Persist retrieval proof on the goal record (survives restart for audit).
      try {
        goalStore.update(goalId, {
          runSummary: {
            ...((goal.runSummary || {}) as object),
            memoryRetrieved: {
              memoryIds: codexMemoryPacket.memoryIds,
              count: codexMemoryPacket.count,
              truncated: codexMemoryPacket.truncated,
              at: Date.now(),
            },
          } as any,
        });
      } catch { /* metadata best-effort */ }
    }
  } catch (memErr) {
    // Memory retrieval must never break CodeX execution.
    logger.warn('[codexLoop] Project memory retrieval skipped', memErr);
  }

  const usedReadFallbacks = new Set<string>();
  const recentToolFingerprints = new Map<string, number>();
  let responseExpectation: ResponseExpectation = 'tool_decision';
  let executedToolsCount = 0;

  // Bounded parse-failure budget: a model that repeatedly returns output that
  // cannot be parsed into a tool call must NOT cycle planning phases forever.
  // (Live failure: local ollama/qwen3.5:4b + fallback laguna returned chatty
  // text; the goal stayed "planning" / "Waiting for local model response" for
  // minutes with no terminal state.) Env-overridable.
  const maxParseFailures = parseInt(process.env.CODEX_MAX_PARSE_FAILURES || '3', 10);
  let parseFailureCount = 0;

  while (true) {
    if (controller.signal.aborted) {
      goalStore.upsertStep(goalId, stepCounter, 'paused', undefined, 'Goal paused explicitly.');
      goalStore.update(goalId, { status: 'paused' });
      await generateCheckpoint(goalId, 'paused', `step-${stepCounter}`, stepCounter, workspaceRoot);
      goalStore.releaseLease(goalId, workerId);
      break;
    }

    goal = goalStore.get(goalId);
    if (!goal || goal.status === 'paused' || goal.status === 'stopped' || goal.status === 'completed' || goal.status === 'failed' || goal.status === 'waiting_for_approval') {
      break; 
    }

    if (!goalStore.acquireLease(goalId, workerId, CODEX_LEASE_DURATION_MS)) {
      pushEventToWriter(writer, 'failed', 'Worker lost lease lock. Terminating.', undefined, undefined, { normalizedStatus: 'failed', lifecycleState: 'failed', userMessage: 'CodeX could not continue because another worker claimed the task.', eventType: 'task_failed', provider: currentProvider, model: currentModel });
      break;
    }

    stepCounter++;

    try {
      const PLANNING_MESSAGES = [
        "Reviewing project structure...",
        "Reading dependencies...",
        "Locating affected files...",
        "Preparing modifications...",
        "Validating generated code..."
      ];
      const planningMsg = PLANNING_MESSAGES[stepCounter % PLANNING_MESSAGES.length];
      pushEventToWriter(writer, 'planning', planningMsg, undefined, undefined, { 
        normalizedStatus: 'planning', 
        lifecycleState: 'planning', 
        userMessage: planningMsg, 
        eventType: 'planning_started', 
        provider: currentProvider, 
        model: currentModel
      });

      const cbState = checkCircuitBreaker('custom-codex');
      if (cbState === 'open') {
        pushEventToWriter(writer, 'failed', 'CodeX Execution Circuit Breaker Open. Failing loop immediately.', undefined, undefined, { normalizedStatus: 'failed', lifecycleState: 'failed', userMessage: 'CodeX stopped because the provider is unresponsive.', eventType: 'task_failed', provider: currentProvider, model: currentModel });
        break;
      }

      const prompt = buildBoundedPrompt(conversation);

      let llmResult;
      let toolCall: any = null;
      let finalAnswerText: string | null = null;
      let parseError = '';
      let isRetry = false;
      let effectiveSystemPrompt = systemPrompt;

      // --- Retry loop: 1 attempt for local models, 2 attempts (original + 1 retry) for cloud ---
      const maxToolGenerationAttempts = isLocalPlanningProvider ? 1 : 2;
      for (let attempt = 1; attempt <= maxToolGenerationAttempts; attempt++) {
        isRetry = attempt > 1;

        if (responseExpectation === 'final_answer' && isRetry) break;

        if (isRetry) {
          // Strengthen system prompt for retry
          effectiveSystemPrompt = systemPrompt + STRICT_JSON_SYSTEM_PROMPT_SUFFIX;
        }

        try {
          // Bounded timeout: local (ollama) models get a SHORT cap so a hung
          // request resolves to a truthful failure instead of "Waiting for
          // local model response" for the full cloud timeout. Env-overridable.
          const configuredTimeout = parseInt(process.env.AGENT_TEAMS_AGENT_TIMEOUT_MS || '60000', 10);
          const localTimeout = parseInt(process.env.AGENT_TEAMS_LOCAL_TIMEOUT_MS || '30000', 10);
          const timeoutMs = isLocalPlanningProvider ? Math.min(configuredTimeout, localTimeout) : configuredTimeout;
          const disableFallback = goal.executionOptions?.disableFallback === true;
          const effectiveProvider = executionRouting.providerId;

          if (executionRouting.mode === 'disabled' && !isRetry) {
            effectiveSystemPrompt += '\n\nCRITICAL PLAN-ONLY MODE: Do NOT output any JSON tool calls or <tool_call> tags. Stop after explaining your plan.';
          }

          const promptLength = prompt.length;
          logger.info('[CodeX LLM Options]', JSON.stringify({
            promptLength,
            maxTokens: 2048,
            timeoutMs,
            provider: effectiveProvider || currentProvider,
            model: currentModel,
            retryNumber: attempt - 1,
            isLocalPlanningProvider,
            executionRouting
          }));

          const llmOptions: LlmChatOptions = {
            prompt,
            systemPrompt: effectiveSystemPrompt,
            agentId: 'agent-codex',
            disableFallback,
            timeoutMs,
            // P1 — planning output budget: the CodeX loop is the planning
            // context, so it requests a generous generation cap. The Ollama
            // adapter uses this as num_predict and, on EMPTY_CONTENT, retries
            // once with 3× and then the escalation model.
            maxTokens: 2048,
            // P4 — planning escalation: the local 4B model cannot produce the
            // full CodeX planning grammar (verified by exact-prompt replay:
            // empty content at any budget) — the stronger configured sibling
            // (qwen3.5:cloud, reachable + working: 1.4s tool-call JSON) is
            // used ONLY when the local model exhausts its output.
            // POLICY GATE (Stage 2): escalation sends content to a cloud
            // provider — localOnly / approvalRequired policies suppress it.
            ...(isLocalPlanningProvider && goal.executionOptions?.allowCloudEscalation !== false
              ? { escalationModel: (process.env.CODEX_PLANNING_ESCALATION_MODEL || 'qwen3.5:cloud') }
              : {}),
            // Stop/pause must interrupt an in-flight model request — not just
            // wait for the next loop-top check.
            signal: controller.signal,
            ...(effectiveProvider ? { provider: effectiveProvider } : {}),
            // The ASSIGNED model must flow to the request. Without it the
            // gateway resolves the provider's DEFAULT model (e.g. ollama →
            // llama3.2:3b) instead of the assignment (qwen3.5:4b), and the
            // whole chain falls back into failure (observed live: offline
            // mode after ollama→openrouter→deepseek all failed).
            ...(currentModel && currentModel !== 'unassigned' ? { model: currentModel } : {})
          };

          // temperature is not supported by LlmChatOptions; strict JSON retry is handled via effectiveSystemPrompt

          logger.info('[CodeXProvider]', JSON.stringify({
            requestId: `${goalId}-${attempt}`,
            agentId: 'agent-codex',
            fallbackEnabled: !disableFallback
          }));

          const startLlm = Date.now();
          updateGoalExec({ status: 'WAITING_FOR_MODEL', currentAction: `Waiting for ${effectiveProvider || 'model'} response` });
          llmResult = await llmChat(llmOptions);
          const durationLlm = Date.now() - startLlm;
          const replyLength = llmResult.reply?.length ?? 0;
          const endsWithBrace = llmResult.reply?.trimEnd().endsWith('}') ?? false;
          logger.info('[codexLoop] LLM Response Diagnostics', JSON.stringify({
            durationMs: durationLlm,
            replyLength,
            endsWithBrace,
            provider: llmResult.provider,
            model: llmResult.model || 'unknown',
            error: llmResult.error?.slice(0, 400) || null,
            rawResponsePreview: llmResult.reply?.slice(0, 300)
          }));

          currentProvider = llmResult.provider;
          currentModel = llmResult.model || 'unknown';

          // Authoritative routing record (PRIORITY 1): requested = the
          // execution routing assignment; resolved = what llmChat actually used.
          const { routingLedger } = await import('../services/routingLedger.js');
          const requestedProvider = executionRouting.providerId || currentProvider;
          routingLedger.record({
            operationId: goalId,
            worker: 'codex',
            routingMode: 'auto',
            requestedProvider,
            requestedModel: currentModel,
            resolvedProvider: llmResult.provider || requestedProvider,
            resolvedModel: llmResult.model || currentModel,
            fallbackUsed: Boolean(llmResult.provider && requestedProvider && llmResult.provider !== requestedProvider),
            fallbackReason: llmResult.provider && requestedProvider && llmResult.provider !== requestedProvider
              ? `Requested ${requestedProvider} but resolved ${llmResult.provider}`
              : null,
            startedAt: startLlm,
            endedAt: Date.now(),
          });

          if (llmResult.offline) {
            throw new Error(llmResult.error || 'All models unreachable');
          }

          if (cbState === 'half-open') {
            recordCircuitBreakerSuccess('custom-codex');
          }
        } catch (providerErr: any) {
          if (controller.signal.aborted) {
            // Stop/pause interrupted the in-flight request — do NOT record it
            // as a provider failure (truthful terminal state is reconciled in
            // the fatal handler below).
            throw providerErr;
          }
          recordCircuitBreakerError('custom-codex');
          const providerFailureMessage =
            `CodeX provider/model unavailable. ` +
            `Primary provider/model: ollama/${currentModel || 'unknown'}; ` +
            `fallback provider/model: none for direct CodeX execution; ` +
            `reason: ${providerErr.message}`;
          pushEventToWriter(writer, 'failed', providerFailureMessage, undefined, providerErr.message, {
            normalizedStatus: 'failed',
            lifecycleState: 'failed',
            userMessage: providerFailureMessage,
            eventType: 'step_failed',
            provider: currentProvider,
            model: currentModel,
            errorCode: 'CODEX_PROVIDER_UNAVAILABLE',
            errorDetails: providerErr.message,
            payload: {
              provider: currentProvider,
              model: currentModel,
              fallbackProvider: null,
              fallbackModel: null
            }
          });
          throw providerErr; // Break out to fatal loop error handler
        }

        const response = llmResult.reply;
        logger.info(`[codexLoop] LLM Response (attempt ${attempt}): ${response}`);

        if (executionRouting.mode === 'disabled') {
          conversation.push({ role: 'assistant', content: response });
          const planningOutput = response.trim();
          const userMsg = 'Planning completed. Select an execution provider to apply changes.';
          
          pushEventToWriter(
            writer,
            'agent_completed',
            planningOutput || 'Local planning completed.',
            undefined,
            undefined,
            {
              normalizedStatus: 'attention',
              lifecycleState: 'waiting',
              userMessage: userMsg,
              eventType: 'planning_completed',
              provider: currentProvider,
              model: currentModel,
              payload: {
                reasonCode: 'EXECUTION_PROVIDER_REQUIRED',
                planningProvider: currentProvider,
                planningModel: currentModel,
                planningOutput: planningOutput,
                toolsRun: 0,
                filesChanged: 0
              }
            }
          );
          goalStore.upsertStep(goalId, stepCounter, 'completed', JSON.stringify({ type: 'planning_completed' }), planningOutput);
          goalStore.update(goalId, { status: 'waiting_for_approval' });
          
          // Clear out tools to prevent execution logic from running
          toolCall = null;
          finalAnswerText = null;
          break; // Break the attempt loop; the outer while loop will exit because goal.status === 'waiting_for_approval'
        }

        // Step 0: In final_answer phase, if the response is plain text, accept it directly
        if (responseExpectation === 'final_answer' && !looksLikeExplicitToolCall(response)) {
          const trimmedText = response.replace(/<[^>]+>/g, '').trim();
          if (trimmedText.length > 0) {
            finalAnswerText = trimmedText;
            conversation.push({ role: 'assistant', content: JSON.stringify({ type: 'tool_call', tool: 'finish', arguments: { message: finalAnswerText } }) });
            break;
          }
        }

        // Step 1: Normalize response and check for tool action FIRST
        const parseResult = parseToolCall(response);
        toolCall = parseResult.toolCall;
        parseError = parseResult.parseError ?? 'No JSON tool call found in response';

        // Step 2: If a valid tool call was found, execute it!
        if (toolCall && toolCall.type === 'tool_call') {
          conversation.push({ role: 'assistant', content: JSON.stringify(toolCall) });
          if (toolCall.tool === 'finish') {
            const finishMsg = (toolCall.arguments?.message || '').trim();
            if (finishMsg) {
              finalAnswerText = finishMsg;
              break;
            }
          } else {
            break; // Valid tool action found (readFile, writeFile, runCommand, etc.)
          }
        }

        // Step 3: If responseExpectation === 'final_answer' and tool call was not returned, accept text
        if (responseExpectation === 'final_answer') {
          const trimmedText = response.replace(/<[^>]+>/g, '').trim();
          if (trimmedText.length > 0) {
            finalAnswerText = trimmedText;
            conversation.push({ role: 'assistant', content: JSON.stringify({ type: 'tool_call', tool: 'finish', arguments: { message: finalAnswerText } }) });
            break;
          }
        }

        // Step 4: Check for TRULY empty response (no text, no tool call)
        if (!response || response.trim().length === 0) {
          pushEventToWriter(
            writer,
            'failed',
            'Final answer was empty.',
            undefined,
            'Final answer was empty.',
            {
              normalizedStatus: 'failed',
              lifecycleState: 'failed',
              userMessage: 'CodeX received an empty final answer from the model.',
              eventType: 'task_failed',
              provider: currentProvider,
              model: currentModel,
              errorCode: 'CODEX_EMPTY_FINAL_ANSWER'
            }
          );
          goalStore.update(goalId, { status: 'failed' });
          throw new Error('CODEX_EMPTY_FINAL_ANSWER');
        }

        if (toolCall && toolCall.type === 'tool_call') {
          break; // Valid tool call found — exit retry loop
        }

        // Parse failed on this attempt
        if (!isRetry) {
          // First attempt failed — emit retry event and continue to second attempt
          logger.error('[CodeX] Tool parsing failed on first attempt:', parseError);
          logger.error('[CodeX] Raw LLM response (first attempt):', response);

          pushEventToWriter(
            writer,
            'retrying',
            'LLM response could not be parsed. Retrying with strict JSON instructions.',
            undefined,
            parseError,
            {
              normalizedStatus: 'attention',
              lifecycleState: 'retrying',
              userMessage: 'LLM response could not be parsed. Retrying with strict JSON instructions.',
              eventType: 'retry_started',
              provider: currentProvider,
              model: currentModel,
              errorCode: 'CODEX_TOOL_PARSE_FAILED',
              errorDetails: parseError,
              payload: { responseLength: response.length }
            }
          );
          // Continue to second attempt
        } else {
          // Final attempt failed — check if this is a local model (plan-only mode)
          logger.error(`[CodeX] Tool parsing failed on attempt ${attempt + 1}:`, parseError);
          logger.error(`[CodeX] Raw LLM response (attempt ${attempt + 1}):`, response);

          // Strict Tool Protocol: No fake finish fallback or prose hacks. Fail honestly.
          pushEventToWriter(
            writer,
            'failed',
            'CodeX received an invalid structured response from the model after retrying.',
            undefined,
            parseError,
            {
              normalizedStatus: 'failed',
              lifecycleState: 'failed',
              userMessage: 'CodeX received an invalid structured response from the model after retrying.',
              eventType: 'task_failed',
              provider: currentProvider,
              model: currentModel,
              errorCode: 'CODEX_TOOL_PARSE_FAILED',
              errorDetails: parseError
            }
          );
          goalStore.update(goalId, { status: 'failed' });
          throw new Error(`CODEX_TOOL_PARSE_FAILED: ${parseError}`);
        }
      }
      // --- End retry loop ---

      // ── Bounded parse-failure budget ──
      // If the attempt loop ended without a valid tool call or final answer
      // (local single-attempt path, or retries exhausted without a fallback),
      // count it. Past the budget the goal transitions to an explicit
      // terminal 'failed' state instead of cycling phases indefinitely.
      if (!toolCall && !finalAnswerText && parseError && (goal.status as string) !== 'waiting_for_approval' && !controller.signal.aborted) {
        parseFailureCount += 1;
        logger.warn(`[CodeX] Parse failure ${parseFailureCount}/${maxParseFailures} for ${goalId} (${currentProvider}/${currentModel})`);
        if (parseFailureCount >= maxParseFailures) {
          const limitMessage =
            `CodeX could not parse the model response into a tool call after ${parseFailureCount} attempts ` +
            `(provider ${currentProvider}, model ${currentModel}). No files were changed.`;
          pushEventToWriter(writer, 'failed', limitMessage, undefined, parseError, {
            normalizedStatus: 'failed',
            lifecycleState: 'failed',
            userMessage: `CodeX could not parse the model response after ${parseFailureCount} attempts. No files were changed.`,
            eventType: 'task_failed',
            provider: currentProvider,
            model: currentModel,
            errorCode: 'CODEX_PARSE_FAILURE_LIMIT',
            errorDetails: parseError
          });
          goalStore.update(goalId, { status: 'failed' });
          endGoalExec('FAILED', limitMessage);
          throw new Error('CODEX_PARSE_FAILURE_LIMIT');
        }
      }

      if (finalAnswerText) {
        const toolResult = `Goal finished: ${finalAnswerText}`;
        await generateCheckpoint(goalId, 'completed', `step-${stepCounter}`, stepCounter, workspaceRoot);
        pushEventToWriter(writer, 'checkpoint_written', `Checkpoint generated for final answer`, undefined, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'checkpoint_written' });
        pushEventToWriter(writer, 'agent_completed', toolResult, 'finish', undefined, {
          normalizedStatus: 'completed',
          lifecycleState: 'completed',
          userMessage: 'CodeX finished the task successfully.',
          eventType: 'agent_completed',
          provider: currentProvider,
          model: currentModel,
          payload: { finalAnswer: finalAnswerText, responseExpectation: 'final_answer' }
        });
        goalStore.upsertStep(goalId, stepCounter, 'completed', JSON.stringify({ type: 'final_answer' }), toolResult);
        goalStore.update(goalId, { status: 'completed', runSummary: { ...((goal.runSummary || {}) as object), ...(codexMemoryPacket && codexMemoryPacket.memoryIds.length ? { memoryRetrieved: { memoryIds: codexMemoryPacket.memoryIds, count: codexMemoryPacket.count, truncated: codexMemoryPacket.truncated, at: Date.now() } } : {}), finalAnswer: finalAnswerText, message: toolResult } as any });
        // Clear the execution-state slot — the final-answer completion path
        // previously left ACTIVE RUN stale (WAITING_FOR_MODEL) after the goal
        // was already completed.
        endGoalExec('COMPLETED', (finalAnswerText || toolResult || '').slice(0, 500));
        break;
      }

      // At this point toolCall is guaranteed valid (we would have thrown otherwise)
      if (toolCall && toolCall.type === 'tool_call') {
        let toolResult = '';
        try {
          const args = toolCall.arguments;
          pushEventToWriter(writer, 'tool_started', `Executing tool: ${toolCall.tool}`, toolCall.tool, undefined, { normalizedStatus: 'active', lifecycleState: 'running', userMessage: `Running tool: ${toolCall.tool}`, eventType: 'tool_started', filePath: args.path, command: args.cmd, provider: currentProvider, model: currentModel, payload: toolCall });
          const startTime = Date.now();
          goalStore.upsertStep(goalId, stepCounter, 'started', JSON.stringify(toolCall));

          if (!allowedTools.map((t: string) => t === 'write_file' ? 'writeFile' : t === 'read_file' ? 'readFile' : t === 'terminal' ? 'runCommand' : t).includes(toolCall.tool)) {
            toolResult = `Error: Tool '${toolCall.tool}' is not allowed for this agent.`;
          }
          else if (toolCall.tool === 'writeFile' && args.path && args.content) {
            const absolutePath = enforceWorkspacePath(args.path, writeScopes, workspaceRoot);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, args.content, 'utf-8');
            validatePostWrite(absolutePath, writeScopes, workspaceRoot);
            toolResult = `Successfully wrote to ${args.path}`;
          }  
          else if (toolCall.tool === 'readFile' && args.path) {
            // §5: resolve before giving up — exact path, then repository
            // filename search; unique match is used automatically. §7: on a
            // true miss, report exactly what was searched, never a bare
            // "file not found".
            let absolutePath: string;
            let readSourceNote = '';
            try {
              absolutePath = enforceWorkspacePath(args.path, readScopes, workspaceRoot);
            } catch (scopeErr: any) {
              absolutePath = resolveWorkspacePath(args.path, workspaceRoot);
              readSourceNote = ` (note: path fell outside the configured read scopes and was resolved against the workspace root ${workspaceRoot || 'unknown'})`;
            }
            if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
              toolResult = fs.readFileSync(absolutePath, 'utf-8').substring(0, 4096);
            } else {
              const resolution = resolveFileReference(args.path, workspaceRoot);
              if (resolution.status === 'found') {
                toolResult = `Resolved "${args.path}" to ${resolution.relativePath} in the selected repository.\n\n` +
                  fs.readFileSync(resolution.resolvedPath, 'utf-8').substring(0, 4096);
              } else if (resolution.status === 'ambiguous') {
                toolResult = `Multiple files match "${args.path}" in the selected repository (${workspaceRoot}). Choose one and retry with its full relative path:\n` +
                  resolution.matches.slice(0, 10).map((m) => `  • ${m}`).join('\n');
              } else {
                toolResult = `Error: ${resolution.report}`;
              }
            }
            if (readSourceNote && toolResult) toolResult += `\n${readSourceNote}`;
          }
          else if ((toolCall.tool === 'listDirectory' || toolCall.tool === 'listFiles') && args.path !== undefined) {
            const targetRel = args.path || '.';
            let absolutePath = resolveWorkspacePath(targetRel, workspaceRoot);
            if (!fs.existsSync(absolutePath)) {
              const directPath = path.resolve(workspaceRoot || process.cwd(), targetRel);
              if (fs.existsSync(directPath)) absolutePath = directPath;
            }
            if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()) {
              const IGNORED = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', '.agentic', 'out', 'build', '.tmp', 'resources']);
              const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
              const filtered = entries
                .filter(e => !IGNORED.has(e.name))
                .slice(0, 50)
                .map(e => `${e.isDirectory() ? '[DIR] ' : '[FILE]'} ${e.name}`);
              toolResult = `Directory contents of "${targetRel}":\n` + (filtered.length > 0 ? filtered.join('\n') : '(empty directory)');
            } else {
              toolResult = `Error: Path "${targetRel}" is not a valid directory.`;
            }
          }
          else if (toolCall.tool === 'runCommand' && args.cmd && args.args) {
            // Shell file I/O (echo/cat/type/Get-Content/redirection) is blocked by
            // sandbox policy — and unnecessary, because native tools exist.
            // Stop it here with strict corrective instructions so the agent gets
            // one immediate corrective retry with the right tool.
            const shellIo = detectShellFileIo(args.cmd, args.args);
            if (shellIo) {
              throw new Error(
                `${shellIo.detail}, which is blocked by sandbox policy because a safer native tool exists. ` +
                `Use the ${shellIo.nativeTool} tool instead. Never use echo, printf, cat, type, Get-Content, ` +
                `PowerShell redirection, or shell redirection for normal file reads/writes. ` +
                `Retry now with ${shellIo.nativeTool}.`
              );
            }
            const { stdout, stderr } = await runSandboxedCommand(args.cmd, args.args, controller.signal, workspaceRoot);
            toolResult = `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
          }
          else if (toolCall.tool === 'reasoningQuery' && args.prompt) {
            pushEventToWriter(writer, 'reasoning', 'Consulting OmniRoute...', toolCall.tool, undefined, { normalizedStatus: 'planning', lifecycleState: 'planning', userMessage: 'Evaluating result with OmniRoute...', eventType: 'validation_started', provider: currentProvider, model: currentModel });
            const result = await llmChat({
              prompt: args.prompt,
              provider: 'omniRoute',
              systemPrompt: 'You are OmniRoute, a pure validation engine. Validate the input strictly as text. Do not emit tools. Do not execute commands.'
            });
            toolResult = result.reply.substring(0, 4096);
          }
          else if (toolCall.tool === 'finish') {
            toolResult = `Goal finished: ${args.message || 'completed'}`;

            let handoffObj = args.handoff;
            if (context?.isTeamExecution && !handoffObj) {
              handoffObj = {
                agentId: context.agentId || 'unknown',
                status: 'completed',
                summary: args.message || 'Completed without specific handoff details.',
                decisions: [],
                artifacts: [],
                openIssues: [],
                recommendedNextActions: []
              };
              args.handoff = handoffObj;
            }

            const verifiedArtifacts: any[] = [];

            const verificationReport = args.verificationReport || args.handoff?.verificationReport;

            db.transaction((tx) => {
              if (handoffObj && Array.isArray(handoffObj.artifacts)) {
                if (context?.role?.toLowerCase().includes('planner')) {
                  handoffObj.artifacts = [];
                }
                for (const art of handoffObj.artifacts) {
                  if (!art.path) continue;

                  // Verification must use actual allowed output paths, we use outputArtifacts or writeScopes
                  const scopesToUse = writeScopes || [];
                  const absolutePath = enforceWorkspacePath(art.path, scopesToUse, workspaceRoot);
                  if (!fs.existsSync(absolutePath)) throw new Error(`Artifact ${art.path} does not exist`);

                  const stat = fs.statSync(absolutePath);
                  if (stat.size === 0) throw new Error(`Artifact ${art.path} is empty`);

                  const content = fs.readFileSync(absolutePath);
                  const checksum = createHash('sha256').update(content).digest('hex');

                  if (!context?.runId || !context?.teamId) {
                    throw new Error("runId and teamId are strictly required to verify artifacts.");
                  }

                  const artifactId = randomUUID();
                  tx.insert(agentTeamArtifacts).values({
                    id: artifactId,
                    runId: context.runId,
                    teamId: context.teamId,
                    goalId: goalId,
                    agentId: context?.agentId || 'codex',
                    path: art.path,
                    checksum: checksum,
                    size: stat.size,
                    createdAt: Date.now().toString(),
                    verifiedAt: Date.now().toString()
                  }).onConflictDoUpdate({
                    target: [agentTeamArtifacts.runId, agentTeamArtifacts.path, agentTeamArtifacts.checksum],
                    set: { verifiedAt: Date.now().toString() }
                  }).run();

                  const existing = tx.select({ id: agentTeamArtifacts.id }).from(agentTeamArtifacts)
                    .where(and(
                      eq(agentTeamArtifacts.runId, context.runId),
                      eq(agentTeamArtifacts.path, art.path),
                      eq(agentTeamArtifacts.checksum, checksum)
                    )).get();

                  verifiedArtifacts.push({
                    id: existing!.id,
                    path: art.path,
                    checksum,
                    checksumAlgorithm: 'sha256',
                    size: stat.size,
                    producedBy: context?.agentId || 'codex'
                  });
                }
              }

              if (context?.role === 'Verifier' && verificationReport) {
                const rep = verificationReport;
                const repId = randomUUID();
                tx.insert(verificationReports).values({
                  id: repId,
                  runId: context?.runId || 'unknown',
                  teamId: context?.teamId || 'unknown',
                  goalId: goalId,
                  verifierId: context?.agentId || 'codex',
                  passed: rep.passed,
                  checks: rep.checks || [],
                  evidence: rep.evidence || '',
                  blockingIssues: rep.blockingIssues || [],
                  recommendedFixes: rep.recommendedFixes || [],
                  createdAt: Date.now().toString()
                }).run();
                handoffObj.verificationReportId = repId;
              }

              const handoffId = randomUUID();
              if (handoffObj) {
                // Preserve the status the agent actually declared. An attempt
                // that finished with status 'failed' must never be persisted
                // as 'completed' — one attempt, one truthful terminal handoff.
                const declaredStatus = args.handoff?.status === 'failed' || args.handoff?.status === 'blocked'
                  ? args.handoff.status
                  : 'completed';
                handoffObj.status = declaredStatus;
                tx.insert(agentTeamHandoffs).values({
                  id: handoffId,
                  teamId: context?.teamId || 'unknown',
                  goalId: goalId,
                  agentId: context?.agentId || 'codex',
                  status: declaredStatus,
                  summary: args.message || 'Completed',
                  artifacts: verifiedArtifacts,
                  createdAt: Date.now().toString()
                }).run();
              }
            });

            if (verifiedArtifacts.length > 0) {
              for (const va of verifiedArtifacts) {
                pushEventToWriter(writer, 'artifact_created', `Artifact verified: ${va.path}`, undefined, undefined, {
                  normalizedStatus: 'active', lifecycleState: 'running', eventType: 'artifact_created',
                  payload: va
                });
              }
            }

            if (handoffObj) {
              handoffObj.artifacts = verifiedArtifacts;
              if (context?.role === 'Verifier') {
                pushEventToWriter(writer, 'verification_completed', 'Verification Report Generated', undefined, undefined, {
                  normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'verification_completed',
                  payload: { passed: verificationReport?.passed || false, report: verificationReport }
                });
              }
              pushEventToWriter(writer, 'handoff_created', 'Handoff payload generated', undefined, undefined, {
                normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'handoff_created',
                payload: { handoff: handoffObj }
              });
            }

            await generateCheckpoint(goalId, 'completed', `step-${stepCounter}`, stepCounter, workspaceRoot);
            pushEventToWriter(writer, 'checkpoint_written', `Checkpoint generated for final step`, undefined, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'checkpoint_written' });

            const finalMessageText = args.message || toolResult || '';
            const finishPayload: any = { handoff: handoffObj, finalAnswer: finalMessageText };
            if (context?.role === 'Verifier') finishPayload.verificationReport = verificationReport;

            pushEventToWriter(writer, 'agent_completed', toolResult, toolCall.tool, undefined, { normalizedStatus: 'completed', lifecycleState: 'completed', userMessage: `CodeX finished the task successfully.`, eventType: 'agent_completed', provider: currentProvider, model: currentModel, payload: finishPayload });

            goalStore.upsertStep(goalId, stepCounter, 'completed', JSON.stringify(toolCall), toolResult);
            goalStore.update(goalId, { status: 'completed', runSummary: { ...((goal.runSummary || {}) as object), ...(codexMemoryPacket && codexMemoryPacket.memoryIds.length ? { memoryRetrieved: { memoryIds: codexMemoryPacket.memoryIds, count: codexMemoryPacket.count, truncated: codexMemoryPacket.truncated, at: Date.now() } } : {}), finalAnswer: finalMessageText, message: toolResult } as any });
          endGoalExec('COMPLETED', toolResult?.slice(0, 500));
            break;
          }
          else {
            toolResult = `Error: Invalid tool call`;
          }

          goalStore.upsertStep(goalId, stepCounter, 'completed', JSON.stringify(toolCall), toolResult);
          const durationMs = Date.now() - startTime;
          pushEventToWriter(writer, 'tool_completed', `Tool Result:\n${toolResult}`, toolCall.tool, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', userMessage: `Tool finished successfully.`, eventType: 'tool_completed', durationMs, provider: currentProvider, model: currentModel, payload: { result: toolResult } });
          await generateCheckpoint(goalId, 'completed', `step-${stepCounter}`, stepCounter, workspaceRoot);
          pushEventToWriter(writer, 'checkpoint_written', `Checkpoint generated for step ${stepCounter}`, undefined, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'checkpoint_written' });
          let boundedResult = boundToolResult(toolResult);
          executedToolsCount++;
          const toolFingerprint = `${toolCall.tool}:${args.path || args.cmd || ''}`;
          const repeatCount = (recentToolFingerprints.get(toolFingerprint) || 0) + 1;
          recentToolFingerprints.set(toolFingerprint, repeatCount);

          const maxAllowedTools = 15;
          if (repeatCount >= 3 || executedToolsCount >= maxAllowedTools) {
            conversation.push({ role: 'system', content: `Tool Result:\n${boundedResult}` });
            conversation.push({ role: 'user', content: buildFinalAnswerPrompt(boundedResult) });
            responseExpectation = 'final_answer';
          } else {
            const repeatNotice = repeatCount > 1
              ? `\n\n[Notice: You have inspected "${args.path || toolFingerprint}" ${repeatCount} times. If you have enough evidence, emit the finish tool call now: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Your complete answer" } }]`
              : '';
            conversation.push({ role: 'system', content: `Tool Result:\n${boundedResult}${repeatNotice}\n\nIf the task is complete, call finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "Summary of completed work" } }. Otherwise, emit the next tool call.` });
          }

        } catch (err: any) {
          conversation.push({ role: 'system', content: `Tool Error: ${boundToolResult(err.message)}` });
          if (controller.signal.aborted) {
            goalStore.upsertStep(goalId, stepCounter, 'interrupted', undefined, undefined, err.message);
          } else {
            goalStore.upsertStep(goalId, stepCounter, 'failed', undefined, undefined, err.message);
            pushEventToWriter(writer, 'retrying', `Tool error: ${err.message}`, undefined, err.message, { normalizedStatus: 'attention', lifecycleState: 'retrying', userMessage: 'The last tool failed. CodeX will attempt to retry.', eventType: 'step_failed', provider: currentProvider, model: currentModel, payload: { error: err.message } });
          }
        }
      }
    } catch (err: any) {
      // Distinguish between our own parse-failure throws and genuine fatal errors
      if (err.message === 'CODEX_TOOL_PARSE_FAILED' || err.message === 'CODEX_PARSE_FAILURE_LIMIT') {
        // Already emitted the terminal event and set status to failed inside
        // the retry loop / parse-failure budget. Just break cleanly.
        break;
      }
      if (controller.signal.aborted) {
        // Stop/pause aborted the loop mid-request. Preserve the truthful
        // terminal state already persisted by abortGoal/pause instead of
        // overwriting it with 'failed'.
        const current = goalStore.get(goalId);
        if (current && current.status === 'pause_requested') {
          goalStore.update(goalId, { status: 'paused' });
        } else if (current && !['stopped', 'paused', 'cancelled', 'failed', 'completed', 'interrupted'].includes(current.status)) {
          goalStore.update(goalId, { status: 'failed' });
        }
        endGoalExec('CANCELLED');
        break;
      }
      pushEventToWriter(writer, 'failed', `Fatal loop error: ${err.message}`, undefined, err.message, { normalizedStatus: 'failed', lifecycleState: 'failed', userMessage: 'A fatal error occurred. Task stopped.', eventType: 'task_failed', provider: currentProvider, model: currentModel, payload: { error: err.message } });
      goalStore.update(goalId, { status: 'failed' });
      endGoalExec('FAILED', err.message);
      break;
    }
  }

  goalControllers.delete(goalId);
  if (!controller.signal.aborted) {
    goalStore.releaseLease(goalId, workerId);
  }
}
