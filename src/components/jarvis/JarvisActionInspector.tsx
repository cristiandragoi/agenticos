import React, { useState } from 'react';
import {
  Activity, CheckCircle2, XCircle, AlertTriangle, ArrowRight,
  Compass, Search, Layers, Clock, Terminal, ChevronDown, ChevronUp,
  Cpu, FileCode, Check, RefreshCw
} from 'lucide-react';
import { useJarvisRuntime } from '../../context/JarvisRuntimeContext';
import { ProviderCostStatusCard } from './ProviderCostStatusCard';

export interface JarvisActionInspectorProps {
  compact?: boolean;
}

export const JarvisActionInspector: React.FC<JarvisActionInspectorProps> = ({ compact = false }) => {
  const { latestActionRecord, actionHistory, workspaceContext } = useJarvisRuntime();
  const [viewMode, setViewMode] = useState<'activity' | 'inspector'>('activity');
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  const activeRecord = latestActionRecord || (actionHistory.length > 0 ? actionHistory[0] : null);

  if (!activeRecord) {
    return (
      <div className="p-4 flex flex-col items-center justify-center text-center text-slate-500 h-full space-y-4">
        <ProviderCostStatusCard />
        <div className="flex flex-col items-center justify-center text-center">
          <Activity size={24} className="mb-2 text-slate-600 opacity-60" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">No Jarvis Actions Yet</span>
          <p className="text-[11px] text-slate-500 mt-1 max-w-[240px]">
            Speak or type an action like "Open Revenue Operator" or "Open the Notion template" to observe execution.
          </p>
        </div>
      </div>
    );
  }

  const isSuccess = activeRecord.status === 'completed';
  const isFailed = activeRecord.status === 'failed';
  const isRunning = activeRecord.status === 'running' || activeRecord.status === 'planned';

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-slate-200 overflow-hidden font-sans select-text" data-testid="jarvis-action-inspector">
      {/* Inspector Subheader / Mode Switcher */}
      <div className="p-2 px-3 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
        <div className="flex items-center gap-1.5">
          <Activity size={13} className={isSuccess ? 'text-emerald-400' : isFailed ? 'text-rose-400' : 'text-cyan-400 animate-pulse'} />
          <span className="text-[11px] font-bold tracking-wider uppercase text-white">Jarvis Action Trace</span>
        </div>
        <div className="flex items-center bg-slate-900 border border-slate-700/60 rounded p-0.5">
          <button
            onClick={() => setViewMode('activity')}
            className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
              viewMode === 'activity' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Activity View
          </button>
          <button
            onClick={() => setViewMode('inspector')}
            className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
              viewMode === 'inspector' ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Detailed Inspector
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Real-time Provider & Cost Status */}
        <ProviderCostStatusCard />
        {viewMode === 'activity' ? (
          /* User-Facing Activity View */
          <div className="space-y-3" data-testid="user-activity-view">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
                <span>Latest Command Result</span>
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                  isSuccess ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                  isFailed ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
                  'bg-amber-500/10 border-amber-500/30 text-amber-300'
                }`}>
                  {activeRecord.status.toUpperCase()}
                </span>
              </div>

              {/* Step 1: Heard command */}
              <div className="flex items-start gap-2.5 text-xs">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={12} className="text-emerald-400" />
                </div>
                <div>
                  <div className="font-semibold text-slate-300">Heard command</div>
                  <div className="text-slate-400 text-[11px] mt-0.5 italic">"{activeRecord.command || activeRecord.displayName || activeRecord.actionType}"</div>
                </div>
              </div>

              {/* Step 2: Intent */}
              <div className="flex items-start gap-2.5 text-xs">
                <div className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                  <Check size={12} className="text-emerald-400" />
                </div>
                <div>
                  <div className="font-semibold text-slate-300">Intent recognized</div>
                  <div className="text-cyan-300 text-[11px] mt-0.5 font-mono">{activeRecord.actionType}</div>
                </div>
              </div>

              {/* Step 3: Entity Resolution */}
              <div className="flex items-start gap-2.5 text-xs">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  isFailed && (activeRecord.errorCode === 'ENTITY_NOT_FOUND' || activeRecord.errorCode === 'ENTITY_AMBIGUOUS')
                    ? 'bg-rose-500/20 border border-rose-500/40'
                    : 'bg-emerald-500/20 border border-emerald-500/40'
                }`}>
                  {isFailed && (activeRecord.errorCode === 'ENTITY_NOT_FOUND' || activeRecord.errorCode === 'ENTITY_AMBIGUOUS') ? (
                    <XCircle size={12} className="text-rose-400" />
                  ) : (
                    <Check size={12} className="text-emerald-400" />
                  )}
                </div>
                <div>
                  <div className="font-semibold text-slate-300">
                    {isFailed && (activeRecord.errorCode === 'ENTITY_NOT_FOUND' || activeRecord.errorCode === 'ENTITY_AMBIGUOUS')
                      ? 'Entity resolution failed'
                      : 'Entity resolved'}
                  </div>
                  {activeRecord.displayName ? (
                    <div className="text-indigo-300 text-[11px] mt-0.5 font-medium">
                      {activeRecord.displayName}
                      {activeRecord.module && <span className="text-slate-400 text-[10px] ml-1">({activeRecord.module})</span>}
                    </div>
                  ) : activeRecord.error ? (
                    <div className="text-rose-300 text-[11px] mt-0.5">{activeRecord.error}</div>
                  ) : (
                    <div className="text-slate-400 text-[11px] mt-0.5">Top-level module navigation</div>
                  )}
                </div>
              </div>

              {/* Step 4: Action Execution */}
              <div className="flex items-start gap-2.5 text-xs">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  isSuccess ? 'bg-emerald-500/20 border border-emerald-500/40' :
                  isFailed ? 'bg-rose-500/20 border border-rose-500/40' :
                  'bg-amber-500/20 border border-amber-500/40'
                }`}>
                  {isSuccess ? (
                    <Check size={12} className="text-emerald-400" />
                  ) : isFailed ? (
                    <XCircle size={12} className="text-rose-400" />
                  ) : (
                    <RefreshCw size={12} className="text-amber-400 animate-spin" />
                  )}
                </div>
                <div>
                  <div className="font-semibold text-slate-300">
                    {isSuccess ? 'Opened successfully' : activeRecord.errorCode === 'NAVIGATION_FAILED' ? 'Navigation failed' : isFailed ? 'Execution stopped' : 'Executing action...'}
                  </div>
                  {isFailed && activeRecord.errorCode === 'NAVIGATION_FAILED' && activeRecord.error && (
                    <div className="text-rose-400 text-[11px] font-mono mt-0.5">{activeRecord.error}</div>
                  )}
                  {isFailed && activeRecord.errorCode === 'NAVIGATION_FAILED' && (
                    <div className="text-rose-300/80 text-[10px] font-mono mt-0.5">Code: {activeRecord.errorCode}</div>
                  )}
                  {activeRecord.destination && !isFailed && (
                    <div className="text-slate-400 text-[11px] font-mono mt-0.5">{activeRecord.destination}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Action History Feed */}
            {actionHistory.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Recent Action History</div>
                <div className="space-y-1">
                  {actionHistory.slice(1, 5).map((rec: any, idx: number) => (
                    <div key={rec.id || idx} className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 text-[11px] flex items-center justify-between">
                      <div className="truncate pr-2">
                        <span className="font-semibold text-slate-300">{rec.displayName || rec.command || rec.actionType}</span>
                        <span className="text-slate-500 text-[10px] block truncate">{rec.destination || rec.actionType}</span>
                      </div>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                        rec.status === 'completed' ? 'text-emerald-400 bg-emerald-950/40' : 'text-rose-400 bg-rose-950/40'
                      }`}>
                        {rec.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Detailed Developer Inspector */
          <div className="space-y-3 font-mono text-[11px]" data-testid="detailed-inspector-view">
            {/* 1. INPUT */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal size={12} /> 1. Input
              </div>
              <div className="text-slate-300 break-words">
                <span className="text-slate-500">raw:</span> "{activeRecord.command || '—'}"
              </div>
              <div className="text-slate-400 text-[10px] flex gap-4">
                <span>owner: {activeRecord.ownerAgent}</span>
                <span>time: {activeRecord.startedAt ? new Date(activeRecord.startedAt).toLocaleTimeString() : '—'}</span>
              </div>
            </div>

            {/* 2. CONTEXT */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                <Compass size={12} /> 2. Workspace Context
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">activeModule:</span> {workspaceContext.activeModule || 'workspace'}
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">activeRoute:</span> {workspaceContext.activeRoute || '—'}
              </div>
              {(workspaceContext as any).activeMissionId && (
                <div className="text-slate-300">
                  <span className="text-slate-500">activeMissionId:</span> {(workspaceContext as any).activeMissionId}
                </div>
              )}
            </div>

            {/* 3. INTENT */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Cpu size={12} /> 3. Intent Detection
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">actionType:</span> {activeRecord.actionType}
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">status:</span> {activeRecord.status}
              </div>
            </div>

            {/* 4. ENTITY RESOLUTION */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Search size={12} /> 4. Entity Resolution
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">displayName:</span> {activeRecord.displayName || '—'}
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">entityId:</span> {activeRecord.entityId || '—'}
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">entityType:</span> {activeRecord.entityType || 'module'}
              </div>
              {activeRecord.errorCode && (
                <div className="text-rose-400">
                  <span className="text-slate-500">failureCode:</span> {activeRecord.errorCode}
                </div>
              )}
            </div>

            {/* 5. ACTION & EXECUTION */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileCode size={12} /> 5. Action Execution
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">dispatched:</span> true
              </div>
              <div className="text-slate-300 break-all">
                <span className="text-slate-500">destination:</span> {activeRecord.destination || '—'}
              </div>
              <div className="text-slate-300">
                <span className="text-slate-500">status:</span> {activeRecord.status}
              </div>
              {activeRecord.error && (
                <div className="text-rose-400 break-words">
                  <span className="text-slate-500">error:</span> {activeRecord.error}
                </div>
              )}
            </div>

            {/* Evidence details */}
            {activeRecord.evidence && activeRecord.evidence.length > 0 && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
                <div className="text-[10px] font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers size={12} /> Evidence Logs
                </div>
                {activeRecord.evidence.map((ev: any, i: number) => (
                  <div key={i} className="text-[10px] text-slate-400 border-l-2 border-purple-500/40 pl-2">
                    <span className="text-slate-300 font-semibold">{ev.type}:</span> {ev.detail}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
