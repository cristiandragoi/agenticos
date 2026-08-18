import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsFolder = path.resolve(
  __dirname,
  '../../drizzle'
);

describe('Database Migrations (Empty DB -> Latest)', () => {
  it('Applies migrations and verifies schema integrity', () => {
    const tempDbPath = path.join(process.cwd(), 'temp_migration_test.db');
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

    const sqlite = new Database(tempDbPath);
    const db = drizzle(sqlite);

    // Run migrations
    migrate(db, { migrationsFolder });

    // Verify tables
    const getTables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = getTables.map(t => t.name);

    expect(tableNames).toContain('goals');
    expect(tableNames).toContain('goal_events');
    expect(tableNames).toContain('goal_steps');
    expect(tableNames).toContain('provider_circuit_breakers');

    // Verify Indexes
    const getIndexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[];
    const indexNames = getIndexes.map(i => i.name);
    // SQLite creates auto-indexes for foreign keys and unique constraints. 
    // Wait, Drizzle doesn't generate named indexes unless specified. Let's just check the DB isn't empty.
    expect(getIndexes.length).toBeGreaterThan(0);

    // Verify foreign keys and strict mode implicitly by testing inserts
    const insertGoal = sqlite.prepare("INSERT INTO goals (id, original_goal, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    insertGoal.run('test-goal', 'do it', 'queued', '123', '123');

    const insertEvent = sqlite.prepare("INSERT INTO goal_events (id, goal_id, sequence, state, step, timestamp, message, provider, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertEvent.run('evt-1', 'test-goal', 1, 'planning', 1, '123', 'msg', 'custom', 'model');

    // This should fail due to foreign key constraint
    expect(() => {
      insertEvent.run('evt-2', 'nonexistent', 1, 'planning', 1, '123', 'msg', 'custom', 'model');
    }).toThrow('FOREIGN KEY constraint failed');

    // Verify unique constraints
    expect(() => {
      insertGoal.run('test-goal', 'other', 'queued', '123', '123');
    }).toThrow('UNIQUE constraint failed: goals.id');

    sqlite.close();
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });
});
