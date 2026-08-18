import React, { useState } from 'react';
import { useMagnitudeStore } from '../store/magnitudeStore';
import {
  Globe, Play, Square, CheckCircle2, XCircle, AlertTriangle,
  Clock, Copy, Check, ExternalLink, RefreshCw, Compass,
  ArrowRight, ShieldCheck, FileText, Layers, Hash, Camera
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import ErrorBoundary from '../components/ErrorBoundary';

function formatElapsed(startStr?: string): string {
  if (!startStr) return '';
  const start = new Date(startStr).getTime();
  if (isNaN(start)) return '';
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

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
      className="px-2.5 py-1 text-[11px] flex items-center gap-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={12} className="text-amber-400" /> : <Copy size={12} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
};

export default function MagnitudeStudio() {
  const {
    activeRunId,
    activeRun,
    events,
    runs,
    isStarting,
    input,
    setInput,
    selectRun,
    createAndStartRun,
    stopActiveRun,
    resetForNewRun,
  } = useMagnitudeStore();

  const isRunning = activeRun?.status === 'running' || activeRun?.status === 'queued';
  const isCompleted = activeRun?.status === 'completed';
  const isFailed = activeRun?.status === 'failed';
  const isStopped = activeRun?.status === 'stopped';

  const handleQuickUrl = (url: string) => {
    setInput(`Open ${url} and inspect the page.`);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isStarting || isRunning) return;
    createAndStartRun(input.trim());
  };

  const result = activeRun?.result;

  return (
    <ErrorBoundary name="MagnitudeStudio">
      <div data-testid="magnitude-studio" className="h-full flex flex-col bg-[#0A0F16] text-slate-100 overflow-hidden">
        {/* Top Header */}
        <header className="shrink-0 border-b border-slate-800/80 bg-[#111823] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Compass size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-wide uppercase text-slate-100">Magnitude Studio</h1>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono">
                  Browser Automation
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Safe headless browser navigation, DOM inspection & content extraction
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isRunning && (
              <button
                onClick={stopActiveRun}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 text-[12px] font-medium transition-colors"
              >
                <Square size={13} fill="currentColor" /> Stop Run
              </button>
            )}
            <button
              onClick={resetForNewRun}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 text-[12px] transition-colors"
            >
              <RefreshCw size={12} /> New Task
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-5xl mx-auto w-full">
          {/* Quick Action URL Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-slate-500 uppercase font-mono tracking-wider">Quick Targets:</span>
            <button
              onClick={() => handleQuickUrl('https://example.com')}
              className="text-[11px] px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors flex items-center gap-1"
            >
              <Globe size={11} className="text-amber-400" /> example.com
            </button>
            <button
              onClick={() => handleQuickUrl('https://www.wikipedia.org/')}
              className="text-[11px] px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors flex items-center gap-1"
            >
              <Globe size={11} className="text-amber-400" /> wikipedia.org
            </button>
            <button
              onClick={() => handleQuickUrl('https://news.ycombinator.com/')}
              className="text-[11px] px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors flex items-center gap-1"
            >
              <Globe size={11} className="text-amber-400" /> news.ycombinator.com
            </button>
          </div>

          {/* Composer Box */}
          <form onSubmit={handleSubmit} data-testid="magnitude-composer" className="bg-[#111823] border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center justify-between">
              <label htmlFor="magnitude-prompt-input" className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Globe size={13} className="text-amber-400" /> Target URL or Inspection Goal
              </label>
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <ShieldCheck size={12} className="text-emerald-400" /> HTTP / HTTPS Only
              </span>
            </div>

            <div className="flex gap-2">
              <input
                id="magnitude-prompt-input"
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="e.g. Open https://example.com and inspect the page"
                className="flex-1 bg-[#0A0F16] border border-slate-700 rounded-lg px-3.5 py-2.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500 font-sans"
                disabled={isRunning || isStarting}
              />
              <button
                type="submit"
                data-testid="magnitude-run-btn"
                disabled={!input.trim() || isRunning || isStarting}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-[13px] rounded-lg flex items-center gap-2 transition-colors shadow"
              >
                {isRunning ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                <span>{isRunning ? 'Inspecting…' : 'Inspect'}</span>
              </button>
            </div>
          </form>

          {/* Selected Run Details Card */}
          {activeRun && (
            <div data-testid="magnitude-active-run" className="bg-[#111823] border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-semibold text-slate-400">{activeRun.id}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                    isCompleted ? 'text-blue-400 border-blue-500/40 bg-blue-500/10' :
                    isFailed ? 'text-rose-400 border-rose-500/40 bg-rose-500/10' :
                    isStopped ? 'text-slate-400 border-slate-600 bg-slate-700/20' :
                    'text-amber-400 border-amber-500/40 bg-amber-500/10'
                  }`}>
                    {activeRun.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Clock size={11} /> {formatElapsed(activeRun.createdAt)}
                </div>
              </div>

              <div className="text-[13px] text-slate-200">
                <span className="text-slate-500 font-mono text-[11px] uppercase tracking-wider block mb-1">Goal:</span>
                <p className="font-sans font-medium">{activeRun.goal}</p>
              </div>

              {activeRun.requestedUrl && (
                <div className="flex items-center gap-2 text-[12px] bg-[#0A0F16] px-3 py-1.5 rounded border border-slate-800">
                  <Globe size={13} className="text-amber-400 shrink-0" />
                  <span className="font-mono text-amber-300 truncate">{activeRun.requestedUrl}</span>
                </div>
              )}
            </div>
          )}

          {/* FINAL RESULT CARD */}
          {isCompleted && result && (
            <div data-testid="magnitude-final-result-card" className="bg-[#111823] border border-blue-500/40 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-blue-400" />
                  <span className="text-sm font-bold uppercase tracking-widest text-blue-400">
                    FINAL RESULT
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton text={result.text || result.title} label="Copy result" />
                  <a
                    href={result.finalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 text-[11px] flex items-center gap-1.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/60 transition-colors"
                  >
                    <ExternalLink size={12} /> Open URL
                  </a>
                </div>
              </div>

              {/* URL & Title Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-[#0A0F16] p-3.5 rounded-lg border border-slate-800 text-[12px]">
                <div>
                  <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Page Title</span>
                  <span className="font-semibold text-slate-100 text-[13px]">{result.title}</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Final URL</span>
                  <span className="font-mono text-emerald-400 break-all">{result.finalUrl}</span>
                </div>
                {result.durationMs && (
                  <div>
                    <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Duration</span>
                    <span className="font-mono text-slate-300">{(result.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
                {result.linksCount !== undefined && (
                  <div>
                    <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Links Found</span>
                    <span className="font-mono text-slate-300">{result.linksCount}</span>
                  </div>
                )}
              </div>

              {/* Page Content Snippet */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <FileText size={13} className="text-amber-400" /> Extracted Page Content
                </span>
                <div className="bg-[#0A0F16] border border-slate-800 rounded-lg p-4 text-[13px] text-slate-200 leading-relaxed font-sans max-h-72 overflow-y-auto whitespace-pre-wrap">
                  {result.text || 'No text extracted.'}
                </div>
              </div>

              {/* Screenshot Evidence (M7) */}
              {result.screenshotPath && (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Camera size={13} className="text-emerald-400" /> Screenshot Evidence
                  </span>
                  <img
                    src={`/api/magnitude/runs/${activeRun?.id}/screenshot`}
                    alt={`Magnitude screenshot for ${result.title || 'run'}`}
                    className="border border-slate-800 rounded-lg max-h-80 w-auto object-contain bg-[#0A0F16]"
                    data-testid="magnitude-screenshot"
                  />
                </div>
              )}
            </div>
          )}

          {/* Failure Alert */}
          {isFailed && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-start gap-3">
              <XCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-rose-300">Execution Failed</h3>
                <p className="text-[12px] text-rose-200/90 mt-1 font-mono">{activeRun?.error || 'Browser inspection failed.'}</p>
              </div>
            </div>
          )}

          {/* Stopped Alert */}
          {isStopped && (
            <div className="bg-slate-700/20 border border-slate-600/40 rounded-xl p-4 flex items-center gap-3">
              <AlertTriangle size={18} className="text-slate-400 shrink-0" />
              <div className="text-[13px] text-slate-300 font-medium">Execution was cancelled by the user.</div>
            </div>
          )}

          {/* Live Timeline */}
          {events.length > 0 && (
            <div data-testid="magnitude-timeline" className="bg-[#111823] border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  <Layers size={13} className="text-amber-400" />
                  <span>Execution Timeline ({events.length} events)</span>
                </div>
              </div>

              <div className="space-y-2.5 border-l border-slate-800 ml-2 pl-3 py-1">
                {events.map((evt, idx) => {
                  const isDone = evt.type === 'magnitude_completed';
                  const isErr = evt.type === 'magnitude_failed';
                  const isStop = evt.type === 'magnitude_stopped';

                  return (
                    <div key={`evt-${evt.id || idx}`} className="flex items-start gap-3 text-[12px]">
                      <span className="text-[10px] text-slate-600 font-mono mt-0.5 shrink-0 w-[55px] text-right">
                        {formatTime(evt.timestamp)}
                      </span>
                      <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${
                        isDone ? 'bg-blue-400' :
                        isErr ? 'bg-rose-400' :
                        isStop ? 'bg-slate-400' :
                        'bg-amber-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <span className={`leading-snug ${isDone ? 'text-blue-300 font-medium' : isErr ? 'text-rose-300' : 'text-slate-300'}`}>
                          {evt.message}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Runs List */}
          {runs.length > 0 && (
            <div data-testid="magnitude-recent-runs" className="bg-[#111823] border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  <Compass size={13} className="text-emerald-400" />
                  <span>Recent Magnitude Runs ({runs.length})</span>
                </div>
              </div>

              <div className="space-y-2">
                {runs.map(r => {
                  const isCurrent = r.id === activeRunId;
                  return (
                    <button
                      key={r.id}
                      onClick={() => selectRun(r.id)}
                      className={`w-full text-left p-3 rounded-lg border flex items-center justify-between gap-3 transition-colors ${
                        isCurrent
                          ? 'border-amber-500/60 bg-amber-500/10 text-slate-100'
                          : 'border-slate-800/80 bg-[#0A0F16] hover:border-slate-700 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Globe size={14} className="text-amber-400 shrink-0" />
                        <span className="text-[12px] truncate font-medium">{r.goal}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded border ${
                          r.status === 'completed' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' :
                          r.status === 'failed' ? 'text-rose-400 border-rose-500/30 bg-rose-500/10' :
                          'text-slate-400 border-slate-700 bg-slate-800'
                        }`}>
                          {r.status}
                        </span>
                        <ArrowRight size={12} className="text-slate-500" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}
