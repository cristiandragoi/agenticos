// Project Runs — runs/operations linked to this project via its tasks.
// Uses the real task records (linkedRunId, status, stages) — no fake data.
import React, { useCallback, useEffect, useState } from 'react';
import { useProjects } from '../../store/projectStore';

interface RunRow {
  taskId: string; title: string; worker: string; status: string;
  linkedRunId?: string | null; linkedBoardCardId?: string | null;
  createdAt?: string | null; updatedAt?: string | null;
  currentStage?: string | null; progressMessage?: string | null;
  resultText?: string | null; buildState?: string; testState?: string;
}

const STATUS_COLOR: Record<string, string> = {
  queued: '#64748b', planning: '#f5b50a', running: '#00d4ff',
  waiting_approval: '#f59e0b', paused: '#64748b', review: '#a855f7',
  completed: '#22c55e', failed: '#ef4444', cancelled: '#374151', blocked: '#f59e0b',
};

export const ProjectRuns: React.FC<{ projectId: string; highlightRunId?: string | null }> = ({ projectId, highlightRunId }) => {
  const { getProjectTasks } = useProjects();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const tasks = await getProjectTasks(projectId);
    setRuns(tasks);
    setLoading(false);
  }, [projectId, getProjectTasks]);

  useEffect(() => { load(); }, [load]);

  return (
    <div data-testid="project-runs">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Runs — {runs.length} run{runs.length !== 1 ? 's' : ''}
        </span>
        <button type="button" onClick={() => void load()} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
          Refresh
        </button>
      </div>
      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
      {!loading && runs.length === 0 && (
        <div style={{ fontSize: 12, color: '#334155', padding: '18px 0', textAlign: 'center' }}>
          No runs for this project yet.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {runs.map((r) => {
          const highlighted = Boolean(highlightRunId && (r.linkedRunId === highlightRunId));
          return (
          <div key={r.taskId} data-testid={`project-run-${r.taskId}`} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
            background: highlighted ? 'rgba(0,212,255,0.08)' : 'rgba(15,23,42,0.6)',
            border: `1px solid ${highlighted ? '#00d4ff' : '#1e293b'}`, borderRadius: 8,
            boxShadow: highlighted ? '0 0 0 1px rgba(0,212,255,0.6)' : undefined,
          }}>
            {highlighted && (
              <span style={{ fontSize: 8, fontWeight: 700, color: '#00d4ff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>◈</span>
            )}
            <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 700, color: STATUS_COLOR[r.status] || '#94a3b8', border: `1px solid ${STATUS_COLOR[r.status] || '#94a3b8'}55`, borderRadius: 8, padding: '2px 8px', textTransform: 'uppercase' }}>
              {r.status}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>{r.title}</div>
              <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#475569', marginTop: 3, flexWrap: 'wrap' }}>
                <span>AGENT: <b style={{ color: '#94a3b8' }}>{r.worker}</b></span>
                {r.linkedRunId && <span>RUN: <b style={{ color: '#94a3b8' }}>{r.linkedRunId.slice(-8)}</b></span>}
                {r.linkedBoardCardId && <span>CARD: <b style={{ color: '#94a3b8' }}>{r.linkedBoardCardId.slice(-8)}</b></span>}
                {r.currentStage && <span>STAGE: <b style={{ color: '#94a3b8' }}>{r.currentStage}</b></span>}
                {r.createdAt && <span>{new Date(r.createdAt).toLocaleString()}</span>}
              </div>
              {r.progressMessage && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{r.progressMessage.slice(0, 100)}</div>}
              {(r.buildState !== 'idle' || r.testState !== 'idle') && (
                <div style={{ display: 'flex', gap: 10, fontSize: 10, marginTop: 3 }}>
                  <span>BUILD: <b style={{ color: r.buildState === 'passed' ? '#22c55e' : r.buildState === 'failed' ? '#ef4444' : '#94a3b8' }}>{r.buildState}</b></span>
                  <span>TEST: <b style={{ color: r.testState === 'passed' ? '#22c55e' : r.testState === 'failed' ? '#ef4444' : '#94a3b8' }}>{r.testState}</b></span>
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectRuns;
