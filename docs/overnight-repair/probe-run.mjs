const BASE = process.env.BASE || 'http://127.0.0.1:4001';
const id = process.argv[2];
const res = await fetch(`${BASE}/api/hermes-api/runs/${id}`);
const d = await res.json();
console.log('status:', d.status);
console.log('provider:', JSON.stringify(d.provider));
console.log('model:', JSON.stringify(d.model));
console.log('finalText:', (d.finalText || '').slice(0, 300));
const evs = d.events || [];
console.log('eventCount:', evs.length);
if (evs.length) {
  const last = evs[evs.length - 1];
  console.log('lastEvent:', last.kind, '|', (last.summary || '').slice(0, 80));
  console.log('kinds:', [...new Set(evs.map(e => e.kind))].join(','));
}
