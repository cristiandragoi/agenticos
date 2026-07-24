import { AlertTriangle, RefreshCw, Shield } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgentCard from '../components/agents/AgentCard';
import AgentDetails from '../components/agents/AgentDetails';
import type {
  AgentOverviewCardData,
  AgentOverviewEntry,
  NormalizedAgentStatus,
} from '../components/agents/agentOverviewTypes';
import '../components/agents/AgentsOverview.css';
import { useData } from '../store/dataStore';
import type { AgentDefinition, ProviderDefinition, RunRecord } from '../types';

const OVERVIEW_AGENTS: AgentOverviewEntry[] = [
  { id: 'agent-jarvis', name: 'JARVIS', route: '/jarvis' },
  { id: 'agent-hermes', name: 'HERMES', route: '/hermes' },
  { id: 'agent-codex', name: 'CODEX', route: '/codex' },
  { id: 'agent-teams', name: 'AGENT TEAMS', route: '/agent-teams' },
];

const ACTIVE_RUN_STATUSES = new Set(['running', 'queued', 'waiting', 'paused', 'planning', 'thinking', 'busy']);

function normalizeStatus(status?: string): NormalizedAgentStatus {
  const value = (status || '').toLowerCase();
  if (['active', 'running', 'online'].includes(value)) return 'Active';
  if (['idle', 'ready'].includes(value)) return 'Ready';
  if (['busy', 'planning', 'thinking'].includes(value)) return 'Busy';
  if (['failed', 'unavailable', 'disconnected'].includes(value)) return 'Unavailable';
  return 'Unknown';
}

function findOverviewAgent(agents: AgentDefinition[], entry: AgentOverviewEntry) {
  return agents.find((agent) => {
    const agentName = (agent.name || '').toUpperCase();
    return agent.id === entry.id || agentName === entry.name;
  });
}

function getAgentProviders(agent: AgentDefinition | undefined, providers: ProviderDefinition[]) {
  if (!agent) return [];
  return (agent.providerIds || [])
    .map((providerId) => providers.find((provider) => provider.id === providerId))
    .filter(Boolean) as ProviderDefinition[];
}

function getProviderLabel(agentProviders: ProviderDefinition[]) {
  if (agentProviders.length === 0) return 'Not configured';
  return agentProviders.map((provider) => provider.name || 'Unknown').join(', ');
}

function getModelLabel(agentProviders: ProviderDefinition[]) {
  const modelNames = agentProviders
    .map((provider) => provider.defaultModel || provider.models?.[0]?.displayName || provider.models?.[0]?.name || provider.models?.[0]?.id)
    .filter(Boolean);
  if (modelNames.length === 0) return 'Not configured';
  return modelNames.join(', ');
}

function getActiveRun(agent: AgentDefinition | undefined, runs: RunRecord[]) {
  if (!agent) return undefined;
  return runs
    .filter((run) => run.agentId === agent.id && ACTIVE_RUN_STATUSES.has(run.status))
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    })[0];
}

function buildCardData(
  entry: AgentOverviewEntry,
  agents: AgentDefinition[],
  providers: ProviderDefinition[],
  runs: RunRecord[],
): AgentOverviewCardData {
  const agent = findOverviewAgent(agents, entry);
  const agentProviders = getAgentProviders(agent, providers);
  const activeRun = getActiveRun(agent, runs);

  return {
    entry,
    agent,
    providers: agentProviders,
    activeRun,
    status: normalizeStatus(activeRun?.status || agent?.status),
    providerLabel: getProviderLabel(agentProviders),
    modelLabel: getModelLabel(agentProviders),
    activityLabel: activeRun?.input || agent?.recentActivity || 'No active run',
    capabilities: agent?.capabilities || [],
    role: agent?.description || 'Unavailable',
  };
}

export default function AgentsGallery() {
  const { agents, providers, runs, isLoading, error, refresh } = useData();
  const navigate = useNavigate();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const overviewAgents = useMemo(
    () => OVERVIEW_AGENTS.map((entry) => buildCardData(entry, agents, providers, runs)),
    [agents, providers, runs],
  );
  const selectedAgent = overviewAgents.find((agent) => agent.entry.id === selectedAgentId);
  const activeCount = overviewAgents.filter((agent) => agent.status === 'Active').length;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAgentId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectAgent = (agentId: string) => {
    setSelectedAgentId((current) => (current === agentId ? null : agentId));
  };

  if (isLoading) {
    return (
      <main className="agents-overview-page" aria-busy="true">
        <PageHeader activeCount={0} />
        <section className="agents-stage agents-stage--loading" aria-label="Loading primary agents">
          {OVERVIEW_AGENTS.map((agent) => (
            <div className="agent-overview-skeleton" key={agent.id} data-testid="agent-skeleton-card">
              <span />
              <strong />
              <p />
            </div>
          ))}
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="agents-overview-page">
        <PageHeader activeCount={activeCount} />
        <section className="agents-overview-error" role="alert" aria-label="Agents overview error">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <h2>Live registry unavailable</h2>
            <p>Agent data could not be loaded. Retry the registry request or open diagnostics.</p>
          </div>
          <div className="agents-overview-error__actions">
            <button type="button" onClick={refresh} aria-label="Retry agents overview data">
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
            <button type="button" onClick={() => navigate('/control-room')} aria-label="Open diagnostics">
              <Shield size={16} aria-hidden="true" />
              Open diagnostics
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="agents-overview-page">
      <PageHeader activeCount={activeCount} />

      <section className="agents-stage" aria-label="Primary agent selector">
        {overviewAgents.map((agent, index) => (
          <AgentCard
            key={agent.entry.id}
            agent={agent}
            index={index}
            isSelected={selectedAgentId === agent.entry.id}
            isInactive={selectedAgentId !== null && selectedAgentId !== agent.entry.id}
            onSelect={() => selectAgent(agent.entry.id)}
          />
        ))}
      </section>

      {selectedAgent && (
        <AgentDetails
          agent={selectedAgent}
          onClose={() => setSelectedAgentId(null)}
          onOpen={() => navigate(selectedAgent.entry.route)}
        />
      )}
    </main>
  );
}

function PageHeader({ activeCount }: { activeCount: number }) {
  return (
    <header className="agents-overview-header">
      <div>
        <p className="agents-overview-header__eyebrow">AI AGENTS</p>
        <h1>Agents Overview</h1>
        <p>Live primary agent registry and launcher.</p>
      </div>
      <div className="agents-overview-header__count" aria-label={`${activeCount} of 4 active agents`}>
        {activeCount} of 4 active
      </div>
    </header>
  );
}
