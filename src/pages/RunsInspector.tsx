import React, { useState, useEffect, useRef } from 'react';
import { Target, Search, Clock, Zap, CheckCircle2, XCircle, AlertCircle, RefreshCw, X, Box } from 'lucide-react';
import type { AgentRun, RunStep } from '../../shared/types';
import type { AgentSkill } from '../../shared/types/skill';
import { apiFetch, apiUrl } from '../api/client';

export default function RunsInspector() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  
  const [runDetails, setRunDetails] = useState<{ run: AgentRun; steps: RunStep[] } | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const pollInterval = useRef<any>(null);

  const fetchSkills = async () => {
    try {
      const res = await apiFetch('/api/skills');
      const data = await res.json();
      setSkills(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRuns = async () => {
    try {
      const res = await apiFetch('/api/runs');
      const data = await res.json();
      setRuns(data || []);
    } catch (e) {
      console.error('Failed to fetch runs', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchRunDetails = async (id: string) => {
    setDetailsLoading(true);
    try {
      const res = await apiFetch(`/api/runs/${id}`);
      const data = await res.json();
      setRunDetails(data);
    } catch (e) {
      console.error('Failed to fetch run details', e);
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
    fetchRuns();
    pollInterval.current = setInterval(() => {
      fetchRuns();
      if (selectedRunId) {
        fetchRunDetails(selectedRunId);
      }
    }, 2000);
    return () => clearInterval(pollInterval.current);
  }, [selectedRunId]);

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'completed': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'failed': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'running': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'queued': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  return (
    <div className="flex h-full w-full" style={{ backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_runs.png')", backgroundSize: 'cover', backgroundAttachment: 'fixed', display: 'flex' }}>
      
      {/* LEFT PANEL: Runs List */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid var(--border-subtle)', transition: 'all 0.3s', width: selectedRunId ? '50%' : '100%' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Zap size={24} style={{ color: 'var(--color-hermes)' }} /> Runs Inspector
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>Live execution history of all background tasks.</p>
          </div>
          <button onClick={fetchRuns} className="search-trigger" style={{ padding: '8px' }}>
            <RefreshCw size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={{ color: 'var(--text-dim)' }}>Loading runs...</div>
          ) : runs.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No runs found in the database.</div>
          ) : (
            runs.map(run => {
              const skillId = (run.input as any)?.skillId;
              const skill = skills.find(s => s.id === skillId);
              let duration = '-';
              if (run.startedAt && run.completedAt) {
                const s = new Date(run.startedAt).getTime();
                const e = new Date(run.completedAt).getTime();
                duration = `${((e - s) / 1000).toFixed(1)}s`;
              } else if (run.startedAt) {
                duration = 'running...';
              }

              const isSelected = selectedRunId === run.id;
              let statusColor = 'var(--text-dim)';
              if (run.status === 'completed') statusColor = 'var(--color-success)';
              if (run.status === 'failed') statusColor = 'var(--color-error)';
              if (run.status === 'running') statusColor = 'var(--color-info)';

              return (
                <div 
                  key={run.id} 
                  onClick={() => {
                    setSelectedRunId(run.id);
                    fetchRunDetails(run.id);
                  }}
                  className="entity-card"
                  style={{ 
                    cursor: 'pointer', 
                    border: isSelected ? '1px solid var(--color-hermes)' : '1px solid var(--border-subtle)',
                    backgroundColor: isSelected ? 'var(--bg-elevated)' : 'var(--bg-surface)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-dim)' }}>{run.id.slice(0,13)}</div>
                      <div className="status-pill" style={{ color: statusColor, borderColor: statusColor, fontSize: '10px' }}>
                        {run.status}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                      {new Date(run.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-primary)', fontWeight: 500 }}>
                      <Target size={14} style={{ color: 'var(--color-hermes)' }}/> 
                      {skill ? skill.name : skillId || 'No Skill'}
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'var(--text-dim)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Box size={12} />
                        {skill?.agentId || 'Hermes'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} /> 
                        {duration}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT PANEL: Inspector */}
      {selectedRunId && (
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-overlay)', backdropFilter: 'blur(10px)' }}>
          <div style={{ padding: '24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
              <Search size={18} style={{ color: 'var(--color-hermes)' }} /> Run Details
            </h2>
            <button onClick={() => setSelectedRunId(null)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {!runDetails ? (
              <div style={{ color: 'var(--text-dim)' }}>Loading details...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* Summary Card */}
                <div style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
                  <h3 className="nav-section-label" style={{ padding: 0, marginBottom: '16px' }}>Metadata</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '14px' }}>
                    <div>
                      <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '12px' }}>Run ID</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '12px' }}>{runDetails.run.id}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '12px' }}>Trigger</span>
                      <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{runDetails.run.trigger}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '12px' }}>Started</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{runDetails.run.startedAt ? new Date(runDetails.run.startedAt).toLocaleString() : '-'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-dim)', display: 'block', fontSize: '12px' }}>Completed</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{runDetails.run.completedAt ? new Date(runDetails.run.completedAt).toLocaleString() : '-'}</span>
                    </div>
                  </div>
                </div>

                {/* Steps */}
                <div>
                  <h3 className="nav-section-label" style={{ padding: 0, marginBottom: '16px' }}>Execution Steps</h3>
                  {runDetails.steps.length === 0 ? (
                    <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '14px' }}>No steps recorded yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {runDetails.steps.map((step, idx) => (
                        <div key={step.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', backgroundColor: step.status === 'completed' ? 'var(--color-success)' : step.status === 'failed' ? 'var(--color-error)' : 'var(--color-info)', flexShrink: 0 }}>
                            {step.status === 'completed' ? <CheckCircle2 size={16} color="#fff"/> : step.status === 'failed' ? <XCircle size={16} color="#fff"/> : <Clock size={16} color="#fff"/>}
                          </div>
                          
                          <div style={{ flex: 1, backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                                Skill: {skills.find(s => s.id === step.skillId)?.name || step.skillId}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'monospace' }}>{new Date(step.startedAt!).toLocaleTimeString()}</div>
                            </div>
                            
                            {!!step.output && (
                              <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-base)', borderRadius: '4px', border: '1px solid var(--border-subtle)', fontSize: '12px', color: 'var(--text-dim)', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                                {JSON.stringify(step.output, null, 2)}
                              </div>
                            )}
                            {step.error && (
                              <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--bg-base)', borderRadius: '4px', border: '1px solid var(--color-error)', fontSize: '12px', color: 'var(--color-error)', fontFamily: 'monospace' }}>
                                {step.error}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

