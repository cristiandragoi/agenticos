import type { AgentDefinition, ProviderDefinition, RunRecord } from '../../types';

export type NormalizedAgentStatus = 'Active' | 'Ready' | 'Busy' | 'Unavailable' | 'Unknown';

export interface AgentOverviewEntry {
  id: string;
  name: 'JARVIS' | 'HERMES' | 'CODEX' | 'AGENT TEAMS';
  route: string;
}

export interface AgentOverviewCardData {
  entry: AgentOverviewEntry;
  agent?: AgentDefinition;
  providers: ProviderDefinition[];
  activeRun?: RunRecord;
  status: NormalizedAgentStatus;
  providerLabel: string;
  modelLabel: string;
  activityLabel: string;
  capabilities: string[];
  role: string;
}
