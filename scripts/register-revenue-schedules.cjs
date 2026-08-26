const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));
const fs = require('fs');

console.log('=== REGISTERING CANONICAL REVENUE ROUTINES & SCHEDULES ===\n');

const DB_PATH = path.resolve(__dirname, '../server/data/agentic-os.db');
const ROAMING_DB_PATH = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';

const routinesToRegister = [
  {
    routineId: 'routine-revenue-supervisor',
    projectId: 'proj-default',
    name: 'Revenue Supervisor Autonomous Cycle',
    description: 'Periodically evaluate experiments, enforce human gate isolation, and advance runnable revenue branches.',
    objective: 'Evaluate revenue experiment branches and advance autonomous revenue generation.',
    worker: 'hermes',
    scheduleId: 'schedule-revenue-supervisor-tick',
    taskTemplate: JSON.stringify({ objective: 'Run Revenue Supervisor Cycle', worker: 'hermes', metadata: { domain: 'revenue_supervisor' } }),
    enabled: 1,
    approvalPolicy: 'read_only_auto',
    verificationPolicy: 'none',
  },
  {
    routineId: 'routine-revenue-daily-briefing',
    projectId: 'proj-default',
    name: 'Revenue Daily Briefing Generator',
    description: 'Generates and persists the daily executive revenue briefing and KPI summary.',
    objective: 'Generate and persist daily KPI briefing for mission-616808fe-',
    worker: 'hermes',
    scheduleId: 'schedule-revenue-daily-briefing',
    taskTemplate: JSON.stringify({ objective: 'Generate Daily Briefing', worker: 'hermes', metadata: { domain: 'revenue_briefing', type: 'daily' } }),
    enabled: 1,
    approvalPolicy: 'read_only_auto',
    verificationPolicy: 'none',
  },
  {
    routineId: 'routine-revenue-weekly-briefing',
    projectId: 'proj-default',
    name: 'Revenue Weekly Briefing Generator',
    description: 'Generates and persists the weekly executive revenue briefing and performance report.',
    objective: 'Generate and persist weekly KPI briefing for mission-616808fe-',
    worker: 'hermes',
    scheduleId: 'schedule-revenue-weekly-briefing',
    taskTemplate: JSON.stringify({ objective: 'Generate Weekly Briefing', worker: 'hermes', metadata: { domain: 'revenue_briefing', type: 'weekly' } }),
    enabled: 1,
    approvalPolicy: 'read_only_auto',
    verificationPolicy: 'none',
  }
];

const schedulesToRegister = [
  {
    id: 'schedule-revenue-daily-briefing',
    taskId: 'task-revenue-daily-briefing',
    type: 'cron',
    cronExpression: '0 8 * * *',
    timezone: 'UTC',
    enabled: 1,
    misfirePolicy: 'run_once',
    executionType: 'worker_task',
    routineId: 'routine-revenue-daily-briefing',
    worker: 'hermes',
    projectId: 'proj-default',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'schedule-revenue-weekly-briefing',
    taskId: 'task-revenue-weekly-briefing',
    type: 'cron',
    cronExpression: '0 8 * * 1',
    timezone: 'UTC',
    enabled: 1,
    misfirePolicy: 'run_once',
    executionType: 'worker_task',
    routineId: 'routine-revenue-weekly-briefing',
    worker: 'hermes',
    projectId: 'proj-default',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'schedule-revenue-supervisor-tick',
    taskId: 'task-revenue-supervisor-tick',
    type: 'cron',
    cronExpression: '*/5 * * * *',
    timezone: 'UTC',
    enabled: 1,
    misfirePolicy: 'skip',
    executionType: 'worker_task',
    routineId: 'routine-revenue-supervisor',
    worker: 'hermes',
    projectId: 'proj-default',
    createdAt: new Date().toISOString(),
  }
];

function registerInDb(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const db = new Database(targetPath);
  
  // Ensure tables exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      routine_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      objective TEXT NOT NULL DEFAULT '',
      worker TEXT NOT NULL,
      task_template TEXT NOT NULL DEFAULT '{}',
      schedule_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      memory_policy TEXT NOT NULL DEFAULT '{"retrieveProjectMemory":true,"allowCandidatePromotion":true}',
      approval_policy TEXT NOT NULL DEFAULT 'inherit_project_policy',
      verification_policy TEXT NOT NULL DEFAULT 'required',
      retry_policy TEXT,
      timeout_seconds INTEGER,
      output_policy TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT
    );
  `);

  const now = new Date().toISOString();

  // Register routines
  for (const r of routinesToRegister) {
    db.prepare('DELETE FROM routines WHERE routine_id = ?').run(r.routineId);
    db.prepare(`
      INSERT INTO routines (routine_id, project_id, name, description, objective, worker, task_template, schedule_id, enabled, approval_policy, verification_policy, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(r.routineId, r.projectId, r.name, r.description, r.objective, r.worker, r.taskTemplate, r.scheduleId, r.enabled, r.approvalPolicy, r.verificationPolicy, now, now);
    console.log(`- Registered routine ${r.routineId} in ${targetPath}`);
  }

  // Register schedules
  for (const s of schedulesToRegister) {
    db.prepare('DELETE FROM schedules WHERE id = ?').run(s.id);
    db.prepare(`
      INSERT INTO schedules (id, task_id, type, timezone, cron_expression, enabled, misfire_policy, execution_type, routine_id, worker, project_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(s.id, s.taskId, s.type, s.timezone, s.cronExpression, s.enabled, s.misfirePolicy, s.executionType, s.routineId, s.worker, s.projectId, s.createdAt);
    console.log(`- Registered schedule ${s.id} in ${targetPath}`);
  }
  
  db.close();
}

registerInDb(DB_PATH);
registerInDb(ROAMING_DB_PATH);
console.log('\nCANONICAL REVENUE ROUTINES & SCHEDULES REGISTERED');
