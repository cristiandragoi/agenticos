import { rawDb } from '../db/index.js';
import { db } from '../db/index.js';
import { projects, knowledgeItems, entityLinks } from '../db/schema.js';
import { eq, desc, asc, and } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

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
    priority INTEGER NOT NULL DEFAULT 999,
    revenue_vertical TEXT,
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

// Idempotent column migrations for existing databases
try {
  const pragma = rawDb.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
  const cols = new Set(pragma.map(c => c.name));
  if (!cols.has('priority')) {
    rawDb.exec('ALTER TABLE projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 999');
  }
  if (!cols.has('revenue_vertical')) {
    rawDb.exec('ALTER TABLE projects ADD COLUMN revenue_vertical TEXT');
  }
} catch { /* best effort */ }

// Idempotent column migrations for revenue_human_gates if table exists
try {
  const gatePragma = rawDb.prepare('PRAGMA table_info(revenue_human_gates)').all() as Array<{ name: string }>;
  if (gatePragma.length > 0) {
    const gateCols = new Set(gatePragma.map(c => c.name));
    if (!gateCols.has('project_id')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN project_id TEXT');
    if (!gateCols.has('task_id')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN task_id TEXT');
    if (!gateCols.has('platform')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN platform TEXT');
    if (!gateCols.has('user_action')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN user_action TEXT');
    if (!gateCols.has('gate_url')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN gate_url TEXT');
    if (!gateCols.has('expires_at')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN expires_at TEXT');
    if (!gateCols.has('notified_conversation')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN notified_conversation TEXT');
    if (!gateCols.has('evidence')) rawDb.exec('ALTER TABLE revenue_human_gates ADD COLUMN evidence TEXT');
  }
} catch { /* best effort */ }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Env-overridable data dir (tests isolate the active-project file); defaults
// to Roaming in packaged app / repo's server/data in dev.
const roamingDataDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'agenticos', 'data')
  : path.join(os.homedir(), 'AppData', 'Roaming', 'agenticos', 'data');
const defaultDataDir = (path.resolve(__dirname, '..', '..').toLowerCase().includes('agenticos') && fs.existsSync(roamingDataDir))
  ? roamingDataDir
  : path.resolve(__dirname, '..', '..', 'data');
const dataDir = process.env.AGENTICOS_DATA_DIR
  ? path.resolve(process.env.AGENTICOS_DATA_DIR)
  : defaultDataDir;
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
      return db
        .select()
        .from(projects)
        .orderBy(asc(projects.priority), desc(projects.updatedAt))
        .all();
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
    priority?: number;
    revenueVertical?: string | null;
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
      priority: data.priority ?? 999,
      revenueVertical: data.revenueVertical ?? null,
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
      priority: number;
      revenueVertical: string | null;
    }>,
  ) {
    db.update(projects).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(projects.id, id)).run();
    return this.getProject(id);
  },

  setPriority(id: string, priority: number) {
    return this.updateProject(id, { priority });
  },

  setRevenueVertical(id: string, revenueVertical: string | null) {
    return this.updateProject(id, { revenueVertical });
  },

  /**
   * Deterministic and persistent project priority ordering across restarts:
   * 1. Shopify (priority 1) — e-commerce storefront integration
   * 2. TikTok Shop (priority 2) — merchant & creator channel
   * 3. All remaining projects keep existing priority / order by updatedAt
   *
   * Note: Free Cash is decommissioned and removed from active Jarvis operational state.
   */
  ensureRevenueProjects() {
    try {
      // Decommission and remove Free Cash from active state if present
      const all = this.listProjects();
      const existingFreeCash = all.find(
        p => p.revenueVertical === 'free_cash' || p.name.toLowerCase() === 'free cash' || p.id === 'proj-free-cash'
      );
      if (existingFreeCash) {
        db.delete(projects).where(eq(projects.id, existingFreeCash.id)).run();
        if (_activeProjectId === existingFreeCash.id) {
          _activeProjectId = null;
          writeActiveProjectId(null);
        }
      }

      const currentProjects = this.listProjects();

      // 1. Shopify (Priority 1)
      const existingShopify = currentProjects.find(
        p => p.revenueVertical === 'shopify' || p.name.toLowerCase() === 'shopify'
      );
      if (existingShopify) {
        this.updateProject(existingShopify.id, {
          priority: 1,
          revenueVertical: 'shopify',
        });
      } else {
        this.createProject({
          id: 'proj-shopify',
          name: 'Shopify',
          description: 'Shopify storefront and e-commerce channel operations',
          status: 'active',
          priority: 1,
          revenueVertical: 'shopify',
          tags: ['revenue', 'shopify', 'p1'],
        });
      }

      // Re-read after Shopify check
      const currentProjects2 = this.listProjects();

      // 2. TikTok Shop (Priority 2)
      const existingTikTok = currentProjects2.find(
        p => p.revenueVertical === 'tiktok_shop' || p.name.toLowerCase() === 'tiktok shop'
      );
      if (existingTikTok) {
        this.updateProject(existingTikTok.id, {
          priority: 2,
          revenueVertical: 'tiktok_shop',
        });
      } else {
        this.createProject({
          id: 'proj-tiktok-shop',
          name: 'TikTok Shop',
          description: 'TikTok Shop merchant and creator operations',
          status: 'active',
          priority: 2,
          revenueVertical: 'tiktok_shop',
          tags: ['revenue', 'tiktok_shop', 'p2'],
        });
      }

      return this.listProjects();
    } catch (e) {
      /* best effort */
      return [];
    }
  },

  deleteProject(idOrName: string): boolean {
    const all = this.listProjects();
    const match = all.find(p => p.id === idOrName || p.name.toLowerCase() === idOrName.toLowerCase());
    if (match) {
      db.delete(projects).where(eq(projects.id, match.id)).run();
      if (_activeProjectId === match.id) {
        _activeProjectId = null;
        writeActiveProjectId(null);
      }
      return true;
    }
    return false;
  },

  getActiveProjectId(): string | null {
    if (_activeProjectId === 'proj-free-cash') {
      _activeProjectId = null;
      writeActiveProjectId(null);
    }
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
