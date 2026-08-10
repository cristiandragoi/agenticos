import React, { useEffect, useMemo, useState } from 'react';
import {
  TerminalSquare, Shield, Activity, X, AlertCircle, FileText, Zap,
  Braces, ChevronUp, ChevronDown, Download, Copy
} from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { getActivityPhrase } from '../../presenters/EventPresenter';
import { exportJSON, generateMarkdownReport } from '../../utils/export';
import { apiFetch, apiUrl } from '../../api/client';

const TABS = [
  { id: 'Terminal', icon: TerminalSquare },
  { id: 'Logs', icon: FileText },
  { id: 'Raw Events', icon: Zap },
  { id: 'Errors', icon: AlertCircle },
  { id: 'Circuit Breakers', icon: Shield },
  { id: 'Lease Activity', icon: Activity },
  { id: 'JSON', icon: Braces }
] as const;

type TabId = typeof TABS[number]['id'];

function formatTime(ts?: string): string {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString([], { hour12: false });
}

/**
 * Advanced Diagnostics drawer. Collapses to a slim, always-visible bar
 * that can be reopened at any time. The drawer only READS the shared
 * event store — closing or opening it never touches the live SSE stream.
 */
export const DiagnosticsDrawer: React.FC = () => {
  const { activeGoalId, events, isDrawerOpen, setIsDrawerOpen } = useCodexStore();
  const [activeTab, setActiveTab] = useState<TabId>('Terminal');
  const [breakers, setBreakers] = useState<any[]>([]);
  const [goal, setGoal] = useState<any>(null);
  const [rawFilter, setRawFilter] = useState('');

  const normalizedEvents = useMemo(() => (events || []).map(normalizeExecutionEvent), [events]);

  // Circuit breakers only refresh while the drawer is open.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const fetchBreakers = async () => {
      try {
        const res = await apiFetch('/api/chat/agents/circuit-breakers');
        const data = await res.json();
        setBreakers(Array.isArray(data) ? data : []);
      } catch (e) {}
    };
    fetchBreakers();
    const interval = setInterval(fetchBreakers, 5000);
    return () => clearInterval(interval);
  }, [isDrawerOpen]);

  // Goal snapshot for JSON export.
  useEffect(() => {
    if (!isDrawerOpen || !activeGoalId) return;
    const fetchGoal = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}`);
        if (res.ok) setGoal(await res.json());
      } catch (e) {}
    };
    fetchGoal();
  }, [isDrawerOpen, activeGoalId, normalizedEvents.length]);

  const commandEvents = normalizedEvents.filter(e => e.tool === 'runCommand' || e.eventType?.startsWith('command'));
  const logEvents = normalizedEvents.filter(e => e.technicalMessage || e.message);
  const errorEvents = normalizedEvents.filter(e => e.error || e.errorCode || e.normalizedStatus === 'failed');
  const leaseEvents = normalizedEvents.filter(e => /lease/i.test(`${e.message || ''} ${e.technicalMessage || ''} ${e.eventType || ''}`));
  const filteredRaw = rawFilter
    ? normalizedEvents.filter(e => JSON.stringify(e).toLowerCase().includes(rawFilter.toLowerCase()))
    : normalizedEvents;

  const handleCopyMarkdown = () => {
    if (!goal) return;
    const md = generateMarkdownReport(goal, goal.runSummary, normalizedEvents);
    navigator.clipboard.writeText(md).catch(() => {});
  };

  const handleDownloadJSON = () => {
    if (!goal) return;
    exportJSON(goal, goal.runSummary, normalizedEvents);
  };

  // Collapsed: slim, always-visible bar with a reopen button.
  if (!isDrawerOpen) {
    return (
      <div
        data-testid="codex-drawer"
        className="h-[42px] shrink-0 bg-[#252526] border-t border-[#333333] flex items-center justify-between px-3 select-none"
      >
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-[#858585] hover:text-[#cccccc] transition-colors"
        >
          <ChevronUp size={14} />
          <span className="font-bold">Advanced Diagnostics</span>
          <span className="normal-case tracking-normal text-[#666] hidden sm:inline">
            Terminal · Logs · Raw Events · Errors · Circuit Breakers · Lease Activity · JSON
          </span>
        </button>
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="text-[11px] px-2 py-1 rounded border border-[#444] text-[#cccccc] hover:bg-[#37373d] transition-colors"
        >
          Open
        </button>
      </div>
    );
  }

  return (
    <div data-testid="codex-drawer" className="h-[320px] shrink-0 bg-[#1e1e1e] flex flex-col select-none border-t border-[#333333]">
      <div className="flex items-center justify-between px-3 bg-[#252526] border-b border-[#333333]">
        <div className="flex gap-3 overflow-x-auto hide-scrollbar">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-[11px] uppercase tracking-widest flex items-center gap-1.5 py-2 transition-colors whitespace-nowrap border-b-2 ${
                activeTab === tab.id
                  ? 'text-[#cccccc] border-b-emerald-500 font-bold'
                  : 'text-[#858585] hover:text-[#cccccc] border-b-transparent'
              }`}
            >
              <tab.icon size={12} />
              <span>{tab.id}</span>
              {tab.id === 'Errors' && errorEvents.length > 0 && (
                <span className="bg-rose-500/20 text-rose-400 text-[9px] px-1 rounded-full">{errorEvents.length}</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsDrawerOpen(false)}
          className="flex items-center gap-1 text-[11px] px-2 py-1 text-[#858585] hover:text-[#cccccc] hover:bg-[#37373d] rounded-sm transition-colors"
          title="Close diagnostics (keeps the run connected)"
        >
          <ChevronDown size={14} /> Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-[#1e1e1e] font-mono text-[12px] leading-relaxed select-text">
        {activeTab === 'Terminal' && (
          <div>
            <div className="text-[#858585] mb-2"># System Terminal Output</div>
            {commandEvents.length === 0 ? (
              <div className="text-[#555555]">[SYSTEM] Awaiting execution commands...</div>
            ) : (
              <div className="space-y-3">
                {commandEvents.map((ev, i) => (
                  <div key={i}>
                    {ev.command && (
                      <div className="flex gap-2 text-[#cccccc]">
                        <span className="text-[#858585] shrink-0">[{formatTime(ev.timestamp)}]</span>
                        <span className="text-emerald-400">$ {ev.command}</span>
                      </div>
                    )}
                    {ev.technicalMessage && (
                      <pre className="text-[#9aa5b1] whitespace-pre-wrap break-all pl-[88px]">{ev.technicalMessage}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Logs' && (
          <div>
            <div className="text-[#858585] mb-2"># Execution Logs</div>
            {logEvents.length === 0 ? (
              <div className="text-[#555555]">No logs to display.</div>
            ) : (
              <div className="space-y-1">
                {logEvents.map((ev, i) => (
                  <div key={i} className="flex gap-3 text-[#cccccc]">
                    <span className="text-[#858585] shrink-0">[{formatTime(ev.timestamp)}]</span>
                    <span className={
                      ev.normalizedStatus === 'failed' ? 'text-rose-400' :
                      ev.normalizedStatus === 'completed' ? 'text-emerald-400' :
                      ev.normalizedStatus === 'attention' ? 'text-amber-400' :
                      'text-[#cccccc]'
                    }>
                      {ev.technicalMessage || ev.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Raw Events' && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[#858585]"># Raw Events ({filteredRaw.length})</span>
              <input
                value={rawFilter}
                onChange={e => setRawFilter(e.target.value)}
                placeholder="Filter events…"
                className="flex-1 bg-[#111] border border-[#333] text-[#ccc] text-[11px] px-2 py-1 focus:outline-none focus:border-emerald-500"
              />
            </div>
            {filteredRaw.length === 0 ? (
              <div className="text-[#555555]">No events to display.</div>
            ) : (
              <div className="space-y-1">
                {filteredRaw.map((ev, i) => (
                  <details key={i} className="text-[#cccccc]">
                    <summary className="cursor-pointer hover:bg-[#252526] px-1 rounded">
                      <span className="text-[#858585]">[{formatTime(ev.timestamp)}]</span>{' '}
                      <span className="text-emerald-400">{ev.eventType}</span>{' '}
                      <span className="text-[#9aa5b1]">{getActivityPhrase(ev)}</span>
                    </summary>
                    <pre className="text-[11px] text-[#9aa5b1] whitespace-pre-wrap break-all bg-[#111] border border-[#333] rounded p-2 mt-1 max-h-64 overflow-y-auto">
                      {JSON.stringify(ev, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Errors' && (
          <div>
            <div className="text-[#858585] mb-2"># Errors</div>
            {errorEvents.length === 0 ? (
              <div className="text-[#555555]">No errors recorded.</div>
            ) : (
              <div className="space-y-2">
                {errorEvents.map((ev, i) => (
                  <div key={i} className="border border-rose-500/30 bg-rose-500/5 rounded p-2">
                    <div className="flex gap-2 text-rose-400">
                      <span className="text-[#858585] shrink-0">[{formatTime(ev.timestamp)}]</span>
                      <span className="font-bold">{ev.errorCode || ev.eventType || 'error'}</span>
                    </div>
                    <div className="text-rose-300/90 break-all mt-1">{ev.error || ev.message}</div>
                    {ev.errorDetails && ev.errorDetails !== ev.error && (
                      <pre className="text-[11px] text-rose-200/60 whitespace-pre-wrap break-all mt-1">{ev.errorDetails}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Circuit Breakers' && (
          <div>
            <div className="text-[#858585] mb-4"># Circuit Breaker Status</div>
            {breakers.length === 0 ? (
              <div className="text-[#555555]">No circuit breakers tripped or registered.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {breakers.map(b => (
                  <div key={b.id} className="bg-[#252526] border border-[#333333] p-3 rounded">
                    <div className="text-[#cccccc] font-medium mb-1">{b.provider} - {b.model}</div>
                    <div className="text-[#858585] text-xs">Errors: <span className={b.errorCount > 0 ? 'text-rose-400' : 'text-emerald-400'}>{b.errorCount}</span></div>
                    {b.cooldownUntil && (
                      <div className="text-amber-400 mt-1 text-[10px]">Cooldown until: {new Date(parseInt(b.cooldownUntil)).toLocaleTimeString()}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Lease Activity' && (
          <div>
            <div className="text-[#858585] mb-2"># Lease Activity</div>
            {leaseEvents.length === 0 ? (
              <div className="text-[#555555]">
                No lease activity events recorded for this run. Worker leases are managed internally
                and only surface here when the backend emits lease-related events.
              </div>
            ) : (
              <div className="space-y-1">
                {leaseEvents.map((ev, i) => (
                  <div key={i} className="flex gap-3 text-[#cccccc]">
                    <span className="text-[#858585] shrink-0">[{formatTime(ev.timestamp)}]</span>
                    <span>{ev.message || ev.technicalMessage}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'JSON' && (
          <div>
            <div className="text-[#858585] mb-2"># Export</div>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={handleCopyMarkdown}
                disabled={!goal}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border border-[#444] text-[#cccccc] hover:bg-[#37373d] transition-colors disabled:opacity-50"
              >
                <Copy size={12} /> Copy Markdown Report
              </button>
              <button
                onClick={handleDownloadJSON}
                disabled={!goal}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded border border-[#444] text-[#cccccc] hover:bg-[#37373d] transition-colors disabled:opacity-50"
              >
                <Download size={12} /> Download JSON
              </button>
            </div>
            {goal ? (
              <pre className="text-[11px] text-[#9aa5b1] whitespace-pre-wrap break-all bg-[#111] border border-[#333] rounded p-2 max-h-48 overflow-y-auto">
                {JSON.stringify({ id: goal.id, status: goal.status, originalGoal: goal.originalGoal, createdAt: goal.createdAt, runSummary: goal.runSummary }, null, 2)}
              </pre>
            ) : (
              <div className="text-[#555555]">No active goal selected.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
