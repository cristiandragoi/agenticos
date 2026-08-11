// Project Agents — project-agent assignment on top of the GLOBAL Agent
// Registry. Shows: agent, capability, status, active task, last activity,
// assignment to this project. Assign/remove via entity_links (no new agents).
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useProjects } from '../../store/projectStore';

interface RegistryAgent {
  id: string; name?: string; slug?: string; capabilities?: string[];
  status?: string; recentActivity?: string; description?: string;
}

const GLOBAL_AGENTS: RegistryAgent[] = [
  { id: 'agent-jarvis', name: 'Jarvis', slug: 'jarvis', capabilities: ['command', 'coordination', 'conversation'], status: 'active' },
  { id: 'agent-hermes', name: 'Hermes', slug: 'hermes', capabilities: ['research', 'delegation', 'tasks'], status: 'active' },
  { id: 'agent-codex', name: 'CodeX', slug: 'codex', capabilities: ['engineering', 'code', 'goals'], status: 'active' },
  { id: 'agent-oracle', name: 'Oracle', slug: 'oracle', capabilities: ['analysis', 'prediction'], status: 'active' },
  { id: 'agent-researcher', name: 'Researcher', slug: 'research', capabilities: ['research', 'sourcing'], status: 'active' },
  { id: 'agent-vision', name: 'Vision', slug: 'vision', capabilities: ['visual', 'image'], status: 'active' },
];

export const ProjectAgents: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { getProjectTasks } = useProjects();
  const [assigned, setAssigned] = useState<string[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/agents`);
      if (res.ok) {
        const data = await res.json();
        setAssigned(data.agents || []);
      }
    } catch { /* best effort */ }
    setTasks(await getProjectTasks(projectId));
    setLoading(false);
  }, [projectId, getProjectTasks]);

  useEffect(() => { load(); }, [load]);

  const assign = async (agentId: string) => {
    await apiFetch(`/api/projects/${projectId}/agents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    await load();
  };
  const remove = async (agentId: string) => {
    await apiFetch(`/api/projects/${projectId}/agents/${agentId}`, { method: 'DELETE' });
    await load();
  };

  const taskByWorker = (worker: string) => {
    const w = worker.toLowerCase();
    const match = tasks.find((t) => String(t.worker || '').toLowerCase() === w || String(t.selectedAgent || '').toLowerCase() === w);
    return match || tasks.find((t) => String(t.selectedAgent || '').toLowerCase() === w) || null;
  };

  return (
    <div data-testid="project-agents">
      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
        Agents — {assigned.length} assigned to this project
      </div>
      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {GLOBAL_AGENTS.map((a) => {
          const isAssigned = assigned.includes(a.id) || assigned.some((id) => id === a.slug || id === `agent-${a.slug}`);
          const activeTask = taskByWorker(a.slug || a.id);
          return (
            <div key={a.id} data-testid={`project-agent-${a.slug}`} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              background: isAssigned ? 'rgba(8,145,178,0.06)' : 'rgba(15,23,42,0.6)',
              border: `1px solid ${isAssigned ? 'rgba(8,145,178,0.4)' : '#1e293b'}`,
              borderRadius: 8,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isAssigned ? 'rgba(8,145,178,0.2)' : '#1e293b',
                color: isAssigned ? '#67e8f9' : '#64748b', fontWeight: 800, fontSize: 13,
              }}>
                {(a.name || '?').slice(0, 1)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>
                  {a.name} {isAssigned && <span style={{ color: '#0891b2', fontSize: 10, fontWeight: 700 }}>· ASSIGNED</span>}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {(a.capabilities || []).join(' · ')}
                </div>
                {activeTask && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                    Active task: <b style={{ color: '#67e8f9' }}>{activeTask.title?.slice(0, 40)}</b> · {activeTask.status}
                  </div>
                )}
              </div>
              {isAssigned ? (
                <button type="button" onClick={() => void remove(a.slug || a.id)} style={{ background: 'transparent', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 6, padding: '4px 10px', fontSize: 10, cursor: 'pointer' }}>
                  Remove
                </button>
              ) : (
                <button type="button" onClick={() => void assign(a.id)} style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                  Assign
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProjectAgents;
