import { runAgentLoop } from '../services/agent/agentLoop.js';
import { runStore } from '../services/runStore.js';
import { randomUUID } from 'crypto';
export async function classifyApolloIntent(transcript) {
    const lower = transcript.toLowerCase();
    // Basic heuristic classification for speed
    if (lower.includes('briefing') || lower.includes('report') || lower.includes('update me on'))
        return 'briefing';
    if (lower.includes('remember') || lower.includes('recall') || lower.includes('memory') || lower.includes('what did i'))
        return 'memory';
    if (lower.match(/\b(build|deploy|run|create|write|execute|fix)\b/))
        return 'agent_task';
    return 'quick';
}
export async function routeApolloQuery(transcript, onChunk) {
    const intent = await classifyApolloIntent(transcript);
    const runId = `run-apollo-${randomUUID().slice(0, 8)}`;
    const targetAgentName = intent === 'agent_task' ? 'JARVIS' : 'Qwythos 9B';
    const workflowId = intent === 'agent_task' ? 'wf-apollo-agent-task' : 'wf-apollo-quick';
    const systemPrompt = `You are Hermes Apollo, a voice-first assistant. Keep latency low.
The user's query has been classified as "${intent}". Route your response efficiently.
If it is a quick query, answer it directly and concisely.
If it is an agent task, explain what you are delegating.`;
    // Create run record
    runStore.create({
        id: runId,
        agentId: 'agent-apollo-dialog',
        sessionId: 'apollo-session',
        workspaceId: 'default',
        mode: 'chat',
        status: 'running',
        input: transcript,
        logs: [`[Apollo] Classified intent: ${intent} -> ${targetAgentName} (Workflow: ${workflowId})`],
        events: [],
        linkedArtifacts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    try {
        // Actually run the target agent via runAgentLoop
        const result = await runAgentLoop(systemPrompt, transcript, 15, targetAgentName);
        // Simulate streaming the result if a callback is provided
        if (onChunk) {
            const words = result.text.split(' ');
            for (const word of words) {
                onChunk(word + ' ');
                await new Promise(r => setTimeout(r, 20));
            }
        }
        runStore.update(runId, {
            status: 'completed',
            output: result.text,
            logs: [`[Apollo] Provider: ${result.provider} (${result.model})`]
        });
        return { intent, response: result.text, runId };
    }
    catch (err) {
        runStore.update(runId, {
            status: 'failed',
            errorMessage: err.message
        });
        return { intent, response: `Error: ${err.message}`, runId };
    }
}
