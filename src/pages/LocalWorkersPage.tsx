import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Play, CheckCircle2, AlertTriangle, XCircle, Clock,
  ShieldAlert, RefreshCw, ChevronRight, Check, Ban, AlertCircle, FileText
} from 'lucide-react';

interface WorkerStep {
  id: string;
  description: string;
  tool?: string;
  arguments?: unknown;
  status: 'pending' | 'running' | 'verified' | 'failed' | 'skipped';
  attempts: number;
  verification?: {
    required: boolean;
    method: 'file_exists' | 'command_exit' | 'browser_dom' | 'git_status' | 'custom';
    verified: boolean;
    realityCheck?: string;
  };
}

interface WorkerEvidence {
  stepId: string;
  tool: string;
  arguments?: unknown;
  startTime: string;
  endTime: string;
  durationMs: number;
  exitState: 'verified' | 'failed' | 'skipped';
  verification: {
    required: boolean;
    method: string;
    verified: boolean;
    realityCheck?: string;
  };
  evidenceSource: string;
  output?: unknown;
  error?: string;
}

interface WorkerResult {
  success: boolean;
  summary: string;
  data?: unknown;
  completedAt: string;
}

interface LocalWorkerTask {
  id: string;
  goal: string;
  status:
    | 'queued'
    | 'planning'
    | 'running'
    | 'awaiting_approval'
    | 'blocked'
    | 'review'
    | 'completed'
    | 'failed'
    | 'cancelled';
  plan: WorkerStep[];
  currentStep: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  evidence: WorkerEvidence[];
  result?: WorkerResult;
}

const LocalWorkersPage: React.FC = () => {
  const [tasks, setTasks] = useState<LocalWorkerTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'awaiting_approval' | 'completed' | 'failed'>('all');
  const [newGoal, setNewGoal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/worker/tasks');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.tasks)) {
          setTasks(data.tasks);
          if (!selectedTaskId && data.tasks.length > 0) {
            setSelectedTaskId(data.tasks[0].id);
          }
        }
      }
    } catch (err) {
      console.error('[LocalWorkers] Failed to fetch tasks:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 2500);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleStartTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.trim() || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/worker/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: newGoal.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.task) {
          setNewGoal('');
          await fetchTasks();
          setSelectedTaskId(data.task.id);
        }
      }
    } catch (err) {
      console.error('[LocalWorkers] Failed to start task:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (taskId: string) => {
    try {
      await fetch(`/api/worker/tasks/${taskId}/approve`, { method: 'POST' });
      await fetchTasks();
    } catch (err) {
      console.error('[LocalWorkers] Failed to approve task:', err);
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      await fetch(`/api/worker/tasks/${taskId}/cancel`, { method: 'POST' });
      await fetchTasks();
    } catch (err) {
      console.error('[LocalWorkers] Failed to cancel task:', err);
    }
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || tasks[0];

  const activeCount = tasks.filter((t) => t.status === 'running' || t.status === 'planning' || t.status === 'queued').length;
  const blockedCount = tasks.filter((t) => t.status === 'awaiting_approval' || t.status === 'blocked').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'active') return t.status === 'running' || t.status === 'planning' || t.status === 'queued';
    if (filter === 'awaiting_approval') return t.status === 'awaiting_approval' || t.status === 'blocked';
    if (filter === 'completed') return t.status === 'completed';
    if (filter === 'failed') return t.status === 'failed' || t.status === 'cancelled';
    return true;
  });

  const getStatusBadge = (status: LocalWorkerTask['status']) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-success flex items-center gap-1 text-xs"><CheckCircle2 size={12} /> Completed</span>;
      case 'failed':
        return <span className="badge badge-danger flex items-center gap-1 text-xs"><XCircle size={12} /> Failed</span>;
      case 'cancelled':
        return <span className="badge badge-secondary flex items-center gap-1 text-xs"><Ban size={12} /> Cancelled</span>;
      case 'awaiting_approval':
        return <span className="badge badge-warning flex items-center gap-1 text-xs"><ShieldAlert size={12} /> Awaiting Approval</span>;
      case 'blocked':
        return <span className="badge badge-warning flex items-center gap-1 text-xs"><AlertTriangle size={12} /> Blocked</span>;
      case 'running':
      case 'planning':
        return <span className="badge badge-primary flex items-center gap-1 text-xs"><RefreshCw size={12} className="animate-spin" /> {status.toUpperCase()}</span>;
      default:
        return <span className="badge badge-secondary text-xs">{status}</span>;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6" data-testid="local-workers-page">
      {/* Top Banner & Metrics */}
      <div className="flex justify-between items-center bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3 text-slate-100">
            <Cpu className="text-cyan-400" size={28} />
            Local Workers
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Bounded autonomous AgenticOS execution substrate with empirical verification &amp; truthful evidence.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchTasks}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-2 border border-slate-700"
            title="Refresh tasks"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Active Tasks</div>
            <div className="text-2xl font-bold text-cyan-400 mt-1">{activeCount}</div>
          </div>
          <Play size={24} className="text-cyan-500/40" />
        </div>
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Approvals Needed</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{blockedCount}</div>
          </div>
          <ShieldAlert size={24} className="text-amber-500/40" />
        </div>
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Completed</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{completedCount}</div>
          </div>
          <CheckCircle2 size={24} className="text-emerald-500/40" />
        </div>
        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Failed / Cancelled</div>
            <div className="text-2xl font-bold text-rose-400 mt-1">{failedCount}</div>
          </div>
          <AlertCircle size={24} className="text-rose-500/40" />
        </div>
      </div>

      {/* Start Task Form */}
      <form onSubmit={handleStartTask} className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 flex gap-3">
        <input
          type="text"
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          placeholder="Delegate a goal to Local Worker (e.g. Inspect D:\AgenticOS git branch and commit status)..."
          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={!newGoal.trim() || isSubmitting}
          className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center gap-2 transition-colors shrink-0"
        >
          <Play size={15} />
          {isSubmitting ? 'Starting...' : 'Delegate to Worker'}
        </button>
      </form>

      {/* Main Content: Task List + Task Detail */}
      <div className="grid grid-cols-12 gap-6 min-h-[500px]">
        {/* Left Column: Tasks List */}
        <div className="col-span-5 bg-slate-900/80 rounded-xl border border-slate-800 flex flex-col overflow-hidden">
          {/* Filters */}
          <div className="p-3 border-b border-slate-800 flex gap-1.5 overflow-x-auto">
            {(['all', 'active', 'awaiting_approval', 'completed', 'failed'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors capitalize ${
                  filter === f
                    ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {filteredTasks.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No worker tasks matching filter.
              </div>
            ) : (
              filteredTasks.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  className={`p-3.5 cursor-pointer transition-colors flex flex-col gap-2 ${
                    selectedTask?.id === t.id
                      ? 'bg-cyan-950/30 border-l-4 border-cyan-400'
                      : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono text-xs text-slate-400">{t.id}</span>
                    {getStatusBadge(t.status)}
                  </div>
                  <div className="text-sm font-medium text-slate-200 line-clamp-2">
                    {t.goal}
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-500">
                    <span>Steps: {t.currentStep} / {t.plan.length}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Selected Task Details */}
        <div className="col-span-7 bg-slate-900/80 rounded-xl border border-slate-800 p-5 flex flex-col gap-6 overflow-y-auto max-h-[750px]">
          {selectedTask ? (
            <>
              {/* Header */}
              <div className="flex justify-between items-start border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{selectedTask.id}</span>
                    {getStatusBadge(selectedTask.status)}
                  </div>
                  <h2 className="text-lg font-bold text-slate-100 mt-2">
                    {selectedTask.goal}
                  </h2>
                </div>

                <div className="flex gap-2">
                  {selectedTask.status === 'awaiting_approval' && (
                    <button
                      onClick={() => handleApprove(selectedTask.id)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 shadow"
                    >
                      <Check size={14} /> Approve &amp; Resume
                    </button>
                  )}
                  {(selectedTask.status === 'running' || selectedTask.status === 'awaiting_approval') && (
                    <button
                      onClick={() => handleCancel(selectedTask.id)}
                      className="px-3 py-1.5 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 text-xs font-medium rounded-lg flex items-center gap-1.5"
                    >
                      <Ban size={14} /> Cancel Task
                    </button>
                  )}
                </div>
              </div>

              {/* Progress & Plan Section */}
              <div>
                <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3">
                  Multi-Step Plan ({selectedTask.plan.length} steps)
                </h3>
                <div className="flex flex-col gap-2.5">
                  {selectedTask.plan.map((step, idx) => (
                    <div
                      key={step.id}
                      className={`p-3 rounded-lg border text-sm flex flex-col gap-1.5 ${
                        idx === selectedTask.currentStep && selectedTask.status === 'running'
                          ? 'bg-cyan-950/30 border-cyan-500/50'
                          : step.status === 'verified'
                          ? 'bg-slate-950 border-emerald-900/50'
                          : step.status === 'failed'
                          ? 'bg-slate-950 border-rose-900/50'
                          : 'bg-slate-950/60 border-slate-800'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-400">Step {idx + 1}</span>
                          <span className="font-medium text-slate-200">{step.description}</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                          step.status === 'verified' ? 'bg-emerald-950 text-emerald-400' :
                          step.status === 'failed' ? 'bg-rose-950 text-rose-400' :
                          step.status === 'running' ? 'bg-cyan-950 text-cyan-400 animate-pulse' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {step.status}
                        </span>
                      </div>

                      {step.tool && (
                        <div className="text-xs text-slate-400 flex items-center gap-2">
                          <span className="font-mono text-cyan-400">Tool: {step.tool}</span>
                          {step.verification?.realityCheck && (
                            <span className="text-slate-400 truncate max-w-md">
                              • Reality check: {step.verification.realityCheck}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Truthful Evidence Section */}
              <div>
                <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3">
                  Empirical Evidence &amp; Verification ({selectedTask.evidence.length} records)
                </h3>
                {selectedTask.evidence.length === 0 ? (
                  <div className="p-4 bg-slate-950/60 rounded-lg border border-slate-800 text-xs text-slate-500">
                    No evidence records gathered yet.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {selectedTask.evidence.map((ev, i) => (
                      <div key={i} className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs flex flex-col gap-1.5 font-mono">
                        <div className="flex justify-between text-slate-400">
                          <span className="text-cyan-400">{ev.tool} ({ev.stepId})</span>
                          <span>{ev.durationMs}ms</span>
                        </div>
                        <div className="text-slate-300">
                          Source: <span className="text-slate-400">{ev.evidenceSource}</span>
                        </div>
                        {ev.verification?.realityCheck && (
                          <div className="text-emerald-400">
                            Verified: {ev.verification.realityCheck}
                          </div>
                        )}
                        {ev.error && (
                          <div className="text-rose-400">
                            Error: {ev.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Final Result */}
              {selectedTask.result && (
                <div className={`p-4 rounded-xl border ${
                  selectedTask.result.success
                    ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
                    : 'bg-rose-950/20 border-rose-800/40 text-rose-200'
                }`}>
                  <h3 className="text-xs uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                    {selectedTask.result.success ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                    Final Truthful Result ({selectedTask.result.success ? 'SUCCESS' : 'FAILURE'})
                  </h3>
                  <p className="text-sm leading-relaxed">{selectedTask.result.summary}</p>
                </div>
              )}
            </>
          ) : (
            <div className="p-12 text-center text-slate-500">
              Select a task from the list or start a new local worker task.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LocalWorkersPage;
