import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { detectGitRepository } from '../utils/workspaceValidation.js';
import {
  getWorkspaceRoot, setWorkspaceRoot, resolveWorkspacePath,
  resolveFileReference, searchWorkspaceFiles, workspaceSelectionFile,
} from '../services/workspaceStore.js';

const router = Router();

router.post('/detect', (req, res) => {
  try {
    let { basePath } = req.body;
    
    // Default to the server's working directory if not provided
    if (!basePath) {
      basePath = process.cwd();
    }
    
    const { isValid, targetPath, gitRoot, errorMessage } = detectGitRepository(basePath);

    return res.json({
      isValid,
      cwd: process.cwd(),
      targetPath,
      gitRoots: gitRoot ? [gitRoot] : [],
      errorMessage
    });
    
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ── Canonical workspace (§1): ONE authoritative root for all agents ── */

router.get('/current', (_req, res) => {
  const workspaceRoot = getWorkspaceRoot();
  res.json({
    workspaceRoot,
    exists: workspaceRoot ? fs.existsSync(workspaceRoot) : false,
    selectionFile: workspaceSelectionFile(),
  });
});

router.post('/select', (req, res) => {
  const root = typeof req.body?.workspaceRoot === 'string'
    ? req.body.workspaceRoot
    : typeof req.body?.workspacePath === 'string' ? req.body.workspacePath : '';
  const result = setWorkspaceRoot(root);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/* ── File resolution (§4–§7): resolve before delegation, truthful errors ── */

router.post('/resolve-file', (req, res) => {
  const candidate = typeof req.body?.path === 'string' ? req.body.path
    : typeof req.body?.file === 'string' ? req.body.file : '';
  if (!candidate.trim()) return res.status(400).json({ error: 'path is required' });
  const result = resolveFileReference(candidate);
  res.json(result);
});

router.post('/search-files', (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query : '';
  if (!query.trim()) return res.status(400).json({ error: 'query is required' });
  const result = searchWorkspaceFiles(query);
  res.json(result);
});

router.post('/resolve-path', (req, res) => {
  const candidate = typeof req.body?.path === 'string' ? req.body.path : '';
  if (!candidate.trim()) return res.status(400).json({ error: 'path is required' });
  const resolved = resolveWorkspacePath(candidate);
  const root = getWorkspaceRoot();
  res.json({ resolved, workspaceRoot: root, isInsideWorkspace: resolved && root ? path.relative(root, resolved).startsWith('..') === false : false });
});

export default router;
