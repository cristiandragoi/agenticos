// SME-2/SME-3 branch inspection for pre-approval validation prep
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
for (const f of ['ro-trace-sme2.json', 'ro-trace-sme3.json']) {
  const d = JSON.parse(fs.readFileSync(T + f, 'utf8'));
  const c = (d.compliance || [])[0] || {};
  const g = (d.gates || [])[0] || {};
  console.log('=====', f, '=====');
  console.log('company:', String(c.companyName || '').slice(0, 120));
  console.log('compliance fields:', Object.keys(c));
  console.log('nextAction:', d.nextAction);
  console.log('gate:', g.id, '|', g.gateType, '|', g.status);
  const ev = d.events || [];
  const urls = [];
  for (const e of ev) {
    const m = e.metadata || {};
    const s = JSON.stringify(m);
    const found = s.match(/https?:\/\/[^\s"',]+/g);
    if (found) urls.push(...found);
  }
  console.log('urls in events:', [...new Set(urls)].slice(0, 6));
  console.log('');
}
