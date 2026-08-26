// Datenschutz-Kit (expt-978155f7-) branch inspection
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
const d = JSON.parse(fs.readFileSync(T + 'ro-trace-dsk.json', 'utf8'));
console.log('nextAction:', d.nextAction);
console.log('argusState:', d.argusState);
const exp = d.experiment || {};
console.log('exp status:', exp.status, '| engine:', exp.engine);
console.log('product/hypothesis:', String(exp.product || exp.hypothesis || '').slice(0, 160));
console.log('\nevents (last 10):');
for (const e of (d.events || []).slice(-10)) {
  const m = e.metadata || {};
  const txt = e.summary || e.details || m.summary || m.reason || m.failure || m.error || '';
  console.log('-', e.type || m.type, '|', String(txt).slice(0, 150));
}
console.log('\nverifications:', (d.verifications || []).length);
for (const v of d.verifications || []) {
  console.log('-', v.id, '|', v.verdict || v.status, '|', String(v.summary || '').slice(0, 100));
}
