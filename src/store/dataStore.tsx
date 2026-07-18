// @ts-nocheck
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { 
  AgentDefinition, Runtime, ProviderDefinition, RunRecord, 
  MemoryScope, MemoryEntry, Artifact, Board, ToolDefinition, ResearchBrief, ServiceLead
} from '../types';
import { apiClient } from '../api/client';

interface Schedule {
  id: string;
  name: string;
  agentId: string;
  interval: string;
  prompt: string;
  type: 'task' | 'workflow' | 'health-check';
  status: 'active' | 'paused' | 'error';
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failed' | 'running';
  lastRunOutput?: string;
  createdAt: string;
  updatedAt: string;
}

interface DataState {
  agents: AgentDefinition[];
  providers: ProviderDefinition[];
  runs: RunRecord[];
  runtimes: Runtime[];
  memoryScopes: MemoryScope[];
  memoryEntries: MemoryEntry[];
  artifacts: Artifact[];
  boards: Board[];
  tools: ToolDefinition[];
  researchBriefs: ResearchBrief[];
  leads: ServiceLead[];
  schedules: Schedule[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

const initialState: DataState = {
  agents: [],
  providers: [],
  runs: [],
  runtimes: [],
  memoryScopes: [],
  memoryEntries: [],
  artifacts: [],
  boards: [],
  tools: [],
  researchBriefs: [],
  leads: [],
  schedules: [],
  isLoading: true,
  error: null,
  refresh: () => {},
};

const DataContext = createContext<DataState>(initialState);

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>(initialState);

  const fetchData = async () => {
    try {
      const [
        agents, providers, runs, runtimes, 
        memoryScopes, memoryEntries, artifacts, boards, tools, researchBriefs, leadData, schedules
      ] = await Promise.all([
        apiClient.getAgents(),
        apiClient.getProviders(),
        apiClient.getRuns(),
        apiClient.getRuntimes(),
        apiClient.getMemoryScopes(),
        apiClient.getMemoryEntries(),
        apiClient.getArtifacts(),
        apiClient.getBoards(),
        apiClient.getTools(),
        apiClient.getResearchBriefs(),
        apiClient.getLeads(),
        apiClient.getSchedules()
      ]);

      setState(prev => ({
        ...prev,
        agents, providers, runs, runtimes,
        memoryScopes, memoryEntries, artifacts, boards, tools, researchBriefs, leads: leadData.leads || [], schedules,
        isLoading: false, error: null, refresh: fetchData
      }));
    } catch (err) {
      setState(prev => ({ ...prev, isLoading: false, error: err instanceof Error ? err.message : 'Failed to fetch' }));
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchData();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}

