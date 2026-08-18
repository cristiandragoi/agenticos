import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

function migrateDatabase(dbPath: string) {
  const db = new Database(dbPath);
  
  db.pragma('foreign_keys = OFF'); 

  db.transaction(() => {
    const columns = db.prepare(`PRAGMA table_info('goal_events')`).all() as any[];
    const hasSequenceId = columns.some(c => c.name === 'sequence_id');
    
    if (hasSequenceId) {
      console.log('Found legacy sequence_id. Verifying duplicates...');
      
      const duplicates = db.prepare(`
        SELECT goal_id, sequence_id, COUNT(*) as cnt 
        FROM goal_events 
        GROUP BY goal_id, sequence_id 
        HAVING cnt > 1
      `).all() as any[];
      
      if (duplicates.length > 0) {
        throw new Error(`Duplicates found for (goal_id, sequence_id). Aborting migration. ` + JSON.stringify(duplicates));
      }
      
      console.log('Renaming sequence_id to sequence...');
      db.prepare(`ALTER TABLE goal_events RENAME COLUMN sequence_id TO sequence;`).run();
      
      console.log('Adding team_id, agent_id, payload columns...');
      const hasTeamId = columns.some(c => c.name === 'team_id');
      if (!hasTeamId) db.prepare(`ALTER TABLE goal_events ADD COLUMN team_id text;`).run();
      const hasAgentId = columns.some(c => c.name === 'agent_id');
      if (!hasAgentId) db.prepare(`ALTER TABLE goal_events ADD COLUMN agent_id text;`).run();
      const hasPayload = columns.some(c => c.name === 'payload');
      if (!hasPayload) db.prepare(`ALTER TABLE goal_events ADD COLUMN payload text;`).run();
      
      console.log('Creating indexes...');
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS goal_events_goal_seq_idx ON goal_events(goal_id, sequence);`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS goal_events_team_seq_idx ON goal_events(team_id, sequence);`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS goal_events_team_agent_seq_idx ON goal_events(team_id, agent_id, sequence);`).run();
    } else {
      console.log('No legacy sequence_id found in goal_events.');
    }

    // Ensure team_runs table has repair_count and verification_report
    const teamRunsCols = db.pragma('table_info(team_runs)') as any[];
    if (teamRunsCols.length > 0) {
      if (!teamRunsCols.some(c => c.name === 'repair_count')) {
        db.prepare(`ALTER TABLE team_runs ADD COLUMN repair_count integer NOT NULL DEFAULT 0;`).run();
      }
      if (!teamRunsCols.some(c => c.name === 'verification_report')) {
        db.prepare(`ALTER TABLE team_runs ADD COLUMN verification_report text;`).run();
      }
    } else {
      db.prepare(`CREATE TABLE team_runs (
        id text PRIMARY KEY,
        team_id text NOT NULL REFERENCES teams(id) ON DELETE cascade,
        status text NOT NULL DEFAULT 'pending',
        current_agent text,
        current_step integer NOT NULL DEFAULT 0,
        goal_id text,
        verification_report text,
        repair_count integer NOT NULL DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );`).run();
    }

    // Ensure agent_team_handoffs exists
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_team_handoffs (
      id text PRIMARY KEY,
      team_id text NOT NULL REFERENCES teams(id) ON DELETE cascade,
      goal_id text NOT NULL,
      agent_id text NOT NULL,
      status text NOT NULL,
      summary text NOT NULL,
      decisions text,
      artifacts text,
      open_issues text,
      recommended_next_actions text,
      created_at text NOT NULL
    );`).run();
    
    console.log('Migration completed successfully.');
  })();
}

const userDataPath = process.env.USER_DATA_PATH || path.join(os.homedir(), '.agentic-os');
const dbFile = path.join(userDataPath, 'agentic-os.db');

try {
  migrateDatabase(dbFile);
} catch (e) {
  console.error('Migration failed:', e);
  process.exit(1);
}
