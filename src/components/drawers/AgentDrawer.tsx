import { useData } from '../../store/dataStore';
import React from 'react';

import DrawerShell from './DrawerShell';
import AgentAvatar from '../ui/AgentAvatar';
import StatusBadge from '../ui/StatusBadge';
import ContextChip from '../ui/ContextChip';

interface AgentDrawerProps {
  entityId: string;
  onClose: () => void;
  onPin: () => void;
  isPinned: boolean;
}

const AgentDrawer: React.FC<AgentDrawerProps> = ({ entityId, onClose, onPin, isPinned }) => {
  const { agents: mockAgents, runs: mockRuns, tools: mockTools } = useData();
  const agent = mockAgents.find(a => a.id === entityId);
  if (!agent) return null;

  const agentTools = mockTools.filter(t => agent.toolIds.includes(t.id));
  const recentRuns = mockRuns.filter(r => r.agentId === agent.id).slice(0, 3);

  return (
    <DrawerShell 
      title={agent.name} 
      subtitle={`ID: ${agent.id}`} 
      onClose={onClose} 
      onPin={onPin} 
      isPinned={isPinned}
      accentColor={agent.color}
    >
      <div className="drawer-section">
        <div className="flex-row gap-4" style={{ marginBottom: 16 }}>
          <AgentAvatar avatar={agent.avatar} color={agent.color} size="lg" status={agent.status} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{agent.name}</div>
            <div className="text-xs text-muted">{agent.kind} • {agent.runtimeId}</div>
          </div>
        </div>
        <p className="text-sm text-secondary">{agent.description}</p>
      </div>

      <div className="drawer-section">
        <div className="drawer-section__label">Status</div>
        <div className="flex-row gap-2" style={{ alignItems: 'center' }}>
          <StatusBadge status={agent.status} />
          <span className="text-xs text-muted">{agent.recentActivity}</span>
        </div>
      </div>

      <div className="drawer-section">
        <div className="drawer-section__label">Capabilities</div>
        <div className="flex-row flex-wrap gap-2">
          {agent.capabilities.map(cap => (
            <ContextChip key={cap} label={cap} />
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <div className="drawer-section__label">Tools ({agentTools.length})</div>
        <div className="flex-col gap-2">
          {agentTools.map(t => (
            <div key={t.id} className="text-sm flex-row gap-2" style={{ alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 500, minWidth: 100 }}>{t.name}</span>
              <span className="text-xs text-muted">{t.description}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <div className="drawer-section__label">Recent Runs</div>
        <div className="flex-col gap-3">
          {recentRuns.length === 0 ? <div className="text-xs text-muted">No recent runs</div> : recentRuns.map(run => (
            <div key={run.id} style={{ background: 'var(--bg-base)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex-row justify-between" style={{ marginBottom: 6 }}>
                <span className="text-xs text-muted font-mono">{run.id.slice(0,8)}</span>
                <StatusBadge status={run.status} />
              </div>
              <div className="text-xs text-primary" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {run.input}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DrawerShell>
  );
};

export default AgentDrawer;


