// Project Graph — visualizes REAL AgenticOS relationships for this project.
// Node types: PROJECT, TASK, AGENT, KNOWLEDGE, ARTIFACT, RUN.
// Edges derive from actual data: project→task (projectId), task→agent (worker),
// task→run (linkedRunId), artifact→task (taskId), knowledge→project.
// Runtime color language applied ONLY where the entity has runtime state
// (tasks/agents); knowledge/artifacts use neutral colors (not "executing").
// Lightweight SVG rendering — no graph physics engine; pan/zoom via wheel.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjects } from '../../store/projectStore';
import { apiFetch } from '../../api/client';

interface GraphNode {
  id: string; label: string; type: 'project' | 'task' | 'agent' | 'knowledge' | 'artifact' | 'run';
  status?: string; worker?: string;
}
interface GraphEdge { from: string; to: string; label?: string }

const NODE_COLOR: Record<string, { fill: string; text: string }> = {
  project: { fill: '#0891b2', text: '#cffafe' },
  task: { fill: '#1e293b', text: '#e2e8f0' },
  agent: { fill: '#0f172a', text: '#e2e8f0' },
  knowledge: { fill: '#312e81', text: '#c7d2fe' },
  artifact: { fill: '#064e3b', text: '#a7f3d0' },
  run: { fill: '#1e3a8a', text: '#bfdbfe' },
};
// Runtime colors for task/agent nodes ONLY (spec: only where entity has state).
const TASK_STATUS_COLOR: Record<string, string> = {
  queued: '#64748b', planning: '#f5b50a', running: '#00d4ff',
  waiting_approval: '#f59e0b', paused: '#64748b', review: '#a855f7',
  completed: '#22c55e', failed: '#ef4444', cancelled: '#374151', blocked: '#f59e0b',
};

export const ProjectGraph: React.FC<{ projectId: string; projectName?: string }> = ({ projectId, projectName }) => {
  const { getProjectTasks } = useProjects();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [scale, setScale] = useState(1);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [tasks, artRes, knowRes] = await Promise.all([
        getProjectTasks(projectId),
        apiFetch(`/api/projects/${projectId}/artifacts`),
        apiFetch(`/api/projects/${projectId}/knowledge`),
      ]);
      const artifacts = artRes.ok ? await artRes.json() : [];
      const knowledge = knowRes.ok ? await knowRes.json() : [];
      const n: GraphNode[] = [{ id: 'project', label: projectName || 'Project', type: 'project' }];
      const e: GraphEdge[] = [];
      const agents = new Set<string>();
      (tasks || []).forEach((t: any) => {
        n.push({ id: `task-${t.taskId}`, label: (t.title || t.taskId).slice(0, 28), type: 'task', status: t.status, worker: t.worker });
        e.push({ from: 'project', to: `task-${t.taskId}` });
        if (t.worker) {
          agents.add(t.worker);
          e.push({ from: `task-${t.taskId}`, to: `agent-${t.worker.toLowerCase()}`, label: t.status });
        }
        if (t.linkedRunId) {
          n.push({ id: `run-${t.linkedRunId}`, label: `run ${t.linkedRunId.slice(-6)}`, type: 'run', status: t.status });
          e.push({ from: `task-${t.taskId}`, to: `run-${t.linkedRunId}` });
        }
      });
      agents.forEach((a) => {
        n.push({ id: `agent-${a.toLowerCase()}`, label: a, type: 'agent' });
        e.push({ from: 'project', to: `agent-${a.toLowerCase()}`, label: 'assigned' });
      });
      (Array.isArray(artifacts) ? artifacts : []).forEach((a: any) => {
        n.push({ id: `art-${a.id}`, label: (a.title || a.id).slice(0, 24), type: 'artifact' });
        e.push({ from: 'project', to: `art-${a.id}` });
        if (a.taskId) e.push({ from: `task-${a.taskId}`, to: `art-${a.id}` });
      });
      (Array.isArray(knowledge) ? knowledge : []).forEach((k: any) => {
        n.push({ id: `know-${k.id}`, label: (k.title || k.id).slice(0, 24), type: 'knowledge' });
        e.push({ from: 'project', to: `know-${k.id}` });
      });
      setNodes(n);
      setEdges(e);
    } catch { /* best effort */ }
    setLoading(false);
  }, [projectId, projectName, getProjectTasks]);

  useEffect(() => { load(); }, [load]);

  // Simple radial layout: project center, others around it deterministically.
  const positions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = { project: { x: 300, y: 220 } };
    const others = nodes.filter((n) => n.id !== 'project');
    const R = 150;
    others.forEach((n, i) => {
      const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
      map[n.id] = { x: 300 + Math.cos(angle) * R, y: 220 + Math.sin(angle) * R * 0.85 };
    });
    return map;
  }, [nodes]);

  const nodeFill = (n: GraphNode) => {
    if (n.type === 'task' && n.status && TASK_STATUS_COLOR[n.status]) return TASK_STATUS_COLOR[n.status];
    if (n.type === 'run' && n.status && TASK_STATUS_COLOR[n.status]) return TASK_STATUS_COLOR[n.status];
    return NODE_COLOR[n.type]?.fill || '#334155';
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.max(0.5, Math.min(2.5, s - e.deltaY * 0.001)));
  };
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + (e.clientX - dragRef.current.x), y: dragRef.current.panY + (e.clientY - dragRef.current.y) });
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div data-testid="project-graph">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Graph — {nodes.length} nodes / {edges.length} edges (real relationships)
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#475569' }}>wheel = zoom · drag = pan</span>
          <button type="button" onClick={() => { setPan({ x: 40, y: 40 }); setScale(1); }} style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Reset</button>
        </div>
      </div>
      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
      <div style={{ border: '1px solid #1e293b', borderRadius: 8, overflow: 'hidden', background: 'rgba(4,12,28,0.7)', position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%"
          height={420}
          viewBox="0 0 600 440"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
          data-testid="project-graph-svg"
        >
          <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
            {/* Edges */}
            {edges.map((e, i) => {
              const a = positions[e.from], b = positions[e.to];
              if (!a || !b) return null;
              return (
                <g key={`e-${i}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(103,232,249,0.25)" strokeWidth={1.2} />
                  {e.label && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fill="#475569" fontSize={8} textAnchor="middle">{e.label}</text>
                  )}
                </g>
              );
            })}
            {/* Nodes */}
            {nodes.map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              const fill = nodeFill(n);
              return (
                <g key={n.id} onClick={() => setSelected(n)} style={{ cursor: 'pointer' }} data-testid={`graph-node-${n.type}`}>
                  <circle cx={p.x} cy={p.y} r={n.type === 'project' ? 30 : n.type === 'agent' ? 24 : 19} fill={fill} opacity={0.18} />
                  <circle cx={p.x} cy={p.y} r={n.type === 'project' ? 22 : n.type === 'agent' ? 17 : 13} fill={fill} opacity={0.85} stroke="rgba(226,232,240,0.35)" strokeWidth={1} />
                  <text x={p.x} y={p.y + 3} textAnchor="middle" fill={NODE_COLOR[n.type]?.text || '#fff'} fontSize={n.type === 'project' ? 9 : 7} fontWeight={700}>{n.label.slice(0, 16)}</text>
                  {n.status && (
                    <text x={p.x} y={p.y + 14} textAnchor="middle" fill="#cbd5e1" fontSize={6}>{n.status}</text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        {/* Details panel on node click */}
        {selected && (
          <div data-testid="graph-node-details" style={{
            position: 'absolute', right: 8, top: 8, width: 230, padding: '10px 12px',
            background: 'rgba(2,6,23,0.96)', border: '1px solid #27436b', borderRadius: 8, fontSize: 11,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: '#67e8f9', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>
                {selected.type}
              </span>
              <button type="button" onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
            <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 6, wordBreak: 'break-word' }}>{selected.label}</div>
            {selected.status && <div style={{ color: TASK_STATUS_COLOR[selected.status] || '#94a3b8' }}>STATUS: {selected.status}</div>}
            {selected.worker && <div style={{ color: '#94a3b8' }}>AGENT: {selected.worker}</div>}
            <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>ID: {selected.id}</div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {Object.entries(NODE_COLOR).map(([k, v]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: v.fill, display: 'inline-block' }} /> {k}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#00d4ff', display: 'inline-block' }} /> running
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#ec4899', display: 'inline-block' }} /> delegated
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#22c55e', display: 'inline-block' }} /> completed
        </span>
      </div>
    </div>
  );
};

export default ProjectGraph;
