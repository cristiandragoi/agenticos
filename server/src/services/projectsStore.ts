import { rawDb } from '../db/index.js';
import { db } from '../db/index.js';
import { projects, knowledgeItems, entityLinks } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Run DDL idempotently on first import
rawDb.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    tags TEXT,
    workspace_path TEXT,
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'note',
    tags TEXT,
    linked_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entity_links (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL,
    from_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    relation TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  );
`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Env-overridable data dir (tests isolate the active-project file); defaults
// to the repo's server/data in production.
const dataDir = process.env.AGENTICOS_DATA_DIR
  ? path.resolve(process.env.AGENTICOS_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
const activeProjectFile = path.join(dataDir, 'active-project.json');

function readActiveProjectId(): string | null {
  try {
    const raw = fs.readFileSync(activeProjectFile, 'utf-8');
    return JSON.parse(raw)?.activeProjectId ?? null;
  } catch {
    return null;
  }
}

function writeActiveProjectId(id: string | null): void {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(activeProjectFile, JSON.stringify({ activeProjectId: id }), 'utf-8');
  } catch { /* best effort */ }
}

let _activeProjectId: string | null = readActiveProjectId();

export const projectsStore = {
  listProjects() {
    try {
      return db.select().from(projects).orderBy(desc(projects.updatedAt)).all();
    } catch { return []; }
  },

  getProject(id: string) {
    try {
      return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
    } catch { return null; }
  },

  createProject(data: {
    id: string;
    name: string;
    description?: string;
    status?: string;
    tags?: string[];
    workspacePath?: string;
    color?: string;
  }) {
    const now = new Date().toISOString();
    db.insert(projects).values({
      id: data.id,
      name: data.name,
      description: data.description ?? null,
      status: data.status ?? 'active',
      tags: data.tags ?? [],
      workspacePath: data.workspacePath ?? null,
      color: data.color ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.getProject(data.id);
  },

  updateProject(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      status: string;
      tags: string[];
      workspacePath: string;
      color: string;
    }>,
  ) {
    db.update(projects).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(projects.id, id)).run();
    return this.getProject(id);
  },

  deleteProject(id: string) {
    db.delete(projects).where(eq(projects.id, id)).run();
    // Also clear activeProjectId if it was this project
    if (_activeProjectId === id) {
      _activeProjectId = null;
      writeActiveProjectId(null);
    }
  },

  getActiveProjectId(): string | null {
    return _activeProjectId;
  },

  setActiveProjectId(id: string | null): void {
    _activeProjectId = id;
    writeActiveProjectId(id);
  },

  getActiveProject() {
    if (!_activeProjectId) return null;
    const project = this.getProject(_activeProjectId);
    if (!project) {
      // SELF-HEAL: a stale/ghost active id is never authoritative. Clear it
      // in memory and persist the cleared state so no caller (endpoint, jarvis
      // context, project scoping) can ever resolve it to a phantom. This does
      // NOT auto-select another project — the user must pick one.
      _activeProjectId = null;
      writeActiveProjectId(null);
      return null;
    }
    return project;
  },

  // ── Knowledge items ──────────────────────────────────────────────────────

  listKnowledgeItems(projectId: string) {
    try {
      return db.select().from(knowledgeItems).where(eq(knowledgeItems.projectId, projectId)).orderBy(desc(knowledgeItems.updatedAt)).all();
    } catch { return []; }
  },

  getKnowledgeItem(id: string) {
    try {
      return db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id)).get() ?? null;
    } catch { return null; }
  },

  createKnowledgeItem(data: {
    id: string;
    projectId: string;
    title: string;
    content?: string;
    type?: string;
    tags?: string[];
    linkedIds?: string[];
  }) {
    const now = new Date().toISOString();
    db.insert(knowledgeItems).values({
      id: data.id,
      projectId: data.projectId,
      title: data.title,
      content: data.content ?? '',
      type: data.type ?? 'note',
      tags: data.tags ?? [],
      linkedIds: data.linkedIds ?? [],
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.getKnowledgeItem(data.id);
  },

  updateKnowledgeItem(
    id: string,
    patch: Partial<{
      title: string;
      content: string;
      type: string;
      tags: string[];
      linkedIds: string[];
    }>,
  ) {
    db.update(knowledgeItems).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(knowledgeItems.id, id)).run();
    return this.getKnowledgeItem(id);
  },

  deleteKnowledgeItem(id: string) {
    db.delete(knowledgeItems).where(eq(knowledgeItems.id, id)).run();
  },

  // ── Project agent assignments (entity_links: project → agent) ────────────

  assignAgent(projectId: string, agentId: string) {
    const existing = db.select().from(entityLinks)
      .where(and(eq(entityLinks.fromId, projectId), eq(entityLinks.toId, agentId))).get();
    if (existing) return existing;
    const id = `link-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    db.insert(entityLinks).values({
      id, fromId: projectId, fromType: 'project', toId: agentId, toType: 'agent',
      relation: 'assigned', metadata: {}, createdAt: now,
    }).run();
    return this.getAgentAssignment(projectId, agentId);
  },

  unassignAgent(projectId: string, agentId: string) {
    db.delete(entityLinks)
      .where(and(eq(entityLinks.fromId, projectId), eq(entityLinks.toId, agentId), eq(entityLinks.relation, 'assigned')))
      .run();
  },

  getAgentAssignment(projectId: string, agentId: string) {
    return db.select().from(entityLinks)
      .where(and(eq(entityLinks.fromId, projectId), eq(entityLinks.toId, agentId), eq(entityLinks.relation, 'assigned')))
      .get() ?? null;
  },

  listAssignedAgents(projectId: string): string[] {
    try {
      const rows = db.select().from(entityLinks)
        .where(and(eq(entityLinks.fromId, projectId), eq(entityLinks.toId, 'agent'), eq(entityLinks.relation, 'assigned')))
        .all();
      // Fall back to any project→agent links regardless of toType value.
      const rows2 = db.select().from(entityLinks)
        .where(and(eq(entityLinks.fromId, projectId), eq(entityLinks.relation, 'assigned')))
        .all();
      const ids = rows2.map((r) => r.toId);
      return [...new Set(ids)];
    } catch { return []; }
  },
};
