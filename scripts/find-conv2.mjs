// List all conversations, find recent jarvis ones + the e110afce one, and the last few messages.
const API = 'http://127.0.0.1:4000/api';
async function main() {
  const res = await fetch(`${API}/jarvis/conversations`, { signal: AbortSignal.timeout(5000) });
  const convs = await res.json();
  const arr = Array.isArray(convs) ? convs : [];
  arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  console.log('TOP 12 BY UPDATED:');
  for (const c of arr.slice(0, 12)) {
    console.log(`${c.id}  ${(c.title || '').slice(0, 40)}  updated=${c.updatedAt || ''}`);
  }
  const target = arr.find((c) => c.id.includes('e110afce')) || arr[0];
  console.log('---TARGET---', target?.id);
  const msgs = await fetch(`${API}/jarvis/conversations/${target.id}/messages`, { signal: AbortSignal.timeout(5000) });
  if (msgs.ok) {
    const m = await msgs.json();
    const arr2 = Array.isArray(m) ? m : (m.messages || []);
    const tail = arr2.slice(-6);
    for (const x of tail) {
      console.log(`${x.role || x.messageType || '?'} | ${String(x.content || '').slice(0, 90)} | meta=${JSON.stringify(x.metadata || {}).slice(0, 120)}`);
    }
  } else {
    console.log('msgs HTTP', msgs.status, (await msgs.text()).slice(0, 200));
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
