import React from 'react';

export interface TaskData {
  id: string;
  title: string;
  description: string;
  agent: 'Hermes' | 'Jarvis' | 'Welders';
  model: string;
  status: 'Backlog' | 'In Progress' | 'Review' | 'Blocked' | 'Done';
  executionStatus: 'Idle' | 'Running' | 'Blocked' | 'Completed';
}

interface KanbanCardProps {
  task: TaskData;
}

const KanbanCard: React.FC<KanbanCardProps> = ({ task }) => {
  const statusColors: Record<string, string> = {
    'Idle': 'bg-slate-700 text-slate-300 border-slate-600',
    'Running': 'bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse',
    'Blocked': 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    'Completed': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  };

  const agentColors: Record<string, string> = {
    'Hermes': 'from-purple-500 to-indigo-500',
    'Jarvis': 'from-cyan-500 to-blue-500',
    'Welders': 'from-amber-500 to-orange-500',
  };

  return (
    <div className="group bg-[#1E293B] border border-slate-700/50 hover:border-slate-500 rounded-xl p-4 shadow-lg hover:shadow-xl transition-all duration-300 cursor-grab active:cursor-grabbing relative overflow-hidden">
      {/* Subtle top glow based on agent */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${agentColors[task.agent]} opacity-75`} />
      
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-slate-200 text-sm tracking-wide leading-tight group-hover:text-white transition-colors">{task.title}</h3>
      </div>
      
      <p className="text-xs text-slate-400 mb-4 line-clamp-3 leading-relaxed">
        {task.description}
      </p>
      
      <div className="flex flex-wrap items-center gap-2 mt-auto pt-3 border-t border-slate-700/50">
        {/* Agent Tag */}
        <span className={`text-[9px] font-bold uppercase tracking-wider text-white px-2 py-0.5 rounded-full bg-gradient-to-r ${agentColors[task.agent]} shadow-sm`}>
          {task.agent}
        </span>
        
        {/* Model Tag */}
        <span className="text-[10px] font-medium text-slate-300 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md flex items-center gap-1">
          <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          {task.model}
        </span>
        
        {/* Execution Status Badge */}
        <span className={`ml-auto text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${statusColors[task.executionStatus]}`}>
          {task.executionStatus}
        </span>
      </div>
    </div>
  );
};

export default KanbanCard;
