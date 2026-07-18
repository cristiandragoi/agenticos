import React, { useState } from 'react';
import { Target, Send, Zap, AlertTriangle, CheckCircle2, ChevronLeft, Loader2 } from 'lucide-react';

interface Props {
  onGoalCreated: (id: string) => void;
}

export const StudioEmptyState: React.FC<Props> = ({ onGoalCreated }) => {
  const [view, setView] = useState<'input' | 'preflight'>('input');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [execProvider, setExecProvider] = useState('ollama');
  const [valProvider, setValProvider] = useState('omniRoute');
  const [workspacePath, setWorkspacePath] = useState('');
  const [approvalPolicy, setApprovalPolicy] = useState('auto');
  const [error, setError] = useState<string | null>(null);
  
  const [plan, setPlan] = useState('');
  const [tokenCount, setTokenCount] = useState(0);

  const handleReview = async () => {
    setError(null);
    if (!prompt.trim()) {
      setError("Goal description cannot be empty.");
      return;
    }
    const wp = workspacePath.trim();
    if (!wp || wp === '/' || wp === '\\') {
      setError("Please provide a specific repository root, not the file system root.");
      return;
    }
    
    setTokenCount(Math.ceil(prompt.length / 4));
    setView('preflight');
    setLoading(true);
    
    try {
      const res = await fetch('/api/chat/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: `Analyze this goal and return a very concise 3-step plan and a list of expected files/directories to inspect. Format with bullet points.\nGoal: ${prompt}`
        })
      });
      const data = await res.json();
      if (data.reply) {
        setPlan(data.reply);
      } else {
        setPlan("Failed to generate plan.");
      }
    } catch (e) {
      setPlan("Error generating plan.");
    }
    setLoading(false);
  };

  const startGoal = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/agents/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          goal: prompt,
          executionProvider: execProvider,
          validationProvider: valProvider,
          workspacePath,
          approvalPolicy
        })
      });
      const data = await res.json();
      if (data.goalId) {
        onGoalCreated(data.goalId);
      } else {
        setError("Failed to create goal: " + (data.error || 'Unknown error'));
        setLoading(false);
      }
    } catch (e) {
      setError("API Error: Could not connect to backend.");
      setLoading(false);
    }
  };

  const isAudit = prompt.toLowerCase().includes('audit');
  const actionLabel = isAudit ? 'Create Audit Run' : 'Review Goal';

  if (view === 'preflight') {
    return (
      <div className="flex-1 flex flex-col p-8 bg-[#1e1e1e] overflow-y-auto items-center">
        <div className="max-w-2xl w-full">
          <button onClick={() => setView('input')} className="flex items-center gap-1 text-[#858585] hover:text-[#cccccc] mb-6 transition-colors text-sm">
            <ChevronLeft size={16} /> Back to Editor
          </button>
          
          <h2 className="text-xl font-semibold text-[#cccccc] mb-6 flex items-center gap-2">
            <CheckCircle2 className="text-emerald-500" size={20} /> Preflight Confirmation
          </h2>

          <div className="bg-[#252526] border border-[#333333] p-4 mb-6">
            <h3 className="text-[11px] font-bold text-[#858585] uppercase tracking-widest mb-3">Configuration</h3>
            <div className="grid grid-cols-2 gap-y-3 text-[13px]">
              <div><span className="text-[#858585]">Workspace:</span> <span className="text-emerald-400 font-mono">{workspacePath}</span></div>
              <div><span className="text-[#858585]">Prompt Size:</span> <span className="text-[#cccccc]">~{tokenCount} tokens</span></div>
              <div><span className="text-[#858585]">Exec Provider:</span> <span className="text-[#cccccc]">{execProvider}</span></div>
              <div><span className="text-[#858585]">Val Provider:</span> <span className="text-[#cccccc]">{valProvider}</span></div>
              <div><span className="text-[#858585]">Approval Policy:</span> <span className="text-[#cccccc]">{approvalPolicy}</span></div>
            </div>
          </div>

          <div className="bg-[#252526] border border-[#333333] p-4 mb-6">
            <h3 className="text-[11px] font-bold text-[#858585] uppercase tracking-widest mb-3">Goal Plan</h3>
            {loading ? (
              <div className="flex items-center gap-2 text-[#858585] text-[13px]">
                <Loader2 size={14} className="animate-spin" /> Generating concise plan...
              </div>
            ) : (
              <div className="text-[13px] text-[#cccccc] whitespace-pre-wrap leading-relaxed">
                {plan}
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[13px] mb-6 flex items-center gap-2">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setView('input')}
              disabled={loading}
              className="px-6 py-2 text-[#cccccc] bg-[#333333] hover:bg-[#444444] transition-colors text-[13px]"
            >
              Cancel
            </button>
            <button
              onClick={startGoal}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors border border-emerald-500 text-[13px]"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Target size={16} />}
              Approve and Start
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#1e1e1e] h-full">
      <div className="flex-1 flex flex-col items-center justify-start p-8 overflow-y-auto">
        <div className="max-w-3xl w-full flex flex-col h-full">
          <div className="flex flex-col items-center mb-6 shrink-0">
            <div className="w-12 h-12 flex items-center justify-center mb-4">
              <Zap size={32} className="text-emerald-500 opacity-80" />
            </div>
            <h2 className="text-2xl font-semibold text-[#cccccc]">CodeX Studio</h2>
            <p className="text-[#858585] text-sm mt-2 text-center max-w-md">Autonomous, long-running agent execution with checkpoint recovery.</p>
          </div>

          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[13px] mb-4 flex items-center gap-2 shrink-0">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div className="flex-1 min-h-[200px] mb-6 flex flex-col">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={loading}
              placeholder="What do you want CodeX to build or change?"
              className="w-full flex-1 bg-[#252526] border border-[#333333] p-4 text-[#cccccc] focus:outline-none focus:border-emerald-500 font-mono text-[13px] resize-none transition-colors placeholder:text-[#555555]"
            />
          </div>

          <div className="space-y-2 shrink-0">
            <div className="text-[11px] font-bold text-[#858585] uppercase tracking-widest mb-3">Example Prompts</div>
            <div className="grid grid-cols-1 gap-2">
              {['Migrate auth module to NextAuth v5', 'Write comprehensive unit tests for the chat router', 'Refactor the database schema to add Stripe billing'].map((ex, i) => (
                <button 
                  key={i}
                  onClick={() => setPrompt(ex)}
                  className="w-full text-left p-3 border border-[#333333] bg-[#252526] hover:bg-[#2d2d2d] transition-colors group flex gap-3 items-start"
                >
                  <Target size={14} className="text-emerald-500 opacity-50 mt-0.5 shrink-0" />
                  <span className="text-[13px] text-[#cccccc]">{ex}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 bg-[#252526] border-t border-[#333333] p-4 flex justify-center sticky bottom-0 z-10">
        <div className="max-w-6xl w-full flex items-end gap-4">
          <div className="flex-1 grid grid-cols-4 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-widest mb-1.5">Execution Provider</label>
              <select value={execProvider} onChange={e => setExecProvider(e.target.value)} className="w-full bg-[#1e1e1e] border border-[#333333] text-[#cccccc] text-[12px] p-2 focus:outline-none focus:border-emerald-500">
                <option value="ollama">Ollama (Local)</option>
                <option value="omniRoute">OmniRoute (Cloud)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-widest mb-1.5">Validation Provider</label>
              <select value={valProvider} onChange={e => setValProvider(e.target.value)} className="w-full bg-[#1e1e1e] border border-[#333333] text-[#cccccc] text-[12px] p-2 focus:outline-none focus:border-indigo-500">
                <option value="omniRoute">OmniRoute (Cloud)</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-widest mb-1.5">Workspace Directory</label>
              <input type="text" value={workspacePath} onChange={e => setWorkspacePath(e.target.value)} className="w-full bg-[#1e1e1e] border border-[#333333] text-[#cccccc] text-[12px] p-2 focus:outline-none focus:border-emerald-500 font-mono" placeholder="/path/to/repo" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#858585] uppercase tracking-widest mb-1.5">Approval Policy</label>
              <select value={approvalPolicy} onChange={e => setApprovalPolicy(e.target.value)} className="w-full bg-[#1e1e1e] border border-[#333333] text-[#cccccc] text-[12px] p-2 focus:outline-none focus:border-emerald-500">
                <option value="auto">Auto-Approve Safe</option>
                <option value="strict">Require Review</option>
              </select>
            </div>
          </div>
          
          <div className="shrink-0">
            <button onClick={handleReview} disabled={!prompt.trim()} className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors border border-emerald-500 text-[13px] h-[34px]">
              <Send size={14} />
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
