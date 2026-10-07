import { apiFetch } from '../api/client';
export function useAgentCommand() {
  const runAgentCommand = async (
    agentId: string, 
    agentName: string, 
    command: string,
    logActivity: (msg: string) => void
  ) => {
    try {
      // Map agent selections to their specific pipelines
      let pipelineRoute = '/api/agentic/pipelines/jarvis-voice-pipeline/run';
      
      if (agentId === 'agent-video') {
        pipelineRoute = '/api/agentic/pipelines/loop-welders-pipeline/run';
      } else if (agentId === 'agent-qwythos') {
        pipelineRoute = '/api/agentic/pipelines/qwythos-workspace-pipeline/run';
      }

      // We use the actual pipeline endpoints instead of the non-existent /api/tools
      const response = await apiFetch(pipelineRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, isTTS: false })
      });
      
      logActivity(`Sent command to ${agentName}: "${command}" (status: ${response.status})`);
      
      if (!response.ok) {
        throw new Error(`Failed with status ${response.status}`);
      }
      return await response.json();
    } catch (err: any) {
      logActivity(`Error sending command to ${agentName}: ${err.message || err}`);
      throw err;
    }
  };

  return { runAgentCommand };
}
