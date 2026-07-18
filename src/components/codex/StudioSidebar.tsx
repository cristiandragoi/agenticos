import React from 'react';
import { ChevronRight, ChevronDown, Check, X, AlertTriangle, Play, FolderGit2, GitBranch, History, CheckCircle2 } from 'lucide-react';

interface Props {
  goals: any[];
  activeGoalId: string | null;
  onSelectGoal: (id: string) => void;
  onNewGoal: () => void;
}

export const StudioSidebar: React.FC<Props> = ({ goals, activeGoalId, onSelectGoal, onNewGoal }) => {
  const activeGoals = goals.filter(g => !['completed', 'cancelled', 'failed', 'interrupted_requires_review'].includes(g.status));
  const reviewGoals = goals.filter(g => g.status === 'interrupted_requires_review');
  const historyGoals = goals.filter(g => ['completed', 'cancelled', 'failed'].includes(g.status));

  const renderGoalItem = (g: any) => {
    const isActive = activeGoalId === g.id;
    return (
      <button 
        key={g.id}
        onClick={() => onSelectGoal(g.id)}
        className={`w-full text-left py-1 px-4 flex items-center gap-2 transition-colors ${
          isActive 
            ? 'bg-[#37373d] border-l-2 border-emerald-500 text-white' 
            : 'bg-transparent border-l-2 border-transparent hover:bg-[#2a2d2e] text-[#cccccc]'
        }`}
      >
        {g.status === 'completed' ? <Check size={14} className="text-emerald-500 shrink-0" /> :
         g.status === 'failed' ? <X size={14} className="text-rose-500 shrink-0" /> :
         g.status === 'interrupted_requires_review' ? <AlertTriangle size={14} className="text-amber-500 shrink-0" /> :
         <Play size={14} className="text-indigo-400 shrink-0" />}
        <span className="text-[13px] truncate flex-1">
          {g.originalGoal || 'Untitled Goal'}
        </span>
      </button>
    );
  };

  const renderSectionHeader = (title: string, count?: number) => (
    <div className="flex items-center gap-1 px-4 py-1.5 mt-2 text-[11px] font-bold uppercase tracking-widest text-[#cccccc] cursor-pointer hover:bg-[#2a2d2e] transition-colors">
      <ChevronDown size={14} />
      <span>{title}</span>
      {count !== undefined && count > 0 && <span className="ml-auto text-[#858585]">{count}</span>}
    </div>
  );

  return (
    <div className="w-full bg-[#252526] flex flex-col h-full shrink-0 select-none">
      <div className="px-4 py-2 border-b border-[#333333]">
        <button 
          onClick={onNewGoal}
          className="w-full flex items-center justify-center py-1 bg-[#37373d] hover:bg-[#444444] text-[#cccccc] rounded-sm transition-colors text-xs border border-[#333333]"
        >
          New Goal
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto pb-4">
        
        {reviewGoals.length > 0 && (
          <div>
            {renderSectionHeader('Approvals', reviewGoals.length)}
            <div className="py-0.5">
              {reviewGoals.map(renderGoalItem)}
            </div>
          </div>
        )}

        <div>
          {renderSectionHeader('Active Goals', activeGoals.length)}
          <div className="py-0.5">
            {activeGoals.length > 0 ? activeGoals.map(renderGoalItem) : (
              <div className="px-8 py-1 text-[13px] text-[#858585] italic">
                No active goals.
              </div>
            )}
          </div>
        </div>

        <div>
          {renderSectionHeader('History', historyGoals.length)}
          <div className="py-0.5">
            {historyGoals.map(renderGoalItem)}
          </div>
        </div>

        <div>
          {renderSectionHeader('Workspace')}
          <div className="py-0.5">
            <button className="w-full text-left py-1 px-4 flex items-center gap-2 hover:bg-[#2a2d2e] text-[#cccccc] border-l-2 border-transparent transition-colors">
              <CheckCircle2 size={14} className="text-[#858585] shrink-0" />
              <span className="text-[13px] truncate">Checkpoints</span>
            </button>
            <button className="w-full text-left py-1 px-4 flex items-center gap-2 hover:bg-[#2a2d2e] text-[#cccccc] border-l-2 border-transparent transition-colors">
              <FolderGit2 size={14} className="text-[#858585] shrink-0" />
              <span className="text-[13px] truncate">Workspace Files</span>
            </button>
            <button className="w-full text-left py-1 px-4 flex items-center gap-2 hover:bg-[#2a2d2e] text-[#cccccc] border-l-2 border-transparent transition-colors">
              <GitBranch size={14} className="text-[#858585] shrink-0" />
              <span className="text-[13px] truncate">Git Changes</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
