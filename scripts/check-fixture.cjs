const fs = require('fs');
const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));

// 1. Check dist argusService exports the correction seam
const src = fs.readFileSync('B:/AgenticOS/server/dist/services/argus/argusService.js', 'utf8');
console.log('dist has _setCorrectionLauncher export:', src.includes('_setCorrectionLauncher'));
console.log('dist has verifyContract export:', src.includes('verifyContract'));

// 2. Test VACUUM INTO produces a consistent copy of Roaming
try {
  const dst = path.join(process.env.TEMP || require('os').tmpdir(), 'vacuum_test.db');
  const d = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db');
  d.prepare('VACUUM INTO ?').run(dst);
  d.close();
  const chk = new Database(dst, { readonly: true });
  const mission = chk.prepare("SELECT id FROM revenue_missions WHERE id='mission-616808fe-'").get();
  const gates = chk.prepare("SELECT COUNT(*) c FROM revenue_human_gates WHERE status='open'").get().c;
  const sup = chk.prepare("SELECT control_state FROM revenue_supervisor_state WHERE id='supervisor-singleton'").get();
  console.log('VACUUM INTO OK. mission found:', !!mission, '| open gates:', gates, '| supervisor:', sup?.control_state);
  chk.close();
  fs.unlinkSync(dst);
} catch (e) {
  console.log('VACUUM INTO FAILED:', e.message);
}
