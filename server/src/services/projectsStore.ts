import { rawDb } from '../db/index.js';
import { db } from '../db/index.js';
import { projects, knowledgeItems } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
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
const dataDir = path.resolve(__dirname, '..', '..', 'data');
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
    return this.getProject(_activeProjectId);
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
};
