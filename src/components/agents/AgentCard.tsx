import { Activity, Cpu, Database, Route } from 'lucide-react';
import type { CSSProperties, KeyboardEvent } from 'react';
import AgentStatusBadge from './AgentStatusBadge';
import type { AgentOverviewCardData } from './agentOverviewTypes';

interface AgentCardProps {
  agent: AgentOverviewCardData;
  index: number;
  isSelected: boolean;
  isInactive: boolean;
  onSelect: () => void;
}

export default function AgentCard({ agent, index, isSelected, isInactive, onSelect }: AgentCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <button
      type="button"
      className={[
        'agent-overview-card',
        isSelected ? 'agent-overview-card--selected' : '',
        isInactive ? 'agent-overview-card--inactive' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--agent-index': index } as CSSProperties}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-pressed={isSelected}
      aria-label={`${agent.entry.name} agent card`}
      data-testid="agent-overview-card"
    >
      <span className="agent-overview-card__topline">
        <span className="agent-overview-card__mark" aria-hidden="true">
          {agent.entry.name.slice(0, 1)}
        </span>
        <AgentStatusBadge status={agent.status} />
      </span>

      <span className="agent-overview-card__body">
        <span className="agent-overview-card__name">{agent.entry.name}</span>
        <span className="agent-overview-card__role">{agent.role}</span>
      </span>

      <span className="agent-overview-card__meta">
        <span>
          <Database size={14} aria-hidden="true" />
          <span>{agent.providerLabel}</span>
        </span>
        <span>
          <Cpu size={14} aria-hidden="true" />
          <span>{agent.modelLabel}</span>
        </span>
        <span>
          <Activity size={14} aria-hidden="true" />
          <span>{agent.activityLabel}</span>
        </span>
        <span>
          <Route size={14} aria-hidden="true" />
          <span>{agent.capabilities.length > 0 ? `${agent.capabilities.length} capabilities` : 'Capabilities unavailable'}</span>
        </span>
      </span>
    </button>
  );
}
