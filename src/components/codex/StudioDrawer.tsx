import React, { useState, useEffect } from 'react';
import { TerminalSquare, Shield, Activity, X, AlertCircle, FileText, Zap } from 'lucide-react';

interface Props {
  activeGoalId: string | null;
  onClose: () => void;
}

export const StudioDrawer: React.FC<Props> = ({ activeGoalId, onClose }) => {
  const [breakers, setBreakers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Terminal');

  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const fetchBreakers = async () => {
      try {
        const res = await fetch('/api/chat/agents/circuit-breakers');
        const data = await res.json();
        setBreakers(Array.isArray(data) ? data : []);
      } catch (e) {}
    };
    fetchBreakers();
    const interval = setInterval(fetchBreakers, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeGoalId) {
      setEvents([]);
      return;
    }
    
    // Fetch initial history
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/chat/agents/goal/${activeGoalId}`);
        const data = await res.json();
        if (data.history) {
          setEvents(data.history);
        }
      } catch (e) {}
    };
    fetchHistory();
    
    const es = new EventSource(`/api/chat/agents/goal/stream/${activeGoalId}`);
    es.addEventListener('goal_event', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setEvents(prev => {
          if (prev.find(p => p.sequenceId === data.sequenceId)) return prev;
          return [...prev, data].sort((a, b) => a.sequenceId - b.sequenceId);
        });
      } catch (err) {}
    });

    return () => es.close();
  }, [activeGoalId]);

  const tabs = [
    { id: 'Terminal', icon: TerminalSquare },
    { id: 'Logs', icon: FileText },
    { id: 'Events', icon: Zap },
    { id: 'Errors', icon: AlertCircle },
    { id: 'Circuit Breakers', icon: Shield },
    { id: 'Lease Activity', icon: Activity }
  ];

  return (
    <div className="h-full bg-[#1e1e1e] flex flex-col shrink-0 select-none border-t border-[#333333]">
      <div className="flex items-center justify-between px-4 bg-[#252526] border-b border-[#333333]">
        <div className="flex gap-4 overflow-x-auto hide-scrollbar">
          {tabs.map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-[11px] uppercase tracking-widest flex items-center gap-1.5 py-1.5 transition-colors whitespace-nowrap border-b border-transparent ${
                activeTab === tab.id 
                  ? 'text-[#cccccc] border-b-emerald-500 font-bold' 
                  : 'text-[#858585] hover:text-[#cccccc]'
              }`}
            >
              <span>{tab.id}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="p-0.5 text-[#858585] hover:bg-[#37373d] hover:text-[#cccccc] rounded-sm transition-colors">
          <X size={14} />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 bg-[#1e1e1e] font-mono text-[13px] leading-relaxed select-text flex flex-col-reverse">
        <div className="flex flex-col">
          {activeTab === 'Terminal' && (
            <div>
              <div className="text-[#858585] mb-2"># System Terminal Output</div>
              <div className="text-emerald-400 mb-1">[SYSTEM] CodeX Terminal initialized.</div>
              {events.length === 0 ? (
                <div className="text-[#cccccc] mb-4">[SYSTEM] Awaiting execution commands...</div>
              ) : (
                <div className="mt-2 space-y-1">
                  {events.map((ev, i) => (
                    <div key={i} className="flex gap-3 text-[#cccccc]">
                      <span className="text-[#858585] shrink-0">[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
                      <span className={
                        ev.state === 'failed' || ev.state === 'cancelled' ? 'text-rose-400' :
                        ev.state === 'completed' || ev.state === 'validating' ? 'text-emerald-400' :
                        ev.state === 'interrupted_requires_review' ? 'text-amber-400' :
                        'text-[#cccccc]'
                      }>
                        [{ev.state.toUpperCase()}] {ev.action || 'Transitioned state'} {ev.file ? `(${ev.file})` : ''}
                      </span>
                    </div>
                  ))}
                  {events.length > 0 && !['completed', 'failed', 'cancelled', 'interrupted_requires_review'].includes(events[events.length - 1].state) && (
                    <div className="flex gap-3 text-[#cccccc] animate-pulse mt-2">
                      <span className="text-[#858585] shrink-0">[{new Date().toLocaleTimeString()}]</span>
                      <span>...</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'Circuit Breakers' && (
            <div>
              <div className="text-[#858585] mb-4"># Circuit Breaker Status</div>
              {breakers.length === 0 ? (
                <div className="text-[#555555]">No circuit breakers tripped or registered.</div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {breakers.map(b => (
                    <div key={b.id} className="bg-[#252526] border border-[#333333] p-3">
                      <div className="text-[#cccccc] font-medium mb-1">{b.provider} - {b.model}</div>
                      <div className="text-[#858585] text-xs">Errors: <span className={b.errorCount > 0 ? 'text-rose-400' : 'text-emerald-400'}>{b.errorCount}</span></div>
                      {b.cooldownUntil && (
                        <div className="text-amber-400 mt-1 text-[10px]">Cooldown until: {new Date(b.cooldownUntil).toLocaleTimeString()}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {['Logs', 'Events', 'Errors', 'Lease Activity'].includes(activeTab) && (
            <div className="text-[#555555]">No {activeTab.toLowerCase()} to display.</div>
          )}
        </div>
      </div>
    </div>
  );
};
