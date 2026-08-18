import { logger } from '../utils/logger.js';
import { Router } from 'express';
import { coordinatorService } from '../domains/teams/coordinatorService.js';
import { db } from '../db/index.js';
import { teams } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { TeamRunner } from '../services/agentTeams/teamRunner.js';
import { teamRuns } from '../db/schema.js';
import { goalStore } from '../services/goalStore.js';

const router = Router();

/* ── POST /api/teams/preview ─────────────────────────────
   Coordinator creates the team sheet and returns it for human approval. */
router.post('/preview', async (req, res) => {
  try {
    const { prompt, workspacePath } = req.body;
    if (!prompt || !workspacePath) {
      return res.status(400).json({ error: 'prompt and workspacePath are required' });
    }

    const { teamId, teamSheet, markdown } = await coordinatorService.createTeam(prompt, workspacePath);
    res.json({ teamId, teamSheet, markdown });
  } catch (err: any) {
    if (err.name === 'LLMSchemaValidationError') {
      logger.error('LLM_SCHEMA_VALIDATION_FAILED:', err.message, err.issues);
      return res.status(422).json({
        error: 'LLM_SCHEMA_VALIDATION_FAILED',
        message: err.message,
        attempts: err.attempts,
        issues: err.issues
      });
    }
    logger.error('ERROR IN /api/teams/preview:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/teams/:id ──────────────────────────────────
   Get the team details. */
router.get('/:id', (req, res) => {
  try {
    const teamId = req.params.id;
    const team = db.select().from(teams).where(eq(teams.id, teamId)).get();
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json(team);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/teams/:id/start ───────────────────────────
   Start a new team run. */
router.post('/:id/start', async (req, res) => {
  try {
    const teamId = req.params.id;
    const runId = await TeamRunner.startTeam(teamId);
    res.json({ runId });
  } catch (err: any) {
    logger.error(`ERROR starting team ${req.params.id}:`, err);
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/teams/runs/:runId/pause ───────────────────
   Pause an active team run. */
router.post('/runs/:runId/pause', async (req, res) => {
  try {
    const runId = req.params.runId;
    await TeamRunner.pauseTeam(runId);
    res.json({ status: 'paused' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/teams/runs/:runId/resume ──────────────────
   Resume a paused team run. */
router.post('/runs/:runId/resume', async (req, res) => {
  try {
    const runId = req.params.runId;
    await TeamRunner.resumeTeam(runId);
    res.json({ status: 'resumed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/teams/runs/:runId ────────────────────────── */
router.get('/runs/:runId', (req, res) => {
  try {
    const runId = req.params.runId;
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/teams/runs/:runId/events ─────────────────── */
router.get('/runs/:runId/events', (req, res) => {
  try {
    const runId = req.params.runId;
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) return res.status(404).json({ error: 'Run not found' });
    
    if (run.goalId) {
      const goal = goalStore.get(run.goalId);
      res.json(goal ? goal.history : []);
    } else {
      res.json([]);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
/* ── GET /api/teams ──────────────────────────────────────
   Get all teams. */
router.get('/', (req, res) => {
  try {
    const allTeams = db.select().from(teams).all();
    res.json(allTeams);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/teams/runs/:runId/handoffs ───────────────── */
router.get('/runs/:runId/handoffs', (req, res) => {
  try {
    const runId = req.params.runId;
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) return res.status(404).json({ error: 'Run not found' });
    
    // We import agentTeamHandoffs at the top if needed, or query it here:
    import('../db/schema.js').then(({ agentTeamHandoffs }) => {
      const handoffs = db.select().from(agentTeamHandoffs)
        .where(eq(agentTeamHandoffs.goalId, run.goalId || ''))
        .all();
      res.json(handoffs);
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
export default router;

/* -- GET /api/teams/runs/:runId/artifacts ----------------- */
router.get('/runs/:runId/artifacts', (req, res) => {
  try {
    const runId = req.params.runId;
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) return res.status(404).json({ error: 'Run not found' });
    
    import('../db/schema.js').then(({ agentTeamArtifacts }) => {
      const artifacts = db.select().from(agentTeamArtifacts)
        .where(eq(agentTeamArtifacts.runId, runId))
        .all();
      res.json({
        runId,
        teamId: run.teamId,
        artifacts
      });
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* -- GET /api/teams/runs/:runId/reports ----------------- */
router.get('/runs/:runId/reports', (req, res) => {
  try {
    const runId = req.params.runId;
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) return res.status(404).json({ error: 'Run not found' });
    
    import('../db/schema.js').then(({ verificationReports }) => {
      const reports = db.select().from(verificationReports)
        .where(eq(verificationReports.runId, runId))
        .all();
      res.json({
        runId,
        teamId: run.teamId,
        reports
      });
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* -- GET /api/teams/:id/runs -----------------------------
   Get all runs for a team. */
router.get('/:id/runs', (req, res) => {
  try {
    const teamId = req.params.id;
    const runs = db.select().from(teamRuns).where(eq(teamRuns.teamId, teamId)).all();
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
