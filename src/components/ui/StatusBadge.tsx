import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'success' | 'warning' | 'error' | 'info' | 'default';
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type }) => {
  let computedType = type || 'default';
  if (!type) {
    const s = status.toLowerCase();
    if (['active', 'completed', 'connected', 'done'].includes(s)) { computedType = 'success'; }
    else if (['waiting', 'queued', 'needs-auth', 'review'].includes(s)) { computedType = 'warning'; }
    else if (['error', 'failed', 'disconnected'].includes(s)) { computedType = 'error'; }
    else if (['running'].includes(s)) { computedType = 'info'; }
  }

  return (
    <span className={`status-badge status-badge--${computedType}`}>
      <span className="status-badge__dot" />
      {status}
    </span>
  );
};

export default StatusBadge;

