import { logger } from '../../utils/logger.js';
import { db } from '../../db/index.js';
import { teams, teamRuns, agentTeamHandoffs, verificationReports, agentTeamArtifacts } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { goalStore } from '../goalStore.js';
import { AgentRunner } from './agentRunner.js';
import { adjudicateVerificationPass, adjudicateVerificationReport, type ReportAdjudicationResult } from './verificationAdjudicator.js';
import { findRepairTarget } from './repairRouting.js';
import { randomUUID } from 'crypto';
import crypto from 'crypto';
import type { AgentExecutionContext } from '../../types.js';

export const AgentHandoffSchema = z.object({
  agentId: z.string(),
  status: z.enum(['completed', 'failed', 'blocked']),
  summary: z.string(),
  decisions: z.array(z.any()).optional().default([]),
  artifacts: z.array(z.object({
    path: z.string(),
    checksum: z.string(),
    checksumAlgorithm: z.literal('sha256'),
    size: z.number().positive(),
    producedBy: z.string()
  })).optional().default([]),
  openIssues: z.array(z.any()).optional().default([]),
  recommendedNextActions: z.array(z.any()).optional().default([]),
  createdAt: z.string().optional()
});

/**
 * LLMs emit blocking issues both as plain strings and as structured objects
 * ({ name, evidence, passed }). Accept both and normalize to strings so a
 * well-formed report is never rejected for format alone.
 */
const issueList = (schemaName: string) => z.array(
  z.union([
    z.string(),
    z.object({
      name: z.string(),
      evidence: z.string().optional(),
      passed: z.boolean().optional()
    }).transform(o => o.evidence ? `${o.name} — ${o.evidence}` : o.name)
  ])
);

export const VerificationReportSchema = z.object({
  passed: z.boolean(),
  summary: z.string(),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    command: z.string().optional(),
    evidence: z.string(),
    path: z.string().optional(),
    expectedContent: z.string().optional(),
    expectedSha256: z.string().optional()
  })),
  blockingIssues: issueList('blockingIssues'),
  recommendedFixes: issueList('recommendedFixes'),
  completedAt: z.string().optional()
});

export const CheckpointSchema = z.object({
  checkpointVersion: z.literal(1),
  teamId: z.string(),
  goalId: z.string(),
  currentStep: z.number(),
  activeAgentId: z.string().nullable(),
  completedAgentIds: z.array(z.string()),
  artifactMetadata: z.array(z.any()),
  lastEventSequence: z.number(),
  databaseRevision: z.number(),
  repairCount: z.number(),
  createdAt: z.string()
});

function parseJSONField(value: any) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  return [];
}

async function createContext(teamId: string, teamSheet: any, agentId: string, originalGoal: string, runId: string, goalId: string): Promise<import('../../types.js').AgentExecutionContext> {
  const agent = teamSheet.agents.find((a: any) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found in team`);
  
  const handoffsRecords = db.select().from(agentTeamHandoffs).where(eq(agentTeamHandoffs.goalId, goalId)).all();
  
  const handoffs: import('../../types.js').AgentHandoff[] = [];
  const dependencyArtifacts: Array<{ path: string; checksum: string; size: number; producedBy: string }> = [];

  // When several handoffs reference the same artifact path (e.g. an initial
  // build and a later repair), only the LATEST declaration is authoritative —
  // repairs legitimately supersede older bytes on disk.
  const latestArtifactByPath = new Map<string, any>();
  for (const record of handoffsRecords) {
    for (const art of parseJSONField(record.artifacts)) {
      if (art?.path) latestArtifactByPath.set(art.path, art);
    }
  }

  for (const record of handoffsRecords) {
    const obj = {
      agentId: record.agentId,
      status: record.status,
      summary: record.summary,
      decisions: parseJSONField(record.decisions),
      artifacts: parseJSONField(record.artifacts),
      openIssues: parseJSONField(record.openIssues),
      recommendedNextActions: parseJSONField(record.recommendedNextActions),
      createdAt: record.createdAt
    };
    
    const parsed = AgentHandoffSchema.parse(obj) as import('../../types.js').AgentHandoff;
    handoffs.push(parsed);
    
    if (parsed.artifacts) {
      for (const art of parsed.artifacts) {
        // Skip superseded declarations: only the latest handoff for a path is verified.
        const latest = latestArtifactByPath.get(art.path);
        if (latest && latest.checksum !== art.checksum) continue;

        // Recompute actual checksum
        let actualChecksum = art.checksum;
        let actualSize = art.size;
        try {
          const content = fs.readFileSync(path.join(teamSheet.workspaceRoot || '', art.path));
          actualSize = content.length;
          actualChecksum = crypto.createHash('sha256').update(content).digest('hex');
        } catch (e) {
          throw new Error(`Failed to verify artifact ${art.path} during context reconstruction`);
        }
        
        if (actualChecksum !== art.checksum) throw new Error(`Checksum mismatch for ${art.path}`);
        if (actualSize === 0) throw new Error(`Artifact ${art.path} is empty`);
        
        dependencyArtifacts.push({
          path: art.path,
          checksum: actualChecksum,
          size: actualSize,
          producedBy: parsed.agentId
        });
      }
    }
  }

  return {
    runId,
    teamId,
    agentId,
    role: agent.role,
    instructions: agent.instructions,
    responsibilities: agent.responsibilities || [],
    acceptanceCriteria: teamSheet.objective?.split('\n') || [],
    workspaceRoot: teamSheet.workspaceRoot || '',
    allowedTools: agent.allowedTools.map((t: string) => t === 'write_file' ? 'writeFile' : t === 'read_file' ? 'readFile' : t === 'terminal' ? 'runCommand' : t).concat(['finish']),
    readScopes: agent.readScopes,
    writeScopes: agent.writeScopes,
    dependencyArtifacts,
    handoffs,
    approvalPolicy: teamSheet.approvalPolicy || 'manual',
    isTeamExecution: true
  };
}

export class TeamRunner {
  private static activeListeners: Map<string, (goal: any) => void> = new Map();

  static async startTeam(teamId: string): Promise<string> {
    const team = db.select().from(teams).where(eq(teams.id, teamId)).get();
    if (!team) throw new Error(`Team ${teamId} not found`);

    const teamSheet: any = team.teamSheet;
    if (!teamSheet.executionSequence || teamSheet.executionSequence.length === 0) {
      throw new Error(`Team ${teamId} has no execution sequence`);
    }

    const goalId = randomUUID();
    goalStore.create({
      id: goalId,
      originalGoal: teamSheet.objective,
      status: 'queued',
      retryCount: 0,
      providerFallbackCount: 0,
      history: [],
      createdAt: Date.now().toString(),
      updatedAt: Date.now().toString()
    });

    const runId = randomUUID();
    db.insert(teamRuns).values({
      id: runId,
      teamId: teamId,
      status: 'running',
      currentAgent: teamSheet.executionSequence[0],
      currentStep: 0,
      goalId: goalId,
      createdAt: Date.now().toString(),
      updatedAt: Date.now().toString()
    }).run();

    // Update the team's status
    db.update(teams).set({ status: 'running' }).where(eq(teams.id, teamId)).run();

    this.attachGoalListener(runId, goalId);

    const firstAgentId = teamSheet.executionSequence[0];
    const firstAgent = teamSheet.agents.find((a: any) => a.id === firstAgentId);
    const context = await createContext(teamId, teamSheet, firstAgentId, teamSheet.objective, runId, goalId);
    
    // Add initialization event using EventWriter pattern
    const writer = goalStore.createEventWriter({ goalId, teamId, agentId: firstAgentId });
    writer.push({
      state: 'agent_started',
      message: `Team Run started. Handoff to ${firstAgentId}`,
      eventType: 'agent_started',
      normalizedStatus: 'active',
      lifecycleState: 'running'
    });

    await AgentRunner.startAgent(goalId, context);
    
    return runId;
  }

  /**
   * Resume a paused run safely.
   * - Exactly one new attempt per call (guarded by the paused→running transition).
   * - When the pause came from a failed verification/adjudication and the repair
   *   budget allows, the resume is routed as a REPAIR to the correct Builder
   *   (by role) with the real blocking issues — not blindly to the agent that
   *   happened to be current (often the Verifier, which would just fail again).
   * - A goal purged from the goals table is recreated so the loop and the
   *   listener have something to attach to.
   */
  static async resumeTeam(runId: string) {
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== 'paused' && run.status !== 'pending') throw new Error(`Run is ${run.status}`);

    const team = db.select().from(teams).where(eq(teams.id, run.teamId)).get();
    const teamSheet: any = team?.teamSheet;
    if (!teamSheet) throw new Error(`Team ${run.teamId} has no team sheet`);

    const goalId = run.goalId || randomUUID();

    // Recreate a purged goal so resumeCodexGoalLoop does not silently no-op.
    if (!goalStore.get(goalId)) {
      goalStore.create({
        id: goalId,
        originalGoal: teamSheet.objective,
        status: 'queued',
        retryCount: 0,
        providerFallbackCount: 0,
        history: [],
        createdAt: Date.now().toString(),
        updatedAt: Date.now().toString()
      });
    }

    // Parse the stored adjudicated report (tolerate double-encoded legacy rows).
    let storedReport: any = null;
    try {
      let raw: any = run.verificationReport;
      if (typeof raw === 'string') raw = JSON.parse(raw);
      if (typeof raw === 'string') raw = JSON.parse(raw);
      storedReport = raw;
    } catch { storedReport = null; }

    const sequence: string[] = teamSheet.executionSequence || [];
    let targetAgentId = run.currentAgent || sequence[0];
    let targetStep = run.currentStep || 0;
    let isRepairResume = false;
    let repairContext: any = null;

    if (storedReport && storedReport.passed === false && run.repairCount < 1) {
      const target = findRepairTarget(teamSheet, []);
      if (target && target.index !== -1) {
        targetAgentId = sequence[target.index];
        targetStep = target.index;
        isRepairResume = true;
        repairContext = {
          blockingIssues: (storedReport.blockingIssues || []).map(String),
          recommendedFixes: (storedReport.recommendedFixes || []).map(String),
          attempt: run.repairCount + 1
        };
      }
    }

    db.transaction((tx) => {
      tx.update(teamRuns).set({
        status: 'running',
        currentAgent: targetAgentId,
        activeAgentId: targetAgentId,
        currentStep: targetStep,
        goalId,
        repairCount: isRepairResume ? run.repairCount + 1 : run.repairCount,
        updatedAt: Date.now().toString()
      }).where(eq(teamRuns.id, runId)).run();
      tx.update(teams).set({ status: 'running', updatedAt: Date.now().toString() }).where(eq(teams.id, run.teamId)).run();
    });

    this.attachGoalListener(runId, goalId);
    const context = await createContext(run.teamId, teamSheet, targetAgentId, teamSheet.objective, runId, goalId);
    if (repairContext) context.repairContext = repairContext;

    const writer = goalStore.createEventWriter({ goalId, teamId: run.teamId, agentId: targetAgentId });
    writer.push({
      state: 'team_resumed',
      message: isRepairResume
        ? `Team resumed as repair attempt ${run.repairCount + 1} routed to ${targetAgentId}.`
        : 'Team execution resumed.',
      eventType: 'team_resumed',
      normalizedStatus: 'active',
      lifecycleState: 'running'
    });
    await AgentRunner.resumeAgent(goalId, context);
  }

  static async pauseTeam(runId: string) {
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (run && run.goalId) {
      await AgentRunner.pauseAgent(run.goalId);
      db.update(teamRuns).set({ status: 'paused', updatedAt: Date.now().toString() }).where(eq(teamRuns.id, runId)).run();
    }
    this.detachGoalListener(runId);
  }

  private static attachGoalListener(runId: string, goalId: string) {
    if (this.activeListeners.has(runId)) return;

    const listener = (goal: any) => {
      if (goal.id !== goalId) return;

      if (goal.status === 'completed') {
        this.handleAgentCompletion(runId, goalId).catch(logger.error);
      } else if (goal.status === 'failed') {
        db.update(teamRuns).set({ status: 'failed', updatedAt: Date.now().toString() }).where(eq(teamRuns.id, runId)).run();
        this.detachGoalListener(runId);
      }
    };

    goalStore.on('goal:updated', listener);
    this.activeListeners.set(runId, listener);
  }

  private static detachGoalListener(runId: string) {
    const listener = this.activeListeners.get(runId);
    if (listener) {
      goalStore.off('goal:updated', listener);
      this.activeListeners.delete(runId);
    }
  }

  private static async handleAgentCompletion(runId: string, goalId: string) {
    try {
      await this.processAgentCompletion(runId, goalId);
    } catch (err: any) {
      logger.error(`[TeamRunner] Agent completion handling failed for run ${runId}:`, err);
      await this.failRun(runId, goalId, err?.message || 'Agent completion handling failed');
    }
  }

  /**
   * Drive a run (and its team) to a truthful terminal 'failed' state with a
   * clear reason. Never leave a team stuck in 'running' after an internal error.
   */
  private static async failRun(runId: string, goalId: string, reason: string) {
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (run && !['completed', 'failed'].includes(run.status)) {
      db.transaction((tx) => {
        tx.update(teamRuns).set({ status: 'failed', updatedAt: Date.now().toString() }).where(eq(teamRuns.id, runId)).run();
        tx.update(teams).set({ status: 'failed', updatedAt: Date.now().toString() }).where(eq(teams.id, run.teamId)).run();
      });
    }
    try {
      const writer = goalStore.createEventWriter({ goalId, teamId: run?.teamId });
      writer.push({
        state: 'failed',
        message: `Team failed: ${reason}`,
        eventType: 'task_failed',
        normalizedStatus: 'failed',
        lifecycleState: 'failed',
        error: reason
      });
    } catch {}
    this.detachGoalListener(runId);
  }

  private static async processAgentCompletion(runId: string, goalId: string) {
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) return;

    const team = db.select().from(teams).where(eq(teams.id, run.teamId)).get();
    const teamSheet: any = team?.teamSheet;
    if (!teamSheet) return;

    const sequence = teamSheet.executionSequence as string[];
    const goal = goalStore.get(goalId);
    if (!goal) return;
    const finishEvent = goal.history.slice().reverse().find(e => e.tool === 'finish' || e.payload?.handoff);
    
    if (!finishEvent || !finishEvent.payload?.handoff) return;

    // Validate the AgentHandoff
    const rawHandoff = typeof finishEvent.payload.handoff === 'string' ? JSON.parse(finishEvent.payload.handoff) : finishEvent.payload.handoff;
    const handoff = AgentHandoffSchema.parse(rawHandoff) as import('../../types.js').AgentHandoff;

    // An attempt that declared failure must be treated as failed — never as a
    // quiet success. Its open issues become the repair instructions.
    const attemptDeclaredFailure = handoff.status === 'failed' || handoff.status === 'blocked';

    // Validate required artifacts & Recompute SHA-256 checksums from the actual files
    if (handoff.artifacts) {
      for (const art of handoff.artifacts) {
        let actualChecksum = '';
        let actualSize = 0;
        try {
          const content = fs.readFileSync(path.join(teamSheet.workspaceRoot || '', art.path));
          actualSize = content.length;
          actualChecksum = crypto.createHash('sha256').update(content).digest('hex');
        } catch (e) {
          throw new Error(`Failed to read artifact ${art.path} during checkpoint preparation`);
        }
        if (actualChecksum !== art.checksum) throw new Error(`Checksum mismatch for artifact ${art.path}`);
        if (actualSize === 0) throw new Error(`Artifact ${art.path} is empty`);
      }
    }

    let verificationReport: any = null;
    let isVerificationFailed = false;
    let adjudication: ReportAdjudicationResult | null = null;

    const currentAgentDef = teamSheet.agents.find((a: any) => a.id === run.currentAgent);
      if (currentAgentDef?.role === 'Verifier') {
        if (attemptDeclaredFailure) {
          // The Verifier itself failed: verification cannot pass. Use the
          // declared open issues as the blocking issues for repair.
          verificationReport = {
            passed: false,
            checks: [],
            evidence: handoff.summary || 'Verifier attempt declared failure.',
            blockingIssues: (handoff.openIssues || []).map(String).filter(Boolean).length > 0
              ? (handoff.openIssues || []).map(String)
              : [handoff.summary || 'Verifier attempt declared failure.'],
            recommendedFixes: (handoff.recommendedNextActions || []).map(String)
          };
          isVerificationFailed = true;
        } else if (!finishEvent.payload?.verificationReport) {
          logger.warn("[TeamRunner] Verifier finished without VerificationReport! Assuming failure.");
          verificationReport = {
            passed: false,
            checks: ['Check if the verification report was provided.'],
            evidence: 'Verifier omitted the required VerificationReport from the finish tool payload.',
            blockingIssues: ['Missing VerificationReport'],
            recommendedFixes: ['Use the verificationReport parameter in the finish tool.']
          };
          isVerificationFailed = true;
        } else {
          try {
            const rawReport = typeof finishEvent.payload.verificationReport === 'string' ? JSON.parse(finishEvent.payload.verificationReport) : finishEvent.payload.verificationReport;
            verificationReport = VerificationReportSchema.parse(rawReport) as import('../../types.js').VerificationReport;

            // Objective adjudication: a self-reported pass is only accepted when
            // every expected artifact exists and every path-based check matches
            // the real bytes / SHA-256 on disk. LLM claims are never trusted.
            adjudication = adjudicateVerificationReport(teamSheet, verificationReport, teamSheet.workspaceRoot || '');
            if (adjudication.overridden) {
              logger.warn('[TeamRunner] Verification pass overridden — objective checks failed:', adjudication.blockingIssues);
              verificationReport.passed = false;
              verificationReport.blockingIssues = [...(verificationReport.blockingIssues || []), ...adjudication.blockingIssues];
              verificationReport.recommendedFixes = [...(verificationReport.recommendedFixes || []), ...adjudication.recommendedFixes];
            }

            // Persist the adjudicated outcome (with objective evidence) so report
            // consumers always see the real result — pass or fail.
            db.insert(verificationReports).values({
              id: randomUUID(),
              runId: runId,
              teamId: run.teamId,
              goalId: goalId,
              verifierId: `${run.currentAgent}-adjudicated`,
              passed: verificationReport.passed,
              checks: verificationReport.checks || [],
              evidence: JSON.stringify(adjudication.evidence),
              blockingIssues: verificationReport.blockingIssues || [],
              recommendedFixes: verificationReport.recommendedFixes || [],
              createdAt: Date.now().toString()
            }).run();

            if (!verificationReport.passed) {
              isVerificationFailed = true;
            }
          } catch (e) {
            logger.error("[TeamRunner] Failed to parse VerificationReport:", e);
            verificationReport = {
              passed: false,
              checks: ['Parse VerificationReport'],
              evidence: `Failed to parse VerificationReport: ${e}`,
              blockingIssues: ['Invalid VerificationReport Format'],
              recommendedFixes: ['Ensure the VerificationReport strictly matches the schema.']
            };
            isVerificationFailed = true;
          }
        }
      }

    let nextStep = run.currentStep + 1;
    let nextAgentId = nextStep < sequence.length ? sequence[nextStep] : null;
    let repairRoutingFailure: string | null = null;

    // An attempt needs repair when verification failed OR the attempt itself
    // declared failure (e.g. Builder could not create its artifact).
    const attemptNeedsRepair = isVerificationFailed || attemptDeclaredFailure;

    if (attemptNeedsRepair) {
      if (run.repairCount < 1) {
        // Role-based repair routing: never depend on generated agent IDs.
        const target = findRepairTarget(teamSheet, adjudication?.missingArtifacts || []);
        if (target && target.index !== -1) {
          nextStep = target.index;
          nextAgentId = sequence[target.index];
          logger.info(`[TeamRunner] Repair routed to agent '${nextAgentId}' (${target.reason}).`);
        } else {
          repairRoutingFailure = 'Repair routing failed: no Builder/Implementer/Developer role and no agent declaring the failed artifacts exists in the team sheet.';
          nextAgentId = null;
        }
      } else {
        // Exceeded repair limit, pause safely
        nextAgentId = null;
      }
    }

    const dbRevision = (run.databaseRevision || 1) + 1;
    const chkSeq = (run.checkpointSequence || 0) + 1;
    
    // Determine completed agents (for simplicity, we assume previous agents in sequence are completed)
    const completedAgents = sequence.slice(0, run.currentStep + 1);

    // The checkpoint carries the run's accumulated verified artifacts — not
    // just the completing agent's (a Verifier finishes with none, and must not
    // erase the artifact evidence the Builder produced).
    const accumulatedArtifacts = db.select().from(agentTeamArtifacts).where(eq(agentTeamArtifacts.runId, runId)).all();
    const checkpointArtifacts = (handoff.artifacts && handoff.artifacts.length > 0)
      ? handoff.artifacts
      : accumulatedArtifacts.map(a => ({ path: a.path, checksum: a.checksum, checksumAlgorithm: 'sha256', size: a.size, producedBy: a.agentId }));

    const checkpointObj = {
      checkpointVersion: 1,
      teamId: run.teamId,
      goalId: goalId,
      currentStep: nextStep !== null ? nextStep : run.currentStep,
      activeAgentId: nextAgentId,
      completedAgentIds: completedAgents,
      artifactMetadata: checkpointArtifacts,
      lastEventSequence: goal.history[goal.history.length - 1]?.sequence || 0,
      databaseRevision: dbRevision,
      repairCount: attemptNeedsRepair && nextAgentId ? run.repairCount + 1 : run.repairCount,
      createdAt: new Date().toISOString()
    };
    
    const checkpoint = CheckpointSchema.parse(checkpointObj);

    const checkpointDir = path.join('.agentos', 'checkpoints', runId);
    if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir, { recursive: true });
    
    const checkpointTmpPath = path.join(checkpointDir, 'checkpoint.json.tmp');
    const checkpointPath = path.join(checkpointDir, 'checkpoint.json');
    
    try {
      const fd = fs.openSync(checkpointTmpPath, 'w');
      fs.writeSync(fd, JSON.stringify(checkpoint, null, 2));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(checkpointTmpPath, checkpointPath);
    } catch (e) {
      const writer = goalStore.createEventWriter({ goalId, teamId: run.teamId, agentId: run.activeAgentId || run.currentAgent || undefined });
      writer.push({ state: 'failed', message: `Checkpoint generation failed: ${(e as Error).message}`, eventType: 'task_failed' });
      db.update(teamRuns).set({ status: 'paused', updatedAt: Date.now().toString() }).where(eq(teamRuns.id, runId)).run();
      return;
    }

    // Execute SQLite state transition in one database transaction.
    // NOTE: the handoff row itself is written once by codexLoop at finish time
    // (with verified artifacts); TeamRunner must not insert a duplicate.
    db.transaction((tx) => {
      const runUpdate: any = {
        updatedAt: Date.now().toString(),
        databaseRevision: dbRevision,
        checkpointVersion: 1,
        checkpointSequence: chkSeq,
      };

      if (verificationReport) {
        runUpdate.verificationReport = JSON.stringify(verificationReport);
      }

      if (attemptNeedsRepair && nextAgentId) {
        runUpdate.repairCount = run.repairCount + 1;
      }

      if (!nextAgentId) {
        if (repairRoutingFailure) {
          runUpdate.status = 'failed';
        } else if (attemptNeedsRepair) {
          runUpdate.status = 'paused'; // Need user review
        } else {
          runUpdate.status = 'completed';
        }
      } else {
        runUpdate.currentAgent = nextAgentId;
        runUpdate.activeAgentId = nextAgentId;
        runUpdate.currentStep = nextStep;
      }

      tx.update(teamRuns).set(runUpdate).where(eq(teamRuns.id, runId)).run();

      // Keep the team's status truthful and in sync with its run.
      if (runUpdate.status) {
        tx.update(teams).set({ status: runUpdate.status, updatedAt: Date.now().toString() }).where(eq(teams.id, run.teamId)).run();
      }
    });

    const writer = goalStore.createEventWriter({ goalId, teamId: run.teamId, agentId: run.currentAgent || undefined });
    writer.push({
      state: 'agent_completed',
      message: `Agent ${run.currentAgent} completed.`,
      eventType: 'agent_completed',
      normalizedStatus: 'active',
      lifecycleState: 'running'
    });

    if (!nextAgentId) {
      if (repairRoutingFailure) {
        writer.push({
          state: 'failed',
          message: `Team failed: ${repairRoutingFailure}`,
          eventType: 'task_failed',
          normalizedStatus: 'failed',
          lifecycleState: 'failed',
          error: repairRoutingFailure
        });
      } else if (attemptNeedsRepair) {
        const reason = (verificationReport?.blockingIssues || []).join('; ') || 'verification did not pass';
        writer.push({
          state: 'team_paused',
          message: `Team paused for review: verification failed after ${run.repairCount} repair attempt(s). Blocking issues: ${reason}`,
          eventType: 'team_paused',
          normalizedStatus: 'attention',
          lifecycleState: 'paused'
        });
      } else {
        writer.push({
          state: 'team_completed',
          message: 'Team execution completed successfully.',
          eventType: 'team_completed',
          normalizedStatus: 'completed',
          lifecycleState: 'completed'
        });
      }
      this.detachGoalListener(runId);
      return;
    }
    
    if (attemptNeedsRepair && nextAgentId) {
      writer.push({
        state: 'repair_requested',
        message: 'Verification failed. Repair requested.',
        eventType: 'repair_requested',
        normalizedStatus: 'attention',
        lifecycleState: 'running'
      });
    }

    writer.push({
      state: 'agent_switch',
      message: `Agent Switch.`,
      eventType: 'agent_switch',
      normalizedStatus: 'active',
      lifecycleState: 'running'
    });

    const nextAgent = teamSheet.agents.find((a: any) => a.id === nextAgentId);
    const context = await createContext(run.teamId, teamSheet, nextAgentId, teamSheet.objective, runId, goalId);

    // Repair executions carry the actual blocking issues to the repair target,
    // with workspace, providers, sandbox context, and approval policy preserved
    // through the same createContext pipeline as the original run.
    if (attemptNeedsRepair) {
      const handoffIssues = (handoff.openIssues || []).map(String).filter(Boolean);
      const handoffFixes = (handoff.recommendedNextActions || []).map(String).filter(Boolean);
      context.repairContext = {
        blockingIssues: [...(verificationReport?.blockingIssues || []), ...handoffIssues],
        recommendedFixes: [...(verificationReport?.recommendedFixes || []), ...handoffFixes],
        attempt: run.repairCount + 1
      };
    }
    
    const nextWriter = goalStore.createEventWriter({ goalId, teamId: run.teamId, agentId: nextAgentId });
    nextWriter.push({
      state: 'agent_started',
      message: `Agent ${nextAgentId} started.`,
      eventType: 'agent_started',
      normalizedStatus: 'active',
      lifecycleState: 'running'
    });

    await AgentRunner.resumeAgent(goalId, context);
  }
}
