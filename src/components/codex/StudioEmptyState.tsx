import React, { useState, useEffect } from 'react';
import { Target, Send, Zap, AlertTriangle, CheckCircle2, ChevronLeft, Loader2 } from 'lucide-react';
import { RunSettings } from './RunSettings';
import { useCodexStore } from '../../store/codexStore';
import { CODEX_BASE_URL } from '../../config/codexRuntime';
import { buildCodexGoalPayload } from '../../features/codex/buildCodexGoalPayload';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  onGoalCreated: (id: string) => void;
}

export const StudioEmptyState: React.FC<Props> = ({ onGoalCreated }) => {
  const { setRunSettings } = useCodexStore();
  const [view, setView] = useState<'input' | 'preflight'>('input');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [isStartingGoal, setIsStartingGoal] = useState(false);
  const [valProvider, setValProvider] = useState('auto');
  const [approvalPolicy, setApprovalPolicy] = useState('auto');
  const [routing, setRouting] = useState<any>(undefined);
  const [error, setError] = useState<string | null>(null);
  
  // Workspace Auto-detection state
  const [folderTree, setFolderTree] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [gitRoots, setGitRoots] = useState<string[]>([]);
  const [cwd, setCwd] = useState('');
  const [isDetecting, setIsDetecting] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [plan, setPlan] = useState('');
  const [tokenCount, setTokenCount] = useState(0);

  useEffect(() => {
    const detectWorkspace = async (path?: string) => {
      setIsDetecting(true);
      setWorkspaceError(null);
      try {
        const res = await apiFetch('/api/workspace/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ basePath: path || undefined })
        });
        const data = await res.json();
        setCwd(data.cwd || '');
        if (!data.isValid) {
          setGitRoots([]);
          setWorkspacePath('');
          setWorkspaceError(data.errorMessage);
        } else {
          setGitRoots(data.gitRoots);
          if (data.gitRoots.length === 1) {
            setWorkspacePath(data.gitRoots[0]);
          } else if (data.gitRoots.length > 0 && !data.gitRoots.includes(workspacePath)) {
            setWorkspacePath(data.gitRoots[0]);
          }
        }
      } catch (err) {
        setWorkspaceError("Failed to connect to backend for workspace detection.");
        setGitRoots([]);
      } finally {
        setIsDetecting(false);
      }
    };

    const timeoutId = setTimeout(() => {
      detectWorkspace(folderTree);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [folderTree, workspacePath]);

  const isRepoValid = workspacePath && gitRoots.length > 0 && !isDetecting && !workspaceError;
  const isExecutable = prompt.trim() && isRepoValid;

  const startGoalFromPlan = async (planText?: string) => {
    if (isStartingGoal) return;
    setIsStartingGoal(true);
    setError(null);
    try {
      const payload = buildCodexGoalPayload({
        goal: prompt,
        repositoryRoot: workspacePath,
        approvalPolicy,
        validationProvider: valProvider,
        assignment: routing,
        explicitRoutingOverride: true
      });
      console.log('[DEBUG] startGoal pressed. Sending payload:', payload);

      const res = await apiFetch('/api/chat/agents/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.goalId) {
        // Persist the chosen configuration so the execution view can
        // show a compact summary while the run is active.
        setRunSettings({ folderTree, workspacePath, baseUrl: CODEX_BASE_URL, valProvider, approvalPolicy });
        onGoalCreated(data.goalId);
      } else {
        setError("Failed to create goal: " + (data.error || 'Unknown error'));
      }
    } catch (e) {
      setError("API Error: Could not connect to backend to start goal.");
    } finally {
      setIsStartingGoal(false);
    }
  };

  const handleReview = async () => {
    if (loading || isStartingGoal) return;
    setError(null);
    if (!isRepoValid) {
      setError(workspaceError || "Please wait for a valid Git repository to be selected.");
      return;
    }
    if (!prompt.trim()) {
      setError("Goal description cannot be empty.");
      return;
    }
    
    setTokenCount(Math.ceil(prompt.length / 4));
    setView('preflight');
    setLoading(true);

    console.log('[DEBUG] Review Goal pressed. Payload to be executed:', {
      validationProvider: valProvider,
      repositoryRoot: workspacePath,
      approvalPolicy,
      routing
    });
    
    let generatedPlan = "";
    try {
      const res = await apiFetch('/api/chat/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: `Analyze this goal and return a very concise 3-step plan and a list of expected files/directories to inspect. Format with bullet points.\nGoal: ${prompt}`
        })
      });
      const data = await res.json();
      if (data.reply) {
        generatedPlan = data.reply;
        setPlan(generatedPlan);
      } else {
        setPlan("Failed to generate plan.");
        setView('input');
        setError("Failed to generate preflight plan.");
      }
    } catch (e) {
      setPlan("Error generating plan.");
      setView('input');
      setError("API Error: Could not connect to backend to generate plan.");
    }
    setLoading(false);

    if (generatedPlan && approvalPolicy === 'auto') {
      await startGoalFromPlan(generatedPlan);
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
              <div><span className="text-[#858585]">Repository Root:</span> <span className="text-emerald-400 font-mono" title={workspacePath}>{workspacePath.length > 40 ? '...' + workspacePath.slice(-37) : workspacePath}</span></div>
              <div><span className="text-[#858585]">Prompt Size:</span> <span className="text-[#cccccc]">~{tokenCount} tokens</span></div>
              <div><span className="text-[#858585]">Current Working Dir:</span> <span className="text-[#cccccc] font-mono" title={cwd}>{cwd.length > 40 ? '...' + cwd.slice(-37) : cwd}</span></div>

              <div><span className="text-[#858585]">Approval Policy:</span> <span className="text-[#cccccc]">{approvalPolicy}</span></div>
              <div><span className="text-[#858585]">Val Provider:</span> <span className="text-[#cccccc]">{valProvider}</span></div>
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
              disabled={loading || isStartingGoal}
              className="px-6 py-2 text-[#cccccc] bg-[#333333] hover:bg-[#444444] transition-colors text-[13px]"
            >
              Cancel
            </button>
            <button
              onClick={() => startGoalFromPlan(plan)}
              disabled={loading || isStartingGoal}
              className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors border border-emerald-500 text-[13px]"
            >
              {isStartingGoal ? <Loader2 className="animate-spin" size={16} /> : <Target size={16} />}
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
              disabled={loading || isStartingGoal}
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
        <div className="max-w-[1400px] w-full flex flex-col gap-3">
          <RunSettings
            values={{ folderTree, workspacePath, valProvider, approvalPolicy, routing }}
            onChange={(patch) => {
              if (patch.folderTree !== undefined) setFolderTree(patch.folderTree);
              if (patch.workspacePath !== undefined) setWorkspacePath(patch.workspacePath);
              if (patch.valProvider !== undefined) setValProvider(patch.valProvider);
              if (patch.approvalPolicy !== undefined) setApprovalPolicy(patch.approvalPolicy);
              if (patch.routing !== undefined) setRouting(patch.routing);
            }}
            gitRoots={gitRoots}
            isDetecting={isDetecting}
            workspaceError={workspaceError}
            cwd={cwd}
            defaultOpen={true}
          />

          <div className="flex justify-end items-center gap-4">
            {!isRepoValid && !isDetecting && (
              <span className="text-rose-400 text-[12px] flex items-center gap-1"><AlertTriangle size={12}/> {workspaceError || "Waiting for valid repository..."}</span>
            )}
            <button onClick={handleReview} disabled={!isExecutable || loading || isStartingGoal} className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors border border-emerald-500 text-[13px] h-[34px]">
              {loading || isStartingGoal ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
