// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FolderOpen, Star, Archive, Trash2, ChevronRight, BookOpen, FileText, Tag, Circle, MessageCircle } from 'lucide-react';
import { useProjects } from '../store/projectStore';
import type { Project, KnowledgeItem } from '../store/projectStore';
import ProjectBoard from '../components/projects/ProjectBoard';
import ProjectLiveWork from '../components/projects/ProjectLiveWork';
import ProjectAgents from '../components/projects/ProjectAgents';
import ProjectArtifacts from '../components/projects/ProjectArtifacts';
import ProjectRuns from '../components/projects/ProjectRuns';
import ProjectGraph from '../components/projects/ProjectGraph';
import ProjectOverview from '../components/projects/ProjectOverview';
import ProjectFiles from '../components/projects/ProjectFiles';
import ProjectTree from '../components/projects/ProjectTree';
import { McpApprovals } from '../components/projects/McpApprovals';

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  paused: '#f5b50a',
  archived: '#64748b',
};

const TYPE_COLORS: Record<string, string> = {
  note: '#67e8f9',
  decision: '#f59e0b',
  research: '#a78bfa',
  reference: '#94a3b8',
  meeting: '#34d399',
  result: '#f87171',
};

function ProjectCard({
  project,
  isActive,
  onSelect,
  onDelete,
}: {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={`project-card-${project.id}`}
      style={{
        border: `1px solid ${isActive ? '#0891b2' : '#1e293b'}`,
        background: isActive ? 'rgba(8,145,178,0.08)' : '#0f172a',
        borderRadius: 8,
        padding: '14px 16px',
        cursor: 'pointer',
        position: 'relative',
        transition: 'border-color 0.15s',
      }}
      onClick={onSelect}
    >
      {isActive && (
        <span
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            fontSize: 9,
            fontWeight: 700,
            color: '#0891b2',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          ACTIVE
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Circle
          size={10}
          fill={project.color || '#00e5ff'}
          color={project.color || '#00e5ff'}
        />
        <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{project.name}</span>
      </div>
      {project.description && (
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px 18px', lineHeight: 1.4 }}>
          {project.description.slice(0, 120)}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 18 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: STATUS_COLORS[project.status] || '#64748b',
          }}
        >
          {project.status?.toUpperCase()}
        </span>
        {(project.tags || []).slice(0, 3).map((tag: string) => (
          <span
            key={tag}
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 10,
              background: '#1e293b',
              color: '#94a3b8',
            }}
          >
            {tag}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete project"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#475569',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 4,
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function KnowledgePanel({ projectId }: { projectId: string }) {
  const { getKnowledgeItems, createKnowledgeItem, updateKnowledgeItem, deleteKnowledgeItem } = useProjects();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState('note');
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getKnowledgeItems(projectId);
    setItems(result);
    setLoading(false);
  }, [projectId, getKnowledgeItems]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const item = await createKnowledgeItem(projectId, {
      title: newTitle.trim(),
      content: newContent.trim(),
      type: newType,
    });
    if (item) {
      setItems((prev) => [item, ...prev]);
      setNewTitle('');
      setNewContent('');
      setNewType('note');
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteKnowledgeItem(projectId, id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleSaveEdit = async (item: KnowledgeItem) => {
    const updated = await updateKnowledgeItem(projectId, item.id, { content: editContent });
    if (updated) setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    setEditing(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Knowledge
        </span>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, fontWeight: 600,
            background: '#0891b2', color: '#fff',
            border: 'none', borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
          }}
        >
          <Plus size={11} /> Add
        </button>
      </div>

      {creating && (
        <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: 12, background: '#0a0f16', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Title…"
            autoFocus
            style={{
              background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
              color: '#e2e8f0', fontSize: 13, padding: '6px 10px', outline: 'none',
            }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            style={{
              background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
              color: '#94a3b8', fontSize: 12, padding: '5px 8px', outline: 'none',
            }}
          >
            {['note', 'decision', 'research', 'reference', 'meeting', 'result'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Content (markdown supported)…"
            rows={4}
            style={{
              background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
              color: '#e2e8f0', fontSize: 12, padding: '6px 10px', outline: 'none', resize: 'vertical', fontFamily: 'monospace',
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handleCreate}
              style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewTitle(''); setNewContent(''); }}
              style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 5, padding: '5px 14px', fontSize: 12, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
      {!loading && items.length === 0 && !creating && (
        <div style={{ fontSize: 12, color: '#334155', textAlign: 'center', padding: '20px 0' }}>
          No knowledge items yet. Add a note, decision, or research entry.
        </div>
      )}

      {items.map((item) => (
        <div
          key={item.id}
          style={{
            border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px',
            background: '#0a0f16', display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLORS[item.type] || '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {item.type}
            </span>
            <span style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0', flex: 1 }}>{item.title}</span>
            <button
              type="button"
              onClick={() => { setEditing(item.id); setEditContent(item.content); }}
              style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', padding: '1px 4px' }}
              title="Edit"
            >
              <FileText size={11} />
            </button>
            <button
              type="button"
              onClick={() => handleDelete(item.id)}
              style={{ background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', padding: '1px 4px' }}
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          </div>

          {editing === item.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={5}
                autoFocus
                style={{
                  background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
                  color: '#e2e8f0', fontSize: 12, padding: '6px 10px', outline: 'none', resize: 'vertical', fontFamily: 'monospace',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => handleSaveEdit(item)}
                  style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 11, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            item.content && (
              <pre style={{ fontSize: 11, color: '#64748b', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', lineHeight: 1.5 }}>
                {item.content.slice(0, 400)}{item.content.length > 400 ? '…' : ''}
              </pre>
            )
          )}

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(item.tags || []).map((tag: string) => (
              <span key={tag} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 8, background: '#1e293b', color: '#64748b' }}>{tag}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProjectsPage() {
  const { projects, activeProjectId, activeProject, isLoading, refresh, setActiveProject, createProject, deleteProject } = useProjects();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState('#00e5ff');
  const [tab, setTab] = useState<'overview' | 'board' | 'livework' | 'agents' | 'knowledge' | 'artifacts' | 'files' | 'runs' | 'graph'>('overview');
  // Deep-link targets (from Jarvis / Mission Control navigation): /projects?project=X&task=T
  const [searchParams] = useSearchParams();
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null);
  const [highlightArtifactId, setHighlightArtifactId] = useState<string | null>(null);

  // Re-sync from the server on page mount so external/active changes are shown.
  useEffect(() => { void refresh(); }, [refresh]);

  // Apply navigation params: select the project (and make it active so Jarvis
  // context follows), then switch to the tab that contains the referenced item.
  const applyDeepLink = useCallback(() => {
    const projectParam = searchParams.get('project');
    const taskParam = searchParams.get('task');
    const runParam = searchParams.get('run');
    const artifactParam = searchParams.get('artifact');
    if (projectParam && projects.some((p) => p.id === projectParam)) {
      setSelectedId(projectParam);
      if (activeProjectId !== projectParam) void setActiveProject(projectParam);
    }
    if (taskParam) {
      setTab('board');
      setHighlightTaskId(taskParam);
      setHighlightRunId(null);
      setHighlightArtifactId(null);
    } else if (runParam) {
      setTab('runs');
      setHighlightRunId(runParam);
      setHighlightTaskId(null);
      setHighlightArtifactId(null);
    } else if (artifactParam) {
      setTab('artifacts');
      setHighlightArtifactId(artifactParam);
      setHighlightTaskId(null);
      setHighlightRunId(null);
    }
  }, [searchParams, projects, activeProjectId, setActiveProject]);

  useEffect(() => { applyDeepLink(); }, [applyDeepLink]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? activeProject ?? projects[0] ?? null;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const project = await createProject({ name: newName.trim(), description: newDesc.trim() || undefined, color: newColor });
    if (project) {
      setSelectedId(project.id);
      setCreating(false);
      setNewName('');
      setNewDesc('');
      setNewColor('#00e5ff');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project and all its knowledge items?')) return;
    await deleteProject(id);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div style={{ minHeight: '100%', background: '#0a0f16', color: '#e2e8f0', padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, borderBottom: '1px solid #1e293b', paddingBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
              Workspace
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Projects</h1>
            <p style={{ fontSize: 13, color: '#475569', margin: '4px 0 0' }}>
              Durable project workspaces with linked knowledge, decisions, and research.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={refresh}
              style={{ background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6,
                padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus size={13} /> New Project
            </button>
          </div>
        </div>

        {/* Create form */}
        {creating && (
          <div style={{ border: '1px solid #0891b2', borderRadius: 10, padding: 20, background: '#0f172a', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#67e8f9' }}>New Project</div>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name…"
              autoFocus
              style={{
                background: '#0a0f16', border: '1px solid #334155', borderRadius: 6,
                color: '#e2e8f0', fontSize: 14, padding: '8px 12px', outline: 'none',
              }}
            />
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)…"
              rows={2}
              style={{
                background: '#0a0f16', border: '1px solid #334155', borderRadius: 6,
                color: '#e2e8f0', fontSize: 13, padding: '8px 12px', outline: 'none', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 12, color: '#64748b' }}>Accent color</label>
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                style={{ width: 36, height: 28, borderRadius: 4, border: '1px solid #334155', cursor: 'pointer', background: 'transparent' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handleCreate}
                style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Create Project
              </button>
              <button
                type="button"
                onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
                style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
          {/* Left: project list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </div>
            {isLoading && <div style={{ fontSize: 12, color: '#475569' }}>Loading…</div>}
            {!isLoading && projects.length === 0 && (
              <div style={{ fontSize: 12, color: '#334155', padding: '16px 0' }}>
                No projects yet. Create your first project to get started.
              </div>
            )}
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                isActive={p.id === activeProjectId}
                onSelect={() => setSelectedId(p.id)}
                onDelete={() => handleDelete(p.id)}
              />
            ))}
          </div>

          {/* Right: project detail */}
          {selectedProject ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Project header */}
              <div style={{ border: '1px solid #1e293b', borderRadius: 10, padding: '16px 20px', background: '#0f172a' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Circle size={12} fill={selectedProject.color || '#00e5ff'} color={selectedProject.color || '#00e5ff'} />
                      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#f1f5f9' }}>{selectedProject.name}</h2>
                    </div>
                    {selectedProject.description && (
                      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 8px 20px', lineHeight: 1.5 }}>{selectedProject.description}</p>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 20 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[selectedProject.status] || '#64748b' }}>
                        {selectedProject.status?.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      data-testid="project-open-in-jarvis"
                      onClick={() => {
                        void setActiveProject(selectedProject.id);
                        navigate('/jarvis');
                      }}
                      title="Talk to Jarvis about this project (sets it active)"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        background: '#134e4a', color: '#5eead4', border: '1px solid #115e59', borderRadius: 6,
                        padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      <MessageCircle size={12} /> Open in Jarvis
                    </button>
                    {activeProjectId !== selectedProject.id ? (
                      <button
                        type="button"
                        onClick={() => setActiveProject(selectedProject.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6,
                          padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <Star size={12} /> Set Active
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActiveProject(null)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          background: '#1e293b', color: '#0891b2', border: '1px solid #0891b2', borderRadius: 6,
                          padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <Star size={12} fill="#0891b2" /> Active
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1e293b', overflowX: 'auto' }}>
                {(['overview', 'tree', 'board', 'livework', 'agents', 'knowledge', 'artifacts', 'files', 'runs', 'graph'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-testid={`project-tab-${t}`}
                    onClick={() => setTab(t)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: tab === t ? '2px solid #0891b2' : '2px solid transparent',
                      color: tab === t ? '#67e8f9' : '#64748b',
                      padding: '8px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t === 'tree' ? 'Execution Tree' : t}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === 'overview' && (
                <ProjectOverview project={selectedProject} projectId={selectedProject.id} />
              )}

              {tab === 'tree' && (
                <>
                  <McpApprovals />
                  <ProjectTree projectId={selectedProject.id} />
                </>
              )}

              {tab === 'board' && (
                <ProjectBoard projectId={selectedProject.id} highlightTaskId={highlightTaskId} />
              )}

              {tab === 'knowledge' && (
                <KnowledgePanel projectId={selectedProject.id} />
              )}

              {tab === 'livework' && (
                <ProjectLiveWork projectId={selectedProject.id} />
              )}

              {tab === 'agents' && (
                <ProjectAgents projectId={selectedProject.id} />
              )}

              {tab === 'artifacts' && (
                <ProjectArtifacts projectId={selectedProject.id} highlightArtifactId={highlightArtifactId} />
              )}

              {tab === 'files' && (
                <ProjectFiles projectId={selectedProject.id} />
              )}

              {tab === 'runs' && (
                <ProjectRuns projectId={selectedProject.id} highlightRunId={highlightRunId} />
              )}

              {tab === 'graph' && (
                <ProjectGraph projectId={selectedProject.id} />
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 240, color: '#334155', fontSize: 14 }}>
              Select a project to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
