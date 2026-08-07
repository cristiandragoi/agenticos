import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { db } from '../db/index.js';
import { agentProviderAssignments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { diagnosticsStore } from '../services/diagnosticsStore.js';

const router = Router();

const getReportDir = () => path.join(process.cwd(), '.agentos', 'diagnostics');
const getLatestReportPath = () => path.join(getReportDir(), 'latest.json');

router.get('/summary', (req: Request, res: Response) => {
  try {
    const reportPath = getLatestReportPath();
    if (fs.existsSync(reportPath)) {
      const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      res.json(data);
    } else {
      res.status(404).json({ error: 'No diagnostic report found. Run diagnostics first.' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/run', (req: Request, res: Response) => {
  // We run the CLI script as a child process so it exactly mirrors the CLI experience
  const scriptPath = path.join(process.cwd(), 'src', 'scripts', 'agenticos-doctor.ts');
  const cmd = fs.existsSync(scriptPath) ? `npx tsx ${scriptPath}` : 'npm run doctor';
  
  exec(cmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
    // We ignore the exit code (since Broken reports exit 1) and just return the latest report
    try {
      const reportPath = getLatestReportPath();
      if (fs.existsSync(reportPath)) {
        const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        res.json(data);
      } else {
        res.status(500).json({ error: 'Diagnostic script failed to produce a report.', stdout, stderr });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message, stdout, stderr });
    }
  });
});

router.post('/repair/:repairId', async (req: Request, res: Response) => {
  const { repairId } = req.params;
  
  try {
    if (repairId === 'fix-codex-assignment') {
      const { newModelId, newProviderId } = req.body;
      if (!newModelId || !newProviderId) {
        return res.status(400).json({ error: 'newModelId and newProviderId required' });
      }
      
      const existing = await db.select().from(agentProviderAssignments).where(eq(agentProviderAssignments.agentId, 'agent-codex')).execute();
      
      const backupDir = path.join(getReportDir(), 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, `agent-codex-assignment-${Date.now()}.json`), JSON.stringify(existing, null, 2));
      
      const now = new Date().toISOString();
      await db.insert(agentProviderAssignments).values({
        agentId: 'agent-codex',
        providerId: newProviderId,
        modelId: newModelId,
        routingMode: 'preferred',
        enabled: true,
        createdAt: now,
        updatedAt: now
      }).onConflictDoUpdate({
        target: agentProviderAssignments.agentId,
        set: {
          providerId: newProviderId,
          modelId: newModelId,
          routingMode: 'preferred',
          updatedAt: now
        }
      }).execute();
      
      return res.json({ success: true, message: 'CodeX assignment repaired safely. Backup created.' });
    }
    
    res.status(400).json({ error: 'Unknown repair ID' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

/**
 * Read-only UI diagnostics bridge — the FRONTEND reports what it renders.
 * Reporting-only; the backend/runtime remains authoritative.
 */
router.post('/ui-snapshot', (req: Request, res: Response) => {
  const snapshot = req.body;
  if (!snapshot || typeof snapshot !== 'object') {
    res.status(400).json({ error: 'snapshot object required' });
    return;
  }
  diagnosticsStore.setUiSnapshot(snapshot as any);
  res.json({ ok: true, receivedVersion: snapshot.version ?? 0 });
});

router.get('/ui-snapshot', (_req: Request, res: Response) => {
  res.json(diagnosticsStore.getUiSnapshot() || { available: false });
});
