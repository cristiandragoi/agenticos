// @ts-nocheck
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { 
  AgentDefinition, Runtime, ProviderDefinition, RunRecord, 
  MemoryScope, MemoryEntry, Artifact, Board, ToolDefinition, ResearchBrief, ServiceLead
} from '../types';
import { apiClient, API_BASE } from '../api/client';

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

interface ProviderCredentialStatus {
  providerId: string;
  configured: boolean;
  maskedPreview: string;
  validationStatus: string | null;
  lastValidatedAt: string | null;
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
  providerCredentials: Record<string, ProviderCredentialStatus>;
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
  providerCredentials: {},
  isLoading: true,
  error: null,
  refresh: () => {},
};

const DataContext = createContext<DataState>(initialState);
const DATA_REFRESH_INTERVAL_MS = 60_000;

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>(initialState);
  const inFlightRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [
        agents, providers, runs, runtimes, 
        memoryScopes, memoryEntries, artifacts, boards, tools, researchBriefs, leadData, schedules, providerCredentials
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
        apiClient.getSchedules(),
        // file:// (production Electron loads dist/index.html) has no HTTP
        // origin; a relative fetch would resolve to file:///api/... and fail,
        // rejecting the whole Promise.all and trapping AppShell in the error
        // gate even though the backend lifecycle is READY. API_BASE is the
        // canonical file-aware base.
        fetch(`${API_BASE}/settings/gateway/credentials-status`).then(res => res.ok ? res.json() : {})
      ]);

      setState(prev => ({
        ...prev,
        agents, providers, runs, runtimes,
        memoryScopes, memoryEntries, artifacts, boards, tools, researchBriefs, leads: leadData.leads || [], schedules,
        providerCredentials,
        isLoading: false, error: null, refresh: fetchData
      }));
    } catch (err) {
      setState(prev => ({ ...prev, isLoading: false, error: err instanceof Error ? err.message : 'Failed to fetch' }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Interval refetch runs even while the window is hidden: otherwise a
    // failed initial load (backend still booting) would never self-heal
    // until the user returns and visibility changes. inFlightRef already
    // prevents overlapping loads.
    const interval = setInterval(() => {
      void fetchData();
    }, DATA_REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchData]);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}

