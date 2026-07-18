import { Router } from 'express';
import { db } from '../services/db.js';

const router = Router();

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
  if (!scopeId || !key || !content) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const entry = {
    id: `mem-ent-${Date.now()}`,
    scopeId,
    key,
    title: key,
    kind: 'note' as const,
    content,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.memoryEntries.upsert(entry);
  res.json(entry);
});

import fs from 'fs/promises';
import path from 'path';

const VAULT_PATH = 'C:\\Users\\Cris\\obsidian-vault';

// Basic safety check for paths
function sanitizePath(unsafePath: string) {
  const safe = path.normalize(unsafePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(VAULT_PATH, safe);
}

router.get('/vault/read', async (req, res) => {
  const { filePath } = req.query;
  if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'Missing filePath' });
  try {
    const fullPath = sanitizePath(filePath);
    const content = await fs.readFile(fullPath, 'utf8');
    res.json({ content });
  } catch (err: any) {
    res.status(404).json({ error: 'File not found or error reading', details: err.message });
  }
});

router.post('/vault/append', async (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || !content) return res.status(400).json({ error: 'Missing filePath or content' });
  try {
    const fullPath = sanitizePath(filePath);
    await fs.appendFile(fullPath, `\n${content}\n`, 'utf8');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Error appending to file', details: err.message });
  }
});

export default router;
