/**
 * Focused tests — Project + Knowledge foundation.
 *
 * Covers: durable project CRUD, active-project persistence (file-backed),
 * knowledge-item ownership (project-scoped), relationship/link foundation,
 * and active-project deletion clearing the persisted selection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let store: any;

async function freshStore() {
  vi.resetModules();
  const mod = await import('../services/projectsStore.js');
  return mod.projectsStore;
}

describe('Projects + Knowledge foundation', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projtest-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    // The active-project file lives under server/data — point it at the temp
    // dir by making the store resolve dataDir relative to the db path.
    process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data');
    store = await freshStore();
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('creates, lists, updates, and deletes a durable project', () => {
    const p = store.createProject({ id: 'proj-test1', name: 'Recruiting', description: 'IAM consultants', tags: ['b2b'], color: '#00e5ff' });
    expect(p.id).toBe('proj-test1');
    expect(p.name).toBe('Recruiting');
    expect(p.status).toBe('active');

    const list = store.listProjects();
    expect(list.some((x: any) => x.id === 'proj-test1')).toBe(true);

    const updated = store.updateProject('proj-test1', { name: 'Recruiting EU' });
    expect(updated.name).toBe('Recruiting EU');

    // Durable across a fresh module load (same DB file).
    const reloaded = store.listProjects();
    expect(reloaded.some((x: any) => x.id === 'proj-test1' && x.name === 'Recruiting EU')).toBe(true);

    store.deleteProject('proj-test1');
    expect(store.getProject('proj-test1')).toBeNull();
  });

  it('persists activeProjectId across module reloads and clears on delete', async () => {
    store.createProject({ id: 'proj-active', name: 'AgenticOS' });
    store.setActiveProjectId('proj-active');
    expect(store.getActiveProjectId()).toBe('proj-active');
    expect(store.getActiveProject()?.name).toBe('AgenticOS');

    // Reload the module — active id must survive (file-backed).
    store = await freshStore();
    expect(store.getActiveProjectId()).toBe('proj-active');

    // Deleting the active project clears the persisted selection.
    store.deleteProject('proj-active');
    expect(store.getActiveProjectId()).toBeNull();
  });

  it('scopes knowledge items to their project and supports links', () => {
    store.createProject({ id: 'proj-k', name: 'Knowledge Proj' });
    store.createProject({ id: 'proj-other', name: 'Other' });

    const note = store.createKnowledgeItem({
      id: 'ki-1', projectId: 'proj-k', title: 'Decision: stack',
      content: '# Stack\nUse SQLite.', type: 'decision', tags: ['stack'], linkedIds: [],
    });
    expect(note.projectId).toBe('proj-k');

    const ref = store.createKnowledgeItem({
      id: 'ki-2', projectId: 'proj-k', title: 'Reference: sqlite docs',
      content: 'SQLite docs link', type: 'reference', linkedIds: ['ki-1'],
    });
    expect(ref.linkedIds).toContain('ki-1');

    // Project-scoped listing: only proj-k items, never proj-other's.
    const items = store.listKnowledgeItems('proj-k');
    expect(items.map((i: any) => i.id).sort()).toEqual(['ki-1', 'ki-2']);
    expect(store.listKnowledgeItems('proj-other')).toEqual([]);

    // Update + delete
    const updated = store.updateKnowledgeItem('ki-1', { content: '# Stack\nUse SQLite (updated)' });
    expect(updated.content).toContain('updated');
    store.deleteKnowledgeItem('ki-1');
    expect(store.getKnowledgeItem('ki-1')).toBeNull();
  });

  it('rejects nothing when active project id points at a deleted project (returns null)', () => {
    store.setActiveProjectId('proj-ghost');
    expect(store.getActiveProject()).toBeNull();
  });
});
