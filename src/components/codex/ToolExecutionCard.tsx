import React, { useState } from 'react';
import {
  Eye, Edit3, Terminal, ShieldCheck, HelpCircle,
  ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Clock
} from 'lucide-react';
import type { ToolExecution, ToolExecutionState } from '../../presenters/executionStatus';
import { getToolLabel } from '../../presenters/EventPresenter';

const TOOL_ICON: Record<string, any> = {
  readFile: Eye,
  writeFile: Edit3,
  runCommand: Terminal,
  reasoningQuery: ShieldCheck,
  finish: CheckCircle2
};

const STATE_STYLE: Record<ToolExecutionState, { chip: string; label: string }> = {
  queued: { chip: 'bg-slate-700/40 text-slate-300 border-slate-600/50', label: 'Queued' },
  running: { chip: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40', label: 'Running' },
  completed: { chip: 'bg-blue-500/15 text-blue-400 border-blue-500/40', label: 'Completed' },
  failed: { chip: 'bg-rose-500/15 text-rose-400 border-rose-500/40', label: 'Failed' }
};

function formatTime(ts?: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface Props {
  execution: ToolExecution;
  isLatest: boolean;
}

/**
 * One card per tool call in the execution stream.
 * Shows target, timing, result summary, and expandable raw input/output.
 */
export const ToolExecutionCard: React.FC<Props> = ({ execution, isLatest }) => {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICON[execution.tool] || HelpCircle;
  const state = STATE_STYLE[execution.state];
  const target = execution.filePath || execution.command || '';
  const duration = formatDuration(execution.durationMs);

  return (
    <div
      data-testid="codex-tool-card"
      data-state={execution.state}
      className={`border rounded-lg bg-[#111823] transition-colors ${
        execution.state === 'running' && isLatest
          ? 'border-emerald-500/60 ring-1 ring-emerald-500/30'
          : execution.state === 'failed'
            ? 'border-rose-500/40'
            : 'border-slate-700/50'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-slate-800/20 rounded-lg transition-colors"
      >
        <div className={`mt-0.5 p-1.5 rounded-md border shrink-0 ${
          execution.state === 'failed' ? 'border-rose-500/40 text-rose-400' :
          execution.state === 'completed' ? 'border-blue-500/40 text-blue-400' :
          'border-emerald-500/40 text-emerald-400'
        }`}>
          {execution.state === 'running' ? <Loader2 size={14} className="animate-spin" /> :
           execution.state === 'completed' ? <CheckCircle2 size={14} /> :
           execution.state === 'failed' ? <XCircle size={14} /> :
           <Icon size={14} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-slate-200">{getToolLabel(execution.tool)}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${state.chip}`}>
              {state.label}
            </span>
            {isLatest && execution.state === 'running' && (
              <span className="text-[10px] text-emerald-400 uppercase tracking-wider animate-pulse">Current</span>
            )}
          </div>

          {target && (
            <div className="text-xs text-purple-400 font-mono truncate mt-0.5" title={target}>
              {target}
            </div>
          )}

          <div className="text-xs text-slate-400 mt-1 line-clamp-2 break-all">
            {execution.summary}
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><Clock size={9} /> {formatTime(execution.startedAt)} → {execution.finishedAt ? formatTime(execution.finishedAt) : '…'}</span>
            {duration && <span>{duration}</span>}
          </div>

          {execution.error && (
            <div className="mt-2 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1 break-all">
              {execution.error}
            </div>
          )}
        </div>

        <div className="text-slate-500 mt-1 shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-700/40 flex flex-col gap-2">
          {execution.input && (
            <div className="bg-[#0A0F16] rounded-md p-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Input</span>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono break-all max-h-48 overflow-y-auto">{execution.input}</pre>
            </div>
          )}
          {execution.output && (
            <div className="bg-[#0A0F16] rounded-md p-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">Output</span>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono break-all max-h-48 overflow-y-auto">{execution.output}</pre>
            </div>
          )}
          {!execution.input && !execution.output && (
            <span className="text-[11px] text-slate-500">No raw payload recorded for this tool call.</span>
          )}
        </div>
      )}
    </div>
  );
};
