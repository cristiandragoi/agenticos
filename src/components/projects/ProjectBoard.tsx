// Project Board — real background-task cards grouped by status.
// The board is project-scoped (implicit filtering): tasks carry projectId.
// Status movement uses explicit controls (no heavy drag-drop dependency):
// each card offers Advance / Block / Complete / Cancel actions via the
// existing background-task API so the board reflects REAL task state.
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useProjects } from '../../store/projectStore';

interface BoardTask {
  taskId: string;
  title: string;
  status: string;
  worker: string;
  projectId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  progressMessage?: string | null;
  currentStage?: string | null;
  blocker?: string | null;
  approvalState?: string | null;
  linkedRunId?: string | null;
  linkedBoardCardId?: string | null;
  lastError?: string | null;
}

const BOARD_COLUMNS: Array<{ key: string; label: string; match: (s: string) => boolean }> = [
  { key: 'backlog', label: 'BACKLOG', match: (s) => s === 'queued' },
  { key: 'ready', label: 'READY', match: (s) => s === 'planning' },
  { key: 'running', label: 'RUNNING', match: (s) => s === 'running' },
  { key: 'blocked', label: 'BLOCKED', match: (s) => ['blocked', 'waiting_approval', 'paused'].includes(s) },
  { key: 'review', label: 'REVIEW', match: (s) => s === 'review' },
  { key: 'completed', label: 'COMPLETED', match: (s) => ['completed', 'failed', 'cancelled'].includes(s) },
];

const STATUS_COLOR: Record<string, string> = {
  queued: '#64748b', planning: '#f5b50a', running: '#00d4ff',
  waiting_approval: '#f59e0b', paused: '#64748b', review: '#a855f7',
  completed: '#22c55e', failed: '#ef4444', cancelled: '#374151', blocked: '#f59e0b',
};

async function mutateTask(taskId: string, action: 'start' | 'block' | 'complete' | 'cancel' | 'resume') {
  try {
    const res = await apiFetch(`/api/background-tasks/${taskId}/${action}`, { method: 'POST' });
    return { ok: res.ok };
  } catch { return { ok: false }; }
}

export const ProjectBoard: React.FC<{ projectId: string; highlightTaskId?: string | null }> = ({ projectId, highlightTaskId }) => {
  const { getProjectTasks } = useProjects();
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getProjectTasks(projectId);
    setTasks(result);
    setError(null);
    setLoading(false);
  }, [projectId, getProjectTasks]);

  useEffect(() => { load(); }, [load]);

  // Live board: poll every 5s so status updates made from other surfaces
  // (Jarvis delegation, Mission Control, API) are reflected without a manual
  // refresh. Cheap list read against the local backend.
  useEffect(() => {
    const id = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const act = async (taskId: string, action: 'start' | 'block' | 'complete' | 'cancel' | 'resume') => {
    const r = await mutateTask(taskId, action);
    if (!r.ok) setError(`Could not ${action} task ${taskId.slice(-6)}`);
    await load();
  };

  const columns = BOARD_COLUMNS.map((col) => ({
    ...col,
    tasks: tasks.filter((t) => col.match(t.status)),
  }));

  return (
    <div data-testid="project-board">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Board — {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
        <button type="button" onClick={() => void load()} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
          Refresh
        </button>
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 11, marginBottom: 8 }}>{error}</div>}
      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading tasks…</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(150px, 1fr))', gap: 8, overflowX: 'auto' }}>
        {columns.map((col) => (
          <div key={col.key} data-testid={`board-col-${col.key}`} style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid #1e293b', borderRadius: 8, padding: 8, minHeight: 120 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: '0.1em', marginBottom: 6, textAlign: 'center' }}>
              {col.label} <span style={{ color: '#475569' }}>({col.tasks.length})</span>
            </div>
            {col.tasks.length === 0 && <div style={{ fontSize: 10, color: '#1e293b', textAlign: 'center', padding: '14px 0' }}>—</div>}
            {col.tasks.map((t) => (
              <div key={t.taskId} data-testid={`board-card-${t.taskId}`} style={{
                border: `1px solid ${t.taskId === highlightTaskId ? '#00d4ff' : STATUS_COLOR[t.status] || '#1e293b'}${t.taskId === highlightTaskId ? '' : '44'}`,
                background: t.taskId === highlightTaskId ? 'rgba(0,212,255,0.08)' : '#0a0f16',
                borderRadius: 6, padding: '8px 10px', marginBottom: 6,
                boxShadow: t.taskId === highlightTaskId ? '0 0 0 1px rgba(0,212,255,0.6)' : undefined,
              }}>
                {t.taskId === highlightTaskId && (
                  <div style={{ fontSize: 8, fontWeight: 700, color: '#00d4ff', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>
                    ◈ Opened from navigation
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 4, wordBreak: 'break-word' }}>
                  {t.title || t.taskId}
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 10, color: '#64748b', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: STATUS_COLOR[t.status] || '#94a3b8', fontWeight: 600 }}>{t.status}</span>
                  {t.worker && <span>· {t.worker}</span>}
                  {t.linkedRunId && <span>· run {t.linkedRunId.slice(-6)}</span>}
                </div>
                {t.progressMessage && <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>{t.progressMessage.slice(0, 60)}</div>}
                {t.blocker && <div style={{ fontSize: 10, color: '#f59e0b', marginBottom: 4 }}>⛔ {t.blocker.slice(0, 50)}</div>}
                {t.lastError && <div style={{ fontSize: 10, color: '#f87171', marginBottom: 4 }}>⚠ {t.lastError.slice(0, 50)}</div>}
                {t.createdAt && (
                  <div style={{ fontSize: 9, color: '#334155', marginBottom: 4 }}>
                    {new Date(t.createdAt).toLocaleString()}
                  </div>
                )}
                {/* Explicit state controls — safe status movement without a heavy drag-drop dep. */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {['queued', 'planning', 'blocked', 'paused'].includes(t.status) && (
                    <button type="button" onClick={() => void act(t.taskId, 'start')} title="Start / resume" style={miniBtn('#00d4ff')}>Start</button>
                  )}
                  {['queued', 'planning', 'running'].includes(t.status) && (
                    <button type="button" onClick={() => void act(t.taskId, 'block')} title="Mark blocked" style={miniBtn('#f59e0b')}>Block</button>
                  )}
                  {['queued', 'planning', 'running', 'review', 'blocked', 'waiting_approval', 'paused'].includes(t.status) && (
                    <button type="button" onClick={() => void act(t.taskId, 'complete')} title="Complete" style={miniBtn('#22c55e')}>Done</button>
                  )}
                  {!['completed', 'failed', 'cancelled'].includes(t.status) && (
                    <button type="button" onClick={() => void act(t.taskId, 'cancel')} title="Cancel" style={miniBtn('#ef4444')}>Cancel</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const miniBtn = (color: string): React.CSSProperties => ({
  background: 'transparent', border: `1px solid ${color}66`, color, borderRadius: 4,
  padding: '2px 7px', fontSize: 9, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
});

export default ProjectBoard;
