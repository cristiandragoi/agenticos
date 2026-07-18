import React, { useState } from 'react';
import { TerminalSquare, Activity, X, AlertCircle, FileText, Save, ChevronDown, ChevronUp } from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';

interface Props {
  activeGoalId: string | null;
  onClose: () => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

export const CodeXDrawer: React.FC<Props> = ({ activeGoalId, onClose, isOpen, setIsOpen }) => {
  const [activeTab, setActiveTab] = useState('Terminal');
  const { events } = useCodexStore();

  const tabs = [
    { id: 'Terminal', icon: TerminalSquare },
    { id: 'Events', icon: Activity },
    { id: 'Logs', icon: FileText },
    { id: 'Errors', icon: AlertCircle },
    { id: 'Checkpoints', icon: Save }
  ];

  if (!isOpen) {
    return (
      <div className="codex-drawer__closed" onClick={() => setIsOpen(true)}>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <TerminalSquare size={14} />
          <span style={{fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1px'}}>Open Terminal</span>
        </div>
        <ChevronUp size={16} />
      </div>
    );
  }

  return (
    <div className="codex-drawer">
      <div className="codex-drawer__header">
        <div className="codex-drawer__tabs">
          {tabs.map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`codex-drawer__tab ${activeTab === tab.id ? 'active' : ''}`}
            >
              <tab.icon size={12} />
              <span>{tab.id}</span>
            </button>
          ))}
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '8px'}}>
          <button onClick={() => setIsOpen(false)} style={{background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '4px'}}>
            <ChevronDown size={16} />
          </button>
          <button onClick={onClose} style={{background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '4px'}}>
            <X size={16} />
          </button>
        </div>
      </div>
      
      <div className="codex-drawer__content">
        <div style={{display: 'flex', flexDirection: 'column'}}>
          {activeTab === 'Terminal' && (
            <div>
              <div style={{color: '#8b949e', marginBottom: '8px'}}># System Terminal Output</div>
              <div style={{color: '#2ea043', marginBottom: '4px'}}>[SYSTEM] CodeX Terminal initialized.</div>
              {events.length === 0 ? (
                <div style={{color: '#8b949e', marginBottom: '16px'}}>[SYSTEM] Awaiting execution commands...</div>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px'}}>
                  {events.map((ev, i) => {
                    const isErr = ev.state === 'failed' || ev.state === 'cancelled';
                    const isOk = ev.state === 'completed' || ev.state === 'validating';
                    const isWarn = ev.state === 'interrupted_requires_review';
                    const color = isErr ? '#f85149' : isOk ? '#2ea043' : isWarn ? '#d29922' : '#c9d1d9';
                    return (
                      <div key={i} className="codex-drawer__terminal-line">
                        <span style={{color: '#8b949e', flexShrink: 0}}>[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
                        <span style={{color}}>
                          [{ev.state.toUpperCase()}] {ev.action || 'Transitioned state'} {ev.file ? `(${ev.file})` : ''}
                        </span>
                      </div>
                    );
                  })}
                  {events.length > 0 && !['completed', 'failed', 'cancelled', 'interrupted_requires_review'].includes(events[events.length - 1].state) && (
                    <div className="codex-drawer__terminal-line" style={{animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'}}>
                      <span style={{color: '#8b949e', flexShrink: 0}}>[{new Date().toLocaleTimeString()}]</span>
                      <span>...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {['Logs', 'Events', 'Errors', 'Checkpoints'].includes(activeTab) && (
            <div style={{color: '#8b949e'}}>No {activeTab.toLowerCase()} to display.</div>
          )}
        </div>
      </div>
    </div>
  );
};
