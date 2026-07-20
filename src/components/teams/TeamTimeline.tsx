import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle2, Circle, AlertTriangle, Loader2, XCircle } from 'lucide-react';
import { apiClient } from '../../api/client';

interface TeamTimelineProps {
  team: any;
  run?: any;
}

const TeamTimeline: React.FC<TeamTimelineProps> = ({ team, run }) => {
  const [handoffs, setHandoffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let interval: any;
    const fetchHandoffs = async () => {
       if (!run?.id) return;
       try {
         const res = await apiClient.get(`/api/teams/runs/${run.id}/handoffs`);
         setHandoffs(res || []);
       } catch (err) {
         console.error('Failed to fetch handoffs', err);
       }
    };
    
    fetchHandoffs();
    if (team.status === 'running') {
      interval = setInterval(fetchHandoffs, 3000);
    }
    return () => clearInterval(interval);
  }, [team.id, team.status, run?.id]);

  return (
    <div className="flex flex-col gap-4 relative">
      <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-800"></div>
      
      {/* Start node */}
      <div className="flex gap-4 relative z-10">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0">
          <CheckCircle2 size={14} className="text-emerald-500" />
        </div>
        <div className="pt-1.5">
          <h4 className="text-sm font-medium text-gray-200">Team Initialized</h4>
          <p className="text-xs text-gray-500">Coordinator parsed the prompt and generated the team sheet.</p>
        </div>
      </div>

      {/* Handoff nodes (if any) */}
      {handoffs.map((handoff, idx) => (
        <div key={handoff.id || idx} className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0">
            <CheckCircle2 size={14} className="text-emerald-500" />
          </div>
          <div className="pt-1.5">
            <h4 className="text-sm font-medium text-gray-200">Handoff: {handoff.fromAgentId} &rarr; {handoff.toAgentId}</h4>
            <p className="text-xs text-gray-500 truncate max-w-[250px]">{handoff.summary}</p>
          </div>
        </div>
      ))}

      {/* Active node */}
      {team.status === 'running' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center shrink-0">
            <Loader2 size={14} className="text-blue-400 animate-spin" />
          </div>
          <div className="pt-1.5">
            <h4 className="text-sm font-medium text-blue-400">Agent Executing</h4>
            <p className="text-xs text-gray-500">The current agent is working on the task...</p>
          </div>
        </div>
      )}

      {team.status === 'completed' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center shrink-0">
            <CheckCircle2 size={14} className="text-purple-400" />
          </div>
          <div className="pt-1.5">
            <h4 className="text-sm font-medium text-purple-400">Team Completed</h4>
            <p className="text-xs text-gray-500">The goal has been verified and achieved.</p>
          </div>
        </div>
      )}

      {team.status === 'failed' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center shrink-0">
            <XCircle size={14} className="text-red-500" />
          </div>
          <div className="pt-1.5">
            <h4 className="text-sm font-medium text-red-500">Team Failed</h4>
            <p className="text-xs text-gray-500">Execution encountered an unrecoverable error or was aborted.</p>
          </div>
        </div>
      )}

      {team.status === 'paused' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center shrink-0">
            <AlertTriangle size={14} className="text-amber-500" />
          </div>
          <div className="pt-1.5">
            <h4 className="text-sm font-medium text-amber-500">Paused (Recovery Conflict)</h4>
            <p className="text-xs text-gray-500">Waiting for user resolution on checkpoint mismatch.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamTimeline;
