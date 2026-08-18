import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type TableInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
  pk: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, '../../drizzle');
const tempDbPath = path.join(os.tmpdir(), `agent-provider-assignment-migration-${process.pid}.db`);

const expectedColumns: Record<string, Pick<TableInfo, 'type' | 'notnull' | 'dflt_value'>> = {
  migration_state: {
    type: 'TEXT',
    notnull: 0,
    dflt_value: "'none'",
  },
  migration_owner: {
    type: 'TEXT',
    notnull: 0,
    dflt_value: null,
  },
  lease_expires_at: {
    type: 'TEXT',
    notnull: 0,
    dflt_value: null,
  },
  migration_version: {
    type: 'INTEGER',
    notnull: 0,
    dflt_value: '1',
  },
};

if (!fs.existsSync(migrationsFolder)) {
  throw new Error(`Migrations folder not found: ${migrationsFolder}`);
}

if (fs.existsSync(tempDbPath)) {
  fs.unlinkSync(tempDbPath);
}

const sqlite = new Database(tempDbPath);

try {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

  const columns = sqlite
    .prepare('PRAGMA table_info(agent_provider_assignments)')
    .all() as TableInfo[];
  const columnsByName = new Map(columns.map((column) => [column.name, column]));

  for (const [columnName, expected] of Object.entries(expectedColumns)) {
    const actual = columnsByName.get(columnName);

    if (!actual) {
      throw new Error(`Missing column: ${columnName}`);
    }

    if (actual.type.toUpperCase() !== expected.type) {
      throw new Error(`Column ${columnName} type mismatch: expected ${expected.type}, got ${actual.type}`);
    }

    if (actual.notnull !== expected.notnull) {
      throw new Error(`Column ${columnName} nullability mismatch: expected ${expected.notnull}, got ${actual.notnull}`);
    }

    if (actual.dflt_value !== expected.dflt_value) {
      throw new Error(`Column ${columnName} default mismatch: expected ${expected.dflt_value}, got ${actual.dflt_value}`);
    }
  }

  console.log('agent_provider_assignments migration columns verified');
} finally {
  sqlite.close();

  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
}
