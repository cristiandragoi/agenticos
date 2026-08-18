// P4 — duplicate-message + history check for the GAP-1 recovery conversation.
const BASE = 'http://127.0.0.1:4600';
const convId = 'conv-9427a04a-';
const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/messages`);
const msgs = await res.json();
const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
const users = arr.filter((m) => m.role === 'user').map((m) => (m.content || '').slice(0, 60));
const agents = arr.filter((m) => m.role === 'agent');
const hasCerulean = users.some((t) => t.includes('CERULEAN'));
const retryTurn = users.filter((t) => t.includes('RETRYFLAG42'));
console.log(`conv=${convId} messages=${arr.length} users=${users.length} agents=${agents.length}`);
console.log(`CERULEAN-in-history=${hasCerulean} RETRYFLAG42-turns=${retryTurn.length} (expect 1)`);
console.log(`DUPLICATE CHECK: agents=${agents.length} (expect 4: turns 1-4 each exactly one)`);
users.forEach((u, i) => console.log(`  user[${i}]: ${u}`));
