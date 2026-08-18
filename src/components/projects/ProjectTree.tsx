import React, { useEffect, useState, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Layers,
  Target,
  ListTodo,
  Workflow,
  FileCheck,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';

interface VerificationRecord {
  id: string;
  taskId: string;
  targetRunId: string;
  verifierProvider: string | null;
  verifierModel: string | null;
  workerProvider: string | null;
  workerModel: string | null;
  sameProvider: boolean;
  verdict: 'PASS' | 'FAIL' | 'NEEDS_REVISION' | 'NOT_PROVEN';
  issues: string[];
  evidence: string[];
  recommendation: string | null;
  revisionCount: number;
}

interface ExecutionResult {
  id: string;
  runId: string;
  status: string;
  summary: string | null;
  structuredOutput: Record<string, unknown> | null;
  artifactRefs: string[];
}

interface ExecutionRun {
  id: string;
  taskId: string;
  workerType: string;
  status: string;
  provider: string | null;
  model: string | null;
  startTime: string | null;
  endTime: string | null;
  result: ExecutionResult | null;
  verification: VerificationRecord | null;
}

interface ProjectTask {
  id: string;
  goalId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  taskType: string;
  status: string;
  assignedCapability: string | null;
  priority: string;
  children: ProjectTask[];
  runs: ExecutionRun[];
}

interface ProjectGoal {
  id: string;
  projectId: string;
  title: string;
  objective: string | null;
  status: string;
  priority: string;
  tasks: ProjectTask[];
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 size={14} className="text-emerald-400" />,
  running: <Play size={14} className="text-cyan-400 animate-pulse" />,
  failed: <XCircle size={14} className="text-rose-400" />,
  queued: <Clock size={14} className="text-amber-400" />,
  pending: <Clock size={14} className="text-slate-400" />,
  planning: <Layers size={14} className="text-indigo-400" />,
};

const VERDICT_BADGES: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  PASS: { label: 'PASS', bg: 'rgba(16,185,129,0.15)', text: '#10b981', icon: <ShieldCheck size={12} /> },
  FAIL: { label: 'FAIL', bg: 'rgba(244,63,94,0.15)', text: '#f43f5e', icon: <ShieldAlert size={12} /> },
  NEEDS_REVISION: { label: 'REVISE', bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', icon: <AlertTriangle size={12} /> },
  NOT_PROVEN: { label: 'UNPROVEN', bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', icon: <ShieldQuestion size={12} /> },
};

export default function ProjectTree({ projectId }: { projectId: string }) {
  const [goals, setGoals] = useState<ProjectGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedGoals, setExpandedGoals] = useState<Record<string, boolean>>({});
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [selectedRun, setSelectedRun] = useState<ExecutionRun | null>(null);

  const fetchTree = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/project-execution/${projectId}/tree`, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load project execution tree`);
      const data = await res.json();
      const goalList: ProjectGoal[] = data.goals || [];
      setGoals(goalList);
      
      // Auto-expand all goals and top tasks on initial load
      const expG: Record<string, boolean> = {};
      const expT: Record<string, boolean> = {};
      for (const g of goalList) {
        expG[g.id] = true;
        for (const t of g.tasks || []) {
          expT[t.id] = true;
        }
      }
      setExpandedGoals(expG);
      setExpandedTasks(expT);
    } catch (err: any) {
      setError(err.message || 'Error fetching tree');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  const toggleGoal = (id: string) => setExpandedGoals((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleTask = (id: string) => setExpandedTasks((prev) => ({ ...prev, [id]: !prev[id] }));

  if (loading && goals.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400 text-sm gap-2">
        <RefreshCw size={16} className="animate-spin text-cyan-400" />
        Loading execution tree...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-950/30 border border-rose-900/50 rounded-lg text-rose-300 text-sm flex items-center justify-between">
        <div>
          <div className="font-semibold mb-1">Execution Tree Error</div>
          <div>{error}</div>
        </div>
        <button
          onClick={fetchTree}
          className="px-3 py-1.5 bg-rose-900/60 hover:bg-rose-800 rounded text-xs font-medium text-white transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="border border-slate-800 rounded-lg p-10 text-center bg-slate-900/40">
        <Target size={32} className="mx-auto text-slate-600 mb-3" />
        <h3 className="text-slate-300 font-medium text-sm mb-1">No Execution Goals Yet</h3>
        <p className="text-slate-500 text-xs max-w-sm mx-auto mb-4">
          Tasks and goals delegated through Jarvis, CodeX, or Magnitude will appear in this persistent execution tree.
        </p>
        <button
          onClick={fetchTree}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Action bar */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Workflow size={16} className="text-cyan-400" />
          <span className="text-xs font-bold text-slate-400 tracking-wider uppercase">
            Canonical Execution Tree
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
            {goals.length} {goals.length === 1 ? 'Goal' : 'Goals'}
          </span>
        </div>
        <button
          onClick={fetchTree}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors px-2 py-1 rounded bg-slate-900 border border-slate-800"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Tree List (2 cols) */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          {goals.map((goal) => {
            const isExpG = expandedGoals[goal.id] ?? true;
            return (
              <div
                key={goal.id}
                className="border border-slate-800 rounded-lg bg-slate-900/60 overflow-hidden"
              >
                {/* Goal Header */}
                <div
                  onClick={() => toggleGoal(goal.id)}
                  className="flex items-center justify-between p-3.5 bg-slate-800/40 hover:bg-slate-800/70 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <button className="text-slate-400 hover:text-white p-0.5">
                      {isExpG ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <Target size={15} className="text-cyan-400 flex-shrink-0" />
                    <span className="font-semibold text-sm text-slate-200 truncate">
                      {goal.title}
                    </span>
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {goal.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono flex-shrink-0">
                    {goal.tasks?.length || 0} Tasks
                  </div>
                </div>

                {/* Goal Tasks Tree */}
                {isExpG && (
                  <div className="p-3 border-t border-slate-800/60 flex flex-col gap-2.5 bg-slate-950/40">
                    {goal.objective && (
                      <div className="text-xs text-slate-400 italic px-2 pb-1 border-b border-slate-800/40">
                        Objective: {goal.objective}
                      </div>
                    )}
                    {(!goal.tasks || goal.tasks.length === 0) ? (
                      <div className="text-xs text-slate-500 italic p-2">No tasks defined under this goal yet.</div>
                    ) : (
                      goal.tasks.map((task) => (
                        <TaskTreeNode
                          key={task.id}
                          task={task}
                          isExpanded={expandedTasks[task.id] ?? true}
                          onToggle={() => toggleTask(task.id)}
                          selectedRun={selectedRun}
                          onSelectRun={setSelectedRun}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected Run / Verification Detail Inspector (1 col) */}
        <div className="lg:col-span-1">
          {selectedRun ? (
            <RunDetailInspector
              run={selectedRun}
              onClose={() => setSelectedRun(null)}
            />
          ) : (
            <div className="border border-slate-800 rounded-lg p-6 bg-slate-900/30 text-center text-slate-500 text-xs">
              <FileCheck size={28} className="mx-auto text-slate-600 mb-2" />
              <div>Select any run in the execution tree to inspect result details and verifier reports.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskTreeNode({
  task,
  isExpanded,
  onToggle,
  selectedRun,
  onSelectRun,
}: {
  task: ProjectTask;
  isExpanded: boolean;
  onToggle: () => void;
  selectedRun: ExecutionRun | null;
  onSelectRun: (run: ExecutionRun) => void;
}) {
  const hasSubtasks = (task.children && task.children.length > 0);
  const hasRuns = (task.runs && task.runs.length > 0);

  return (
    <div className="border border-slate-800/80 rounded-md bg-slate-900/40 overflow-hidden">
      {/* Task Header */}
      <div
        onClick={onToggle}
        className="flex items-center justify-between p-2.5 bg-slate-800/20 hover:bg-slate-800/40 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button className="text-slate-500 hover:text-slate-300 p-0.5">
            {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <ListTodo size={14} className="text-slate-400 flex-shrink-0" />
          <span className="text-xs font-medium text-slate-300 truncate">
            {task.title}
          </span>
          {task.assignedCapability && (
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/50 font-mono">
              {task.assignedCapability}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {STATUS_ICONS[task.status] || STATUS_ICONS.pending}
          <span className="text-[10px] text-slate-400 capitalize">{task.status}</span>
        </div>
      </div>

      {/* Task Content: Runs + Subtasks */}
      {isExpanded && (
        <div className="p-2.5 border-t border-slate-800/40 flex flex-col gap-2 bg-slate-950/20">
          {/* Runs list */}
          {hasRuns && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Execution Runs ({task.runs.length})
              </span>
              {task.runs.map((run) => {
                const isSelected = selectedRun?.id === run.id;
                const verdict = run.verification?.verdict;
                const vBadge = verdict ? VERDICT_BADGES[verdict] : null;

                return (
                  <div
                    key={run.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRun(run);
                    }}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-all border ${
                      isSelected
                        ? 'border-cyan-500/80 bg-cyan-950/30'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {STATUS_ICONS[run.status] || STATUS_ICONS.pending}
                      <span className="text-xs font-mono text-slate-300 truncate">
                        {run.id}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ({run.workerType})
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {vBadge && (
                        <span
                          style={{ background: vBadge.bg, color: vBadge.text }}
                          className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
                        >
                          {vBadge.icon}
                          {vBadge.label}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 capitalize font-mono">
                        {run.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Subtasks nested */}
          {hasSubtasks && (
            <div className="flex flex-col gap-1.5 mt-1 pl-3 border-l-2 border-slate-800">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Subtasks ({task.children.length})
              </span>
              {task.children.map((child) => (
                <TaskTreeNode
                  key={child.id}
                  task={child}
                  isExpanded={true}
                  onToggle={() => {}}
                  selectedRun={selectedRun}
                  onSelectRun={onSelectRun}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunDetailInspector({
  run,
  onClose,
}: {
  run: ExecutionRun;
  onClose: () => void;
}) {
  const result = run.result;
  const ver = run.verification;
  const vBadge = ver?.verdict ? VERDICT_BADGES[ver.verdict] : null;

  return (
    <div className="border border-slate-800 rounded-lg bg-slate-900/90 p-4 flex flex-col gap-3 sticky top-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div>
          <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
            Run Inspector
          </div>
          <div className="text-xs font-mono font-bold text-slate-200">{run.id}</div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs p-1"
        >
          ✕
        </button>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/60 p-2.5 rounded border border-slate-800/60">
        <div>
          <span className="text-slate-500 block text-[10px]">Worker</span>
          <span className="text-slate-300 font-mono">{run.workerType}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">Status</span>
          <span className="text-slate-300 font-mono capitalize">{run.status}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">Provider</span>
          <span className="text-slate-300 font-mono truncate">{run.provider || 'default'}</span>
        </div>
        <div>
          <span className="text-slate-500 block text-[10px]">Model</span>
          <span className="text-slate-300 font-mono truncate">{run.model || 'default'}</span>
        </div>
      </div>

      {/* Execution Result */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Result Summary
        </span>
        <div className="text-xs bg-slate-950 p-2.5 rounded border border-slate-800 text-slate-300 max-h-36 overflow-y-auto leading-relaxed">
          {result?.summary || 'No summary text available.'}
        </div>
      </div>

      {/* Verification Report */}
      <div className="flex flex-col gap-1.5 border-t border-slate-800/80 pt-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            First-Class Verification
          </span>
          {vBadge && (
            <span
              style={{ background: vBadge.bg, color: vBadge.text }}
              className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded"
            >
              {vBadge.icon}
              {vBadge.label}
            </span>
          )}
        </div>

        {ver ? (
          <div className="flex flex-col gap-2 text-xs bg-slate-950/60 p-2.5 rounded border border-slate-800/60">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Verifier: {ver.verifierProvider || 'unknown'}</span>
              <span>Worker: {ver.workerProvider || 'unknown'}</span>
            </div>
            {ver.sameProvider && (
              <div className="text-[10px] text-amber-400 bg-amber-950/30 border border-amber-800/50 p-1.5 rounded">
                ⚠ Note: Verifier & Worker shared same provider family.
              </div>
            )}
            {ver.recommendation && (
              <div>
                <span className="text-slate-500 block text-[10px]">Recommendation:</span>
                <span className="text-slate-300">{ver.recommendation}</span>
              </div>
            )}
            {ver.issues && ver.issues.length > 0 && (
              <div>
                <span className="text-slate-500 block text-[10px]">Issues ({ver.issues.length}):</span>
                <ul className="list-disc pl-3.5 text-rose-300 text-[11px] space-y-0.5">
                  {ver.issues.map((iss, i) => (
                    <li key={i}>{iss}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic bg-slate-950/30 p-2 rounded text-center">
            No verification report recorded for this run.
          </div>
        )}
      </div>
    </div>
  );
}
