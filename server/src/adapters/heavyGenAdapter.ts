import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';
import type {
  RuntimeAdapter, RuntimeHealth, AgentDefinition, AgentInvocation,
  InvocationAck, RuntimeEvent, RunRecord, ToolDefinition, MemoryScope
} from '../types.js';
import { runStore } from '../services/runStore.js';
import { mockAgents, mockTools, mockMemoryScopes } from '../data.js';

export class HeavyGenAdapter implements RuntimeAdapter {
  id = 'rt-heavy-gen';
  label = 'Heavy Generation Runtime (Fugu/Fusion)';

  async health(): Promise<RuntimeHealth> {
    return { status: 'healthy', lastCheck: new Date().toISOString(), latencyMs: 25 };
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return mockAgents.filter(a => a.runtimeId === this.id);
  }

  // Token estimator utility
  estimateTokens(prompt: string): number {
    // Rough estimate: 1 token ~= 4 chars in English
    return Math.ceil(prompt.length / 4);
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

    const tokens = this.estimateTokens(input.prompt);
    const estimatedTimeMin = Math.ceil(tokens / 500); // Rough estimate of generation time

    let initialLogs = [
      `[00:00] Initializing Heavy Generation Pipeline...`,
      `[00:01] Token estimation: ~${tokens} tokens.`,
      `[00:01] Estimated generation time: ${estimatedTimeMin} minutes.`
    ];

    if (tokens > 100000) {
      initialLogs.push(`[WARNING] Context window is very large! Nearing token limit.`);
    }
    if (estimatedTimeMin > 15) {
      initialLogs.push(`[WARNING] Generation may take longer than 15 minutes. Proceeding...`);
    }

    runStore.update(input.runId, {
      status: 'running',
      logs: initialLogs
    });

    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
      // Execute real API call
      (async () => {
        try {
          const isOpenRouter = apiKey.startsWith('sk-or-');
          const url = isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
          
          let targetModel = 'openai/gpt-4o-mini'; // fallback
          // Fugu/Sakana disabled for EU region — use OpenRouter/DeepSeek instead
          if (input.agentId === 'agent-fusion') targetModel = 'openrouter/fusion-large';

          runStore.update(input.runId, {
            logs: [...initialLogs, `[00:02] Connected to provider. Initiating heavy generation using model ${targetModel}...`]
          });

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              ...(isOpenRouter ? { 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'Agentic OS' } : {})
            },
            body: JSON.stringify({
              model: targetModel,
              messages: [{ role: 'user', content: input.prompt }]
            })
          });

          if (!response.ok) {
            throw new Error(`Upstream API failed: ${await response.text()}`);
          }

          const data = await response.json();
          const output = data.choices[0].message.content;

          runStore.update(input.runId, {
            status: 'completed',
            output,
            logs: [...initialLogs, `[00:02] Connected to provider.`, `[${new Date().toISOString()}] Generation completed successfully via ${targetModel}.`]
          });
        } catch (err: any) {
          logger.error('[HeavyGen] API Error:', err);
          runStore.update(input.runId, {
            status: 'failed',
            errorMessage: err.message || 'API request failed',
            logs: [...initialLogs, `[ERROR] ${err.message}`]
          });
        }
      })();
    } else {
      // Simulate heavy generation
      setTimeout(() => {
        runStore.update(input.runId, {
          logs: [...initialLogs, `[00:02] Fetching workspace context...`, `[00:10] Generating architecture...`]
        });
      }, 2000);

      setTimeout(() => {
        runStore.update(input.runId, {
          logs: [...initialLogs, `[00:02] Fetching workspace context...`, `[00:10] Generating architecture...`, `[00:45] Finalizing codebase...`]
        });
      }, 5000);

      setTimeout(() => {
        const output = `[HeavyGen Simulated] Generated project based on: "${input.prompt}".`;
        runStore.update(input.runId, { 
          status: 'completed', 
          output,
          logs: [...initialLogs, `[00:02] Fetching workspace context...`, `[00:10] Generating architecture...`, `[00:45] Finalizing codebase...`, `[01:00] Task completed successfully.`]
        });
      }, 8000);
    }

    return { status: 'accepted', runId: input.runId };
  }

  async *stream(input: AgentInvocation): AsyncIterable<RuntimeEvent> {
    yield { type: 'status', payload: { status: 'running' }, timestamp: new Date().toISOString() };
    const words = `Heavy generation starting for: ${input.prompt}`.split(' ');
    for (const word of words) {
      await new Promise(r => setTimeout(r, 100));
      yield { type: 'chat_chunk', payload: { chunk: word + ' ' }, timestamp: new Date().toISOString() };
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
    return mockTools;
  }

  async listMemoryScopes(agentId?: string): Promise<MemoryScope[]> {
    return mockMemoryScopes;
  }
}
