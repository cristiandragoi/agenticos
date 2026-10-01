import { selfHealSupervisor } from '../dist/domains/selfHeal/SelfHealSupervisor.js';
import { goalLifecycleManager } from '../dist/domains/controlPlane/GoalLifecycle.js';
import { auditLog } from '../dist/domains/selfHeal/AuditLog.js';
import Database from 'better-sqlite3';

const dbPath = process.env.APPDATA + '/agenticos/data/agentic-os.db';
const db = new Database(dbPath);

console.log('================================================================');
console.log('RESUMING REAL RESTORED PRODUCTION INCIDENTS');
console.log('================================================================');

async function run() {
  // 1. Check Initial State in DB
  const inc2136Before = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-2136'").get();
  const goal2136Before = db.prepare("SELECT * FROM goal_runs WHERE goal_id = 'goal-1790545900080-d92z0'").get();
  console.log('\n[INITIAL STATE - SELFHEAL-2136]');
  console.log(`Incident: ${inc2136Before.id} | Status: ${inc2136Before.status} | GoalId: ${inc2136Before.goal_id}`);
  console.log(`Goal: ${goal2136Before.goal_id} | Status: ${goal2136Before.status} | Prompt: "${goal2136Before.original_user_input}"`);

  const inc6158Before = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-6158'").get();
  const goal6158Before = db.prepare("SELECT * FROM goal_runs WHERE goal_id = 'goal-1790545872590-8rsyl'").get();
  console.log('\n[INITIAL STATE - SELFHEAL-6158]');
  console.log(`Incident: ${inc6158Before.id} | Status: ${inc6158Before.status} | GoalId: ${inc6158Before.goal_id}`);
  console.log(`Goal: ${goal6158Before.goal_id} | Status: ${goal6158Before.status} | Prompt: "${goal6158Before.original_user_input}"`);

  // Ensure GoalRuns are loaded in GoalLifecycleManager
  const g1 = goalLifecycleManager.getGoalRun('goal-1790545900080-d92z0');
  const g2 = goalLifecycleManager.getGoalRun('goal-1790545872590-8rsyl');
  console.log(`\nLoaded GoalRuns into memory: g1=${!!g1}, g2=${!!g2}`);

  // -------------------------------------------------------------------------
  // EXECUTE RESUMPTION FOR SELFHEAL-2136
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('PROCEEDING: SELFHEAL-2136 (Open the camera.)');
  console.log('================================================================');
  const res2136 = await selfHealSupervisor.executeClosedLoopRepair({
    incidentId: 'SELFHEAL-2136',
    goalId: 'goal-1790545900080-d92z0',
    conversationId: goal2136Before.conversation_id || 'conv-4569958b-',
    originalUserInput: goal2136Before.original_user_input,
    target: 'camera',
    userAction: {
      verb: 'open',
      target: 'camera',
      prompt: goal2136Before.original_user_input,
      entityId: 'camera',
      entityName: 'camera',
      entityType: 'capability',
      conversationId: goal2136Before.conversation_id || 'conv-4569958b-',
    },
    failureClassification: {
      domain: 'implementation',
      repairability: 'engineering',
      reason: 'Capability dispatch missing for open camera',
    },
    resumeFromDiagnosing: true,
    requiresPhysicalUserVerification: true,
  });

  console.log('\n[RESULT 2136]');
  console.log('Success:', res2136.success);
  console.log('Outcome:', JSON.stringify(res2136.outcome, null, 2));
  console.log('Verification:', JSON.stringify(res2136.verification, null, 2));

  // -------------------------------------------------------------------------
  // EXECUTE RESUMPTION FOR SELFHEAL-6158
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('PROCEEDING: SELFHEAL-6158 (Read what is inside Hermes 1.)');
  console.log('================================================================');
  const res6158 = await selfHealSupervisor.executeClosedLoopRepair({
    incidentId: 'SELFHEAL-6158',
    goalId: 'goal-1790545872590-8rsyl',
    conversationId: goal6158Before.conversation_id || 'conv-4569958b-',
    originalUserInput: goal6158Before.original_user_input,
    target: 'Hermes 1',
    userAction: {
      verb: 'observe',
      target: 'Hermes 1',
      prompt: goal6158Before.original_user_input,
      entityId: 'Hermes 1',
      entityName: 'Hermes 1',
      entityType: 'capability',
      conversationId: goal6158Before.conversation_id || 'conv-4569958b-',
    },
    failureClassification: {
      domain: 'implementation',
      repairability: 'engineering',
      reason: 'Desktop perception window inspection failed on control characters in JSON',
    },
    resumeFromDiagnosing: true,
    requiresPhysicalUserVerification: true,
  });

  console.log('\n[RESULT 6158]');
  console.log('Success:', res6158.success);
  console.log('Outcome:', JSON.stringify(res6158.outcome, null, 2));
  console.log('Verification:', JSON.stringify(res6158.verification, null, 2));

  // -------------------------------------------------------------------------
  // POST-EXECUTION DATABASE AUDIT
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('FINAL DATABASE AND TIMELINE AUDIT');
  console.log('================================================================');

  const inc2136After = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-2136'").get();
  const goal2136After = db.prepare("SELECT * FROM goal_runs WHERE goal_id = 'goal-1790545900080-d92z0'").get();
  console.log('\n[FINAL STATE - SELFHEAL-2136]');
  console.log(`Incident ID: ${inc2136After.id} | Status: ${inc2136After.status} | ResolvedAt: ${inc2136After.resolved_at}`);
  console.log(`Goal ID: ${goal2136After.goal_id} | Status: ${goal2136After.status}`);
  console.log('Goal Timeline:');
  const tl2136 = JSON.parse(goal2136After.timeline || '[]');
  for (const t of tl2136) {
    console.log(`  [${t.timestamp}] [${t.state}] (${t.actor}) ${t.summary}`);
  }

  const inc6158After = db.prepare("SELECT * FROM repair_incidents WHERE id = 'SELFHEAL-6158'").get();
  const goal6158After = db.prepare("SELECT * FROM goal_runs WHERE goal_id = 'goal-1790545872590-8rsyl'").get();
  console.log('\n[FINAL STATE - SELFHEAL-6158]');
  console.log(`Incident ID: ${inc6158After.id} | Status: ${inc6158After.status} | ResolvedAt: ${inc6158After.resolved_at}`);
  console.log(`Goal ID: ${goal6158After.goal_id} | Status: ${goal6158After.status}`);
  console.log('Goal Timeline:');
  const tl6158 = JSON.parse(goal6158After.timeline || '[]');
  for (const t of tl6158) {
    console.log(`  [${t.timestamp}] [${t.state}] (${t.actor}) ${t.summary}`);
  }

  const entries2136 = auditLog.getEntries('SELFHEAL-2136');
  console.log(`\nAudit log transitions for SELFHEAL-2136: ${entries2136.length}`);
  for (const e of entries2136) {
    console.log(`  [${e.timestamp}] ${e.fromState} -> ${e.toState} (${e.actor}: ${e.reason})`);
  }

  const entries6158 = auditLog.getEntries('SELFHEAL-6158');
  console.log(`\nAudit log transitions for SELFHEAL-6158: ${entries6158.length}`);
  for (const e of entries6158) {
    console.log(`  [${e.timestamp}] ${e.fromState} -> ${e.toState} (${e.actor}: ${e.reason})`);
  }
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
