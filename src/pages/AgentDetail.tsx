// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AgentAvatar from '../components/ui/AgentAvatar';
import StatusBadge from '../components/ui/StatusBadge';
import ContextChip from '../components/ui/ContextChip';
import { PenTool, Database, HardDrive, Activity, Edit2 } from 'lucide-react';

const AgentDetail: React.FC = () => {
  const { agents, providers, runs, tools, isLoading } = useData();
  const { agentId } = useParams();
  const navigate = useNavigate();

  if (isLoading) return null;

  const agent = agents.find((a) => a.id === (agentId || ''));
  if (!agent) {
    return (
      <div className="p-4 text-muted text-center mt-10">Agent not found</div>
    );
  }

  const agentTools = tools.filter((t) => (agent.toolIds || []).includes(t.id));
  const agentProviders = (agent.providerIds || [])
    .map((pid) => providers.find((p) => p.id === pid))
    .filter(Boolean);
  const recentRuns = runs
    .filter((r) => r.agentId === agent.id)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5);

  return (
    <div className="flex-col h-full" style={{ overflowY: 'auto' }}>
      <div className="page-header">
        <button
          className="btn"
          onClick={() => navigate('/agents')}
          style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ← Back to Agents
        </button>
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'flex-start',
          padding: '0 16px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: 24,
        }}
      >
        <AgentAvatar
          avatar={agent.avatar}
          color={agent.color}
          size="lg"
          status={agent.status}
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{agent.name}</h1>
            <StatusBadge status={agent.status} />
          </div>
          <p className="text-secondary" style={{ fontSize: '0.85rem', margin: 0 }}>
            {agent.description}
          </p>
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 10,
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
            }}
          >
            <span>{agent.kind}</span>
            <span>·</span>
            <span>{agent.runtimeId}</span>
            <span>·</span>
            <span>ID: {agent.id}</span>
          </div>
          {agent.recentActivity && (
            <div
              style={{
                marginTop: 8,
                fontSize: '0.75rem',
                color: 'var(--color-hermes)',
              }}
            >
              Last: {agent.recentActivity}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          padding: '0 16px',
          marginBottom: 24,
        }}
      >
        {/* Summary cards */}
        <div
          className="widget-card"
          style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}
        >
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
            <PenTool size={13} style={{ marginRight: 4, display: 'inline' }} />
            Tools ({agentTools.length})
          </div>
          {agentTools.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {agentTools.map((t) => (
                <ContextChip key={t.id} label={t.name} />
              ))}
            </div>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No tools assigned
            </span>
          )}
        </div>

        <div
          className="widget-card"
          style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}
        >
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
            <HardDrive size={13} style={{ marginRight: 4, display: 'inline' }} />
            Providers ({agentProviders.length})
          </div>
          {agentProviders.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {agentProviders.map((p) => (
                <ContextChip key={p.id} label={p.name} />
              ))}
            </div>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No providers assigned
            </span>
          )}
        </div>

        <div
          className="widget-card"
          style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}
        >
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
            <Activity size={13} style={{ marginRight: 4, display: 'inline' }} />
            Capabilities
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(agent.capabilities || []).map((cap: string) => (
              <ContextChip key={cap} label={cap} />
            ))}
          </div>
        </div>

        <div
          className="widget-card"
          style={{ padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)' }}
        >
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>
            <Database size={13} style={{ marginRight: 4, display: 'inline' }} />
            Memory Scopes
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(agent.memoryScopes || []).map((scope: string) => (
              <ContextChip key={scope} label={scope} />
            ))}
          </div>
        </div>
      </div>

      {/* Recent Runs */}
      <div style={{ padding: '0 16px', marginBottom: 24 }}>
        <h3
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 12,
          }}
        >
          Recent Runs ({recentRuns.length})
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recentRuns.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No runs yet
            </div>
          ) : (
            recentRuns.map((run) => (
              <div
                key={run.id}
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <StatusBadge status={run.status} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {run.input}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {run.id.slice(0, 8)} · {new Date(run.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentDetail;
