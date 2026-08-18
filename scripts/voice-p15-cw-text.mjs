// Fetch the ACTUAL current-work reply text(s) from the persisted conversation
// to prove the answers derive from real runtime state.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;
console.log('CONV', convId);
if (!convId) process.exit(0);
const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${convId}/messages`);
const msgs = await msgsRes.json();
const rows = (Array.isArray(msgs) ? msgs : []).slice(-12);
for (const m of rows) {
  const model = m?.metadata?.model || '';
  const role = m?.role || '';
  const content = String(m?.content || '').slice(0, 240);
  if (role === 'user' || model.includes('current-work') || /working on|current task|cannot determine/i.test(content)) {
    console.log(`[${role} | ${model}] ${content.replace(/\n/g, ' ')}`);
  }
}
