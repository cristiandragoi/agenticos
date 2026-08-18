// Inspect agent-jarvis assignment (corrected column names).
import { rawDb } from '../dist/db/index.js';
try {
  const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%assign%'").all();
  console.log('tables:', JSON.stringify(tables));
  const cols = rawDb.prepare("PRAGMA table_info(agent_provider_assignments)").all();
  console.log('columns:', JSON.stringify(cols.map((c) => c.name)));
  const rows = rawDb.prepare("SELECT * FROM agent_provider_assignments WHERE agent_id = 'agent-jarvis'").all();
  console.log('agent-jarvis:', JSON.stringify(rows).slice(0, 500));
} catch (e) {
  console.log('error:', String(e).slice(0, 300));
}
