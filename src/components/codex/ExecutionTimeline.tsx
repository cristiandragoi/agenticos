import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GoalEvent } from '../../../server/src/types';
import { pairToolExecutions, type ToolExecution } from '../../presenters/executionStatus';
import { getActivityPhrase, getStatusPresentation } from '../../presenters/EventPresenter';
import { ToolExecutionCard } from './ToolExecutionCard';

function formatTime(ts?: string): string {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Compact, readable one-line activity entry. */
const ActivityLine: React.FC<{ event: GoalEvent }> = ({ event }) => {
  const [expanded, setExpanded] = useState(false);
  const colors = getStatusPresentation(event.normalizedStatus || 'idle');
  const phrase = getActivityPhrase(event);
  const hasDetails = !!(event.error || event.technicalMessage || event.errorDetails);

  return (
    <div className="flex items-start gap-3 group">
      <span className="text-[10px] text-slate-600 font-mono mt-1 shrink-0 w-[62px] text-right">
        {formatTime(event.timestamp)}
      </span>
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${colors.colorClass.replace('text-', 'bg-')}`} />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => hasDetails && setExpanded(!expanded)}
          className={`text-left text-[13px] leading-snug ${colors.colorClass} ${hasDetails ? 'hover:underline decoration-slate-600' : 'cursor-default'}`}
        >
          {phrase}
          {hasDetails && (
            expanded
              ? <ChevronDown size={11} className="inline ml-1 opacity-60" />
              : <ChevronRight size={11} className="inline ml-1 opacity-60" />
          )}
        </button>
        {(event.filePath || event.command) && (
          <div className="text-[11px] text-purple-400/80 font-mono truncate" title={event.filePath || event.command}>
            {event.filePath || event.command}
          </div>
        )}
        {expanded && hasDetails && (
          <div className="mt-1.5 bg-[#0A0F16] border border-slate-700/40 rounded-md p-2 flex flex-col gap-1.5">
            {event.error && (
              <div className="text-[11px] text-rose-400 break-all">{event.error}</div>
            )}
            {event.errorDetails && event.errorDetails !== event.error && (
              <div className="text-[11px] text-rose-300/80 break-all">{event.errorDetails}</div>
            )}
            {event.technicalMessage && (
              <pre className="text-[11px] text-slate-400 whitespace-pre-wrap font-mono break-all max-h-40 overflow-y-auto">{event.technicalMessage}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface Props {
  events: GoalEvent[];
  runIsActive: boolean;
}

/**
 * Live execution timeline: interleaves readable activity lines with
 * tool execution cards in chronological order. This is the primary
 * "what is happening" surface — no raw logs by default.
 */
export const ExecutionTimeline: React.FC<Props> = ({ events, runIsActive }) => {
  const executions = useMemo(() => pairToolExecutions(events, runIsActive), [events, runIsActive]);

  const consumedSequences = useMemo(() => {
    const set = new Set<number>();
    for (const ex of executions) {
      set.add(ex.startSequence);
      if (ex.endSequence !== undefined) set.add(ex.endSequence);
    }
    return set;
  }, [executions]);

  const executionByStart = useMemo(() => {
    const map = new Map<number, ToolExecution>();
    for (const ex of executions) map.set(ex.startSequence, ex);
    return map;
  }, [executions]);

  const latestRunningId = useMemo(() => {
    for (let i = executions.length - 1; i >= 0; i--) {
      if (executions[i].state === 'running') return executions[i].id;
    }
    return null;
  }, [executions]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-600">
        <span className="text-sm">No execution events yet.</span>
        <span className="text-xs mt-1 opacity-70">Activity will appear here as CodeX works.</span>
      </div>
    );
  }

  return (
    <div data-testid="codex-timeline" className="flex flex-col gap-2.5">
      {events.map((event) => {
        const toolCard = executionByStart.get(event.sequence);
        if (toolCard) {
          return (
            <div key={`tool-${event.sequence}`} className="pl-[74px]">
              <ToolExecutionCard execution={toolCard} isLatest={toolCard.id === latestRunningId} />
            </div>
          );
        }
        if (consumedSequences.has(event.sequence)) return null;
        return <ActivityLine key={`ev-${event.sequence}`} event={event} />;
      })}
    </div>
  );
};
