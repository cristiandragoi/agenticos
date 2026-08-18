// Verify persisted history contains the CERULEAN turn (system truth) for both GAP1 runs.
const BASE = 'http://127.0.0.1:4600';
for (const convId of ['conv-3a11541e-', 'conv-fc90a4f3-']) {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/messages`);
  const msgs = await res.json();
  const arr = Array.isArray(msgs) ? msgs : (msgs.messages || []);
  const userTexts = arr.filter((m) => m.role === 'user').map((m) => m.content || '');
  const hasCerulean = userTexts.some((t) => t.includes('CERULEAN'));
  console.log(`${convId}: messages=${arr.length} users=${userTexts.length} CERULEAN-in-history=${hasCerulean}`);
}
