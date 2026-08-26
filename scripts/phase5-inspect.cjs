#!/usr/bin/env node
const BASE = 'http://127.0.0.1:4001';
const id = process.argv[2] || 'hapi-mt2ejagu-1u';

async function main() {
  const rec = await (await fetch(`${BASE}/api/hermes-api/runs/${id}`)).json();
  console.log('status:', rec.status);
  console.log('provider:', rec.provider, '| model:', rec.model);
  console.log('pendingApproval:', JSON.stringify(rec.pendingApproval, null, 2));
  console.log('--- events ---');
  for (const e of (rec.events || [])) console.log(`[${e.kind}] ${(e.summary || '').slice(0, 110)}`);
}
main().catch((e) => { console.error('ERROR', e); process.exit(2); });
