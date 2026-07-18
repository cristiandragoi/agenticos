import React from 'react';
import type { AgentDefinition } from '../../types';
import { Activity, Zap, Moon } from 'lucide-react';

interface AgentFleetCardProps {
  agent: AgentDefinition;
  onClick?: () => void;
}

const AgentFleetCard: React.FC<AgentFleetCardProps> = ({ agent, onClick }) => {
  const isActive = agent.status === 'active';
  const accentColor = agent.color || 'var(--border-subtle)';

  return (
    <div
      className="agent-fleet-card"
      onClick={onClick}
      style={{
        '--card-accent': accentColor,
        borderColor: isActive ? `${accentColor}44` : 'var(--border-subtle)',
        boxShadow: isActive ? `0 0 20px ${accentColor}15` : undefined,
      } as React.CSSProperties}
    >
      {/* Glow border for active agents */}
      {isActive && <div className="agent-fleet-card__glow" style={{ background: `radial-gradient(ellipse at 50% -20%, ${accentColor}33, transparent 70%)` }} />}

      {/* Header */}
      <div className="agent-fleet-card__header">
        <div className="agent-fleet-card__avatar" style={{ background: `${accentColor}22`, color: accentColor }}>
          {agent.avatar}
        </div>
        <div
          className={`agent-fleet-card__status ${isActive ? 'active' : 'sleeping'}`}
          style={{ borderColor: isActive ? '#10b981' : '#6b7280' }}
        >
          {isActive ? <Activity size={10} /> : <Moon size={10} />}
          <span>{isActive ? 'ACTIVE' : 'SLEEPING'}</span>
        </div>
      </div>

      {/* Body */}
      <div className="agent-fleet-card__body">
        <div className="agent-fleet-card__name">{agent.name}</div>
        <div className="agent-fleet-card__desc">{agent.description}</div>
      </div>

      {/* Footer */}
      <div className="agent-fleet-card__footer">
        <div className="agent-fleet-card__capabilities">
          {agent.capabilities.slice(0, 2).map((cap: string) => (
            <span key={cap} className="agent-fleet-card__tag">{cap.replace(/-/g, ' ')}</span>
          ))}
          {agent.capabilities.length > 2 && (
            <span className="agent-fleet-card__tag agent-fleet-card__tag--more">
              +{agent.capabilities.length - 2}
            </span>
          )}
        </div>
        {agent.recentActivity && (
          <div className="agent-fleet-card__activity">
            <Zap size={10} />
            <span>{agent.recentActivity}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentFleetCard;
