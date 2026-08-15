import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
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

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <button 
      onClick={handleCopy} 
      className="px-2 py-0.5 text-[10px] flex items-center gap-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

const MarkdownComponents = {
  pre({ children, ...props }: any) {
    const codeElement = children as React.ReactElement<any>;
    const codeText = codeElement?.props?.children || '';
    return (
      <div className="relative my-2">
        <div className="absolute top-2 right-2 z-10">
          <CopyButton text={String(codeText).replace(/\n$/, '')} label="Copy code" />
        </div>
        <pre className="bg-[#090C10] p-3 pt-6 rounded border border-slate-800 overflow-x-auto text-[11px] font-mono text-slate-300" {...props}>
          {children}
        </pre>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    return <code className={`${className || ''} bg-[#090C10] px-1.5 py-0.5 rounded text-[11px] font-mono text-purple-300 border border-slate-800`} {...props}>{children}</code>;
  },
  h1({ children, ...props }: any) {
    return <h1 className="text-[14px] font-bold text-slate-100 mt-3 mb-1.5 border-b border-slate-700/40 pb-1" {...props}>{children}</h1>;
  },
  h2({ children, ...props }: any) {
    return <h2 className="text-[13px] font-bold text-slate-200 mt-2.5 mb-1" {...props}>{children}</h2>;
  },
  h3({ children, ...props }: any) {
    return <h3 className="text-[12px] font-bold text-emerald-400 mt-2 mb-1" {...props}>{children}</h3>;
  },
  p({ children, ...props }: any) {
    return <p className="mb-1.5 leading-relaxed text-slate-300" {...props}>{children}</p>;
  },
  ul({ children, ...props }: any) {
    return <ul className="list-disc list-inside mb-2 space-y-0.5 text-slate-300" {...props}>{children}</ul>;
  },
  ol({ children, ...props }: any) {
    return <ol className="list-decimal list-inside mb-2 space-y-0.5 text-slate-300" {...props}>{children}</ol>;
  },
  li({ children, ...props }: any) {
    return <li className="text-[12px] leading-relaxed" {...props}>{children}</li>;
  }
};

/** Compact, readable one-line activity entry with rich expandable result support. */
const ActivityLine: React.FC<{ event: GoalEvent }> = ({ event }) => {
  const isCompletion = event.eventType === 'agent_completed' || event.eventType === 'task_completed' || event.tool === 'finish' || event.state === 'completed';
  const finalAnswer = (event.payload?.finalAnswer || (event.message && !event.message.startsWith('Executing') ? event.message.replace(/^Goal finished:\s*/i, '') : '')).trim();
  
  const [expanded, setExpanded] = useState(isCompletion && !!finalAnswer);
  const colors = getStatusPresentation(event.normalizedStatus || 'idle');
  const phrase = getActivityPhrase(event);
  const hasDetails = !!(event.error || event.technicalMessage || event.errorDetails || (isCompletion && finalAnswer));

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
          <div className="mt-1.5 bg-[#0A0F16] border border-slate-700/40 rounded-md p-3 flex flex-col gap-2">
            {isCompletion && finalAnswer && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Final Result
                  </span>
                  <CopyButton text={finalAnswer} label="Copy result" />
                </div>
                <div className="text-[12px] text-slate-200 leading-relaxed font-sans overflow-x-auto">
                  <ReactMarkdown components={MarkdownComponents}>{finalAnswer}</ReactMarkdown>
                </div>
              </div>
            )}
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
 * tool execution cards in chronological order.
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
