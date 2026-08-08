import { Router } from 'express';
import { db } from '../services/db.js';
import { memoryStore } from '../services/memory/store.js';
import { createMemory, newMemoryId, seedDecisions } from '../services/memory/distill.js';
import type { MemoryRecord, MemoryType, MemoryStatus } from '../services/memory/types.js';

const router = Router();

// ── Legacy scopes/entries + obsidian vault bridge (unchanged) ──────────────
router.get('/scopes', (_req, res) => res.json(db.memoryScopes.list()));
router.get('/scopes/:id', (req, res) => {
  const scope = db.memoryScopes.get(req.params.id);
  if (!scope) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Memory scope not found' } }); return; }
  res.json(scope);
});
router.get('/entries', (req, res) => {
  const { scopeId } = req.query;
  const entries = db.memoryEntries.list(scopeId ? { scopeId: scopeId as string } : undefined);
  res.json(entries);
});
router.post('/entries', (req, res) => {
  const { scopeId, key, content } = req.body;
  if (!scopeId || !key || !content) return res.status(400).json({ error: 'Missing required fields' });
  const entry = { id: `mem-ent-${Date.now()}`, scopeId, key, title: key, kind: 'note' as const, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.memoryEntries.upsert(entry);
  res.json(entry);
});
import fs from 'fs/promises';
import path from 'path';
const VAULT_PATH = 'C:\\Users\\Cris\\obsidian-vault';
function sanitizePath(unsafePath: string) {
  const safe = path.normalize(unsafePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(VAULT_PATH, safe);
}
router.get('/vault/read', async (req, res) => {
  const { filePath } = req.query;
  if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'Missing filePath' });
  try { res.json({ content: await fs.readFile(sanitizePath(filePath), 'utf8') }); }
  catch (err: any) { res.status(404).json({ error: 'File not found or error reading', details: err.message }); }
});
router.post('/vault/append', async (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || !content) return res.status(400).json({ error: 'Missing filePath or content' });
  try { await fs.appendFile(sanitizePath(filePath), `\n${content}\n`, 'utf8'); res.json({ success: true }); }
  catch (err: any) { res.status(500).json({ error: 'Error appending to file', details: err.message }); }
});

// ── AgenticOS memory system (Jarvis memory + proactive context milestone) ──

/** Seed canonical decisions once at first API use. */
seedDecisions();

function parseMemoryBody(body: any): Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastConfirmedAt' | 'lastUsedAt' | 'useCount' | 'status' | 'supersedesMemoryId' | 'derivedFromMemoryIds' | 'pinned'> | null {
  const type = body?.type as MemoryType | undefined;
  if (!type || !['episodic', 'semantic', 'decision', 'preference', 'working'].includes(type)) return null;
  if (!body?.title) return null;
  return {
    type, title: String(body.title), summary: String(body.summary || ''), content: String(body.content || ''),
    scope: String(body.scope || 'general'),
    entities: Array.isArray(body.entities) ? body.entities.map(String) : [],
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    source: { sourceType: body.sourceType === 'task' || body.sourceType === 'conversation' || body.sourceType === 'ledger' ? body.sourceType : 'manual', ...(body.source || {}) },
    confidence: typeof body.confidence === 'number' ? body.confidence : 0.7,
  };
}

router.get('/memories', (req, res) => {
  const q = req.query;
  const items = memoryStore.list({
    type: (q.type as MemoryType) || null,
    scope: (q.scope as string) || null,
    status: (q.status as MemoryStatus) || null,
    agent: (q.agent as string) || null,
    entity: (q.entity as string) || null,
    tag: (q.tag as string) || null,
    minConfidence: q.minConfidence != null ? Number(q.minConfidence) : null,
    limit: q.limit != null ? Math.min(200, Number(q.limit)) : 50,
    offset: q.offset != null ? Number(q.offset) : 0,
  });
  res.json(items);
});

router.get('/memories/:id', (req, res) => {
  const m = memoryStore.get(req.params.id);
  if (!m) { res.status(404).json({ error: 'Memory not found' }); return; }
  memoryStore.touch(req.params.id);
  res.json(m);
});

router.post('/memories', (req, res) => {
  const body = parseMemoryBody(req.body);
  if (!body) { res.status(400).json({ error: 'Invalid memory (type + title required)' }); return; }
  const m = createMemory({ ...body, derivedFromMemoryIds: req.body?.derivedFromMemoryIds });
  res.status(201).json(m);
});

router.patch('/memories/:id', (req, res) => {
  const existing = memoryStore.get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Memory not found' }); return; }
  const patch: Partial<MemoryRecord> = {};
  if (typeof req.body?.title === 'string') patch.title = req.body.title;
  if (typeof req.body?.summary === 'string') patch.summary = req.body.summary;
  if (typeof req.body?.content === 'string') patch.content = req.body.content;
  if (typeof req.body?.scope === 'string') patch.scope = req.body.scope;
  if (Array.isArray(req.body?.entities)) patch.entities = req.body.entities.map(String);
  if (Array.isArray(req.body?.tags)) patch.tags = req.body.tags.map(String);
  if (typeof req.body?.confidence === 'number') patch.confidence = req.body.confidence;
  if (req.body?.status && ['active', 'superseded', 'stale', 'archived'].includes(req.body.status)) patch.status = req.body.status;
  if (typeof req.body?.pinned === 'boolean') patch.pinned = req.body.pinned;
  const updated = memoryStore.update(req.params.id, patch);
  res.json(updated);
});

router.delete('/memories/:id', (req, res) => {
  memoryStore.remove(req.params.id);
  res.json({ success: true });
});

router.post('/memories/:id/confirm', (req, res) => {
  const updated = memoryStore.update(req.params.id, { lastConfirmedAt: Date.now(), status: 'active' });
  if (!updated) { res.status(404).json({ error: 'Memory not found' }); return; }
  res.json(updated);
});

router.post('/memories/:id/correct', (req, res) => {
  // "That is wrong" — mark the old memory superseded + create the corrected
  // one, preserving provenance/history (never silently erase).
  const existing = memoryStore.get(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Memory not found' }); return; }
  memoryStore.update(req.params.id, { status: 'superseded' });
  const corrected = createMemory({
    type: existing.type,
    title: req.body?.title ? String(req.body.title) : `Corrected: ${existing.title}`,
    summary: req.body?.summary ? String(req.body.summary) : existing.summary,
    content: req.body?.content ? String(req.body.content) : existing.content,
    scope: existing.scope,
    entities: existing.entities,
    tags: [...existing.tags, 'corrected'],
    confidence: Math.min(1, existing.confidence + 0.1),
    source: { ...existing.source, sourceType: 'conversation' },
    derivedFromMemoryIds: [existing.id],
  });
  res.status(201).json({ corrected, superseded: existing.id });
});

router.get('/search', (req, res) => {
  const q = (req.query.q as string) || '';
  const hits = memoryStore.search(q, {
    type: (req.query.type as MemoryType) || null,
    scope: (req.query.scope as string) || null,
    status: (req.query.status as MemoryStatus) || null,
    limit: req.query.limit != null ? Math.min(50, Number(req.query.limit)) : 20,
  });
  res.json(hits);
});

router.get('/timeline', (req, res) => {
  res.json(memoryStore.timeline({ limit: req.query.limit != null ? Math.min(200, Number(req.query.limit)) : 100, offset: req.query.offset != null ? Number(req.query.offset) : 0 }));
});

router.get('/decisions', (_req, res) => {
  res.json(memoryStore.decisions());
});

router.get('/graph', (req, res) => {
  const q = req.query;
  res.json(memoryStore.graph({
    focus: (q.focus as string) || null,
    depth: q.depth != null ? Number(q.depth) : 1,
    limit: q.limit != null ? Math.min(200, Number(q.limit)) : 60,
  }));
});

router.get('/entities', (_req, res) => {
  res.json(memoryStore.entities());
});

export default router;
