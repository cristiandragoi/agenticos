// Extract compliance details (website/contact) for all 3 SME branches
const fs = require('fs');
const T = process.env.LOCALAPPDATA + '\\Temp\\';
for (const f of ['ro-trace-sme1.json', 'ro-trace-sme2.json', 'ro-trace-sme3.json']) {
  const d = JSON.parse(fs.readFileSync(T + f, 'utf8'));
  const c = (d.compliance || [])[0] || {};
  console.log('=====', f, '=====');
  console.log('company:', String(c.companyName || '').slice(0, 90));
  console.log('website:', c.website);
  console.log('contactEmail:', c.contactEmail);
  console.log('contactSource:', c.contactSource);
  console.log('optOut:', c.optOut, '| doNotContact:', c.doNotContact, '| suppression:', c.suppressionState);
  console.log('lawfulBasis:', String(c.lawfulBasis || '').slice(0, 80));
  console.log('outreachHistory:', JSON.stringify(c.outreachHistory).slice(0, 120));
  console.log('');
}
