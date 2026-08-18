// RoutinesPanel — minimal canonical Routine view (Control Room).
// Lists Routine / Project / Worker / Schedule / Enabled / Last Run / verdict / next,
// with Run now / Enable / Disable / View history actions. No redesign, no Teach UI.
import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../../api/client';
import { Play, Plus, Trash2, RefreshCw, Loader2, Power } from 'lucide-react';

interface Routine {
  routineId: string;
  projectId: string;
  name: string;
  worker: string;
  enabled: boolean;
  scheduleId: string | null;
  objective: string;
}

interface RoutineRun {
  triggeredAt: string;
  triggerType: string;
  status: string;
  worker: string | null;
  verdict: string | null;
  runId: string | null;
  backgroundTaskId: string | null;
  error: string | null;
}

const WORKERS = ['hermes', 'codex', 'magnitude'];

const RoutinesPanel: React.FC = () => {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [runs, setRuns] = useState<Record<string, RoutineRun[]>>({});
  const [openRuns, setOpenRuns] = useState<string | null>(null);

  // create form
  const [name, setName] = useState('');
  const [worker, setWorker] = useState('hermes');
  const [objective, setObjective] = useState('');
  const [cron, setCron] = useState('');
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoutines(await apiClient.getRoutines());
    } catch (e: any) {
      setError(e?.message || 'Failed to load routines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Resolve available projects + default the create form to the active project.
    (async () => {
      try {
        const [projs, active] = await Promise.all([apiClient.getProjects(), apiClient.getActiveProject()]);
        const list: Array<{ id: string; name: string }> = (projs || []).map((p: any) => ({ id: p.id, name: p.name }));
        setProjects(list);
        const defaultId = (active && list.some((p) => p.id === active.id)) ? active.id : (list[0]?.id ?? '');
        setProjectId(defaultId);
      } catch { /* non-fatal */ }
    })();
  }, [load]);

  const create = async () => {
    if (!name.trim() || !objective.trim()) { setError('Name and objective required.'); return; }
    if (!projectId) { setError('Select a project first.'); return; }
    setCreating(true);
    setError(null);
    try {
      await apiClient.createRoutine({
        projectId,
        name, worker, objective,
        cronExpression: cron.trim() ? cron.trim() : undefined,
        enabled: true,
      });
      setShowCreate(false);
      setName(''); setObjective(''); setCron('');
      await load();
    } catch (e: any) { setError(e?.message || 'Create failed'); }
    finally { setCreating(false); }
  };

  const runNow = async (id: string) => {
    setError(null);
    try { await apiClient.runRoutine(id); await load(); } catch (e: any) { setError(e?.message); }
  };

  const toggle = async (id: string, enabled: boolean) => {
    setError(null);
    try { await apiClient.setRoutineEnabled(id, enabled); await load(); } catch (e: any) { setError(e?.message); }
  };

  const viewRuns = async (id: string) => {
    if (openRuns === id) { setOpenRuns(null); return; }
    setOpenRuns(id);
    try {
      const rows = await apiClient.getRoutineRuns(id);
      setRuns((r) => ({ ...r, [id]: rows }));
    } catch { /* non-fatal */ }
  };

  const del = async (id: string) => {
    setError(null);
    try { await apiClient.deleteRoutine(id); await load(); } catch (e: any) { setError(e?.message); }
  };

  return (
    <div className="flex-col" style={{ gap: 8 }}>
      <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="text-xs text-dim" style={{ fontWeight: 600, letterSpacing: 0.5 }}>ROUTINES</div>
        <div className="flex-row" style={{ gap: 6 }}>
          <button className="btn-ghost" onClick={load} title="Refresh"><RefreshCw size={13} /></button>
          <button className="btn-ghost" onClick={() => setShowCreate((v) => !v)} title="New routine"><Plus size={13} /></button>
        </div>
      </div>

      {error && <div style={{ color: 'var(--color-error)', fontSize: '0.75rem' }}>{error}</div>}

      {showCreate && (
        <div className="flex-col" style={{ gap: 6, padding: '8px 0' }}>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={inpStyle} />
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inpStyle}>
            <option value="">Select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={worker} onChange={(e) => setWorker(e.target.value)} style={inpStyle}>
            {WORKERS.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <textarea placeholder="Objective (what the routine does)" value={objective} onChange={(e) => setObjective(e.target.value)} style={{ ...inpStyle, minHeight: 48 }} />
          <input placeholder="Cron (optional, e.g. 0 9 * * *)" value={cron} onChange={(e) => setCron(e.target.value)} style={inpStyle} />
          <button className="btn-primary" onClick={create} disabled={creating}>
            {creating ? 'Creating…' : 'Create routine'}
          </button>
        </div>
      )}

      {loading && <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>Loading…</div>}

      {(routines || []).length === 0 && !loading ? (
        <div style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: '0.75rem', fontStyle: 'italic', textAlign: 'center' }}>
          No routines yet.
        </div>
      ) : (routines || []).map((r) => (
        <div key={r.routineId} className="flex-col" style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', gap: 6 }}>
          <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="flex-row" style={{ gap: 8, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.enabled ? 'var(--color-success)' : 'var(--text-tertiary)' }} />
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span className="text-xxs text-dim" style={{ textTransform: 'uppercase' }}>{r.worker}</span>
            </div>
            <div className="flex-row" style={{ gap: 4 }}>
              <button className="btn-ghost" onClick={() => runNow(r.routineId)} title="Run now"><Play size={12} /></button>
              <button className="btn-ghost" onClick={() => toggle(r.routineId, !r.enabled)} title={r.enabled ? 'Disable' : 'Enable'}><Power size={12} /></button>
              <button className="btn-ghost" onClick={() => viewRuns(r.routineId)} title="History"><Loader2 size={12} /></button>
              <button className="btn-ghost" onClick={() => del(r.routineId)} title="Delete"><Trash2 size={12} /></button>
            </div>
          </div>
          <div className="text-xxs text-dim">{r.objective}</div>
          {openRuns === r.routineId && (
            <div className="flex-col" style={{ gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {(runs[r.routineId] || []).length === 0 && <div className="text-xxs text-dim">No runs yet.</div>}
              {(runs[r.routineId] || []).map((run, i) => (
                <div key={i} className="text-xxs text-dim" style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                  <span>{new Date(run.triggeredAt).toLocaleString()}</span>
                  <span style={{ color: run.status === 'completed' ? 'var(--color-success)' : 'var(--color-error)' }}>{run.status}</span>
                  <span>{run.verdict || run.worker || run.triggerType}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const inpStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
};

export default RoutinesPanel;
