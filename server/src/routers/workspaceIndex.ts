/**
 * WorkspaceIndexer V1 — REST surface (diagnostic API, no UI in this pass).
 *
 * GET  /api/workspace-index/status          index status + stats
 * POST /api/workspace-index/index           refresh (initial + incremental)
 * GET  /api/workspace-index/search          bounded evidence search
 * POST /api/workspace-index/clear           clear the workspace index
 *
 * The API NEVER accepts an arbitrary filesystem root: workspace resolution
 * comes from the authoritative project/workspace store (P9/P10).
 */
import { Router } from 'express';
import {
  searchWorkspace, indexWorkspace, clearWorkspaceIndex, getIndexStatus,
  type WorkspaceSearchMode,
} from '../services/workspaceIndexer.js';

const router = Router();

router.get('/status', (req, res) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    res.json(getIndexStatus({ projectId }));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'workspace index status unavailable' });
  }
});

router.post('/index', (req, res) => {
  try {
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null;
    const stats = indexWorkspace({ projectId });
    if (stats.error) {
      res.status(422).json(stats);
      return;
    }
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'workspace index failed' });
  }
});

router.post('/clear', (req, res) => {
  try {
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : null;
    const result = clearWorkspaceIndex({ projectId });
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'workspace index clear failed' });
  }
});

router.get('/search', (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      res.status(400).json({ error: 'Missing q (search query).' });
      return;
    }
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    const mode = (typeof req.query.mode === 'string' ? req.query.mode : 'auto') as WorkspaceSearchMode;
    if (!['auto', 'exact', 'text'].includes(mode)) {
      res.status(400).json({ error: `mode must be auto|exact|text (got "${mode}")` });
      return;
    }
    const limit = typeof req.query.limit === 'string' ? Math.max(1, Math.min(parseInt(req.query.limit, 10) || 25, 100)) : undefined;
    const fileTypes = typeof req.query.fileTypes === 'string' && req.query.fileTypes
      ? req.query.fileTypes.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const pathPrefix = typeof req.query.pathPrefix === 'string' && req.query.pathPrefix
      ? req.query.pathPrefix : undefined;

    const resp = searchWorkspace({ projectId, query: q, mode, limit, fileTypes, pathPrefix });
    if (resp.error && resp.results.length === 0) {
      res.status(resp.error === 'No workspace selected/configured.' ? 422 : 500).json(resp);
      return;
    }
    res.json(resp);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'workspace search failed' });
  }
});

export default router;
