import React, { useEffect } from 'react';
import { useCodexStore } from '../../store/codexStore';
import { StudioChat } from './StudioChat';
import { StudioBoard } from './StudioBoard';
import { StudioRecovery } from './StudioRecovery';
import { StudioPlan } from './StudioPlan';
import { StudioFiles } from './StudioFiles';
import { StudioEmptyState } from './StudioEmptyState';
import { MessageSquare, LayoutList, Kanban, FolderCode, GitCompare, TerminalSquare, ShieldCheck, Activity, Save } from 'lucide-react';

interface Props {
  activeGoalId: string | null;
  goalStatus: string | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onGoalCreated?: (id: string) => void;
}

export const StudioWorkspace: React.FC<Props> = ({ activeGoalId, goalStatus, activeTab, setActiveTab, onGoalCreated }) => {

  const { setEvents } = useCodexStore();

  useEffect(() => {
    if (!activeGoalId) {
      setEvents([]);
      return;
    }

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
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={14} /> },
    { id: 'plan', label: 'Plan', icon: <LayoutList size={14} /> },
    { id: 'board', label: 'Board', icon: <Kanban size={14} /> },
    { id: 'files', label: 'Files', icon: <FolderCode size={14} /> },
    { id: 'diff', label: 'Diff', icon: <GitCompare size={14} /> },
    { id: 'terminal', label: 'Terminal', icon: <TerminalSquare size={14} /> },
    { id: 'validation', label: 'Validation', icon: <ShieldCheck size={14} /> },
    { id: 'events', label: 'Events', icon: <Activity size={14} /> },
    { id: 'checkpoints', label: 'Checkpoints', icon: <Save size={14} /> },
  ];

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="flex bg-[#252526] shrink-0 overflow-x-auto hide-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 text-[13px] border-r border-[#333333] transition-colors whitespace-nowrap min-w-[120px] max-w-[200px] ${
              activeTab === tab.id 
                ? 'bg-[#1e1e1e] text-emerald-400 border-t-[2px] border-t-emerald-500 shadow-[0_-1px_0_#1e1e1e]' 
                : 'bg-[#2d2d2d] text-[#858585] hover:bg-[#333333] border-t-[2px] border-t-transparent'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>
      
      <div className="flex-1 relative overflow-hidden bg-[#1e1e1e]">
        {!activeGoalId && activeTab === 'chat' ? (
          <StudioEmptyState onGoalCreated={onGoalCreated!} />
        ) : (
          <>
            {activeTab === 'chat' && <StudioChat activeGoalId={activeGoalId} />}
            {activeTab === 'plan' && <StudioPlan activeGoalId={activeGoalId} />}
            {activeTab === 'board' && <StudioBoard activeGoalId={activeGoalId} />}
            {activeTab === 'files' && <StudioFiles activeGoalId={activeGoalId} />}
            
            {activeTab === 'diff' && <StudioFiles activeGoalId={activeGoalId} />}
            {activeTab === 'events' && <StudioChat activeGoalId={activeGoalId} />}
            
            {['terminal', 'validation', 'checkpoints'].includes(activeTab) && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 font-mono text-sm space-y-4">
                <div className="w-16 h-16 rounded-full bg-[#111823] border border-slate-700 flex items-center justify-center">
                  <Activity size={24} className="text-slate-400 opacity-50" />
                </div>
                {!activeGoalId ? (
                  <span>No active goal selected.</span>
                ) : (
                  <div className="text-center">
                    <span className="text-slate-400 font-bold uppercase tracking-widest text-xs">Awaiting {activeTab} Data</span>
                    <p className="text-[10px] mt-2 opacity-50">This panel will populate when CodeX triggers relevant events.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {goalStatus === 'interrupted_requires_review' && (
        <StudioRecovery activeGoalId={activeGoalId!} />
      )}
    </div>
  );
};
