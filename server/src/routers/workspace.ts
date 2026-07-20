import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { detectGitRepository } from '../utils/workspaceValidation.js';

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

export default router;
