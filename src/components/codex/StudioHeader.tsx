import React from 'react';
import { Terminal, Play, Pause, AlertTriangle, Shield, Clock, PanelRightOpen, PanelBottomOpen, XCircle } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  activeGoalId: string | null;
  goalStatus: string | null;
  setGoalStatus: (status: string) => void;
  goals: any[];
  toggleDrawer: () => void;
  toggleInspector: () => void;
}

export const StudioHeader: React.FC<Props> = ({ activeGoalId, goalStatus, setGoalStatus, goals, toggleDrawer, toggleInspector }) => {
  const activeGoal = goals.find(g => g.id === activeGoalId);

  const handlePause = async () => {
    if (!activeGoalId) return;
    await apiFetch(`/api/chat/agents/goal/${activeGoalId}/pause`, { method: 'POST' });
    setGoalStatus('pause_requested');
  };

  const handleResume = async () => {
    if (!activeGoalId) return;
    await apiFetch(`/api/chat/agents/goal/${activeGoalId}/resume`, { method: 'POST' });
    setGoalStatus('queued');
  };
  
  const handleCancel = async () => {
    if (!activeGoalId) return;
    await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'abort' })
    });
    setGoalStatus('cancelled');
  };

  return (
    <div className="h-10 border-b border-[#333333] bg-[#252526] px-3 flex items-center justify-between shrink-0 relative z-20 text-xs">
      <div className="flex items-center gap-3">
        <Terminal size={14} className="text-[#cccccc]" />
        <span className="font-medium text-[#cccccc]">CodeX Studio</span>
        {activeGoalId && activeGoal && (
          <span className="text-[#858585] mx-1">• {activeGoal.originalGoal?.slice(0, 40) || 'Active Goal'}{activeGoal.originalGoal?.length > 40 ? '...' : ''}</span>
        )}
      </div>

      {activeGoalId && activeGoal && (
        <div className="flex-1 flex items-center justify-center gap-4 text-[#cccccc]">
          <div className="flex items-center gap-2">
            <span className="text-[#858585]">Exec:</span>
            <span>Ollama</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#858585]">Val:</span>
            <span>OmniRoute</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#858585]">Phase:</span>
            <span className="text-amber-400">{goalStatus || 'UNKNOWN'}</span>
          </div>
          <div className="flex items-center gap-1 text-[#858585]">
            <Clock size={12}/>
            <span>{activeGoal.createdAt && !isNaN(new Date(activeGoal.createdAt).getTime()) ? Math.floor((Date.now() - new Date(activeGoal.createdAt).getTime()) / 60000) : 0}m</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1">
        {goalStatus === 'interrupted_requires_review' && (
          <span className="flex items-center gap-1 text-rose-400 mr-3">
            <AlertTriangle size={12} /> Recovery Required
          </span>
        )}
        
        {activeGoalId && goalStatus && !['paused', 'completed', 'failed', 'cancelled', 'interrupted_requires_review'].includes(goalStatus) && (
          <button onClick={handlePause} className="flex items-center gap-1.5 px-2 py-1 hover:bg-[#37373d] text-[#cccccc] rounded-sm transition-colors" title="Pause">
            <Pause size={14} /> Pause
          </button>
        )}
        {activeGoalId && ['paused', 'failed', 'interrupted'].includes(goalStatus || '') && (
          <button onClick={handleResume} className="flex items-center gap-1.5 px-2 py-1 hover:bg-[#37373d] text-emerald-400 rounded-sm transition-colors" title="Resume">
            <Play size={14} /> Resume
          </button>
        )}
        {activeGoalId && !['completed', 'cancelled'].includes(goalStatus || '') && (
          <button onClick={handleCancel} className="flex items-center gap-1.5 px-2 py-1 hover:bg-[#37373d] text-rose-400 rounded-sm transition-colors" title="Cancel">
            <XCircle size={14} /> Cancel
          </button>
        )}

        <div className="w-px h-4 bg-[#444444] mx-1"></div>

        <button onClick={toggleDrawer} className="p-1 hover:bg-[#37373d] text-[#cccccc] rounded-sm transition-colors" title="Toggle Terminal">
          <PanelBottomOpen size={16} />
        </button>
        <button onClick={toggleInspector} className="p-1 hover:bg-[#37373d] text-[#cccccc] rounded-sm transition-colors" title="Toggle Inspector">
          <PanelRightOpen size={16} />
        </button>
      </div>
    </div>
  );
};
