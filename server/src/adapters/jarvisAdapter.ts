import type {
  RuntimeAdapter, RuntimeHealth, AgentDefinition, AgentInvocation,
  InvocationAck, RuntimeEvent, RunRecord, ToolDefinition, MemoryScope
} from '../types.js';
import { runStore } from '../services/runStore.js';
import { mockAgents, mockTools, mockMemoryScopes } from '../data.js';
import { runAgentLoop } from '../services/agent/agentLoop.js';

export class JarvisAdapter implements RuntimeAdapter {
  id = 'rt-jarvis';
  label = 'Jarvis Runtime';

  async health(): Promise<RuntimeHealth> {
    return { status: 'healthy', lastCheck: new Date().toISOString(), latencyMs: 18 };
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
      logs: ['[Jarvis] Task accepted', '[Jarvis] Queuing for execution'],
      events: [],
      linkedArtifacts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    runStore.create(run);
    runAgentProcess(input, run);
    return { status: 'accepted', runId: input.runId };
  }

  async *stream(input: AgentInvocation): AsyncIterable<RuntimeEvent> {
    yield { type: 'status', payload: { status: 'running' }, timestamp: new Date().toISOString() };

    const agent = mockAgents.find(a => a.id === input.agentId);
    const agentName = agent?.name || 'Jarvis';

    const systemPrompt = `You are ${agentName}, an execution and automation agent in Agentic OS. You have access to tools:
  - terminal: Execute shell commands to run scripts, git, builds, deployments
  - read_file: Read file contents
  - write_file: Write or create files
  - search_files: Find files or search inside them
  - web_search: Search the web for information
  - web_extract: Extract content from web pages
  - speak: Reply to the user with spoken audio. Use this when you want to respond with voice instead of text.
When the user uses voice input or voice mode is on, reply with both a short text and spoken audio using the British voice via the speak tool.`;

    let text: string;
    let provider: string;
    let model: string;
    let toolCalls = 0;
    let iterations = 0;

    try {
      const result = await runAgentLoop(systemPrompt, input.prompt, 25, agentName, input.runId);
      text = result.text;
      provider = result.provider;
      model = result.model;
      toolCalls = result.toolCalls;
      iterations = result.iterations;

      // Stream result
      const words = text.split(' ');
      for (const word of words) {
        yield { type: 'chat_chunk', payload: { chunk: word + ' ' }, timestamp: new Date().toISOString() };
        await new Promise(r => setTimeout(r, 10));
      }

      runStore.update(input.runId, {
        status: 'completed',
        output: text,
        logs: [
          '[Jarvis] Task accepted',
          `[Jarvis] Provider: ${provider} (${model})`,
          `[Jarvis] Tool calls: ${toolCalls} in ${iterations} iterations`,
          '[Jarvis] Task complete',
        ],
      });
    } catch (err: any) {
      text = `Error: ${err.message}`;
      yield { type: 'chat_chunk', payload: { chunk: text }, timestamp: new Date().toISOString() };
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

function runAgentProcess(input: AgentInvocation, run: RunRecord): void {
  const agent = mockAgents.find(a => a.id === input.agentId);
  const agentName = agent?.name || 'Jarvis';

  const systemPrompt = `You are ${agentName}, an execution and automation agent in Agentic OS. You have access to tools:
  - terminal: Execute shell commands to run scripts, git, builds, deployments
  - read_file: Read file contents
  - write_file: Write or create files
  - search_files: Find files or search inside them
  - web_search: Search the web for information
  - web_extract: Extract content from web pages
  - speak: Reply to the user with spoken audio. Use this when you want to respond with voice instead of text.
When the user uses voice input or voice mode is on, reply with both a short text and spoken audio using the British voice via the speak tool.`;

  (async () => {
    try {
      const result = await runAgentLoop(systemPrompt, input.prompt, 25, agentName, input.runId);
      runStore.update(input.runId, {
        status: 'completed',
        output: result.text,
        logs: [
          '[Jarvis] Task accepted',
          `[Jarvis] Provider: ${result.provider} (${result.model})`,
          `[Jarvis] Tool calls: ${result.toolCalls} in ${result.iterations} iterations`,
          '[Jarvis] Task complete',
        ],
      });
    } catch (err: any) {
      runStore.update(input.runId, {
        status: 'failed',
        errorMessage: err.message,
        logs: [`[Jarvis] Error: ${err.message}`],
      });
    }
  })();
}
