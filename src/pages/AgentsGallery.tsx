// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState } from 'react';
import { useDrawer } from '../store/appStore';
import EntityCard from '../components/ui/EntityCard';
import AgentAvatar from '../components/ui/AgentAvatar';
import CreateAgentDrawer from '../components/drawers/CreateAgentDrawer';
import { Activity, Database, PenTool, Plus, HardDrive } from 'lucide-react';

const OVERVIEW_AGENTS = [
  { id: 'agent-jarvis', name: 'JARVIS', drawerType: 'agent' },
  { id: 'agent-hermes', name: 'HERMES', drawerType: 'hermes' },
  { id: 'agent-codex', name: 'CODEX', drawerType: 'agent' },
  { id: 'agent-teams', name: 'AGENT TEAMS', drawerType: 'agent' },
];

const ACTIVE_RUN_STATUSES = new Set(['running', 'queued', 'waiting', 'paused']);

const AgentsGallery: React.FC = () => {
  const { agents, runs, providers, isLoading } = useData();
  const drawer = useDrawer();
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) return null;

  const getAgentProviders = (agent: any) => {
    return (agent.providerIds || [])
      .map((pid: string) => providers.find((p) => p.id === pid))
      .filter(Boolean);
  };

  const getOverviewAgent = (entry: any) => {
    return agents.find((agent) => {
      const name = (agent.name || '').toUpperCase();
      return agent.id === entry.id || name === entry.name;
    });
  };

  const getProviderLabel = (agent: any) => {
    if (!agent) return 'Unknown';
    const agentProviders = getAgentProviders(agent);
    if (agentProviders.length === 0) return 'Unknown';
    return agentProviders.map((provider: any) => provider.name || 'Unknown').join(', ');
  };

  const getModelLabel = (agent: any) => {
    if (!agent) return 'Not configured';
    const agentProviders = getAgentProviders(agent);
    const modelNames = agentProviders
      .map((provider: any) => provider.defaultModel || provider.models?.[0]?.name || provider.models?.[0]?.id)
      .filter(Boolean);
    if (modelNames.length === 0) return 'Not configured';
    return modelNames.join(', ');
  };

  const getActiveRun = (agent: any) => {
    if (!agent) return null;
    return runs
      .filter((run) => run.agentId === agent.id && ACTIVE_RUN_STATUSES.has(run.status))
      .sort((a, b) => {
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return bTime - aTime;
      })[0] || null;
  };

  return (
    <div className="flex-col h-full" style={{
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_agents.png')",
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Agents Registry</h1>
          <p>Visual roster of all agents, runtimes, and capabilities.</p>
        </div>
        <div className="page-header__actions">
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--color-hermes)',
              color: '#000',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
            New Agent
          </button>
        </div>
      </div>

      <div className="gallery-grid">
        {OVERVIEW_AGENTS.map((entry) => {
          const agent = getOverviewAgent(entry);
          const activeRun = getActiveRun(agent);
          const status = agent?.status || 'Unknown';
          const toolCount = agent?.toolIds?.length || 0;

          return (
            <EntityCard
              key={entry.id}
              title={entry.name}
              subtitle={`${getProviderLabel(agent)} - ${getModelLabel(agent)}`}
              preview={
                activeRun?.input ||
                agent?.recentActivity ||
                agent?.description ||
                'No active run'
              }
              status={status}
              accent={agent?.color}
              tags={agent?.capabilities || []}
              meta={[
                {
                  icon: <HardDrive size={14} />,
                  label: getProviderLabel(agent),
                },
                {
                  icon: <Database size={14} />,
                  label: getModelLabel(agent),
                },
                {
                  icon: <Activity size={14} />,
                  label: activeRun?.status || 'No active run',
                },
                {
                  icon: <PenTool size={14} />,
                  label: `${toolCount} tool${toolCount !== 1 ? 's' : ''}`,
                },
              ]}
              onClick={() =>
                agent && drawer.open(entry.drawerType, agent.id)
              }
            >
              <AgentAvatar
                avatar={agent?.avatar}
                color={agent?.color}
                size="lg"
                status={status}
              />
            </EntityCard>
          );
        })}
      </div>

      {showCreate && (
        <CreateAgentDrawer
          onClose={() => setShowCreate(false)}
          onPin={() => {}}
          isPinned={false}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </div>
  );
};

export default AgentsGallery;
