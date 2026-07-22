import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle2, Circle, AlertTriangle, Loader2, XCircle, FileCode } from 'lucide-react';
import { apiClient } from '../../api/client';

interface TeamTimelineProps {
  team: any;
  run?: any;
}

function parseList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatTime(ts?: string): string {
  if (!ts) return '';
  const n = Number(ts);
  const d = isNaN(n) ? new Date(ts) : new Date(n);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface TimelineEntry {
  agentName: string;
  role: string;
  action: string;
  status: string;
  time: string;
  summary?: string;
  artifacts: string[];
}

/**
 * Translate a raw handoff record into a meaningful timeline entry.
 * Raw identifiers (agentId, checksums) stay out of the title — they are
 * only shown inside the expandable details.
 */
function describeHandoff(handoff: any, team: any): TimelineEntry {
  const agents: any[] = team?.teamSheet?.agents || [];
  const agentDef = agents.find(a => a.id === handoff.agentId);
  const agentName = agentDef?.name || agentDef?.role || 'Agent';
  const role = agentDef?.role || '';
  const status = handoff.status || 'completed';
  const artifacts = parseList(handoff.artifacts).map((a: any) => a?.path).filter(Boolean);

  let action: string;
  if (role === 'Planner') {
    action = 'Completed plan';
  } else if (role === 'Verifier') {
    action = status === 'completed' ? 'Checked deliverables' : 'Verification failed';
  } else if (artifacts.length > 0) {
    action = `Created ${artifacts.join(', ')}`;
  } else {
    action = 'Completed implementation';
  }

  return {
    agentName,
    role,
    action,
    status,
    time: formatTime(handoff.createdAt),
    summary: handoff.summary,
    artifacts
  };
}

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-500',
  failed: 'text-red-500',
  blocked: 'text-amber-500'
};

const TeamTimeline: React.FC<TeamTimelineProps> = ({ team, run }) => {
  const [handoffs, setHandoffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let interval: any;
    const fetchHandoffs = async () => {
       if (!run?.id) return;
       try {
         const res = await apiClient.get(`/api/teams/runs/${run.id}/handoffs`);
         setHandoffs(Array.isArray(res) ? res : []);
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

  // The authoritative status is the RUN's; team.status can lag behind
  // (e.g. stuck 'running' while the run is paused/failed/completed).
  const displayStatus = run?.status || team.status;

  return (
    <div className="flex flex-col gap-4 relative min-w-0" data-testid="team-timeline">
      <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-800"></div>
      
      {/* Start node */}
      <div className="flex gap-4 relative z-10">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0">
          <CheckCircle2 size={14} className="text-emerald-500" />
        </div>
        <div className="pt-1.5 min-w-0">
          <h4 className="text-sm font-medium text-gray-200">Team Initialized</h4>
          <p className="text-xs text-gray-500 break-words">Coordinator parsed the prompt and generated the team sheet.</p>
        </div>
      </div>

      {/* Handoff nodes — one meaningful entry per completed agent step */}
      {handoffs.map((handoff, idx) => {
        const entry = describeHandoff(handoff, team);
        const color = STATUS_COLOR[entry.status] || 'text-emerald-500';
        return (
          <div key={handoff.id || idx} className="flex gap-4 relative z-10">
            <div className={`w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0`}>
              <CheckCircle2 size={14} className={color} />
            </div>
            <div className="pt-1 min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h4 className="text-sm font-medium text-gray-200 break-words">
                  {entry.agentName} — {entry.action}
                </h4>
                <span className={`text-[10px] uppercase tracking-wider ${color}`}>{entry.status}</span>
                {entry.time && <span className="text-[10px] text-gray-600">{entry.time}</span>}
              </div>
              {(entry.summary || entry.artifacts.length > 0) && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Details</summary>
                  <div className="mt-1 text-xs text-gray-400 break-words whitespace-pre-wrap">
                    {entry.summary && <p className="mb-1">{entry.summary}</p>}
                    {entry.artifacts.map(p => (
                      <div key={p} className="flex items-center gap-1 text-purple-400/80 font-mono break-all">
                        <FileCode size={10} /> {p}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      })}

      {/* Active node */}
      {displayStatus === 'running' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/50 flex items-center justify-center shrink-0">
            <Loader2 size={14} className="text-blue-400 animate-spin" />
          </div>
          <div className="pt-1.5 min-w-0">
            <h4 className="text-sm font-medium text-blue-400">Agent Executing</h4>
            <p className="text-xs text-gray-500 break-words">The current agent is working on the task...</p>
          </div>
        </div>
      )}

      {displayStatus === 'completed' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/50 flex items-center justify-center shrink-0">
            <CheckCircle2 size={14} className="text-purple-400" />
          </div>
          <div className="pt-1.5 min-w-0">
            <h4 className="text-sm font-medium text-purple-400">Team Completed</h4>
            <p className="text-xs text-gray-500 break-words">The goal has been verified and achieved.</p>
          </div>
        </div>
      )}

      {displayStatus === 'failed' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/50 flex items-center justify-center shrink-0">
            <XCircle size={14} className="text-red-500" />
          </div>
          <div className="pt-1.5 min-w-0">
            <h4 className="text-sm font-medium text-red-500">Team Failed</h4>
            <p className="text-xs text-gray-500 break-words">Execution encountered an unrecoverable error or was aborted.</p>
          </div>
        </div>
      )}

      {displayStatus === 'paused' && (
        <div className="flex gap-4 relative z-10">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center shrink-0">
            <AlertTriangle size={14} className="text-amber-500" />
          </div>
          <div className="pt-1.5 min-w-0">
            <h4 className="text-sm font-medium text-amber-500">Paused (Review or Repair)</h4>
            <p className="text-xs text-gray-500 break-words">Execution is paused. Review the blocking issues or resume to continue.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamTimeline;
