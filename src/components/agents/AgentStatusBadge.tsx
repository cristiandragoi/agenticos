import type { NormalizedAgentStatus } from './agentOverviewTypes';

interface AgentStatusBadgeProps {
  status: NormalizedAgentStatus;
}

const LIVE_STATUSES = new Set<NormalizedAgentStatus>(['Active', 'Busy']);

export default function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const isLive = LIVE_STATUSES.has(status);

  return (
    <span className={`agent-status-badge agent-status-badge--${status.toLowerCase()}`}>
      {isLive && <span className="agent-status-badge__signal" aria-hidden="true" />}
      <span>{status}</span>
    </span>
  );
}
