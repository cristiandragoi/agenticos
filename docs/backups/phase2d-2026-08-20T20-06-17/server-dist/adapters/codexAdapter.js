import { runStore } from '../services/runStore.js';
import { mockAgents, mockTools, mockMemoryScopes } from '../data.js';
const CODEX_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const CODEX_OLLAMA_MODEL = process.env.OLLAMA_CODEX_MODEL || 'auto';
/**
 * CodexAdapter — Runtime adapter for CodeX models.
 * Uses local Ollama by default, with OpenAI-compatible routing when configured.
 * Supports chat completions with streaming.
 */
export class CodexAdapter {
    id = 'rt-codex';
    label = 'Codex Runtime';
    /**
     * Restricted Codex inspection host capabilities.
     * Only read/write inspection and web access.
     * Does NOT claim process_exec, localhost_http, sqlite_read/write, node, npm, build, test.
     */
    capabilities = [
        'filesystem_read',
        'filesystem_write',
        'browser',
        'external_web',
    ];
    get apiKey() {
        return process.env.OPENAI_API_KEY || '';
    }
    get baseUrl() {
        return process.env.OPENAI_BASE_URL || CODEX_OLLAMA_BASE_URL;
    }
    async health() {
        return { status: 'healthy', lastCheck: new Date().toISOString(), latencyMs: 15 };
    }
    async listAgents() {
        return mockAgents.filter(a => a.runtimeId === this.id);
    }
    async invoke(input) {
        const run = {
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
        // Run in background
        runCodexProcess(input, run);
        return { status: 'accepted', runId: input.runId };
    }
    async *stream(input) {
        yield { type: 'status', payload: { status: 'running' }, timestamp: new Date().toISOString() };
        const model = input.uiContext?.model || CODEX_OLLAMA_MODEL;
        const useOllama = !this.apiKey;
        try {
            const messages = [
                {
                    role: 'system',
                    content: `You are Codex, an expert coding assistant inside Agentic OS. You write, review, debug, and explain code with precision. You have access to the project workspace and can help with any coding task. Be direct, concise, and actionable. When writing code, include the full implementation. When debugging, explain the root cause and the fix.`,
                },
                {
                    role: 'user',
                    content: input.prompt,
                },
            ];
            const response = await fetch(`${useOllama ? CODEX_OLLAMA_BASE_URL + '/api/generate' : this.baseUrl + '/chat/completions'}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(useOllama ? {} : { 'Authorization': `Bearer ${this.apiKey}` }),
                },
                body: JSON.stringify(useOllama ? {
                    model,
                    prompt: input.prompt,
                    stream: true,
                } : {
                    model,
                    messages,
                    max_tokens: 4096,
                    temperature: 0.3,
                    stream: true,
                }),
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`CodeX provider error (${response.status}): ${errText.slice(0, 200)}`);
            }
            const reader = response.body?.getReader();
            if (!reader)
                throw new Error('No response body');
            const decoder = new TextDecoder();
            let buffer = '';
            let accumulated = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const payload = useOllama ? line.trim() : line.startsWith('data: ') ? line.slice(6).trim() : '';
                    if (!payload || payload === '[DONE]')
                        continue;
                    try {
                        const chunk = JSON.parse(payload);
                        const content = useOllama ? chunk.response : chunk.choices?.[0]?.delta?.content;
                        if (content) {
                            accumulated += content;
                            yield {
                                type: 'chat_chunk',
                                payload: { chunk: content },
                                timestamp: new Date().toISOString(),
                            };
                        }
                    }
                    catch { /* skip malformed */ }
                }
            }
            runStore.update(input.runId, {
                status: 'completed',
                output: accumulated,
                logs: [
                    `[Codex] Model: ${model}`,
                    `[Codex] Response length: ${accumulated.length} chars`,
                ],
            });
        }
        catch (err) {
            const errorMsg = `Error: ${err.message}`;
            yield { type: 'chat_chunk', payload: { chunk: errorMsg }, timestamp: new Date().toISOString() };
            runStore.update(input.runId, { status: 'failed', errorMessage: err.message });
        }
        yield { type: 'run_status', payload: { status: 'completed' }, timestamp: new Date().toISOString() };
    }
    async cancel(runId) {
        runStore.update(runId, { status: 'failed', errorMessage: 'Cancelled by user' });
    }
    async getRun(runId) {
        const run = runStore.get(runId);
        if (!run)
            throw Object.assign(new Error('Run not found'), { status: 404, code: 'NOT_FOUND' });
        return run;
    }
    async listTools(agentId) {
        if (!agentId)
            return mockTools;
        const agent = mockAgents.find(a => a.id === agentId);
        if (!agent)
            return [];
        return mockTools.filter(t => agent.toolIds.includes(t.id));
    }
    async listMemoryScopes(agentId) {
        if (!agentId)
            return mockMemoryScopes;
        const agent = mockAgents.find(a => a.id === agentId);
        if (!agent)
            return [];
        return mockMemoryScopes.filter(s => agent.memoryScopes.includes(s.id));
    }
}
/* ─── Background runner for invoke() ─── */
function runCodexProcess(input, run) {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || CODEX_OLLAMA_BASE_URL;
    const model = input.uiContext?.model || CODEX_OLLAMA_MODEL;
    const useOllama = !apiKey;
    (async () => {
        try {
            const res = await fetch(`${useOllama ? CODEX_OLLAMA_BASE_URL + '/api/generate' : baseUrl + '/chat/completions'}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(useOllama ? {} : { 'Authorization': `Bearer ${apiKey}` }),
                },
                body: JSON.stringify(useOllama ? {
                    model,
                    prompt: input.prompt,
                    stream: false,
                } : {
                    model,
                    messages: [
                        { role: 'system', content: 'You are Codex, an expert coding assistant inside Agentic OS.' },
                        { role: 'user', content: input.prompt },
                    ],
                    max_tokens: 4096,
                    temperature: 0.3,
                }),
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`CodeX provider error (${res.status}): ${errText.slice(0, 200)}`);
            }
            const data = await res.json();
            const output = (useOllama ? data.response : data.choices?.[0]?.message?.content) || 'No response from Codex.';
            runStore.update(input.runId, {
                status: 'completed',
                output,
                logs: [
                    `[Codex] Model: ${model}`,
                    `[Codex] Response length: ${output.length} chars`,
                ],
            });
        }
        catch (err) {
            runStore.update(input.runId, {
                status: 'failed',
                errorMessage: err.message,
                logs: [`[Codex] Error: ${err.message}`],
            });
        }
    })();
}
