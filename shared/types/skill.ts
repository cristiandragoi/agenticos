export interface AgentSkill {
  id: string; // e.g. "daily-briefing"
  name: string; // human-readable, e.g. "Daily Briefing"
  description?: string; // what it does, for UI tooltips
  agentId?: string; // which agent runs it by default (Jarvis, Hermes, etc.)
  toolId?: string; // underlying tool/adapter ID (maps to toolLoader / adapters)
  modelHint?: string; // optional model preference (e.g. "llama3.1:8b-64k")
  paramsTemplate?: Record<string, unknown>; // default parameters / prompt snippets
  active: boolean;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
}
