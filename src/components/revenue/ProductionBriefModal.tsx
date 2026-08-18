import React, { useState, useEffect } from 'react';
import { revenueClient, type ProductionBrief } from '../../api/revenueClient';

interface Props {
  opportunityId: string;
  onClose: () => void;
}

export default function ProductionBriefModal({ opportunityId, onClose }: Props) {
  const [briefs, setBriefs] = useState<ProductionBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBrief, setActiveBrief] = useState<ProductionBrief | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBriefs();
  }, [opportunityId]);

  useEffect(() => {
    if (activeBrief && ['generating', 'completed'].includes(activeBrief.status)) {
      loadTasks();
      const interval = setInterval(loadTasks, 3000);
      return () => clearInterval(interval);
    }
  }, [activeBrief?.id, activeBrief?.status]);

  const loadTasks = async () => {
    if (!activeBrief) return;
    try {
      const data = await revenueClient.getBriefTasks(activeBrief.id);
      setTasks(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  const loadBriefs = async () => {
    setLoading(true);
    try {
      const data = await revenueClient.getOpportunityBriefs(opportunityId);
      setBriefs(data);
      if (data.length > 0) setActiveBrief(data[0]);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    try {
      const newBrief = await revenueClient.createProductionBrief(opportunityId);
      setBriefs([newBrief, ...briefs]);
      setActiveBrief(newBrief);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGeneratePlan = async () => {
    if (!activeBrief) return;
    try {
      const updated = await revenueClient.generateExecutionPlan(activeBrief.id);
      setActiveBrief(updated);
      setBriefs(briefs.map(b => b.id === updated.id ? updated : b));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApprovePlan = async () => {
    if (!activeBrief) return;
    try {
      const updated = await revenueClient.approveExecutionPlan(activeBrief.id);
      setActiveBrief(updated);
      setBriefs(briefs.map(b => b.id === updated.id ? updated : b));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStartGeneration = async () => {
    if (!activeBrief) return;
    try {
      const updated = await revenueClient.startGeneration(activeBrief.id);
      setActiveBrief(updated);
      setBriefs(briefs.map(b => b.id === updated.id ? updated : b));
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100
    }}>
      <div style={{
        background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 12,
        padding: 32, width: 900, maxWidth: '90%', color: 'var(--text-primary)', maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2>Production Briefs</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>Close</button>
        </div>

        {error && <div style={{ color: '#ef4444', marginBottom: 16 }}>{error}</div>}

        {loading ? (
          <div>Loading briefs...</div>
        ) : briefs.length === 0 ? (
          <div>
            <p style={{ color: 'var(--text-secondary)' }}>No production brief exists for this opportunity.</p>
            <button onClick={handleCreate} style={{ background: '#3b82f6', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
              Create Production Brief
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ width: 200, borderRight: '1px solid var(--border-subtle)', paddingRight: 16 }}>
              <h3 style={{ marginTop: 0 }}>History</h3>
              {briefs.map(b => (
                <div key={b.id} onClick={() => setActiveBrief(b)} style={{
                  padding: 8, borderRadius: 4, cursor: 'pointer',
                  background: activeBrief?.id === b.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                  border: activeBrief?.id === b.id ? '1px solid var(--border-subtle)' : '1px solid transparent'
                }}>
                  <div>Version {b.version}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.status}</div>
                </div>
              ))}
              <button onClick={handleCreate} style={{ marginTop: 16, background: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', width: '100%' }}>
                + New Brief
              </button>
            </div>
            
            <div style={{ flex: 1 }}>
              {activeBrief && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <h3 style={{ marginTop: 0 }}>Brief v{activeBrief.version}</h3>
                    <span style={{ padding: '4px 12px', background: 'var(--bg-elevated)', borderRadius: 16, border: '1px solid var(--border-subtle)', textTransform: 'capitalize' }}>
                      {activeBrief.status.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <div style={{ marginBottom: 24, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                    <strong>Objective:</strong> {activeBrief.objective}
                  </div>

                  {activeBrief.status === 'draft' && (
                    <div style={{ display: 'flex', gap: 16 }}>
                      <button onClick={handleGeneratePlan} style={{ background: '#8b5cf6', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
                        Generate Execution Plan (Ultron)
                      </button>
                    </div>
                  )}

                  {activeBrief.status === 'awaiting_review' && (
                    <div style={{ padding: 16, border: '1px solid #f59e0b', borderRadius: 8, background: 'rgba(245, 158, 11, 0.1)' }}>
                      <h4 style={{ color: '#f59e0b', marginTop: 0 }}>Review Execution Plan</h4>
                      <pre style={{ background: 'rgba(0,0,0,0.5)', padding: 12, borderRadius: 4, fontSize: 12, overflowX: 'auto' }}>
                        {JSON.stringify(activeBrief.executionPlan, null, 2)}
                      </pre>
                      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
                        <button onClick={handleApprovePlan} style={{ background: '#10b981', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
                          Approve Plan
                        </button>
                      </div>
                    </div>
                  )}

                  {activeBrief.status === 'ready_for_generation' && (
                    <div style={{ display: 'flex', gap: 16 }}>
                      <button onClick={handleStartGeneration} style={{ background: '#3b82f6', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
                        Start Generation (OmniRoute)
                      </button>
                    </div>
                  )}

                  {['generating', 'completed'].includes(activeBrief.status) && (
                    <div style={{ marginTop: 24 }}>
                      <h4 style={{ margin: '0 0 16px 0' }}>Job Queue</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {tasks.length === 0 ? (
                          <div style={{ color: 'var(--text-secondary)' }}>Loading jobs...</div>
                        ) : (
                          tasks.map(t => (
                            <div key={t.id} style={{
                              padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                              <div>
                                <strong>{t.title}</strong>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Agent: {t.assignedAgentId}</div>
                              </div>
                              <span style={{
                                padding: '4px 8px', borderRadius: 4, fontSize: 12, textTransform: 'capitalize',
                                background: t.status === 'completed' ? '#10b981' :
                                            t.status === 'failed' || t.status === 'blocked' ? '#ef4444' :
                                            t.status === 'running' ? '#3b82f6' : 'rgba(255,255,255,0.1)'
                              }}>
                                {t.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                      <div style={{ marginTop: 16, color: 'var(--text-secondary)', fontSize: 12 }}>
                        Review generated assets in Hermes Studio when jobs complete.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
