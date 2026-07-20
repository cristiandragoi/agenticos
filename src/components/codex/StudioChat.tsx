import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, FastForward, CheckCircle2, XCircle, AlertTriangle, Eye, Edit3, Terminal, ShieldCheck, Search, Filter, Settings2, Download, Copy } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { getStatusPresentation, getEventCategory, presentEvent } from '../../presenters/EventPresenter';
import { exportJSON, generateMarkdownReport, sanitizeExport } from '../../utils/export';
import { normalizeExecutionEvent } from '../../utils/normalize';
import { useCodexStore } from '../../store/codexStore';

// ... ToolCard ...
const ToolCard = React.memo(({ event, presented, isHighlighted }: { event: any, presented: any, isHighlighted: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  
  // Dynamic icon mapping based on presented.iconKey
  let Icon = Terminal;
  if (presented.iconKey === 'planning') Icon = Settings2;
  if (presented.iconKey === 'tool') Icon = Terminal;
  if (presented.iconKey === 'file') Icon = Eye;
  if (presented.iconKey === 'validation') Icon = ShieldCheck;
  if (presented.iconKey === 'warning') Icon = AlertTriangle;
  if (presented.iconKey === 'error') Icon = XCircle;
  if (presented.iconKey === 'completed') Icon = CheckCircle2;

  return (
    <div className={`flex items-start gap-3 w-full group transition-all duration-300 ${isHighlighted ? 'ring-2 ring-emerald-500/50 rounded-lg p-1' : ''}`}>
      <div className={`mt-1 p-2 rounded-full border ${presented.backgroundClass} ${presented.borderClass} ${presented.colorClass} flex-shrink-0`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div 
          className="bg-[#111823] border border-slate-700/50 rounded-lg p-3 hover:border-slate-600/50 transition-colors cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {presented.badgeText}
                </span>
                <span className="text-[10px] text-slate-500">
                  {new Date(event.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                </span>
              </div>
              <span className="text-sm text-slate-200 truncate font-medium">
                {presented.title}
              </span>
              <span className="text-xs text-slate-400 line-clamp-2">
                {presented.explanation}
              </span>
            </div>
            {event.durationMs && (
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {(event.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>

          {expanded && presented.expandableDetails && (
            <div className="mt-3 pt-3 border-t border-slate-700/50 flex flex-col gap-2">
              {presented.expandableDetails.input && (
                <div className="bg-[#0A0F16] rounded-md p-2">
                  <span className="text-xs text-slate-500 mb-1 block">Input</span>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono break-all">
                    {presented.expandableDetails.input}
                  </pre>
                </div>
              )}
              {presented.expandableDetails.output && (
                <div className="bg-[#0A0F16] rounded-md p-2">
                  <span className="text-xs text-slate-500 mb-1 block">Output</span>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono break-all">
                    {presented.expandableDetails.output}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.event.sequenceId === nextProps.event.sequenceId && prevProps.isHighlighted === nextProps.isHighlighted;
});

const VIRTUALIZATION_THRESHOLD = 250;

export const StudioChat = ({ activeGoalId }: { activeGoalId: string | null }) => {
  const { events } = useCodexStore();
  const goalId = activeGoalId || '';
  const goal: any = { id: activeGoalId, status: 'executing', runSummary: {} };
  const isExecuting = true;
  
  const rawEvents = (events || []).sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  // Memoize normalization & presentation to prevent lag
  const presentedData = useMemo(() => {
    return rawEvents.map((raw: any, idx: number) => {
      const normalized = normalizeExecutionEvent(raw);
      const prev = idx > 0 ? normalizeExecutionEvent(rawEvents[idx-1]) : undefined;
      return {
        normalized,
        presented: presentEvent(normalized, prev)
      };
    });
  }, [rawEvents]);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const toggleCategory = (cat: string) => {
    const next = new Set(selectedCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setSelectedCategories(next);
  };

  const filteredData = useMemo(() => {
    return presentedData.filter(({ presented }: { presented: any }) => {
      // OR logic for categories
      if (selectedCategories.size > 0 && !selectedCategories.has(presented.category)) {
        return false;
      }
      // AND logic for search
      if (debouncedSearch && !presented.searchableText.includes(debouncedSearch.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [presentedData, debouncedSearch, selectedCategories]);

  // Replay State
  const [replayIndex, setReplayIndex] = useState(filteredData.length);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<'0.5x'|'1x'|'2x'|'Instant'>('1x');

  // Auto-follow if not replaying historical runs
  useEffect(() => {
    if (!isReplaying && isExecuting) {
      setReplayIndex(filteredData.length);
    }
  }, [filteredData.length, isExecuting, isReplaying]);

  // Replay Engine Logic
  useEffect(() => {
    if (!isReplaying || replayIndex >= filteredData.length) {
      setIsReplaying(false);
      return;
    }

    if (replaySpeed === 'Instant') {
      setReplayIndex(filteredData.length);
      setIsReplaying(false);
      return;
    }

    const currentEvent = filteredData[replayIndex];
    const nextEvent = filteredData[replayIndex + 1];

    let interval = 500; // default
    if (currentEvent && nextEvent) {
      const delta = new Date(nextEvent.normalized.timestamp).getTime() - new Date(currentEvent.normalized.timestamp).getTime();
      interval = Math.max(100, Math.min(3000, delta));
      
      if (replaySpeed === '0.5x') interval *= 2;
      else if (replaySpeed === '2x') interval /= 2;
    }

    const timer = setTimeout(() => {
      setReplayIndex(prev => prev + 1);
    }, interval);

    return () => clearTimeout(timer);
  }, [isReplaying, replayIndex, filteredData, replaySpeed]);

  const displayData = filteredData.slice(0, Math.max(1, replayIndex));
  const isVirtualized = displayData.length > VIRTUALIZATION_THRESHOLD;

  const handleCopyMarkdown = () => {
    const md = generateMarkdownReport(goal, goal.runSummary, presentedData.map((d: any) => d.normalized));
    navigator.clipboard.writeText(md).then(() => {
      alert('Markdown report copied.');
    }).catch(() => {
      alert('Clipboard access was denied.');
    });
  };

  const handleDownloadJSON = () => {
    exportJSON(goal, goal.runSummary, presentedData.map((d: any) => d.normalized));
  };

  return (
    <div className="flex flex-col h-full bg-[#0A0F16]">
      {/* Header / Toolbar */}
      <div className="p-3 border-b border-slate-700/50 bg-[#111823] flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search logs..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#0A0F16] border border-slate-700/50 rounded-md pl-9 pr-3 py-1.5 text-sm text-slate-200 outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1">
            {['planning', 'tool', 'error', 'warning'].map(cat => (
              <button 
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors border ${selectedCategories.has(cat) ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-[#0A0F16] text-slate-400 border-slate-700/50 hover:bg-slate-800'}`}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>
        
        {/* Replay Controls & Stats */}
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-[#0A0F16] rounded-md border border-slate-700/50 p-1">
              <button onClick={() => setIsReplaying(!isReplaying)} className="p-1 hover:text-slate-200 hover:bg-slate-800 rounded">
                {isReplaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <div className="w-[1px] h-3 bg-slate-700"></div>
              {['0.5x', '1x', '2x', 'Instant'].map(speed => (
                <button 
                  key={speed}
                  onClick={() => setReplaySpeed(speed as any)}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${replaySpeed === speed ? 'bg-slate-700 text-slate-200' : 'hover:bg-slate-800'}`}
                >
                  {speed}
                </button>
              ))}
            </div>
            <span>Showing {displayData.length} of {presentedData.length} events</span>
          </div>
          
          {goal.runSummary && (
            <div className="flex items-center gap-2">
              <button onClick={handleCopyMarkdown} className="flex items-center gap-1 hover:text-slate-200 transition-colors">
                <Copy className="w-3 h-3" /> Copy MD
              </button>
              <button onClick={handleDownloadJSON} className="flex items-center gap-1 hover:text-slate-200 transition-colors">
                <Download className="w-3 h-3" /> JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-hidden relative">
        {isVirtualized ? (
          <Virtuoso
            data={displayData}
            initialTopMostItemIndex={displayData.length - 1}
            followOutput="smooth"
            className="w-full h-full p-4"
            itemContent={(index, item: any) => (
              <div className="pb-4">
                <ToolCard 
                  event={item.normalized} 
                  presented={item.presented} 
                  isHighlighted={!!debouncedSearch} 
                />
              </div>
            )}
          />
        ) : (
          <div className="w-full h-full overflow-y-auto p-4 flex flex-col gap-4 pb-20">
            {displayData.map((item) => (
              <ToolCard 
                key={`${item.normalized.goalId}-${item.normalized.sequence}`} 
                event={item.normalized} 
                presented={item.presented} 
                isHighlighted={!!debouncedSearch} 
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
