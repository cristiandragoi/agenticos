/**
 * projectExecution.ts router
 *
 * Project execution API — Goals, Tasks, Runs, Results, Verifications.
 *
 * Routes:
 *   POST   /api/project-execution/:projectId/goals
 *   GET    /api/project-execution/:projectId/goals
 *   GET    /api/project-execution/:projectId/goals/:goalId
 *   POST   /api/project-execution/:projectId/goals/:goalId/tasks
 *   GET    /api/project-execution/:projectId/goals/:goalId/tasks
 *   GET    /api/project-execution/:projectId/goals/:goalId/tree
 *   GET    /api/project-execution/:projectId/tree
 *   POST   /api/project-execution/:projectId/tasks/:taskId/runs
 *   GET    /api/project-execution/:projectId/tasks/:taskId/runs
 *   GET    /api/project-execution/:projectId/tasks/:taskId/runs/:runId
 *   GET    /api/project-execution/:projectId/tasks/:taskId/runs/:runId/result
 *   POST   /api/project-execution/:projectId/tasks/:taskId/runs/:runId/verify
 *   GET    /api/project-execution/:projectId/tasks/:taskId/verifications
 *   GET    /api/project-execution/:projectId/activity
 *   GET    /api/project-execution/workers/capabilities
 */

import { Router, Request, Response } from 'express';
import { projectTaskService } from '../services/projectExecution/projectTaskService.js';
import { executionRunService } from '../services/projectExecution/executionRunService.js';
import { verificationService } from '../services/projectExecution/verificationService.js';
import { executeCodexTask, executeMagnitudeTask, WORKER_CAPABILITY_REGISTRY } from '../domains/workerAdapters/index.js';
import { classifyAction } from '../services/actionClassifier.js';
import type { WorkerType } from '../services/projectExecution/schema.js';

const router = Router({ mergeParams: true });

// ── Worker Capabilities ────────────────────────────────────────────────────

router.get('/workers/capabilities', (_req: Request, res: Response) => {
  res.json({ capabilities: WORKER_CAPABILITY_REGISTRY });
});

// ── Goals ─────────────────────────────────────────────────────────────────

router.post('/:projectId/goals', (req: Request, res: Response) => {
  try {
    const { title, objective, priority, successCriteria, createdBy, goalId, metadata } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const goal = projectTaskService.createGoal({
      projectId: req.params.projectId,
      title,
      objective,
      priority,
      successCriteria,
      createdBy,
      goalId,
      metadata,
    });
    res.json(goal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/goals', (req: Request, res: Response) => {
  try {
    const goals = projectTaskService.listGoals(req.params.projectId);
    res.json(goals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/goals/:goalId', (req: Request, res: Response) => {
  try {
    const goal = projectTaskService.getGoal(req.params.goalId);
    if (!goal || goal.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    res.json(goal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────

router.post('/:projectId/goals/:goalId/tasks', (req: Request, res: Response) => {
  try {
    const { title, description, taskType, assignedCapability, parentTaskId, priority,
      dependencyIds, acceptanceCriteria, approvalRequired, metadata } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const task = projectTaskService.createTask({
      projectId: req.params.projectId,
      goalId: req.params.goalId,
      title,
      description,
      taskType,
      assignedCapability: assignedCapability as WorkerType | undefined,
      parentTaskId,
      priority,
      dependencyIds,
      acceptanceCriteria,
      approvalRequired,
      metadata,
    });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/goals/:goalId/tasks', (req: Request, res: Response) => {
  try {
    const tasks = projectTaskService.listTasks(req.params.goalId);
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/goals/:goalId/tree', (req: Request, res: Response) => {
  try {
    const goal = projectTaskService.getGoal(req.params.goalId);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    const tree = projectTaskService.getTaskTree(req.params.goalId);
    res.json({ goal, tasks: tree });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Full Project Tree ──────────────────────────────────────────────────────

router.get('/:projectId/tree', (req: Request, res: Response) => {
  try {
    const goals = projectTaskService.listGoals(req.params.projectId);
    const tree = goals.map(goal => {
      const tasks = projectTaskService.getTaskTree(goal.id);
      const tasksWithRuns = tasks.map(task => {
        const runs = executionRunService.listRunsForTask(task.id);
        const runsWithResults = runs.map(run => {
          const result = run.finalResultId
            ? executionRunService.getResult(run.finalResultId)
            : null;
          const verification = verificationService.getVerificationForRun(run.id);
          return { ...run, result, verification };
        });
        const children = task.children.map((child: any) => {
          const childRuns = executionRunService.listRunsForTask(child.id);
          return { ...child, runs: childRuns };
        });
        return { ...task, children, runs: runsWithResults };
      });
      return { ...goal, tasks: tasksWithRuns };
    });
    res.json({ projectId: req.params.projectId, goals: tree });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Runs ──────────────────────────────────────────────────────────────────

router.post('/:projectId/tasks/:taskId/runs', async (req: Request, res: Response) => {
  try {
    const { workerType, prompt, conversationId, requestId, workspacePath, approved } = req.body;
    const task = projectTaskService.getTask(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const effectiveWorker: WorkerType = workerType ?? task.assignedCapability ?? 'codex';

    // Safety classification before creating a run
    const description = prompt ?? task.description ?? task.title;
    const { permitted, classification } = classifyAction(description, effectiveWorker, approved ?? false)
      ? { permitted: true, classification: classifyAction(description, effectiveWorker, approved ?? false) }
      : { permitted: false, classification: classifyAction(description, effectiveWorker, approved ?? false) };

    // Re-classify properly
    const cls = classifyAction(description, effectiveWorker, approved ?? false);
    if (cls.blocked) {
      return res.status(403).json({
        error: `Execution blocked: ${cls.reason}`,
        actionClass: cls.actionClass,
        requiresApproval: cls.requiresApproval,
      });
    }

    let result: any;
    if (effectiveWorker === 'codex') {
      result = await executeCodexTask(task, { workspacePath, conversationId, requestId });
    } else if (effectiveWorker === 'magnitude') {
      result = await executeMagnitudeTask(task, { goal: prompt, conversationId, requestId, approved });
    } else {
      // Generic fallback: just create the run record
      const run = executionRunService.createRun({
        taskId: task.id,
        projectId: task.projectId,
        goalId: task.goalId,
        workerType: effectiveWorker,
        trigger: 'api',
        requestId,
        conversationId,
      });
      result = { run };
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/tasks/:taskId/runs', (req: Request, res: Response) => {
  try {
    const runs = executionRunService.listRunsForTask(req.params.taskId);
    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/tasks/:taskId/runs/:runId', (req: Request, res: Response) => {
  try {
    const run = executionRunService.getRun(req.params.runId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const result = run.finalResultId ? executionRunService.getResult(run.finalResultId) : null;
    const events = executionRunService.listEventsForRun(run.id);
    const verification = verificationService.getVerificationForRun(run.id);
    res.json({ run, result, events, verification });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/tasks/:taskId/runs/:runId/result', (req: Request, res: Response) => {
  try {
    const run = executionRunService.getRun(req.params.runId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const result = run.finalResultId ? executionRunService.getResult(run.finalResultId) : null;
    if (!result) return res.status(404).json({ error: 'No result available yet' });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:projectId/tasks/:taskId/runs/:runId/result', (req: Request, res: Response) => {
  try {
    const run = executionRunService.getRun(req.params.runId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: 'Run not found' });
    }
    const { status, summary, structuredOutput, artifactRefs, metadata } = req.body;
    const result = executionRunService.createResult({
      runId: run.id,
      taskId: req.params.taskId,
      status: status ?? 'completed',
      summary: summary ?? 'Task completed',
      structuredOutput,
      artifactRefs,
      metadata,
    });
    executionRunService.updateRun(run.id, {
      status: status ?? 'completed',
      endTime: new Date().toISOString(),
    });
    projectTaskService.updateTask(req.params.taskId, {
      status: status ?? 'completed',
      completedAt: new Date().toISOString(),
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Verifications ─────────────────────────────────────────────────────────

router.post('/:projectId/tasks/:taskId/runs/:runId/verify', async (req: Request, res: Response) => {
  try {
    const run = executionRunService.getRun(req.params.runId);
    if (!run || run.taskId !== req.params.taskId) {
      return res.status(404).json({ error: 'Run not found' });
    }
    if (run.status !== 'completed') {
      return res.status(400).json({ error: `Run is not completed (status: ${run.status})` });
    }
    const resultRecord = run.finalResultId
      ? executionRunService.getResult(run.finalResultId)
      : null;
    if (!resultRecord) {
      return res.status(400).json({ error: 'No result found for this run' });
    }

    const task = projectTaskService.getTask(req.params.taskId);
    const goal = task ? projectTaskService.getGoal(task.goalId) : null;

    const verification = await verificationService.verify({
      taskId: req.params.taskId,
      targetRunId: req.params.runId,
      projectId: req.params.projectId,
      goalId: run.goalId,
      objective: req.body.objective ?? goal?.objective ?? task?.title ?? 'Task completion',
      acceptanceCriteria: req.body.acceptanceCriteria ?? task?.acceptanceCriteria ?? null,
      workerResult: resultRecord,
      workerRun: run,
    });

    res.json(verification);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:projectId/tasks/:taskId/verifications', (req: Request, res: Response) => {
  try {
    const verifications = verificationService.listVerificationsForTask(req.params.taskId);
    res.json(verifications);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Activity Feed ─────────────────────────────────────────────────────────

router.get('/:projectId/activity', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string || '50', 10);
    const events = executionRunService.listEventsForProject(req.params.projectId, limit);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
