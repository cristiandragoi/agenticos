/**
 * Focused tests — ACTIVE-PROJECT TRUTH contract.
 *
 * Stale/ghost activeProjectId must never leak as authoritative state:
 *   STALE ID → NO ACTIVE PROJECT (never the first available project, never a
 *   phantom id). getActiveProject() self-heals by clearing the stale id in
 *   memory + persisting null; GET /api/projects reports the resolved truth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import request from 'supertest';

vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });

let tmpDir: string;
let store: any;

function activeFile() {
  return path.join(tmpDir, 'data', 'active-project.json');
}

async function freshStore() {
  vi.resetModules();
  const mod = await import('../services/projectsStore.js');
  return mod.projectsStore;
}

function writeStaleFile(id: string) {
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(activeFile(), JSON.stringify({ activeProjectId: id }), 'utf-8');
}

describe('Active-project truth contract', () => {
  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aptruth-'));
    process.env.AGENT_TEAMS_DB_PATH = path.join(tmpDir, 'test.db');
    process.env.AGENTICOS_DATA_DIR = path.join(tmpDir, 'data');
    store = await freshStore();
  });

  afterEach(() => {
    delete process.env.AGENT_TEAMS_DB_PATH;
    delete process.env.AGENTICOS_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  async function freshApp() {
    vi.resetModules();
    const { projectsStore: s } = await import('../services/projectsStore.js');
    store = s;
    const { default: projectsRouter } = await import('../routers/projects.js');
    const app = express();
    app.use('/api/projects', projectsRouter);
    return app;
  }

  it('valid active project ID → getActiveProject returns the project and the endpoint reports it', async () => {
    store.createProject({ id: 'proj-real', name: 'AgenticOS', description: 'platform' });
    store.setActiveProjectId('proj-real');

    expect(store.getActiveProject()?.id).toBe('proj-real');
    expect(store.getActiveProject()?.name).toBe('AgenticOS');

    const app = await freshApp();
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.activeProjectId).toBe('proj-real');
    expect(res.body.projects.some((p: any) => p.id === 'proj-real')).toBe(true);
  });

  it('null active project ID → getActiveProject null and the endpoint reports null', async () => {
    store.setActiveProjectId(null);
    expect(store.getActiveProject()).toBeNull();

    const app = await freshApp();
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.activeProjectId).toBeNull();
  });

  it('stale/nonexistent ID → getActiveProject returns null, endpoint reports null, and the stale id self-heals', async () => {
    store.createProject({ id: 'proj-real', name: 'AgenticOS' });
    store.setActiveProjectId('proj-ghost'); // persisted stale id

    // Contract: stale → null, never undefined, never a substitute project.
    expect(store.getActiveProject()).toBeNull();

    // SELF-HEAL: the stale id is cleared in memory and persisted as null.
    expect(store.getActiveProjectId()).toBeNull();
    expect(JSON.parse(fs.readFileSync(activeFile(), 'utf-8')).activeProjectId).toBeNull();

    // Endpoint reports resolved truth.
    const app = await freshApp();
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.activeProjectId).toBeNull();
    expect(res.body.projects.some((p: any) => p.id === 'proj-real')).toBe(true);
  });

  it('project deletion while active → active becomes null, no ghost leaks, nothing auto-selected', async () => {
    store.createProject({ id: 'proj-a', name: 'A' });
    store.createProject({ id: 'proj-b', name: 'B' });
    store.setActiveProjectId('proj-a');
    expect(store.getActiveProject()?.id).toBe('proj-a');

    store.deleteProject('proj-a');
    expect(store.getActiveProjectId()).toBeNull();
    expect(store.getActiveProject()).toBeNull();
    // Never silently auto-selects the remaining project.
    expect(store.getActiveProjectId()).not.toBe('proj-b');

    const app = await freshApp();
    const res = await request(app).get('/api/projects');
    expect(res.body.activeProjectId).toBeNull();
  });

  it('restart with a stale persisted ID → comes up with no active project, no crash, no phantom', async () => {
    store.createProject({ id: 'proj-real', name: 'AgenticOS' });
    writeStaleFile('proj-ghost'); // simulate restart with stale persistence

    store = await freshStore();
    // Module loaded the stale id into memory…
    expect(store.getActiveProjectId()).toBe('proj-ghost');
    // …but resolving it self-heals: no active project, no phantom, no crash.
    expect(store.getActiveProject()).toBeNull();
    expect(store.getActiveProjectId()).toBeNull();
    expect(JSON.parse(fs.readFileSync(activeFile(), 'utf-8')).activeProjectId).toBeNull();
  });
});
