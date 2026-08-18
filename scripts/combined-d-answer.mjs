// Fetch the DeepSeek synthesis answer from the persisted conversation.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const list = Array.isArray(convs) ? convs : [];
const sorted = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
const latest = sorted[0];
const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${latest.id}/messages`);
const msgs = await msgsRes.json();
const rows = Array.isArray(msgs) ? msgs : [];
const last = rows.slice(-4);
for (const m of last) {
  console.log(`[${m?.role} | ${m?.model || m?.metadata?.model}] ${String(m?.content || '').slice(0, 300).replace(/\n/g, ' ')}`);
}
