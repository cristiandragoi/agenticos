/**
 * Memory Studio — the AgenticOS visual memory system (memory milestone).
 *
 * Four views: GRAPH (interactive neighborhood with zoom/pan/search/filters),
 * TIMELINE (chronological, grouped Today/Yesterday/This week/Earlier),
 * LIBRARY (searchable/filterable/paginated), DECISIONS (active/superseded).
 * Every memory opens a provenance detail panel (source, operation, worker,
 * created, confidence, derived-from) — no opaque memories.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, apiUrl } from '../api/client';

type MemoryType = 'episodic' | 'semantic' | 'decision' | 'preference' | 'working';
type MemoryStatus = 'active' | 'superseded' | 'stale' | 'archived';

interface MemoryRecord {
  id: string; type: MemoryType; title: string; summary: string; content: string;
  scope: string; entities: string[]; tags: string[];
  source: { conversationId?: string | null; operationId?: string | null; taskId?: string | null; worker?: string | null; artifactPath?: string | null; sourceType: string };
  confidence: number; createdAt: number; updatedAt: number; lastConfirmedAt: number | null;
  lastUsedAt: number | null; useCount: number; status: MemoryStatus;
  supersedesMemoryId: string | null; derivedFromMemoryIds: string[]; pinned: boolean;
}
interface GraphNode { id: string; kind: 'memory' | 'entity'; type?: MemoryType; title: string; summary?: string; status?: MemoryStatus; entityKind?: string; strength?: number }
interface GraphEdge { from: string; to: string; relation: string; weight: number }
interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; focus: string | null; truncated: boolean; totalNodes: number }

const TYPE_COLOR: Record<string, string> = {
  episodic: '#fbbf24', semantic: '#34d399', decision: '#f87171', preference: '#a78bfa', working: '#94a3b8',
};
const KIND_COLOR: Record<string, string> = {
  company: '#60a5fa', person: '#f472b6', project: '#22d3ee', task: '#a3e635', artifact: '#fb923c',
  decision: '#f87171', provider: '#c084fc', model: '#e879f9', agent: '#4ade80', outcome: '#facc15', generic: '#64748b',
};

const api = async (url: string, opts?: RequestInit) => {
  const res = await apiFetch(`/api/memory${url}`, opts);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function groupKey(ts: number): string {
  const now = new Date(); const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}

export default function MemoryStudio() {
  const [tab, setTab] = useState<'GRAPH' | 'TIMELINE' | 'LIBRARY' | 'DECISIONS'>('GRAPH');
  const [selected, setSelected] = useState<MemoryRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // "View related memories" from Jarvis: /memory?focus=<terms> opens the
  // graph focused on the relevant neighborhood.
  const initialFocus = useMemo(() => {
    try {
      const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
      return q.get('focus') || '';
    } catch { return ''; }
  }, []);

  const selectMemory = (id: string) => {
    api(`/memories/${id}`).then(setSelected).catch(() => {});
  };

  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(null), 4000); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0b1220', color: '#e2e8f0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #1e293b', background: '#0f172a' }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: '#67e8f9' }}>MEMORY</span>
        {(['GRAPH', 'TIMELINE', 'LIBRARY', 'DECISIONS'] as const).map((t) => (
          <button key={t} data-testid={`memory-tab-${t.toLowerCase()}`} onClick={() => setTab(t)}
            style={{ background: tab === t ? '#164e63' : 'transparent', color: tab === t ? '#a5f3fc' : '#94a3b8', border: `1px solid ${tab === t ? '#0e7490' : '#334155'}`, borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {t}
          </button>
        ))}
        {notice && <span data-testid="memory-notice" style={{ color: '#4ade80', fontSize: 11, marginLeft: 'auto' }}>{notice}</span>}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          {tab === 'GRAPH' && <GraphView onSelect={selectMemory} flash={flash} initialFocus={initialFocus} />}
          {tab === 'TIMELINE' && <TimelineView onSelect={selectMemory} />}
          {tab === 'LIBRARY' && <LibraryView onSelect={selectMemory} flash={flash} />}
          {tab === 'DECISIONS' && <DecisionsView onSelect={selectMemory} />}
        </div>
        <MemoryDetail memory={selected} onClose={() => setSelected(null)} flash={flash} />
      </div>
    </div>
  );
}

// ── GRAPH ───────────────────────────────────────────────────────────────────
function GraphView({ onSelect, flash, initialFocus = '' }: { onSelect: (id: string) => void; flash: (m: string) => void; initialFocus?: string }) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [focusInput, setFocusInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [hideWeak, setHideWeak] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const load = (focus?: string) => {
    const resolveFocus = async (f?: string): Promise<string | undefined> => {
      if (!f) return undefined;
      if (f.startsWith('mem-') || f.startsWith('entity:')) return f;
      const hits: any[] = await api(`/search?q=${encodeURIComponent(f)}&limit=3`).catch(() => []);
      if (hits.length) return hits[0].memory.id;
      const ents: any[] = await api('/entities').catch(() => []);
      const match = ents.find((e) => e.name.toLowerCase().includes(f.toLowerCase()));
      return match?.id;
    };
    resolveFocus(focus).then((resolved) =>
      api(`/graph${resolved ? `?focus=${encodeURIComponent(resolved)}&` : '?'}depth=1&limit=80`)
        .then((g: GraphData) => {
          setGraph(g);
          const center = { x: 0, y: 0 };
          const next: Record<string, { x: number; y: number }> = {};
          const focusNode = g.nodes.find((n) => n.id === g.focus);
          if (focusNode) next[focusNode.id] = center;
          const others = g.nodes.filter((n) => n.id !== g.focus);
          others.forEach((n, i) => {
            const ring = 150 + 90 * (i % 3);
            const angle = (i * 2.4) % (Math.PI * 2);
            next[n.id] = { x: center.x + ring * Math.cos(angle), y: center.y + ring * Math.sin(angle) };
          });
          setPos(next);
        })
        .catch(() => setGraph({ nodes: [], edges: [], focus: null, truncated: false, totalNodes: 0 }))
    ).catch(() => setGraph({ nodes: [], edges: [], focus: null, truncated: false, totalNodes: 0 }));
  };
  useEffect(() => { load(initialFocus || undefined); }, [initialFocus]);

  const nodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((n) => typeFilter === 'all' || (n.kind === 'memory' && n.type === typeFilter));
  }, [graph, typeFilter]);
  const edges = useMemo(() => {
    if (!graph) return [];
    const ids = new Set(nodes.map((n) => n.id));
    return graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (!hideWeak || e.weight >= 1.5));
  }, [graph, nodes, hideWeak]);

  const onWheel = (e: React.WheelEvent) => {
    const f = Math.exp(-e.deltaY * 0.001);
    setZoom((z) => Math.min(3, Math.max(0.3, z * f)));
  };
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPan({ x: dragRef.current.panX + (ev.clientX - dragRef.current.x), y: dragRef.current.panY + (ev.clientY - dragRef.current.y) });
    };
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #1e293b', background: '#0f172a', alignItems: 'center', flexWrap: 'wrap' }}>
        <input data-testid="memory-graph-search" value={focusInput} onChange={(e) => setFocusInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && focusInput.trim()) load(focusInput.trim()); }}
          placeholder="Search / focus (e.g. Kadabau, Berlin, revenue)" style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '5px 10px', fontSize: 12, width: 260 }} />
        <button data-testid="memory-graph-focus" onClick={() => focusInput.trim() && load(focusInput.trim())} style={{ ...btn, background: '#164e63', color: '#a5f3fc' }}>Focus</button>
        <button onClick={() => load()} style={btn}>Reset</button>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={sel}>
          <option value="all">All types</option>
          <option value="episodic">Episodic</option><option value="semantic">Semantic</option>
          <option value="decision">Decision</option><option value="preference">Preference</option>
        </select>
        <label style={{ fontSize: 11, color: '#94a3b8', display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={hideWeak} onChange={(e) => setHideWeak(e.target.checked)} /> hide weak links
        </label>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>
          {graph?.nodes.length ?? 0} nodes · {edges.length} edges{graphtrunc(graph)}
        </span>
      </div>
      <svg ref={svgRef} data-testid="memory-graph-svg" style={{ flex: 1, width: '100%', cursor: 'grab', background: '#0b1220' }}
        onWheel={onWheel} onMouseDown={onMouseDown}>
        <g transform={`translate(${300 + pan.x},${260 + pan.y}) scale(${zoom})`}>
          {edges.map((e, i) => {
            const a = pos[e.from]; const b = pos[e.to];
            if (!a || !b) return null;
            const strong = e.weight >= 1.5;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={strong ? '#475569' : '#1e293b'} strokeWidth={strong ? 1.5 : 0.8} strokeDasharray={e.relation === 'RELATED_TO' ? '3 3' : undefined}
              data-testid="memory-graph-edge" />;
          })}
          {nodes.map((n) => {
            const p = pos[n.id]; if (!p) return null;
            const color = n.kind === 'entity' ? KIND_COLOR[n.entityKind || 'generic'] || '#64748b' : TYPE_COLOR[n.type || 'episodic'];
            const r = n.kind === 'entity' ? 10 : 8;
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{ cursor: 'pointer' }} data-testid="memory-graph-node"
                onClick={(e) => { e.stopPropagation(); if (n.kind === 'memory') onSelect(n.id); else load(n.title); }}>
                <circle r={r} fill={color} opacity={n.kind === 'entity' ? 0.9 : 0.75} stroke="#0b1220" strokeWidth={1.5} />
                <text y={r + 11} textAnchor="middle" fontSize={8.5} fill="#cbd5e1" style={{ pointerEvents: 'none' }}>
                  {(n.title || n.id).slice(0, 22)}
                </text>
                <title>{`${n.title} (${n.kind === 'entity' ? n.entityKind : n.type})`}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
const graphtrunc = (g: GraphData | null) => (g?.truncated ? ' · truncated (use Focus to expand)' : '');

// ── TIMELINE ────────────────────────────────────────────────────────────────
function TimelineView({ onSelect }: { onSelect: (id: string) => void }) {
  const [groups, setGroups] = useState<Record<string, MemoryRecord[]>>({});
  const [offset, setOffset] = useState(0);
  const load = (off: number, append = false) => {
    api(`/timeline?limit=100&offset=${off}`).then((items: MemoryRecord[]) => {
      setGroups((prev) => {
        const next = append ? { ...prev } : {};
        for (const m of items) { const k = groupKey(m.createdAt); (next[k] ||= []).push(m); }
        return next;
      });
    }).catch(() => {});
  };
  useEffect(() => { load(0); }, []);
  const order = ['Today', 'Yesterday', 'This week', 'Earlier'];
  return (
    <div data-testid="memory-timeline" style={{ height: '100%', overflowY: 'auto', padding: 12 }}>
      {order.filter((k) => groups[k]?.length).map((k) => (
        <div key={k} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#67e8f9', letterSpacing: 1, marginBottom: 6 }}>{k.toUpperCase()}</div>
          {groups[k].map((m) => (
            <div key={m.id} data-testid="timeline-item" onClick={() => onSelect(m.id)} style={{ cursor: 'pointer', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '6px 10px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: TYPE_COLOR[m.type] }} />
              <span style={{ fontSize: 10, color: '#64748b', minWidth: 90 }}>{fmtTime(m.createdAt)}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', minWidth: 70 }}>{m.type.toUpperCase()}</span>
              <span style={{ fontSize: 12, flex: 1 }}>{m.title}</span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{m.scope}{m.source?.taskId ? ` · ${m.source.taskId}` : ''}</span>
            </div>
          ))}
        </div>
      ))}
      <button onClick={() => { const o = offset + 100; setOffset(o); load(o, true); }} style={btn}>Load more</button>
    </div>
  );
}

// ── LIBRARY ─────────────────────────────────────────────────────────────────
function LibraryView({ onSelect, flash }: { onSelect: (id: string) => void; flash: (m: string) => void }) {
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState('');
  const [type, setType] = useState(''); const [scope, setScope] = useState(''); const [status, setStatus] = useState(''); const [agent, setAgent] = useState('');

  const run = (extra: Record<string, string> = {}, off = 0) => {
    const p = new URLSearchParams({ limit: '50', offset: String(off), ...extra });
    if (q) p.set('q', q);
    if (type) p.set('type', type); if (scope) p.set('scope', scope); if (status) p.set('status', status); if (agent) p.set('agent', agent);
    if (q) {
      api(`/search?${p}`).then((hits: any[]) => {
        const list = hits.map((h) => h.memory);
        setItems(list); setTotal(list.length);
      }).catch(() => {});
    } else {
      api(`/memories?${p}`).then((r: { items: MemoryRecord[]; total: number }) => { setItems(r.items); setTotal(r.total); }).catch(() => {});
    }
  };
  useEffect(() => { run(); }, []);

  const archive = (id: string) => { api(`/memories/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) }).then(() => { run({}, offset); flash('Memory archived.'); }); };
  const del = (id: string) => { if (!confirm('Delete this memory?')) return; api(`/memories/${id}`, { method: 'DELETE' }).then(() => { run({}, offset); flash('Memory deleted.'); }); };
  const confirmM = (id: string) => { api(`/memories/${id}/confirm`, { method: 'POST' }).then(() => { run({}, offset); flash('Memory confirmed.'); }); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid #1e293b', background: '#0f172a', flexWrap: 'wrap', alignItems: 'center' }}>
        <input data-testid="memory-library-search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run({}, 0)} placeholder="Search memories (semantic + keyword)…" style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '5px 10px', fontSize: 12, width: 240 }} />
        <select value={type} onChange={(e) => { setType(e.target.value); run({ type: e.target.value }, 0); }} style={sel}><option value="">All types</option><option>episodic</option><option>semantic</option><option>decision</option><option>preference</option></select>
        <select value={scope} onChange={(e) => { setScope(e.target.value); run({ scope: e.target.value }, 0); }} style={sel}><option value="">All scopes</option><option>revenue</option><option>codex</option><option>routing</option><option>general</option></select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); run({ status: e.target.value }, 0); }} style={sel}><option value="">All statuses</option><option>active</option><option>superseded</option><option>stale</option><option>archived</option></select>
        <select value={agent} onChange={(e) => { setAgent(e.target.value); run({ agent: e.target.value }, 0); }} style={sel}><option value="">All agents</option><option>revenue</option><option>codex</option><option>hermes</option><option>jarvis</option></select>
        <button onClick={() => run({}, 0)} style={{ ...btn, background: '#164e63', color: '#a5f3fc' }}>Search</button>
        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>{total} memories</span>
      </div>
      <div data-testid="memory-library" style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {items.map((m) => (
          <div key={m.id} data-testid="library-item" style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 10px', marginBottom: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: TYPE_COLOR[m.type] }} />
            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => onSelect(m.id)}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{m.title} <span style={{ color: '#64748b', fontWeight: 400, fontSize: 10 }}>{m.type} · {m.scope} · {m.status}{m.confidence != null ? ` · ${Math.round(m.confidence * 100)}%` : ''}</span></div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.summary}</div>
            </div>
            <button onClick={() => confirmM(m.id)} style={mini}>Confirm</button>
            <button onClick={() => archive(m.id)} style={mini}>Archive</button>
            <button onClick={() => del(m.id)} style={{ ...mini, color: '#f87171' }}>Delete</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - 50); setOffset(o); run({}, o); }} style={btn}>Prev</button>
          <button onClick={() => { const o = offset + 50; setOffset(o); run({}, o); }} style={btn}>Next</button>
        </div>
      </div>
    </div>
  );
}

// ── DECISIONS ───────────────────────────────────────────────────────────────
function DecisionsView({ onSelect }: { onSelect: (id: string) => void }) {
  const [decisions, setDecisions] = useState<MemoryRecord[]>([]);
  useEffect(() => { api('/decisions').then(setDecisions).catch(() => {}); }, []);
  return (
    <div data-testid="memory-decisions" style={{ height: '100%', overflowY: 'auto', padding: 12 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>Explicit decisions Jarvis consults before acting. Active decisions influence behavior when scope matches.</div>
      {decisions.map((d) => (
        <div key={d.id} data-testid="decision-item" onClick={() => onSelect(d.id)} style={{ cursor: 'pointer', background: '#0f172a', border: `1px solid ${d.status === 'active' ? '#164e63' : '#1e293b'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: d.status === 'active' ? '#4ade80' : '#64748b' }} />
            <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{d.title}</span>
            <span data-testid="decision-status" style={{ fontSize: 10, color: d.status === 'active' ? '#4ade80' : '#94a3b8', background: '#1e293b', borderRadius: 6, padding: '1px 6px' }}>{d.status.toUpperCase()}</span>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{d.content}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Scope: {d.scope} · Created {fmtTime(d.createdAt)}{d.supersedesMemoryId ? ` · supersedes ${d.supersedesMemoryId}` : ''}{d.lastUsedAt ? ` · last used ${fmtTime(d.lastUsedAt)}` : ''}</div>
        </div>
      ))}
      {!decisions.length && <div style={{ color: '#64748b', fontSize: 12 }}>No decisions yet.</div>}
    </div>
  );
}

// ── DETAIL PANEL ────────────────────────────────────────────────────────────
function MemoryDetail({ memory, onClose, flash }: { memory: MemoryRecord | null; onClose: () => void; flash: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  if (!memory) return <div style={{ width: 280, borderLeft: '1px solid #1e293b', background: '#0f172a', padding: 12, color: '#64748b', fontSize: 12 }}>Select a memory to inspect its provenance.</div>;
  const s = memory.source || {};
  const derive = (label: string, val: string | null | undefined, href?: string) =>
    val ? <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 4 }}><span style={{ color: '#64748b', minWidth: 90 }}>{label}</span><span style={{ color: '#cbd5e1', wordBreak: 'break-all' }}>{href ? <a href={href} target="_blank" rel="noreferrer" style={{ color: '#7dd3fc' }}>{val}</a> : val}</span></div> : null;
  return (
    <div data-testid="memory-detail" style={{ width: 300, borderLeft: '1px solid #1e293b', background: '#0f172a', padding: 12, overflowY: 'auto', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{memory.type.toUpperCase()} · {memory.status.toUpperCase()}</span>
        <button onClick={onClose} style={mini}>✕</button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{memory.title}</div>
      <div style={{ color: '#94a3b8', marginBottom: 10 }}>{memory.summary}</div>
      <div style={{ borderTop: '1px solid #1e293b', paddingTop: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#67e8f9', letterSpacing: 1, marginBottom: 6 }}>PROVENANCE</div>
        {derive('Source:', s.sourceType)}
        {derive('Task:', s.taskId)}
        {derive('Operation:', s.operationId)}
        {derive('Conversation:', s.conversationId)}
        {derive('Worker:', s.worker)}
        {derive('Artifact:', s.artifactPath)}
        {derive('Created:', fmtTime(memory.createdAt))}
        {derive('Confidence:', `${Math.round(memory.confidence * 100)}%`)}
        {derive('Derived from:', memory.derivedFromMemoryIds?.join(', '))}
        {derive('Supersedes:', memory.supersedesMemoryId)}
        {memory.lastConfirmedAt ? derive('Last confirmed:', fmtTime(memory.lastConfirmedAt)) : null}
        {memory.lastUsedAt ? derive('Last used:', fmtTime(memory.lastUsedAt)) : null}
        {derive('Use count:', String(memory.useCount))}
      </div>
      <div style={{ borderTop: '1px solid #1e293b', paddingTop: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#67e8f9', letterSpacing: 1, marginBottom: 6 }}>CONTENT</div>
        {editing ? (
          <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={6} style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 11 }} />
        ) : (
          <div style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{memory.content}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid #1e293b', paddingTop: 8 }}>
        <button onClick={() => { if (editing) { api(`/memories/${memory.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editContent }) }).then(() => flash('Memory updated.')); } setEditing(!editing); setEditContent(memory.content); }} style={btn}>{editing ? 'Save' : 'Edit'}</button>
        <button onClick={() => api(`/memories/${memory.id}/confirm`, { method: 'POST' }).then(() => flash('Memory confirmed.'))} style={btn}>Confirm</button>
        <button onClick={() => api(`/memories/${memory.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !memory.pinned }) }).then(() => flash(memory.pinned ? 'Unpinned.' : 'Pinned.'))} style={btn}>{memory.pinned ? 'Unpin' : 'Pin'}</button>
        <button onClick={() => api(`/memories/${memory.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: memory.status === 'stale' ? 'active' : 'stale' }) }).then(() => flash('Status toggled.'))} style={btn}>{memory.status === 'stale' ? 'Mark active' : 'Mark stale'}</button>
        <button onClick={() => api(`/memories/${memory.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) }).then(onClose)} style={{ ...btn, color: '#f87171' }}>Archive</button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = { background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer' };
const mini: React.CSSProperties = { background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '1px 8px', fontSize: 10, cursor: 'pointer' };
const sel: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 6, fontSize: 11, padding: '3px 6px' };
