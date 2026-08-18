// Raw dump of recent messages to see the actual stored shape.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${convId}/messages`);
const msgs = await msgsRes.json();
const rows = Array.isArray(msgs) ? msgs : [];
console.log('TOTAL', rows.length);
for (const m of rows.slice(-10)) {
  console.log(JSON.stringify({ role: m?.role, model: m?.metadata?.model, content: String(m?.content || '').slice(0, 200) }).slice(0, 260));
}
