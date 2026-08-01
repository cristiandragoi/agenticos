import { logger } from '../utils/logger.js';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { MemoryEntry, ObsidianConfig, SyncJob } from '../types.js';
import { db } from '../services/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');

const router = Router();

import { JsonStore } from '../services/store.js';

// In-memory sync state
const syncQueue: MemoryEntry[] = [];
const syncJobs = new JsonStore<SyncJob>(path.join(dataDir, 'syncJobs.json'));
let syncListeners: any[] = [];

function notifySyncStatus(): void {
  const pendingCount = syncQueue.length;
  const failedCount = syncJobs.list({ status: 'failed' }).length;
  const lastSynced = syncJobs.list({ status: 'synced' })
    .sort((a, b) => new Date(b.lastAttempt || 0).getTime() - new Date(a.lastAttempt || 0).getTime())[0];

  const status = { pendingCount, failedCount, lastSyncedTime: lastSynced?.lastAttempt || null };
  syncListeners.forEach(c => { try { c.write(`data: ${JSON.stringify(status)}\n\n`); } catch (_) {} });
}

/* ── GET /api/sync/status (SSE) ────────────────────── */
router.get('/status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  syncListeners.push(res);
  notifySyncStatus();
  req.on('close', () => { syncListeners = syncListeners.filter(c => c !== res); });
});

/* ── POST /api/sync/queue ──────────────────────────── */
router.post('/queue', (req, res) => {
  const { memoryEntry } = req.body;
  if (!syncQueue.find(e => e.id === memoryEntry.id)) {
    syncQueue.push(memoryEntry);
    if (!db.memoryEntries.get(memoryEntry.id)) {
      db.memoryEntries.upsert(memoryEntry);
    }
  }
  notifySyncStatus();
  res.status(202).json({ queued: true });
});

async function processSync(config: ObsidianConfig): Promise<SyncJob> {
  if (syncQueue.length === 0) {
    return { id: 'empty', entryIds: [], status: 'synced', retryCount: 0 };
  }
  const entries = [...syncQueue];
  syncQueue.length = 0;

  const jobId = `sync-${Date.now()}`;
  const job: SyncJob = {
    id: jobId, entryIds: entries.map(e => e.id),
    status: 'pending', retryCount: 0, lastAttempt: new Date().toISOString(),
  };
  syncJobs.upsert(job);
  notifySyncStatus();

  try {
    for (const entry of entries) {
      const vaultPath = path.resolve(
        config.vaultPath.replace('~', process.env.USERPROFILE || process.env.HOME || '')
      );
      const sanitizedTitle = entry.title.replace(/[\/\\:*?"<>|]/g, '-').substring(0, 100);
      const folder = config.folderMapping[entry.scopeId] || config.folderMapping['global'] || '';
      const targetDir = path.join(vaultPath, folder);

      const mdContent = `---\nid: ${entry.id}\nkind: ${entry.kind}\nsource: ${entry.sourceType || 'unknown'}/${entry.sourceId || 'unknown'}\ndate: ${entry.createdAt}\n---\n# ${entry.title}\n${entry.content}\n`;

      if (fs.existsSync(targetDir)) {
        await fs.promises.writeFile(path.join(targetDir, `${sanitizedTitle}.md`), mdContent, 'utf-8');
        logger.info(`[Sync] Written: ${sanitizedTitle}.md → ${targetDir}`);
      } else {
        logger.info(`[Sync Mock] Directory not found: ${targetDir} — skipping write`);
      }

      const dbEntry = db.memoryEntries.get(entry.id);
      if (dbEntry) {
        dbEntry.syncStatus = 'synced';
        db.memoryEntries.upsert(dbEntry);
      }
    }
    job.status = 'synced';
  } catch (error: any) {
    job.status = 'failed';
    job.error = error.message;
    logger.error('[Sync Error]', error);
  }

  job.lastAttempt = new Date().toISOString();
  syncJobs.upsert(job);
  notifySyncStatus();
  return job;
}

/* ── POST /api/sync/now ────────────────────────────── */
router.post('/now', async (req, res) => {
  const { config } = req.body;
  const job = await processSync(config);
  res.json({ success: true, job });
});

/* ── POST /api/sync/retry ──────────────────────────── */
router.post('/retry', async (req, res) => {
  const { config } = req.body;
  const failedJobs = syncJobs.list({ status: 'failed' });
  for (const job of failedJobs) {
    for (const entryId of job.entryIds) {
      const entry = db.memoryEntries.get(entryId);
      if (entry && !syncQueue.find(e => e.id === entry.id)) syncQueue.push(entry);
    }
    syncJobs.delete(job.id);
  }
  const result = await processSync(config);
  res.json({ success: true, job: result });
});

/* ── GET /api/sync/jobs ────────────────────────────── */
router.get('/jobs', (_req, res) => {
  res.json(syncJobs.list());
});

export default router;
