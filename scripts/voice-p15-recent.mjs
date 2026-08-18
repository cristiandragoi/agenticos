// Dump raw message rows for the most recently updated conversations to see
// exactly how current-work replies are stored.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const list = Array.isArray(convs) ? convs : [];
const sorted = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
for (const c of sorted.slice(0, 4)) {
  const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${c.id}/messages`);
  const msgs = await msgsRes.json();
  const rows = Array.isArray(msgs) ? msgs : [];
  console.log('=== CONV', c.id, 'updated', c.updatedAt, 'msgs', rows.length);
  for (const m of rows.slice(-6)) {
    console.log('  ', JSON.stringify({ role: m?.role, model: m?.model, mdModel: m?.metadata?.model, content: String(m?.content || '').slice(0, 140) }).slice(0, 220));
  }
}
