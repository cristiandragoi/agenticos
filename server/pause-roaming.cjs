// Phase B safety hold: persist PAUSED in the PACKAGED (Roaming) DB.
// The packaged app's backend is NOT running, so no canonical HTTP control path
// exists against this DB. This mirrors revenueSupervisor.persistState() exactly
// (same table, columns, and ON CONFLICT upsert) so the packaged supervisor
// boots into PAUSED instead of the ACTIVE default.
const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

const ROAMING = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';

const db = new Database(ROAMING); // read-write
db.pragma('journal_mode = WAL');

// Mirror revenueSupervisor.ensureStateTable()
db.exec(`
  CREATE TABLE IF NOT EXISTS revenue_supervisor_state (
    id TEXT PRIMARY KEY,
    control_state TEXT NOT NULL,
    active_mission_id TEXT,
    cycle_count INTEGER NOT NULL DEFAULT 0,
    last_cycle_at TEXT,
    updated_at TEXT NOT NULL
  );
`);

const now = new Date().toISOString();
// Mirror revenueSupervisor.persistState() upsert. Preserve existing cycle_count
// if a row somehow exists; otherwise start at 0 (truthful: no cycle has run
// against the Roaming DB).
const existing = db.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
const cycleCount = existing ? existing.cycle_count : 0;

db.prepare(`
  INSERT INTO revenue_supervisor_state (id, control_state, active_mission_id, cycle_count, last_cycle_at, updated_at)
  VALUES ('supervisor-singleton', ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    control_state = excluded.control_state,
    active_mission_id = excluded.active_mission_id,
    cycle_count = excluded.cycle_count,
    last_cycle_at = excluded.last_cycle_at,
    updated_at = excluded.updated_at
`).run('PAUSED', 'mission-616808fe-', cycleCount, existing ? existing.last_cycle_at : null, now);

const row = db.prepare('SELECT * FROM revenue_supervisor_state WHERE id = ?').get('supervisor-singleton');
console.log('ROAMING supervisor state now:', JSON.stringify(row, null, 2));
db.close();
