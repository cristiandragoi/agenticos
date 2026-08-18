// @ts-nocheck
import React from 'react';
import { useData } from '../../store/dataStore';
import { useDrawer } from '../../store/appStore';
import { Clock, User, CheckCircle, XCircle, Play } from 'lucide-react';

const Sessions: React.FC = () => {
  const { runs, agents } = useData();
  const drawer = useDrawer();

  const sessionList = (runs || []).slice().sort(
    (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const getAgentName = (agentId: string) => {
    const agent = (agents || []).find((a: any) => a.id === agentId);
    return agent?.name || agentId;
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { class: string; label: string }> = {
      running: { class: 'badge--success', label: 'Running' },
      queued: { class: 'badge--info', label: 'Queued' },
      waiting: { class: 'badge--warning', label: 'Awaiting Input' },
      completed: { class: 'badge--success', label: 'Completed' },
      failed: { class: 'badge--error', label: 'Failed' },
      archived: { class: 'badge--default', label: 'Archived' },
    };
    return map[status] || { class: 'badge--default', label: status };
  };

  return (
    <div className="jarvis-sessions">
      <div className="jarvis-sessions__header">
        <h2>Agent Sessions</h2>
        <span className="text-dim">{sessionList.length} total sessions</span>
      </div>
      <div className="jarvis-sessions__list">
        {sessionList.map((run: any) => {
          const badge = getStatusBadge(run.status);
          return (
            <div
              key={run.id}
              className="jarvis-session-row"
              onClick={() => drawer.open('run', run.id)}
            >
              <div className="jarvis-session-row__agent">
                <User size={14} />
                <span>{getAgentName(run.agentId)}</span>
              </div>
              <div className="jarvis-session-row__preview">
                {run.input?.slice(0, 80)}{run.input?.length > 80 ? '...' : ''}
              </div>
              <div className="jarvis-session-row__meta">
                <span className={`status-badge ${badge.class}`}>
                  <span className="status-badge__dot" />
                  {badge.label}
                </span>
                <span className="text-xxs text-dim">
                  <Clock size={10} />
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
        {sessionList.length === 0 && (
          <div className="jarvis-empty">No sessions found</div>
        )}
      </div>
    </div>
  );
};

export default Sessions;