import { defineConfig } from 'drizzle-kit';
import path from 'path';
import fs from 'fs';

// Match the logic in db/index.ts for the DB path
const dbPath = process.env.AGENT_TEAMS_DB_PATH || path.join(process.cwd(), 'data', 'agentic-os.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
});
