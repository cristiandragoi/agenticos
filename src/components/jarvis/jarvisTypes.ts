export type StageId = 'input' | 'job_discovery' | 'welders_researcher' | 'email_copywriter' | 'sentinel' | 'video_agent' | 'review_qa' | 'deploy_output' | 'jarvis_voice_reply' | 'qwythos' | 'code_generation' | 'preview_build' | 'save_workspace';
export type StageStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface StageConfig {
  agentId: string;
  agentName: string;
  actionType: string;
  description: string;
  color: string;
}

export interface StageLogEntry {
  id: string;
  stageId: StageId;
  status: StageStatus;
  commandText: string;
  createdAt: string;
}

export const STAGE_CONFIG: Record<StageId, StageConfig> = {
  input:            { agentId: 'agent-jarvis-core', agentName: 'JARVIS', actionType: 'routing', description: 'Route commands to the right agent. Speaks to the fleet.', color: '#38bdf8' },
  job_discovery:    { agentId: 'agent-scout', agentName: 'SCOUT', actionType: 'job_discovery', description: 'Apify-powered job search. Scrapes DE/NL job boards for welders/electricians.', color: '#10b981' },
  welders_researcher: { agentId: 'agent-gemini-welders-research', agentName: 'Welders Researcher', actionType: 'market_research', description: 'Deep market research on DE/NL welders demand. Generates structured reports.', color: '#8b5cf6' },
  email_copywriter: { agentId: 'agent-gemini-email-copy', agentName: 'Email Copywriter', actionType: 'email_template', description: 'Drafts personalized cold email templates from lead data.', color: '#a78bfa' },
  sentinel:         { agentId: 'agent-sentinel', agentName: 'Sentinel', actionType: 'logging', description: 'Monitors pipeline runs. Logs results to Obsidian vault.', color: '#ef4444' },
  video_agent:      { agentId: 'agent-video', agentName: 'VideoAgent', actionType: 'video_pipeline', description: 'Generates video content from briefs. Render pipeline.', color: '#22c55e' },
  review_qa:        { agentId: 'agent-reviewer', agentName: 'REVIEWER', actionType: 'qa', description: 'Reviews generated content and code. Runs quality checks.', color: '#f59e0b' },
  deploy_output:    { agentId: 'agent-fusion', agentName: 'Fusion', actionType: 'deploy_output', description: 'Final output: writes to Obsidian vault, sends emails, publishes.', color: '#06b6d4' },
  jarvis_voice_reply: { agentId: 'agent-jarvis', agentName: 'Voice Reply', actionType: 'tts', description: 'Text-to-speech audio generation via Deepgram.', color: '#ec4899' },
  qwythos:          { agentId: 'agent-qwythos', agentName: 'Qwythos 9B', actionType: 'local_reasoning', description: 'Qwythos 9B Abliterated — local LLM via Ollama on port 11434.', color: '#a78bfa' },
  code_generation:  { agentId: 'agent-qwable', agentName: 'Qwable Coder', actionType: 'code_generation', description: 'Generates UI code, games, and web layouts locally.', color: '#3b82f6' },
  preview_build:    { agentId: 'agent-qwable', agentName: 'Build Preview', actionType: 'preview_build', description: 'Generates working live build previews.', color: '#10b981' },
  save_workspace:   { agentId: 'agent-qwable', agentName: 'Save Workspace', actionType: 'save_workspace', description: 'Saves code and builds to active workspace.', color: '#f59e0b' },
};
