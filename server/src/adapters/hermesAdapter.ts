import { logger } from '../utils/logger.js';
import type {
  RuntimeAdapter, RuntimeHealth, AgentDefinition, AgentInvocation,
  InvocationAck, RuntimeEvent, RunRecord, ToolDefinition, MemoryScope
} from '../types.js';
import { runStore } from '../services/runStore.js';
import { mockAgents, mockTools, mockMemoryScopes } from '../data.js';
import { runAgentLoop, AgentRunResult } from '../services/agent/agentLoop.js';

export class HermesAdapter implements RuntimeAdapter {
  id = 'rt-hermes';
  label = 'Hermes Runtime';

  async health(): Promise<RuntimeHealth> {
    return { status: 'healthy', lastCheck: new Date().toISOString(), latencyMs: 12 };
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return mockAgents.filter(a => a.runtimeId === this.id);
  }

  async invoke(input: AgentInvocation): Promise<InvocationAck> {
    const run: RunRecord = {
      id: input.runId,
      agentId: input.agentId,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      mode: input.mode,
      status: 'queued',
      input: input.prompt,
      logs: [],
      events: [],
      linkedArtifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    runStore.create(run);

    // Run agent loop in background
    runAgentProcess(input, run);

    return { status: 'accepted', runId: input.runId };
  }

  async *stream(input: AgentInvocation): AsyncIterable<RuntimeEvent> {
    yield { type: 'status', payload: { status: 'running' }, timestamp: new Date().toISOString() };

    const agent = mockAgents.find(a => a.id === input.agentId);
    const agentName = agent?.name || 'Hermes';

    const systemPrompt = `You are ${agentName}, an AI agent in Agentic OS. You have access to tools that let you:
- Execute shell commands (terminal)
- Read and write files (read_file, write_file)
- Search files (search_files)
- Search the web (web_search)
- Extract web page content (web_extract)

You are helpful, knowledgeable, and direct. You execute tasks step by step.
When asked to do something, use your tools to accomplish it. Break complex tasks into steps.
Your working directory is the project root. You can write code, run builds, search for information, etc.
Keep responses concise and actionable. When you're done, explain what you did.
${input.uiContext?.currentRoute === '/hermes-studio' ? '\nCONTEXT: hermes-studio' : ''}`;

    const executionOptions = input.executionOptions;

    let result: AgentRunResult;
    try {
      result = await runAgentLoop(systemPrompt, input.prompt, 25, agentName, input.runId, executionOptions);

      // Stream the result word by word
      const words = result.text.split(' ');
      for (const word of words) {
        yield { type: 'chat_chunk', payload: { chunk: word + ' ' }, timestamp: new Date().toISOString() };
        await new Promise(r => setTimeout(r, 10));
      }

      logger.info(`[HermesProvider] {
  requestId: "${input.runId}",
  agentId: "${input.agentId}",
  provider: "${result.provider}",
  model: "${result.model}",
  endpoint: "${result.provider === 'OmniRoute' ? 'openrouter.ai' : '127.0.0.1:11434'}",
  fallbackEnabled: ${!(executionOptions?.disableFallback)}
}`);

      // Log what happened
      const logs = [
        `[${agentName}] Received: "${input.prompt.slice(0, 60)}${input.prompt.length > 60 ? '...' : ''}"`,
        `[${agentName}] Provider: ${result.provider} (${result.model})`,
        `[${agentName}] Tool calls: ${result.toolCalls} in ${result.iterations} iterations`,
      ];

      runStore.update(input.runId, {
        status: 'completed',
        output: result.text,
        logs,
      });
    } catch (err: any) {
      const errorMsg = `Error: ${err.message}`;
      yield { type: 'chat_chunk', payload: { chunk: errorMsg }, timestamp: new Date().toISOString() };
      runStore.update(input.runId, { status: 'failed', errorMessage: err.message });
    }

    yield { type: 'run_status', payload: { status: 'completed' }, timestamp: new Date().toISOString() };
  }

  async cancel(runId: string): Promise<void> {
    runStore.update(runId, { status: 'failed', errorMessage: 'Cancelled by user' });
  }

  async getRun(runId: string): Promise<RunRecord> {
    const run = runStore.get(runId);
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404, code: 'NOT_FOUND' });
    return run;
  }

  async listTools(agentId?: string): Promise<ToolDefinition[]> {
    if (!agentId) return mockTools;
    const agent = mockAgents.find(a => a.id === agentId);
    if (!agent) return [];
    return mockTools.filter(t => agent.toolIds.includes(t.id));
  }

  async listMemoryScopes(agentId?: string): Promise<MemoryScope[]> {
    if (!agentId) return mockMemoryScopes;
    const agent = mockAgents.find(a => a.id === agentId);
    if (!agent) return [];
    return mockMemoryScopes.filter(s => agent.memoryScopes.includes(s.id));
  }
}

/* ─── Background runner for invoke() ─── */

function runAgentProcess(input: AgentInvocation, run: RunRecord): void {
  const agent = mockAgents.find(a => a.id === input.agentId);
  const agentName = agent?.name || 'Hermes';

  const systemPrompt = `You are ${agentName}, an AI agent in Agentic OS. You have access to tools.
${input.uiContext?.currentRoute === '/hermes-studio' ? '\nCONTEXT: hermes-studio' : ''}`;

  const executionOptions = input.executionOptions;

  (async () => {
    try {
      const result = await runAgentLoop(systemPrompt, input.prompt, 25, agentName, input.runId, executionOptions);
      const gatewayLog = result.provider === 'OmniRoute'
        ? `[Gateway: OmniRoute | launcher=chat | profile=auto | port=20128]`
        : `[${agentName}] Provider: ${result.provider} (${result.model})`;

      logger.info(`[HermesProvider] {
  requestId: "${input.runId}",
  agentId: "${input.agentId}",
  provider: "${result.provider}",
  model: "${result.model}",
  endpoint: "${result.provider === 'OmniRoute' ? 'openrouter.ai' : '127.0.0.1:11434'}",
  fallbackEnabled: ${!(executionOptions?.disableFallback)}
}`);

      runStore.update(input.runId, {
        status: 'completed',
        output: result.text,
        logs: [
          `[${agentName}] Task accepted`,
          gatewayLog,
          `[${agentName}] Tool calls: ${result.toolCalls} in ${result.iterations} iterations`,
        ],
      });
    } catch (err: any) {
      runStore.update(input.runId, {
        status: 'failed',
        errorMessage: err.message,
        logs: [`[${agentName}] Error: ${err.message}`],
      });
    }
  })();
}
