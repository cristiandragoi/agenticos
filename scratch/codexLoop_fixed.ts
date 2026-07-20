import fs from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'crypto';
import { customProviderChat, getCustomProviderConfig } from '../adapters/customProvider.js';
import { llmChat } from '../services/llmGateway.js';
import { goalStore } from '../services/goalStore.js';
import { enforceWorkspacePath, validatePostWrite, runSandboxedCommand, captureWorkspaceSnapshot } from '../utils/sandbox.js';
import type { GoalState, GoalEvent, AgentExecutionContext } from '../types.js';
import { goalControllers } from '../routers/chat.js';
import { db } from '../db/index.js';
import { providerCircuitBreakers, agentTeamArtifacts } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

interface ToolCall {
  tool: 'writeFile' | 'readFile' | 'runCommand' | 'reasoningQuery' | 'finish';
  path?: string;
  content?: string;
  cmd?: string;
  args?: string[];
  prompt?: string;
  message?: string;
}

const DEFAULT_SYSTEM_PROMPT = `You are CodeX, a Restricted Process Runner. Achieve the user's goal autonomously.
Use JSON inside <tool_call> tags. Wait for the tool result before proceeding.

Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.

Tools:
1. writeFile: { "tool": "writeFile", "path": "relative/path/to/file", "content": "file contents" }
2. readFile: { "tool": "readFile", "path": "relative/path/to/file" }
3. runCommand: { "tool": "runCommand", "cmd": "npm", "args": ["install", "express"] }
4. reasoningQuery: { "tool": "reasoningQuery", "prompt": "ask OmniRoute for validation" }
5. finish: { "tool": "finish", "message": "Goal completed." }
`;

function buildAgentPrompt(agent: any, originalGoal: string): string {
  const toolsList = agent.allowedTools.map((t: string, i: number) => {
    if (t === 'writeFile' || t === 'write_file') return `${i + 1}. writeFile: { "tool": "writeFile", "path": "relative/path/to/file", "content": "file contents" }`;
    if (t === 'readFile' || t === 'read_file') return `${i + 1}. readFile: { "tool": "readFile", "path": "relative/path/to/file" }`;
    if (t === 'runCommand' || t === 'terminal') return `${i + 1}. runCommand: { "tool": "runCommand", "cmd": "npm", "args": ["install", "express"] }`;
    if (t === 'reasoningQuery') return `${i + 1}. reasoningQuery: { "tool": "reasoningQuery", "prompt": "ask OmniRoute for validation" }`;
    if (t === 'finish') {
      if (agent.role === 'Verifier') {
        return `${i + 1}. finish: { "tool": "finish", "message": "Verification complete.", "handoff": { "agentId": "verifier", "status": "completed", "summary": "...", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": [] }, "verificationReport": { "passed": true, "summary": "...", "checks": [{ "name": "...", "passed": true, "evidence": "..." }], "blockingIssues": [], "recommendedFixes": [] } }`;
      }
      return `${i + 1}. finish: { "tool": "finish", "message": "Goal completed.", "handoff": { "agentId": "${agent.id}", "status": "completed", "summary": "...", "decisions": [], "artifacts": [], "openIssues": [], "recommendedNextActions": [] } }`;
    }
    return '';
  }).filter(Boolean);
  
  return `You are ${agent.name} (${agent.role}). Achieve the user's goal autonomously.
Use JSON inside <tool_call> tags. Wait for the tool result before proceeding.
Respond to the user in English. Keep plans, explanations, reports, and execution summaries in English unless the user explicitly requests another language.

Goal Context:
${originalGoal}

Instructions:
${agent.instructions}

Responsibilities:
${agent.responsibilities.join('\n')}

Tools:
${toolsList.join('\n')}
${agent.allowedTools.length + 1}. finish: { "tool": "finish", "message": "Verification report or summary" }
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

async function generateCheckpoint(goalId: string, phase: string, stepId?: string, stepIndex?: number) {
  const goal = goalStore.get(goalId);
  if (!goal) return undefined;
  const snapshot = await captureWorkspaceSnapshot();
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


const ToolCallSchema = z.object({
  type: z.literal('tool_call'),
  tool: z.enum(['writeFile', 'readFile', 'runCommand', 'reasoningQuery', 'finish']),
  arguments: z.record(z.any())
});

export async function resumeCodexGoalLoop(goalId: string, context?: AgentExecutionContext) { console.trace('Resuming loop for goal:', goalId);
  const workerId = randomUUID();
  const currentTeamId = context?.teamId;
  const currentAgentId = context?.agentId;
  const writer = goalStore.createEventWriter({ goalId, teamId: currentTeamId, agentId: currentAgentId });
  
  if (!goalStore.acquireLease(goalId, workerId, 30000)) {
    console.log(`[GoalMode] Goal ${goalId} is already running elsewhere.`);
    return;
  }

  const controller = new AbortController();
  goalControllers.set(goalId, controller);

  let goal = goalStore.get(goalId);
  if (!goal) return;

  if (['executing', 'planning', 'reasoning', 'retrying'].includes(goal.status)) {
    const lastStep = goalStore.getStep(goalId, goal.history.length);
    if (lastStep && lastStep.status === 'started' && lastStep.toolCall) {
      const toolCall = JSON.parse(lastStep.toolCall as string);
      if (toolCall.tool === 'writeFile' || toolCall.tool === 'write_file') {
        const absolutePath = enforceWorkspacePath(toolCall.path);
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
    console.error(`[GoalMode] Goal ${goalId} is a team execution but missing required context boundaries. Controlled failure initiated.`);
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
  let allowedTools = context?.allowedTools || ['writeFile', 'readFile', 'runCommand', 'reasoningQuery', 'finish'];
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
    if (allowedTools.includes('finish')) systemPrompt += `4. finish: { "type": "tool_call", "tool": "finish", "arguments": { "message": "done", "handoff": { "artifacts": [ { "path": "relative/path" } ], "verificationReport": { "passed": true, "checks": ["..."], "evidence": "...", "blockingIssues": [], "recommendedFixes": [] } } } }\n`;
    systemPrompt += `\nAllowed Read Scopes: ${context.readScopes?.join(', ')}\nAllowed Write Scopes: ${context.writeScopes?.join(', ')}`;
  }

  const conversation = [
    { role: 'user', content: `Goal: ${goal.originalGoal}` }
  ];

  const latestCheckpoint = goalStore.getLatestCheckpoint(goalId);
  let startSequenceId = 0;

  if (latestCheckpoint) {
    const currentSnapshot = await captureWorkspaceSnapshot();
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
      conversation.push({ role: 'assistant', content: `<tool_call>{"tool": "${event.tool}"}</tool_call>` });
    } else if (event.message.startsWith('Tool Result:')) {
      conversation.push({ role: 'system', content: event.message });
    } else if (event.state === 'user_action_required') {
      conversation.push({ role: 'user', content: event.message });
    }
  }

  pushEventToWriter(writer, 'planning', 'Resuming goal loop...', undefined, undefined, { normalizedStatus: 'active', lifecycleState: 'running', userMessage: 'Continuing the task from the previous checkpoint.', eventType: 'task_resumed' });
  let stepCounter = goal.history.length;

  
  let currentProvider = getCustomProviderConfig()?.providerName || 'custom';
  let currentModel = getCustomProviderConfig()?.defaultModel || 'unknown';

  while (true) {
    if (controller.signal.aborted) {
      goalStore.upsertStep(goalId, stepCounter, 'paused', undefined, 'Goal paused explicitly.');
      goalStore.update(goalId, { status: 'paused' });
      await generateCheckpoint(goalId, 'paused', `step-${stepCounter}`, stepCounter);
      goalStore.releaseLease(goalId, workerId);
      break;
    }

    goal = goalStore.get(goalId);
    if (!goal || goal.status === 'paused' || goal.status === 'stopped' || goal.status === 'completed' || goal.status === 'failed') {
      break; 
    }

    if (!goalStore.acquireLease(goalId, workerId, 30000)) {
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
      
      const prompt = conversation.map(m => `${m.role.toUpperCase()}:
${m.content}`).join('\n\n');
      
      let llmResult;
      try {
        const timeoutMs = parseInt(process.env.AGENT_TEAMS_AGENT_TIMEOUT_MS || '300000');
        const startLlm = Date.now();
        llmResult = await llmChat({
          prompt,
          systemPrompt,
          provider: 'ollama', // Force CodeX to use the intended local setup by default, though llmGateway handles routing.
          timeoutMs
        });
        const durationLlm = Date.now() - startLlm;
        console.log(`[codexLoop] LLM Generation took ${durationLlm}ms`);
        
        currentProvider = llmResult.provider;
        currentModel = llmResult.model || 'unknown';

        if (llmResult.offline) {
          throw new Error(llmResult.error || 'All models unreachable');
        }

        if (cbState === 'half-open') {
          recordCircuitBreakerSuccess('custom-codex');
        }
      } catch (providerErr: any) {
        recordCircuitBreakerError('custom-codex');
        pushEventToWriter(writer, 'failed', `CodeX provider failed: ${providerErr.message}`, undefined, providerErr.message, { normalizedStatus: 'failed', lifecycleState: 'failed', userMessage: 'CodeX could not continue. Open the error details for more information.', eventType: 'step_failed', provider: currentProvider, model: currentModel });
        break;
      }

      const response = llmResult.reply;
      console.log(`[codexLoop] LLM Response: ${response}`);
      conversation.push({ role: 'assistant', content: response });

      let toolCall: any = null;
      let parseError = '';
      
      let jsonMatch = response.match(/\`\`\`(?:json)?\n([\s\S]*?)\n\`\`\`/);
      let rawJson = jsonMatch ? jsonMatch[1] : response.trim();
      
      try {
        const parsed = JSON.parse(rawJson);
        toolCall = ToolCallSchema.parse(parsed);
      } catch (err: any) {
        parseError = err.message;
      }
      
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
            const absolutePath = enforceWorkspacePath(args.path, writeScopes, context?.workspaceRoot);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, args.content, 'utf-8');
            validatePostWrite(absolutePath, writeScopes, context?.workspaceRoot);
            toolResult = `Successfully wrote to ${args.path}`;
          }  
          else if (toolCall.tool === 'readFile' && args.path) {
            const absolutePath = enforceWorkspacePath(args.path, readScopes, context?.workspaceRoot);
            if (fs.existsSync(absolutePath)) {
              toolResult = fs.readFileSync(absolutePath, 'utf-8').substring(0, 4096);
            } else {
              toolResult = `Error: File not found at ${args.path}`;
            }
          }
          else if (toolCall.tool === 'runCommand' && args.cmd && args.args) {
            const { stdout, stderr } = await runSandboxedCommand(args.cmd, args.args, controller.signal, context?.workspaceRoot);
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
            toolResult = `Goal finished: ${args.message}`;
            
            const handoffObj = args.handoff;
            const verifiedArtifacts: any[] = [];
            
            await db.transaction(async (tx) => {
              if (handoffObj && Array.isArray(handoffObj.artifacts)) {
                for (const art of handoffObj.artifacts) {
                  if (!art.path) continue;
                  
                  // Verification must use actual allowed output paths, we use outputArtifacts or writeScopes
                  const scopesToUse = writeScopes || [];
                  const absolutePath = enforceWorkspacePath(art.path, scopesToUse, context?.workspaceRoot);
                  if (!fs.existsSync(absolutePath)) throw new Error(`Artifact ${art.path} does not exist`);
                  
                  const stat = fs.statSync(absolutePath);
                  if (stat.size === 0) throw new Error(`Artifact ${art.path} is empty`);
                  
                  const content = fs.readFileSync(absolutePath);
                  const checksum = createHash('sha256').update(content).digest('hex');
                  
                  const artifactId = randomUUID();
                  tx.insert(agentTeamArtifacts).values({
                    id: artifactId,
                    runId: context?.runId || 'unknown',
                    teamId: context?.teamId || 'unknown',
                    goalId: goalId,
                    agentId: context?.agentId || 'codex',
                    path: art.path,
                    checksum: checksum,
                    size: stat.size,
                    createdAt: Date.now().toString(),
                    verifiedAt: Date.now().toString()
                  }).run();
                  
                  verifiedArtifacts.push({
                    id: artifactId,
                    path: art.path,
                    checksum,
                    checksumAlgorithm: 'sha256',
                    size: stat.size,
                    producedBy: context?.agentId || 'codex'
                  });
                }
              }

              if (context?.role === 'Verifier' && args.handoff?.verificationReport) {
                const rep = args.handoff.verificationReport;
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
                tx.insert(agentTeamHandoffs).values({
                  id: handoffId,
                  teamId: context?.teamId || 'unknown',
                  goalId: goalId,
                  agentId: context?.agentId || 'codex',
                  status: 'completed',
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
                  payload: { passed: args.handoff?.verificationReport?.passed || false, report: args.handoff?.verificationReport }
                });
              }
              pushEventToWriter(writer, 'handoff_created', 'Handoff payload generated', undefined, undefined, {
                normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'handoff_created',
                payload: { handoff: handoffObj }
              });
            }

            await generateCheckpoint(goalId, 'completed', `step-${stepCounter}`, stepCounter);
            pushEventToWriter(writer, 'checkpoint_written', `Checkpoint generated for final step`, undefined, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'checkpoint_written' });

            const finishPayload: any = { handoff: handoffObj };
            if (context?.role === 'Verifier') finishPayload.verificationReport = args.handoff?.verificationReport;
            
            pushEventToWriter(writer, 'agent_completed', toolResult, toolCall.tool, undefined, { normalizedStatus: 'completed', lifecycleState: 'completed', userMessage: `CodeX finished the task successfully.`, eventType: 'agent_completed', provider: currentProvider, model: currentModel, payload: finishPayload });
            
            goalStore.upsertStep(goalId, stepCounter, 'completed', JSON.stringify(toolCall), toolResult);
            goalStore.update(goalId, { status: 'completed' });
            break;
          }
          else {
            toolResult = `Error: Invalid tool call`;
          }

          conversation.push({ role: 'system', content: `Tool Result:\n${toolResult}` });
          goalStore.upsertStep(goalId, stepCounter, 'completed', JSON.stringify(toolCall), toolResult);
          const durationMs = Date.now() - startTime;
          pushEventToWriter(writer, 'tool_completed', `Tool Result:\n${toolResult}`, toolCall.tool, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', userMessage: `Tool finished successfully.`, eventType: 'tool_completed', durationMs, provider: currentProvider, model: currentModel, payload: { result: toolResult } });
          await generateCheckpoint(goalId, 'completed', `step-${stepCounter}`, stepCounter);
          pushEventToWriter(writer, 'checkpoint_written', `Checkpoint generated for step ${stepCounter}`, undefined, undefined, { normalizedStatus: 'completed', lifecycleState: 'running', eventType: 'checkpoint_written' });

        } catch (err: any) {
          conversation.push({ role: 'system', content: `Tool Error: ${err.message}` });
          if (controller.signal.aborted) {
            goalStore.upsertStep(goalId, stepCounter, 'interrupted', undefined, undefined, err.message);
          } else {
            goalStore.upsertStep(goalId, stepCounter, 'failed', undefined, undefined, err.message);
            pushEventToWriter(writer, 'retrying', `Tool error: ${err.message}`, undefined, err.message, { normalizedStatus: 'attention', lifecycleState: 'retrying', userMessage: 'The last tool failed. CodeX will attempt to retry.', eventType: 'step_failed', provider: currentProvider, model: currentModel, payload: { error: err.message } });
          }
        }
      } else {
        // No tools used - terminal state
        pushEventToWriter(writer, 'agent_completed', 'CodeX stopped using tools.', undefined, undefined, { normalizedStatus: 'completed', lifecycleState: 'completed', userMessage: 'Task finished.', eventType: 'agent_completed', provider: currentProvider, model: currentModel });
        goalStore.update(goalId, { status: 'completed' });
        break;
      }
    } catch (err: any) {
      pushEventToWriter(writer, 'failed', `Fatal loop error: ${err.message}`, undefined, err.message, { normalizedStatus: 'failed', lifecycleState: 'failed', userMessage: 'A fatal error occurred. Task stopped.', eventType: 'task_failed', provider: currentProvider, model: currentModel, payload: { error: err.message } });
      goalStore.update(goalId, { status: 'failed' });
      break;
    }
  }

  goalControllers.delete(goalId);
  if (!controller.signal.aborted) {
    goalStore.releaseLease(goalId, workerId);
  }
}
