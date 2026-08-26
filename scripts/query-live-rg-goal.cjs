// query-live-rg-goal.cjs — read-only dump of the live CodeX goal runSummary.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

const goalId = process.argv[2] || 'goal-6b2af352-';
const row = db.prepare('SELECT id, status, run_summary, workspace_path FROM goals WHERE id = ?').get(goalId);
if (!row) { console.error('goal not found:', goalId); process.exit(2); }

let summary = null;
try { summary = typeof row.run_summary === 'string' ? JSON.parse(row.run_summary) : row.run_summary; } catch { summary = row.run_summary; }

console.log('=== GOAL', row.id, 'status=', row.status, 'workspace=', row.workspace_path, '===');
console.log(JSON.stringify(summary, null, 2).slice(0, 4000));

const s = JSON.stringify(summary || '');
const checks = {
  ripgrepVersion: /ripgrep \d+/i.test(s),
  webglRenderer: /WebGLRenderer/i.test(s),
  repoRoot: /B:[\\/]?AgenticOS|agenticos/i.test(s),
  blockedByPolicy: /blocked by policy/i.test(s),
  noFilesModified: /no files were modified|filesChanged[^\]]*\][^0-9]*0|did not modify/i.test(s),
};
console.log('\n=== CHECKS ===', JSON.stringify(checks, null, 2));
db.close();
process.exit(checks.ripgrepVersion && checks.webglRenderer && !checks.blockedByPolicy ? 0 : 2);
