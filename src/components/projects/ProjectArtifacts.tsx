// Project Artifacts — outputs produced by AgenticOS work, scoped to project.
// Shows: WHAT was built, WHO built it, FOR which task, WHERE it lives, VERIFIED?
// Extends the existing artifact system (no duplicate file content — references).
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useProjects } from '../../store/projectStore';

interface ProjectArtifact {
  id: string; type?: string; title?: string; preview?: string; content?: string;
  projectId?: string; taskId?: string; linkedAgentId?: string; location?: string;
  createdBy?: string; verificationState?: string; status?: string;
  createdAt?: string; updatedAt?: string;
}

const VERIFY_COLOR: Record<string, string> = {
  pending: '#64748b', running: '#f5b50a', passed: '#22c55e', failed: '#ef4444', skipped: '#475569',
};
const TYPE_COLOR: Record<string, string> = {
  document: '#67e8f9', report: '#a78bfa', code: '#4ade80', screenshot: '#f472b6',
  research: '#a78bfa', 'build output': '#fbbf24', 'verification report': '#22c55e',
  handoff: '#f59e0b', dataset: '#60a5fa', decision: '#f87171', url: '#34d399',
};

export const ProjectArtifacts: React.FC<{ projectId: string; highlightArtifactId?: string | null }> = ({ projectId, highlightArtifactId }) => {
  const { getProjectTasks } = useProjects();
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newArt, setNewArt] = useState({ title: '', type: 'document', preview: '', taskId: '', createdBy: '', location: '' });

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/artifacts`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setArtifacts(data);
      }
    } catch { /* best effort */ }
    setTasks(await getProjectTasks(projectId));
    setLoading(false);
  }, [projectId, getProjectTasks]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newArt.title.trim()) return;
    const res = await apiFetch(`/api/projects/${projectId}/artifacts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newArt, title: newArt.title.trim() }),
    });
    if (res.ok) {
      const created = await res.json();
      setArtifacts((prev) => [created, ...prev]);
      setCreating(false);
      setNewArt({ title: '', type: 'document', preview: '', taskId: '', createdBy: '', location: '' });
    }
  };

  return (
    <div data-testid="project-artifacts">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Artifacts — {artifacts.length} output{artifacts.length !== 1 ? 's' : ''}
        </span>
        <button type="button" onClick={() => setCreating((c) => !c)} style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          + Record Artifact
        </button>
      </div>
      {creating && (
        <div style={{ border: '1px solid #0891b2', borderRadius: 8, padding: 12, background: '#0f172a', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          <input type="text" value={newArt.title} onChange={(e) => setNewArt({ ...newArt, title: e.target.value })} placeholder="Artifact title…" style={inputStyle} autoFocus />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={newArt.type} onChange={(e) => setNewArt({ ...newArt, type: e.target.value })} style={inputStyle}>
              {['document', 'report', 'code', 'screenshot', 'research', 'build output', 'verification report', 'handoff', 'dataset', 'decision', 'url'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={newArt.taskId} onChange={(e) => setNewArt({ ...newArt, taskId: e.target.value })} style={inputStyle}>
              <option value="">No task link</option>
              {tasks.map((t) => <option key={t.taskId} value={t.taskId}>{t.title?.slice(0, 30)}</option>)}
            </select>
          </div>
          <input type="text" value={newArt.createdBy} onChange={(e) => setNewArt({ ...newArt, createdBy: e.target.value })} placeholder="Created by (agent)…" style={inputStyle} />
          <input type="text" value={newArt.location} onChange={(e) => setNewArt({ ...newArt, location: e.target.value })} placeholder="Location / path / reference…" style={inputStyle} />
          <textarea value={newArt.preview} onChange={(e) => setNewArt({ ...newArt, preview: e.target.value })} placeholder="Preview / description…" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => void handleCreate()} style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Save</button>
            <button type="button" onClick={() => setCreating(false)} style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 5, padding: '5px 14px', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
      {!loading && artifacts.length === 0 && !creating && (
        <div style={{ fontSize: 12, color: '#334155', padding: '18px 0', textAlign: 'center' }}>
          No artifacts yet. Record outputs as work produces them.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {artifacts.map((a) => {
          const highlighted = Boolean(highlightArtifactId && a.id === highlightArtifactId);
          return (
          <div key={a.id} data-testid={`project-artifact-${a.id}`} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
            background: highlighted ? 'rgba(0,212,255,0.08)' : 'rgba(15,23,42,0.6)',
            border: `1px solid ${highlighted ? '#00d4ff' : '#1e293b'}`, borderRadius: 8,
            boxShadow: highlighted ? '0 0 0 1px rgba(0,212,255,0.6)' : undefined,
          }}>
            {highlighted && (
              <span style={{ fontSize: 8, fontWeight: 700, color: '#00d4ff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>◈</span>
            )}
            <span style={{ flex: '0 0 auto', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: TYPE_COLOR[a.type || 'document'] || '#94a3b8', background: 'rgba(15,23,42,0.8)', padding: '2px 7px', borderRadius: 8 }}>
              {a.type || 'artifact'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>{a.title}</div>
              {a.preview && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{a.preview.slice(0, 120)}</div>}
              <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#475569', marginTop: 4, flexWrap: 'wrap' }}>
                {a.createdBy && <span>WHO: <b style={{ color: '#94a3b8' }}>{a.createdBy}</b></span>}
                {a.taskId && <span>TASK: <b style={{ color: '#94a3b8' }}>{a.taskId.slice(-8)}</b></span>}
                {a.location && <span>WHERE: <b style={{ color: '#94a3b8' }}>{a.location.slice(0, 50)}</b></span>}
                {a.createdAt && <span>{new Date(a.createdAt).toLocaleString()}</span>}
              </div>
            </div>
            <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 700, color: VERIFY_COLOR[a.verificationState || 'pending'] || '#64748b', border: `1px solid ${VERIFY_COLOR[a.verificationState || 'pending'] || '#64748b'}55`, borderRadius: 8, padding: '2px 8px' }}>
              {String(a.verificationState || 'pending').toUpperCase()}
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  background: '#0a0f16', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', fontSize: 12, padding: '6px 10px', outline: 'none',
};

export default ProjectArtifacts;
