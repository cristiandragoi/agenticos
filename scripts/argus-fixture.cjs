// ARGUS isolated-fixture helper.
// Copies the Roaming canonical DB to a throwaway temp dir and points
// AGENTICOS_DATA_DIR / AGENT_TEAMS_DB_PATH at it, so a verifier's control/gate
// mutations never touch production. Cleans up on exit.
const os = require('os');
const fs = require('fs');
const path = require('path');
const Database = require(path.resolve(__dirname, '../server/node_modules/better-sqlite3'));

const ROAMING_DB = 'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db';

function setupIsolatedFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-fixture-'));
  const dbPath = path.join(dir, 'agentic-os.db');
  // Consistent snapshot via VACUUM INTO (checkpoints WAL into the copy).
  const src = new Database(ROAMING_DB);
  src.prepare('VACUUM INTO ?').run(dbPath);
  src.close();
  process.env.AGENTICOS_DATA_DIR = dir;
  process.env.AGENT_TEAMS_DB_PATH = dbPath;
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  process.on('exit', cleanup);
  return dbPath;
}

module.exports = { setupIsolatedFixture, ROAMING_DB };
