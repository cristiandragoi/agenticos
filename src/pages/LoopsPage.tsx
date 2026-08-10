// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { useDrawer } from '../store/appStore';
import { useData } from '../store/dataStore';
import { GitBranch, Play, CheckCircle, XCircle, Clock, ChevronRight, Plus } from 'lucide-react';
import StatusBadge from '../components/ui/StatusBadge';
import { apiFetch, apiUrl } from '../api/client';

interface LoopStep {
  id: string;
  agentId: string;
  prompt: string;
  dependsOn?: string[];
  mode: string;
  outputKey?: string;
}

interface LoopDefinition {
  id: string;
  name: string;
  description?: string;
  steps: LoopStep[];
  createdAt: string;
  status: 'draft' | 'running' | 'completed' | 'failed';
  currentRun?: LoopRun;
}

interface LoopRun {
  id: string;
  loopId: string;
  stepResults: Record<string, string>;
  status: string;
  createdAt: string;
  completedAt?: string;
  iteration?: number;
  score?: number;
  stopReason?: string;
}


const AGENT_COLORS: Record<string, string> = {
  'agent-hermes': '#d4a373',
  'agent-jarvis': '#63b3ed',
  'agent-athena': '#c084fc',
  'agent-sentinel': '#f87171',
  'agent-video': '#fb923c',
};

const AGENT_NAMES: Record<string, string> = {
  'agent-hermes': 'Hermes',
  'agent-jarvis': 'Jarvis',
  'agent-athena': 'Unavailable agent',
  'agent-sentinel': 'Sentinel',
  'agent-video': 'VideoAgent',
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'completed') return <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />;
  if (status === 'running') return <Clock size={14} style={{ color: 'var(--color-info)' }} />;
  if (status === 'failed') return <XCircle size={14} style={{ color: 'var(--color-error)' }} />;
  return <GitBranch size={14} style={{ color: 'var(--text-muted)' }} />;
};

const LoopsPage: React.FC = () => {
  const { agents } = useData();
  const [loops, setLoops] = useState<LoopDefinition[]>([]);
  const [runningLoops, setRunningLoops] = useState<Set<string>>(new Set());
  const [expandedLoop, setExpandedLoop] = useState<string | null>(null);
  const [runConfigModal, setRunConfigModal] = useState<LoopDefinition | null>(null);
  const [configMaxIterations, setConfigMaxIterations] = useState(5);
  const [configStopCondition, setConfigStopCondition] = useState('score > 90');

  const fetchLoops = async () => {
    try {
      const [defRes, runsRes] = await Promise.all([
        apiFetch('/api/loops'),
        apiFetch('/api/loops/runs/all')
      ]);
      if (defRes.ok && runsRes.ok) {
        const defs: LoopDefinition[] = await defRes.json();
        const runs: LoopRun[] = await runsRes.json();
        // Attach the most recent run to each definition
        const merged = defs.map(def => {
          const defRuns = runs.filter(r => r.loopId === def.id).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          return { ...def, currentRun: defRuns[0] };
        });
        setLoops(merged);
      }
    } catch (err) {
      console.error('Failed to fetch loops', err);
    }
  };

  useEffect(() => {
    fetchLoops();
    const interval = setInterval(fetchLoops, 2000);
    return () => clearInterval(interval);
  }, []);

  const triggerLoop = async (loop: LoopDefinition) => {
    if (runningLoops.has(loop.id)) return;
    setRunningLoops(prev => new Set([...prev, loop.id]));
    setLoops(prev => prev.map(l => l.id === loop.id ? { ...l, status: 'running' } : l));

    try {
      const payload = { maxIterations: configMaxIterations, stopCondition: configStopCondition };
      setRunConfigModal(null);
      const res = await apiFetch(`/api/loops/${loop.id}/run`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to start loop');
      // Poll status every second until done
      const checkStatus = async () => {
        const sRes = await apiFetch(`/api/loops/${loop.id}/status`);
        if (sRes.ok) {
          const { definition } = await sRes.json();
          setLoops(prev => prev.map(l => l.id === definition.id ? definition : l));
          if (definition.status !== 'running') {
            setRunningLoops(prev => { const s = new Set(prev); s.delete(loop.id); return s; });
          } else {
            setTimeout(checkStatus, 1000);
          }
        }
      };
      setTimeout(checkStatus, 1000);
    } catch (err) {
      // Create loop on backend first if needed, then fallback to local simulation
      setLoops(prev => prev.map(l => l.id === loop.id ? { ...l, status: 'running' } : l));
      setTimeout(() => {
      setRunningLoops(prev => { const s = new Set(prev); s.delete(loop.id); return s; });
      }, 4000);
    }
  };

  const statusCols = {
    draft: loops.filter(l => l.status === 'draft'),
    running: loops.filter(l => l.status === 'running'),
    completed: loops.filter(l => l.status === 'completed'),
    failed: loops.filter(l => l.status === 'failed'),
  };

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_loops.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Loop Engineering</h1>
          <p>Multi-step, multi-agent plans with dependency resolution and output chaining.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> New Loop
          </button>
        </div>
      </div>

      {runConfigModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setRunConfigModal(null)}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-glass)', borderRadius: 12,
            padding: 24, width: 400, maxWidth: '90vw',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Play size={16} /> Configure Loop Run
            </h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Max Iterations</label>
              <input
                type="number" value={configMaxIterations} min={1} max={50}
                onChange={e => setConfigMaxIterations(parseInt(e.target.value))}
                style={{
                  width: '100%', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                  borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.85rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Stop Condition (LLM Evaluation)</label>
              <input
                type="text" value={configStopCondition}
                onChange={e => setConfigStopCondition(e.target.value)}
                placeholder="e.g. score > 90"
                style={{
                  width: '100%', background: 'var(--bg-glass)', border: '1px solid var(--border-glass)',
                  borderRadius: 6, padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.85rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost" onClick={() => setRunConfigModal(null)}>Cancel</button>
              <button className="btn btn--primary" onClick={() => triggerLoop(runConfigModal)}>
                Start Execution
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="board-layout">
        {(['draft', 'running', 'completed', 'failed'] as const).map(status => (
          <div key={status} className="board-column">
            <div className="board-column__header">
              <div className="board-column__title" style={{ textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusIcon status={status} /> {status}
              </div>
              <div className="board-column__count">{statusCols[status].length}</div>
            </div>
            <div className="board-column__body">
              {statusCols[status].length === 0 ? (
                <div className="board-column__empty">No {status} loops</div>
              ) : statusCols[status].map(loop => (
                <div key={loop.id} className="entity-card" style={{ '--card-accent': status === 'running' ? 'var(--color-info)' : status === 'completed' ? 'var(--color-success)' : status === 'failed' ? 'var(--color-error)' : 'var(--text-muted)' } as React.CSSProperties}>
                  <div className="entity-card__header">
                    <div style={{ flex: 1 }}>
                      <div className="entity-card__title">{loop.name}</div>
                      <div className="entity-card__subtitle">{loop.steps.length} steps</div>
                    </div>
                    <StatusBadge status={loop.status} />
                  </div>
                  {loop.currentRun && (
                    <div style={{ marginBottom: 12, padding: '8px', background: 'var(--bg-glass)', borderRadius: 6, display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Iteration</div>
                        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{loop.currentRun.iteration || 1}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Score</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 4, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${loop.currentRun.score || 0}%`, height: '100%', background: 'var(--color-success)' }} />
                          </div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{loop.currentRun.score || 0}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {loop.currentRun?.stopReason && loop.status !== 'running' && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12, padding: '6px', borderLeft: '2px solid var(--border-glass)', background: 'var(--bg-base)' }}>
                      <strong>Stop Reason:</strong> {loop.currentRun.stopReason}
                    </div>
                  )}
                  {loop.description && (
                    <div className="entity-card__body" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                      {loop.description}
                    </div>
                  )}

                  {/* Step pipeline visualization */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {loop.steps.map((step, idx) => (
                      <React.Fragment key={step.id}>
                        <div style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
                          background: AGENT_COLORS[step.agentId] + '22',
                          color: AGENT_COLORS[step.agentId],
                          border: `1px solid ${AGENT_COLORS[step.agentId]}44`,
                          whiteSpace: 'nowrap',
                        }}>
                          {AGENT_NAMES[step.agentId] || step.agentId}
                        </div>
                        {idx < loop.steps.length - 1 && <ChevronRight size={10} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Expanded step detail */}
                  {expandedLoop === loop.id && (
                    <div style={{ marginBottom: 8 }}>
                      {loop.steps.map((step, idx) => (
                        <div key={step.id} style={{
                          padding: '6px 8px', marginBottom: 4, borderRadius: 4,
                          background: 'var(--bg-glass)', fontSize: '0.75rem',
                          borderLeft: `3px solid ${AGENT_COLORS[step.agentId]}`,
                        }}>
                          <div style={{ color: AGENT_COLORS[step.agentId], marginBottom: 2 }}>
                            {idx + 1}. {AGENT_NAMES[step.agentId]}
                            {step.dependsOn?.length ? ` (after: ${step.dependsOn.join(', ')})` : ''}
                          </div>
                          <div style={{ color: 'var(--text-secondary)' }}>{step.prompt}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      className="btn btn--ghost"
                      style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                      onClick={() => setExpandedLoop(expandedLoop === loop.id ? null : loop.id)}
                    >
                      {expandedLoop === loop.id ? 'Collapse' : 'Steps'}
                    </button>
                    {loop.status !== 'running' && (
                      <button
                        className="btn btn--primary"
                        style={{ fontSize: '0.72rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => {
                          setConfigMaxIterations(loop.maxIterations || 5);
                          setConfigStopCondition(loop.stopCondition || 'score > 90');
                          setRunConfigModal(loop);
                        }}
                      >
                        <Play size={10} />
                        {runningLoops.has(loop.id) ? 'Running...' : 'Run Loop'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LoopsPage;

