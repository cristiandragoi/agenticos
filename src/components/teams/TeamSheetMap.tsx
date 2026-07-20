import React from 'react';
import { Bot, ArrowRight, CheckCircle2 } from 'lucide-react';

interface TeamSheetMapProps {
  teamSheet: any;
}

const TeamSheetMap: React.FC<TeamSheetMapProps> = ({ teamSheet }) => {
  if (!teamSheet || !teamSheet.agents) return null;

  return (
    <div className="flex flex-col gap-3">
      {teamSheet.agents.map((agent: any, index: number) => (
        <div key={index} className="flex flex-col">
          <div className="bg-[#1A1A1E] border border-gray-700 rounded-lg p-3 flex gap-3 relative">
            <div className="w-10 h-10 rounded bg-gray-800 flex items-center justify-center shrink-0">
              <Bot size={20} className="text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-start">
                <h4 className="text-sm font-semibold text-gray-200 truncate">{agent.name}</h4>
                <span className="text-[10px] uppercase tracking-wider bg-gray-800 px-2 py-0.5 rounded text-gray-400">
                  {agent.role}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{agent.instructions}</p>
            </div>
          </div>
          {index < teamSheet.agents.length - 1 && (
            <div className="flex justify-center py-2">
              <ArrowRight size={16} className="text-gray-600 rotate-90" />
            </div>
          )}
        </div>
      ))}
      
      {/* Verification Agent logic is typically built-in or appended implicitly, but we can visualize completion */}
      <div className="flex justify-center py-2">
        <ArrowRight size={16} className="text-gray-600 rotate-90" />
      </div>
      <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-3 flex items-center justify-center gap-2">
        <CheckCircle2 size={16} className="text-emerald-500" />
        <span className="text-sm text-emerald-400 font-medium">Goal Evaluation</span>
      </div>
    </div>
  );
};

export default TeamSheetMap;
