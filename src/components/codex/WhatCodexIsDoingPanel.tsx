import React, { useEffect, useState, useMemo } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Cpu,
  FileCode,
  FileSearch,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Loader2,
  RefreshCw,
  Terminal
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { TERMINAL_GOAL_STATES, isGoalActivelyRunning } from '../../presenters/executionStatus';
import ErrorBoundary from '../ErrorBoundary';

interface WhatCodexIsDoingPanelProps {
  goal: any | null;
  goalStatus: string | null;
  events: any[];
}

export function formatTimeAgo(ts?: string | number): string {
  if (!ts) return 'just now';
  const start = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(start)) return 'just now';
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  return `${hr} hour${hr === 1 ? '' : 's'} ago`;
}

export function formatDuration(startTs?: string | number, endTs?: string | number): string {
  if (!startTs) return '-';
  const start = typeof startTs === 'number' ? startTs : new Date(startTs).getTime();
  const end = endTs ? (typeof endTs === 'number' ? endTs : new Date(endTs).getTime()) : Date.now();
  if (isNaN(start)) return '-';
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec} seconds`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

export const WhatCodexIsDoingPanel: React.FC<WhatCodexIsDoingPanelProps> = ({
  goal,
  goalStatus,
  events = []
}) => {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  // Live timer tick for heartbeat / elapsed counters
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const status = (goalStatus || goal?.status || '').toLowerCase();
  const isTerminal = TERMINAL_GOAL_STATES.includes(status);
  const isRunning = isGoalActivelyRunning(goal || { status });

  // Analyze events
  const {
    lastEvent,
    filesInspected,
    filesChanged,
    lastSuccessfulAction,
    stoppedStep,
    rawResult,
    providerWait,
    isStalled,
    lastActivityTs,
    cleanTimeline
  } = useMemo(() => {
    const inspected = new Set<string>();
    const changed = new Set<string>();
    let lastSuccess = '';
    let stopStep = 0;
    let finishAnswer = '';
    let isWaitingForModel = false;
    let lastActTs = goal?.createdAt ? new Date(goal.createdAt).getTime() : Date.now();
    const timelineItems: Array<{ time: string; text: string }> = [];

    for (const e of events) {
      if (e.timestamp) {
        const ts = new Date(e.timestamp).getTime();
        if (!isNaN(ts) && ts > lastActTs) lastActTs = ts;
        const timeStr = new Date(e.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        let desc = e.message || e.summary || e.eventType || '';
        if (e.tool === 'readFile' && (e.filePath || e.payload?.path)) {
          const p = e.filePath || e.payload?.path;
          inspected.add(p);
          desc = `Reading ${p}`;
        } else if (e.tool === 'writeFile' && (e.filePath || e.payload?.path)) {
          const p = e.filePath || e.payload?.path;
          changed.add(p);
          desc = `Modifying ${p}`;
        } else if (e.eventType === 'agent_completed' || e.tool === 'finish') {
          desc = 'Task completed';
          if (e.payload?.finalAnswer) finishAnswer = e.payload.finalAnswer;
          else if (e.message) finishAnswer = e.message.replace(/^Goal finished:\s*/i, '');
        }

        if (desc && !timelineItems.some(item => item.text === desc)) {
          timelineItems.push({ time: timeStr, text: desc });
        }
      }

      if (e.step && typeof e.step === 'number') stopStep = Math.max(stopStep, e.step);

      if (e.tool && e.tool !== 'finish') {
        lastSuccess = `${e.tool} (${e.filePath || e.command || ''})`.trim();
      }

      if (e.eventType === 'llm_query_started' || e.normalizedStatus === 'waiting_for_model') {
        isWaitingForModel = true;
      } else if (e.eventType === 'llm_query_completed' || e.eventType === 'tool_started') {
        isWaitingForModel = false;
      }
    }

    if (!finishAnswer && goal?.finalAnswer) finishAnswer = goal.finalAnswer;
    if (!finishAnswer && goal?.runSummary?.finalAnswer) finishAnswer = goal.runSummary.finalAnswer;
    if (!finishAnswer && goal?.runSummary?.message) finishAnswer = goal.runSummary.message;

    const idleSeconds = Math.max(0, Math.floor((Date.now() - lastActTs) / 1000));
    const stalled = !isTerminal && status !== 'paused' && status !== 'waiting_for_approval' && idleSeconds >= 45;

    return {
      lastEvent: events[events.length - 1] || null,
      filesInspected: Array.from(inspected),
      filesChanged: Array.from(changed),
      lastSuccessfulAction: lastSuccess || 'Goal initialized',
      stoppedStep: stopStep,
      rawResult: finishAnswer,
      providerWait: isWaitingForModel,
      isStalled: stalled,
      lastActivityTs: lastActTs,
      cleanTimeline: timelineItems.slice(-8)
    };
  }, [events, goal, status, isTerminal]);

  const providerName = goal?.provider || goal?.executionProviderId || 'DeepSeek';
  const modelName = goal?.model || 'DeepSeek V4 Flash';
  const originalObjective = goal?.originalGoal || goal?.title || 'Inspect repository and perform requested actions.';
  const startedAgo = formatTimeAgo(goal?.createdAt);
  const lastActivityAgo = formatTimeAgo(lastActivityTs);
  const duration = formatDuration(goal?.createdAt, goal?.completedAt || (isTerminal ? lastActivityTs : undefined));

  // Determine Current Step Description in plain English
  let currentStepDesc = 'Analyzing requested objective…';
  if (lastEvent?.tool === 'readFile') {
    currentStepDesc = `Reading ${lastEvent.filePath || lastEvent.payload?.path || 'source file'}`;
  } else if (lastEvent?.tool === 'searchFiles') {
    currentStepDesc = `Searching files matching "${lastEvent.payload?.pattern || 'pattern'}"`;
  } else if (lastEvent?.tool === 'listDirectory') {
    currentStepDesc = `Listing contents of "${lastEvent.payload?.path || '.'}"`;
  } else if (lastEvent?.tool === 'writeFile') {
    currentStepDesc = `Writing changes to ${lastEvent.filePath || lastEvent.payload?.path}`;
  } else if (lastEvent?.tool === 'runCommand') {
    currentStepDesc = `Executing command: ${lastEvent.command || lastEvent.payload?.cmd}`;
  } else if (providerWait) {
    currentStepDesc = `Waiting for ${providerName} model response…`;
  } else if (status === 'planning') {
    currentStepDesc = 'Formulating execution plan…';
  }

  // Derive What I Did summary
  let whatIdid = 'Codex executed the goal loop and verified all steps.';
  if (filesInspected.length > 0 && filesChanged.length === 0) {
    whatIdid = `Codex opened the requested source file${filesInspected.length > 1 ? 's' : ''} (${filesInspected.join(', ')}) in read-only mode and inspected the exports and structure.`;
  } else if (filesChanged.length > 0) {
    whatIdid = `Codex inspected the repository and applied modifications to ${filesChanged.join(', ')}.`;
  }

  // Copy Summary text generator
  const copySummaryText = useMemo(() => {
    return [
      `Task: ${originalObjective}`,
      `Status: ${status.toUpperCase()}`,
      `Worker: Codex`,
      `Started: ${goal?.createdAt ? new Date(goal.createdAt).toLocaleString() : 'N/A'}`,
      `Duration: ${duration}`,
      `Current/Final step: ${isTerminal ? 'Completed execution' : currentStepDesc}`,
      `Result: ${rawResult || 'None'}`,
      `Files inspected: ${filesInspected.length > 0 ? filesInspected.join(', ') : 'None'}`,
      `Files changed: ${filesChanged.length > 0 ? filesChanged.join(', ') : 'None'}`,
      `Provider/model: ${providerName} / ${modelName}`,
      `Error/blocker: ${goal?.error || goal?.lastError || 'None'}`,
      `Relevant timeline:`,
      ...cleanTimeline.map(t => `${t.time} — ${t.text}`)
    ].join('\n');
  }, [originalObjective, status, goal, duration, isTerminal, currentStepDesc, rawResult, filesInspected, filesChanged, providerName, modelName, cleanTimeline]);

  const handleCopySummary = () => {
    navigator.clipboard.writeText(copySummaryText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <ErrorBoundary name="WhatCodexIsDoingPanel">
      <div className="w-full bg-[#161b22] border border-slate-700/60 rounded-lg overflow-hidden shadow-lg mb-4 text-slate-200">
        {/* Header Bar */}
        <div className="bg-[#0d1117] px-4 py-2.5 border-b border-slate-700/60 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Cpu size={14} />
            </span>
            <span className="text-[13px] font-bold text-slate-100 tracking-wide">
              {isTerminal
                ? (status === 'completed' ? 'Task Summary (Completed)' : 'Task Summary (Terminated)')
                : status === 'waiting_for_approval'
                ? 'Approval Required'
                : isStalled
                ? 'Codex Possible Stall Alert'
                : providerWait
                ? 'Codex Waiting for Model'
                : 'What Codex Is Doing'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopySummary}
              className="px-2.5 py-1 text-[11px] font-medium flex items-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-colors shadow-sm"
              title="Copy clean plain-text summary for debugging or sharing"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copied ? 'Summary Copied!' : 'Copy Summary'}</span>
            </button>
          </div>
        </div>

        {/* Main Body */}
        <div className="p-4 space-y-4 text-[13px]">
          {/* CASE A: RUNNING / ACTIVE */}
          {!isTerminal && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full shrink-0 ${
                  status === 'waiting_for_approval' ? 'bg-amber-400' :
                  isStalled ? 'bg-rose-500 animate-ping' :
                  providerWait ? 'bg-amber-400 animate-pulse' :
                  'bg-emerald-400 animate-pulse'
                }`} />
                <span className="text-[15px] font-bold text-slate-100">
                  {status === 'waiting_for_approval'
                    ? 'Codex is waiting for your approval'
                    : isStalled
                    ? 'Codex appears stalled (no activity for >45s)'
                    : providerWait
                    ? `Codex is waiting for ${providerName}`
                    : 'Codex is working'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 bg-[#0d1117] p-3 rounded border border-slate-800 font-mono text-[12px]">
                <div>
                  <span className="text-slate-400 font-sans">Current step: </span>
                  <span className="text-emerald-400 font-semibold">{currentStepDesc}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans">Started: </span>
                  <span className="text-slate-200">{startedAgo}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans">Last activity: </span>
                  <span className="text-slate-200">{lastActivityAgo}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-sans">Worker / Model: </span>
                  <span className="text-purple-300">Codex ({modelName})</span>
                </div>
                {providerWait && (
                  <>
                    <div>
                      <span className="text-slate-400 font-sans">Waiting for: </span>
                      <span className="text-amber-300">Model response stream</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-sans">Provider timeout: </span>
                      <span className="text-slate-300">60 seconds</span>
                    </div>
                  </>
                )}
                {isStalled && (
                  <div className="col-span-full text-rose-400 font-sans font-medium flex items-center gap-1.5 mt-1">
                    <AlertTriangle size={14} />
                    <span>No worker progress detected for over 45s. Check provider connectivity or click Pause/Stop to recover.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CASE B: COMPLETED TASK SUMMARY */}
          {status === 'completed' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-[14px]">
                <CheckCircle2 size={18} />
                <span>Completed</span>
              </div>

              <div className="space-y-2 bg-[#0d1117] p-3.5 rounded border border-slate-800">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">What I was asked to do:</div>
                  <div className="text-slate-200 font-medium">{originalObjective}</div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">What I did:</div>
                  <div className="text-slate-300 leading-relaxed">{whatIdid}</div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-blue-400 mb-1 flex items-center gap-1">
                    <CheckCircle2 size={13} /> Result:
                  </div>
                  <div className="text-slate-100 bg-[#161b22] p-2.5 rounded border border-slate-700/60 font-sans leading-relaxed">
                    {rawResult ? (
                      <ReactMarkdown>{rawResult}</ReactMarkdown>
                    ) : (
                      <span className="italic text-slate-400">Task completed successfully without explicit return text.</span>
                    )}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Files Inspected</span>
                    <span className="text-purple-300 font-mono">
                      {filesInspected.length > 0 ? filesInspected.join(', ') : 'None'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Files Changed</span>
                    <span className="text-slate-200 font-mono">
                      {filesChanged.length > 0 ? filesChanged.join(', ') : 'None'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Duration</span>
                    <span className="text-slate-200">{duration}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Completed By</span>
                    <span className="text-emerald-400">Codex / {modelName}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CASE C: FAILED / BLOCKED TASK SUMMARY */}
          {(status === 'failed' || status === 'blocked' || status === 'cancelled') && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-[14px]">
                <XCircle size={18} />
                <span>{status === 'blocked' ? 'Blocked' : 'Failed'}</span>
              </div>

              <div className="space-y-2 bg-[#0d1117] p-3.5 rounded border border-slate-800">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">What Codex was trying to do:</div>
                  <div className="text-slate-200 font-medium">{originalObjective}</div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Where it stopped:</div>
                  <div className="text-slate-300 font-mono text-[12px]">Step {stoppedStep}: {currentStepDesc}</div>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-rose-400 mb-0.5">Reason:</div>
                  <div className="text-rose-300 bg-rose-950/30 p-2 rounded border border-rose-900/50 font-mono text-[12px] break-all">
                    {goal?.lastError || goal?.error || goal?.blocker || 'Provider or tool execution error occurred.'}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Last Successful Action</span>
                    <span className="text-slate-200 font-mono">{lastSuccessfulAction}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Files Changed Before Failure</span>
                    <span className="text-slate-200 font-mono">{filesChanged.length > 0 ? filesChanged.join(', ') : 'None'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px] uppercase font-bold">Can It Be Retried?</span>
                    <span className="text-emerald-400 font-bold">Yes (Click Resume or re-submit)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Expandable Technical Details Section */}
          <div className="pt-2 border-t border-slate-700/60">
            <button
              onClick={() => setTechOpen(!techOpen)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              {techOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Technical Details & Provider Routing</span>
            </button>

            {techOpen && (
              <div className="mt-2.5 bg-[#090c10] p-3 rounded border border-slate-800 text-[11px] font-mono grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-300">
                <div>Planning Provider: <span className="text-purple-300">DeepSeek (OpenAI-compatible)</span></div>
                <div>Execution Provider: <span className="text-purple-300">{providerName}</span></div>
                <div>Model ID: <span className="text-blue-300">{modelName}</span></div>
                <div>Routing Mode: <span className="text-emerald-300">preferred-first with local fallback</span></div>
                <div>Fallback Policy: <span className="text-slate-300">DeepSeek → Ollama (llama3.2:3b)</span></div>
                <div>Goal ID: <span className="text-slate-400">{goal?.id || 'N/A'}</span></div>
                <div>Operation ID: <span className="text-slate-400">{goal?.operationId || goal?.metadata?.operationId || 'N/A'}</span></div>
                <div>Lease State: <span className="text-emerald-400">{isRunning ? 'Active worker lease held' : 'Lease released'}</span></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};
