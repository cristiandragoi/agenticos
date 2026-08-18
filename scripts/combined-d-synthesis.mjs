// PART D — synthesis step retry: pure direct question (no browser verbs that
// would re-route to Magnitude). DeepSeek forced via routing override.
const BASE = 'http://127.0.0.1:4000';
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const convId = Array.isArray(convs) && convs.length ? convs[convs.length - 1].id : null;

const prompt = 'Given this recorded page result — title: "Example Domain"; content begins: "This domain is for use in illustrative examples" — write one sentence explaining what kind of site this is.';
const synthRes = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt,
    operationId: `d-synth3-${Date.now()}`, inputChannel: 'typed', approvalPolicy: 'auto',
    overrideProvider: 'DeepSeek',
    overrideModel: 'deepseek-v4-flash',
  }),
});
const text = await synthRes.text();
const frames = text.split('\n\n');
const intent = frames.filter((f) => f.startsWith('event: intent')).map((f) => {
  const m = f.match(/data: ({.*})/);
  return m ? JSON.parse(m[1]) : null;
})[0];
const agent = frames.filter((f) => f.startsWith('event: message')).map((f) => {
  const m = f.match(/data: ({.*})/);
  return m ? JSON.parse(m[1]) : null;
}).find((d) => d?.role === 'agent');
const done = frames.filter((f) => f.startsWith('event: done')).map((f) => {
  const m = f.match(/data: ({.*})/);
  return m ? JSON.parse(m[1]) : null;
})[0];
console.log('D2_INTENT', JSON.stringify({ route: intent?.route, type: intent?.type }));
console.log('D2_DONE', JSON.stringify({ route: done?.route, provider: done?.provider, model: done?.model }));
console.log('D2_SYNTHESIS', String(agent?.content || '').slice(0, 400));
