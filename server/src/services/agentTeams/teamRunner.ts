import { db } from '../../db/index.js';
import { teams, teamRuns, agentTeamHandoffs } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { goalStore } from '../goalStore.js';
import { AgentRunner } from './agentRunner.js';
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

export const VerificationReportSchema = z.object({
  passed: z.boolean(),
  summary: z.string(),
  checks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    command: z.string().optional(),
    evidence: z.string()
  })),
  blockingIssues: z.array(z.string()),
  recommendedFixes: z.array(z.string()),
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

  static async resumeTeam(runId: string) {
    const run = db.select().from(teamRuns).where(eq(teamRuns.id, runId)).get();
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== 'paused' && run.status !== 'pending') throw new Error(`Run is ${run.status}`);

    db.update(teamRuns).set({ status: 'running', updatedAt: Date.now().toString() }).where(eq(teamRuns.id, runId)).run();
    
    if (run.goalId && run.teamId) {
      this.attachGoalListener(runId, run.goalId);
      const team = db.select().from(teams).where(eq(teams.id, run.teamId)).get();
      const teamSheet: any = team?.teamSheet;
      const context = await createContext(run.teamId, teamSheet, run.currentAgent || '', teamSheet?.objective || '', runId, run.goalId);
      const writer = goalStore.createEventWriter({ goalId: run.goalId, teamId: run.id, agentId: run.currentAgent || undefined });
      writer.push({
        state: 'team_resumed',
        message: 'Team execution resumed.',
        eventType: 'team_resumed',
        normalizedStatus: 'active',
        lifecycleState: 'running'
      });
      await AgentRunner.resumeAgent(run.goalId, context);
    }
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
        this.handleAgentCompletion(runId, goalId).catch(console.error);
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

    const currentAgentDef = teamSheet.agents.find((a: any) => a.id === run.currentAgent);
      if (currentAgentDef?.role === 'Verifier') {
        if (!finishEvent.payload?.verificationReport) {
          console.warn("[TeamRunner] Verifier finished without VerificationReport! Assuming failure.");
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
            
            if (!verificationReport.passed) {
              isVerificationFailed = true;
            }
          } catch (e) {
            console.error("[TeamRunner] Failed to parse VerificationReport:", e);
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

    if (isVerificationFailed) {
      if (run.repairCount < 1) {
        // Find builder step index
        const builderIndex = sequence.findIndex(s => s.toLowerCase() === 'builder');
        if (builderIndex !== -1) {
          nextStep = builderIndex;
          nextAgentId = sequence[nextStep];
        } else {
          nextAgentId = null; // No builder found, can't repair
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

    const checkpointObj = {
      checkpointVersion: 1,
      teamId: run.teamId,
      goalId: goalId,
      currentStep: nextStep !== null ? nextStep : run.currentStep,
      activeAgentId: nextAgentId,
      completedAgentIds: completedAgents,
      artifactMetadata: handoff.artifacts || [],
      lastEventSequence: goal.history[goal.history.length - 1]?.sequence || 0,
      databaseRevision: dbRevision,
      repairCount: isVerificationFailed && nextAgentId ? run.repairCount + 1 : run.repairCount,
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

    // Execute SQLite state transition in one database transaction
    db.transaction((tx) => {
      tx.insert(agentTeamHandoffs).values({
        id: randomUUID(),
        teamId: run.teamId,
        goalId: goalId,
        agentId: handoff.agentId,
        status: handoff.status,
        summary: handoff.summary,
        decisions: handoff.decisions as any,
        artifacts: handoff.artifacts as any,
        openIssues: handoff.openIssues as any,
        recommendedNextActions: handoff.recommendedNextActions as any,
        createdAt: new Date().toISOString()
      }).run();

      const runUpdate: any = {
        updatedAt: Date.now().toString(),
        databaseRevision: dbRevision,
        checkpointVersion: 1,
        checkpointSequence: chkSeq,
      };

      if (verificationReport) {
        runUpdate.verificationReport = JSON.stringify(verificationReport);
      }

      if (isVerificationFailed && nextAgentId) {
        runUpdate.repairCount = run.repairCount + 1;
      }

      if (!nextAgentId) {
        if (isVerificationFailed) {
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
      if (isVerificationFailed) {
        writer.push({
          state: 'team_paused',
          message: 'Team paused due to verification failure and repair limit.',
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
    
    if (isVerificationFailed && nextAgentId) {
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
