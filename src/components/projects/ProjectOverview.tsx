// Project Overview — executive summary from REAL data:
// active tasks, blockers, assigned agents, recent artifacts, knowledge, runs.
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useProjects } from '../../store/projectStore';
import type { Project, KnowledgeItem } from '../../store/projectStore';

const STATUS_COLOR: Record<string, string> = {
  queued: '#64748b', planning: '#f5b50a', running: '#00d4ff',
  waiting_approval: '#f59e0b', paused: '#64748b', review: '#a855f7',
  completed: '#22c55e', failed: '#ef4444', cancelled: '#374151', blocked: '#f59e0b',
};

export const ProjectOverview: React.FC<{ project: Project; projectId: string }> = ({ project, projectId }) => {
  const { getProjectTasks, getKnowledgeItems } = useProjects();
  const [tasks, setTasks] = useState<any[]>([]);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [t, k, artRes] = await Promise.all([
      getProjectTasks(projectId),
      getKnowledgeItems(projectId),
      apiFetch(`/api/projects/${projectId}/artifacts`),
    ]);
    setTasks(t);
    setKnowledge(k);
    setArtifacts(artRes.ok ? await artRes.json() : []);
    setLoading(false);
  }, [projectId, getProjectTasks, getKnowledgeItems]);

  useEffect(() => { load(); }, [load]);

  const active = tasks.filter((t) => !['completed', 'failed', 'cancelled'].includes(t.status));
  const blocked = tasks.filter((t) => t.status === 'blocked' || t.status === 'waiting_approval');
  const agents = [...new Set(tasks.map((t) => t.worker).filter(Boolean))];
  const recentArtifacts = artifacts.slice(0, 4);
  const recentKnowledge = knowledge.slice(0, 4);
  const recentRuns = tasks.slice(0, 4);

  return (
    <div data-testid="project-overview" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '14px 16px', background: '#0f172a' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Project</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{project.name}</div>
        {project.description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{project.description}</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, flexWrap: 'wrap' }}>
          <span style={{ color: project.status === 'active' ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>● {project.status?.toUpperCase()}</span>
          <span style={{ color: '#475569' }}>{active.length} active task{active.length !== 1 ? 's' : ''}</span>
          <span style={{ color: '#475569' }}>{blocked.length} blocker{blocked.length !== 1 ? 's' : ''}</span>
          <span style={{ color: '#475569' }}>{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0f172a' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#67e8f9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Active Work</div>
          {loading ? <div style={{ fontSize: 11, color: '#475569' }}>Loading…</div> : active.length === 0 ? (
            <div style={{ fontSize: 11, color: '#334155' }}>No active tasks.</div>
          ) : active.map((t) => (
            <div key={t.taskId} style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(30,58,95,0.3)' }}>
              <span style={{ color: STATUS_COLOR[t.status] || '#94a3b8', fontWeight: 700, marginRight: 6 }}>{t.status}</span>
              <span style={{ color: '#cbd5e1' }}>{t.title?.slice(0, 50)}</span>
              {t.worker && <span style={{ color: '#64748b', marginLeft: 6 }}>{t.worker}</span>}
            </div>
          ))}
        </div>

        <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0f172a' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Blockers</div>
          {loading ? <div style={{ fontSize: 11, color: '#475569' }}>Loading…</div> : blocked.length === 0 ? (
            <div style={{ fontSize: 11, color: '#334155' }}>No blockers. All clear.</div>
          ) : blocked.map((t) => (
            <div key={t.taskId} style={{ fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(30,58,95,0.3)' }}>
              <span style={{ color: '#f59e0b', fontWeight: 700, marginRight: 6 }}>⛔</span>
              <span style={{ color: '#cbd5e1' }}>{t.title?.slice(0, 50)}</span>
              {t.blocker && <div style={{ color: '#fca5a5', fontSize: 10, marginTop: 2 }}>{String(t.blocker).slice(0, 60)}</div>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0f172a' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Recent Artifacts</div>
          {recentArtifacts.length === 0 ? <div style={{ fontSize: 11, color: '#334155' }}>None yet.</div> : recentArtifacts.map((a) => (
            <div key={a.id} style={{ fontSize: 11, padding: '3px 0' }}>
              <span style={{ color: '#94a3b8' }}>{a.type}</span> <span style={{ color: '#cbd5e1' }}>{a.title?.slice(0, 40)}</span>
              {a.verificationState === 'passed' && <span style={{ color: '#22c55e', marginLeft: 6 }}>✓ verified</span>}
            </div>
          ))}
        </div>
        <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0f172a' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Recent Knowledge</div>
          {recentKnowledge.length === 0 ? <div style={{ fontSize: 11, color: '#334155' }}>None yet.</div> : recentKnowledge.map((k) => (
            <div key={k.id} style={{ fontSize: 11, padding: '3px 0' }}>
              <span style={{ color: '#94a3b8' }}>{k.type}</span> <span style={{ color: '#cbd5e1' }}>{k.title?.slice(0, 40)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0f172a' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Recent Runs</div>
        {recentRuns.length === 0 ? <div style={{ fontSize: 11, color: '#334155' }}>None yet.</div> : recentRuns.map((r) => (
          <div key={r.taskId} style={{ fontSize: 11, padding: '3px 0', display: 'flex', gap: 8 }}>
            <span style={{ color: STATUS_COLOR[r.status] || '#94a3b8', fontWeight: 700 }}>{r.status}</span>
            <span style={{ color: '#cbd5e1' }}>{r.title?.slice(0, 50)}</span>
            {r.worker && <span style={{ color: '#64748b' }}>{r.worker}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProjectOverview;
