import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { 
  AgentDefinition, Runtime, ProviderDefinition, RunRecord, 
  MemoryScope, MemoryEntry, Artifact, Board, ToolDefinition, ResearchBrief, ServiceLead,
  LeadsResponse
} from '../types';
import { extractLeads } from '../types';
import { apiClient, API_BASE } from '../api/client';
import { backendLifecycleStore } from '../diagnostics/backendLifecycleStore';

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

export const DataContext = createContext<DataState>(initialState);
const DATA_REFRESH_INTERVAL_MS = 60_000;

function normalizeRunInput(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input !== null && typeof input === 'object') {
    return JSON.stringify(input);
  }
  return '';
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>(initialState);
  const inFlightRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [
        agents,
        providers,
        runs,
        runtimes,
        memoryScopes,
        memoryEntries,
        artifacts,
        boards,
        tools,
        researchBriefs,
        leadData,
        schedules,
        providerCredentials,
      ] = await Promise.all([
        apiClient.getAgents() as Promise<AgentDefinition[]>,
        apiClient.getProviders() as Promise<ProviderDefinition[]>,
        apiClient.getRuns(),
        apiClient.getRuntimes() as Promise<Runtime[]>,
        apiClient.getMemoryScopes() as Promise<MemoryScope[]>,
        apiClient.getMemoryEntries() as Promise<MemoryEntry[]>,
        apiClient.getArtifacts() as Promise<Artifact[]>,
        apiClient.getBoards() as Promise<Board[]>,
        apiClient.getTools() as Promise<ToolDefinition[]>,
        apiClient.getResearchBriefs() as Promise<ResearchBrief[]>,
        apiClient.getLeads() as Promise<LeadsResponse>,
        apiClient.getSchedules() as Promise<Schedule[]>,
        fetch(`${API_BASE}/settings/gateway/credentials-status`).then((res): Promise<Record<string, ProviderCredentialStatus>> => res.ok ? res.json() : Promise.resolve({})),
      ]);

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      const normalizedRuns: RunRecord[] = (runs || []).map((r) => ({
        ...r,
        input: normalizeRunInput(r.input),
      }));

      setState({
        agents,
        providers,
        runs: normalizedRuns,
        runtimes,
        memoryScopes,
        memoryEntries,
        artifacts,
        boards,
        tools,
        researchBriefs,
        leads: extractLeads(leadData),
        schedules,
        providerCredentials,
        isLoading: false,
        error: null,
        refresh: fetchData,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch',
      }));
      // Quick auto-retry for transient startup boot delay
      if (!retryTimeoutRef.current) {
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          void fetchData();
        }, 2000);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Listen for backend lifecycle ready events to immediately self-heal
  useEffect(() => {
    const unsub = backendLifecycleStore.subscribe(() => {
      const current = backendLifecycleStore.getState();
      if (current.status === 'ready') {
        void fetchData();
      }
    });
    return unsub;
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, DATA_REFRESH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchData]);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
