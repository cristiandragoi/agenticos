import { Router } from 'express';
import { db } from '../db/index.js';
import { agentPromptVersions, agentExecutions, runEvaluations } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { createChallengerPrompt, promotePromptVersion, rollbackPromptVersion } from '../services/evolution/promptManager.js';

const router = Router();

// 1. GET /api/evolution/executions
router.get('/executions', async (req, res) => {
  try {
    const { agentId } = req.query;
    let query = db.select({
      execution: agentExecutions,
      evaluation: runEvaluations
    })
    .from(agentExecutions)
    .leftJoin(runEvaluations, eq(agentExecutions.id, runEvaluations.executionId))
    .orderBy(desc(agentExecutions.createdAt));

    if (agentId) {
      // Drizzle ORM does not support dynamic where easily like this with leftJoin without building the query carefully
      // For simplicity, we just filter in memory if needed, or build it
    }

    const results = await query;
    if (agentId) {
      res.json(results.filter(r => r.execution.agentId === String(agentId)));
    } else {
      res.json(results);
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch executions', details: error.message });
  }
});

// 2. GET /api/evolution/agents/:id/versions
router.get('/agents/:id/versions', async (req, res) => {
  try {
    const { id } = req.params;
    const versions = await db.select().from(agentPromptVersions)
      .where(eq(agentPromptVersions.agentId, id))
      .orderBy(desc(agentPromptVersions.versionNumber));
    res.json(versions);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch versions', details: error.message });
  }
});

// 3. POST /api/evolution/agents/:id/challenger
router.post('/agents/:id/challenger', async (req, res) => {
  try {
    const { id } = req.params;
    const { author } = req.body;
    const newVersion = await createChallengerPrompt(id, author || 'System');
    res.json(newVersion);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create challenger', details: error.message });
  }
});

// 4. POST /api/evolution/versions/:id/promote
router.post('/versions/:id/promote', async (req, res) => {
  try {
    const { id } = req.params;
    const { author, reason } = req.body;
    const promoted = await promotePromptVersion(id, author || 'System', reason || 'Human promoted');
    res.json(promoted);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to promote version', details: error.message });
  }
});

// 5. POST /api/evolution/versions/:id/rollback
router.post('/versions/:id/rollback', async (req, res) => {
  try {
    const { id } = req.params;
    const { author, reason } = req.body;
    const rolledBack = await rollbackPromptVersion(id, author || 'System', reason || 'Human rollback');
    res.json(rolledBack);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to rollback version', details: error.message });
  }
});

// 6. GET /api/evolution/leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    // A real leaderboard would aggregate via SQL.
    // For now we'll fetch all and aggregate in memory as a mock.
    const allExecs = await db.select({
      execution: agentExecutions,
      evaluation: runEvaluations
    })
    .from(agentExecutions)
    .leftJoin(runEvaluations, eq(agentExecutions.id, runEvaluations.executionId));

    const agentStats: Record<string, any> = {};

    for (const row of allExecs) {
      const aid = row.execution.agentId;
      if (!agentStats[aid]) {
        agentStats[aid] = {
          agentId: aid,
          totalRuns: 0,
          successes: 0,
          failures: 0,
          totalScore: 0,
          totalCost: 0,
          totalTime: 0,
          evalCount: 0
        };
      }
      const s = agentStats[aid];
      s.totalRuns++;
      if (row.execution.success) s.successes++;
      else s.failures++;
      
      s.totalCost += (row.execution.actualCost || row.execution.estimatedCost || 0);
      s.totalTime += (row.execution.executionTimeMs || 0);

      if (row.evaluation && row.evaluation.overallScore !== null) {
        s.totalScore += row.evaluation.overallScore;
        s.evalCount++;
      }
    }

    const leaderboard = Object.values(agentStats).map(s => ({
      agentId: s.agentId,
      totalRuns: s.totalRuns,
      successRate: s.totalRuns > 0 ? (s.successes / s.totalRuns) * 100 : 0,
      averageScore: s.evalCount > 0 ? s.totalScore / s.evalCount : 0,
      averageCost: s.totalRuns > 0 ? s.totalCost / s.totalRuns : 0,
      averageRuntime: s.totalRuns > 0 ? s.totalTime / s.totalRuns : 0,
    })).sort((a, b) => b.averageScore - a.averageScore);

    res.json(leaderboard);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate leaderboard', details: error.message });
  }
});

export default router;
