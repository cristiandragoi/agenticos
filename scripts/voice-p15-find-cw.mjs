// Find the conversation(s) containing current-work-context replies and dump their text.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const list = Array.isArray(convs) ? convs : [];
console.log('CONVS', list.length);
for (const c of list.slice(-6)) {
  const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${c.id}/messages`);
  const msgs = await msgsRes.json();
  const rows = Array.isArray(msgs) ? msgs : [];
  const cw = rows.filter((m) => m?.model === 'current-work-context' || (m?.role === 'agent' && /working on|current task|cannot determine/i.test(String(m?.content || ''))));
  if (cw.length) {
    console.log('=== CONV', c.id, 'updated', c.updatedAt, 'cwMsgs', cw.length);
    for (const m of cw.slice(-4)) {
      console.log(`[${m.role} | ${m.metadata?.model}] ${String(m.content || '').slice(0, 320).replace(/\n/g, ' ')}`);
    }
  }
}
