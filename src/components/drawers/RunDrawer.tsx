import { useData } from '../../store/dataStore';
import React from 'react';

import DrawerShell from './DrawerShell';
import StatusBadge from '../ui/StatusBadge';

interface RunDrawerProps {
  entityId: string;
  onClose: () => void;
  onPin: () => void;
  isPinned: boolean;
}

const RunDrawer: React.FC<RunDrawerProps> = ({ entityId, onClose, onPin, isPinned }) => {
  const { runs: mockRuns, agents: mockAgents } = useData();
  const run = mockRuns.find(r => r.id === entityId);
  if (!run) return null;
  const agent = mockAgents.find(a => a.id === run.agentId);

  return (
    <DrawerShell 
      title={`Run ${run.id.slice(0, 8)}`} 
      subtitle={`Agent: ${agent?.name || run.agentId}`} 
      onClose={onClose} 
      onPin={onPin} 
      isPinned={isPinned}
    >
      <div className="drawer-section">
        <div className="drawer-section__label">Status</div>
        <div className="flex-row gap-2" style={{ alignItems: 'center' }}>
          <StatusBadge status={run.status} />
          {run.durationMs && <span className="text-xs text-muted">{run.durationMs}ms</span>}
        </div>
      </div>
      <div className="drawer-section">
        <div className="drawer-section__label">Input</div>
        <p className="text-sm text-primary">{run.input}</p>
      </div>
      {run.output && (
        <div className="drawer-section">
          <div className="drawer-section__label">Output</div>
          <p className="text-sm text-primary">{run.output}</p>
        </div>
      )}
      <div className="drawer-section">
        <div className="drawer-section__label">Logs</div>
        <div className="log-stream" style={{ background: 'var(--bg-base)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
          {run.logs.map((log, i) => (
            <div key={i} className="log-stream__entry">{log}</div>
          ))}
          {run.logs.length === 0 && <div className="text-muted text-xs">No logs available.</div>}
        </div>
      </div>
    </DrawerShell>
  );
};
export default RunDrawer;


