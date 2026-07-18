// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState } from 'react';
import { useDrawer } from '../store/appStore';
import EntityCard from '../components/ui/EntityCard';
import AgentAvatar from '../components/ui/AgentAvatar';
import CreateAgentDrawer from '../components/drawers/CreateAgentDrawer';
import { Activity, Database, PenTool, Plus, HardDrive } from 'lucide-react';

const AgentsGallery: React.FC = () => {
  const { agents, runs, providers, tools, isLoading } = useData();
  const drawer = useDrawer();
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) return null;

  const getAgentProviders = (agent: any) => {
    return (agent.providerIds || [])
      .map((pid: string) => providers.find((p) => p.id === pid))
      .filter(Boolean);
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
        {agents.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '40px',
              textAlign: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>
              Connected but empty
            </div>
            <div style={{ opacity: 0.7 }}>No agents found in registry</div>
          </div>
        ) : (
          agents.map((agent) => {
            const runCount = runs.filter(
              (r) => r.agentId === agent.id
            ).length;
            const agentProviders = getAgentProviders(agent);
            return (
              <EntityCard
                key={agent.id}
                title={agent.name}
                subtitle={`${agent.kind} · ${agent.runtimeId}`}
                preview={
                  agent.recentActivity ||
                  agent.description ||
                  'No recent activity'
                }
                status={agent.status}
                accent={agent.color}
                tags={agent.capabilities}
                meta={[
                  {
                    icon: <PenTool size={14} />,
                    label: `${agent.toolIds.length} tool${
                      agent.toolIds.length !== 1 ? 's' : ''
                    }`,
                  },
                  {
                    icon: <HardDrive size={14} />,
                    label: `${agentProviders.length} provider${
                      agentProviders.length !== 1 ? 's' : ''
                    }`,
                  },
                  {
                    icon: <Activity size={14} />,
                    label: `${runCount} run${runCount !== 1 ? 's' : ''}`,
                  },
                ]}
                onClick={() =>
                  drawer.open(
                    agent.id === 'agent-hermes' ? 'hermes' : 'agent',
                    agent.id
                  )
                }
              >
                <AgentAvatar
                  avatar={agent.avatar}
                  color={agent.color}
                  size="lg"
                  status={agent.status}
                />
              </EntityCard>
            );
          })
        )}
      </div>

      {/* Create Agent Drawer */}
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
