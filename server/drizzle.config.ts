import { defineConfig } from 'drizzle-kit';
import path from 'path';
import os from 'os';

// Match the logic in db/index.ts for the DB path
const userDataPath = process.env.USER_DATA_PATH || path.join(os.homedir(), '.agentic-os');
const dbPath = path.join(userDataPath, 'agentic-os.db');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
});
