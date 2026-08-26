// check-dev-db.cjs — which DB does the DEV server use + supervisor state.
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const http = require('http');

function get(path) {
  return new Promise((resolve) => {
    const r = http.get('http://127.0.0.1:4001' + path, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    r.on('error', () => resolve('ERR'));
    r.setTimeout(5000, () => { r.destroy(); resolve('TIMEOUT'); });
  });
}

(async () => {
  console.log('=== supervisor status ===');
  console.log((await get('/api/revenue-supervisor/status')).slice(0, 400));

  console.log('\n=== temp DB (isolated) goals ===');
  try {
    const t = new Database('C:/Users/Cris/AppData/Local/Temp/agenticos-devtest/agentic-os.db', { readonly: true });
    console.log('goal count:', t.prepare('SELECT COUNT(*) c FROM goals').get().c);
    console.log('has goal-170a82b7-:', !!t.prepare('SELECT 1 FROM goals WHERE id=?').get('goal-170a82b7-'));
    t.close();
  } catch (e) { console.log('temp DB read err:', e.message); }

  console.log('\n=== server/data DB (DEV) goals ===');
  try {
    const d = new Database('B:/AgenticOS/server/data/agentic-os.db', { readonly: true });
    console.log('goal count:', d.prepare('SELECT COUNT(*) c FROM goals').get().c);
    console.log('has goal-170a82b7-:', !!d.prepare('SELECT 1 FROM goals WHERE id=?').get('goal-170a82b7-'));
    d.close();
  } catch (e) { console.log('dev DB read err:', e.message); }
})();
