import { ArrowLeft, ExternalLink, X } from 'lucide-react';
import AgentStatusBadge from './AgentStatusBadge';
import type { AgentOverviewCardData } from './agentOverviewTypes';

interface AgentDetailsProps {
  agent: AgentOverviewCardData;
  onClose: () => void;
  onOpen: () => void;
}

export default function AgentDetails({ agent, onClose, onOpen }: AgentDetailsProps) {
  return (
    <section
      className="agent-details-panel"
      aria-label={`${agent.entry.name} details`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="agent-details-panel__header">
        <button
          type="button"
          className="agent-details-panel__back"
          onClick={onClose}
          aria-label="Back to agents overview"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          className="agent-details-panel__close"
          onClick={onClose}
          aria-label={`Close ${agent.entry.name} details`}
        >
          <X size={16} aria-hidden="true" />
          Close
        </button>
      </div>

      <div className="agent-details-panel__identity">
        <div>
          <h2>{agent.entry.name}</h2>
          <p>{agent.role}</p>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>

      <dl className="agent-details-panel__facts">
        <div>
          <dt>Status</dt>
          <dd>{agent.status}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>{agent.providerLabel}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{agent.modelLabel}</dd>
        </div>
        <div>
          <dt>Current activity</dt>
          <dd>{agent.activityLabel}</dd>
        </div>
      </dl>

      <div className="agent-details-panel__capabilities">
        <h3>Capabilities</h3>
        {agent.capabilities.length > 0 ? (
          <ul>
            {agent.capabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        ) : (
          <p>Unavailable</p>
        )}
      </div>

      <div className="agent-details-panel__actions">
        <button
          type="button"
          className="agent-details-panel__open"
          onClick={onOpen}
          aria-label={`Open Agent ${agent.entry.name}`}
        >
          <ExternalLink size={16} aria-hidden="true" />
          Open Agent
        </button>
      </div>
    </section>
  );
}
