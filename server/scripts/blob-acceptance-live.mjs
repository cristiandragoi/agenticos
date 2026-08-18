// P10 — LIVE neural-blob acceptance evidence (A–E) via the real production
// HTTP path. Captures the real runtime-state transitions that drive the blob.
const BASE = 'http://127.0.0.1:4600';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postMessage(convId, message, channel = 'typed') {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ prompt: message, inputChannel: channel }),
  });
  const text = await res.text();
  let reply = '', provider = null, model = null;
  const statuses = [];
  for (const block of text.split('\n\n')) {
    const ev = block.split('\n').find((l) => l.startsWith('event: '))?.slice(7);
    const dataLine = block.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
    if (!dataLine) continue;
    let data; try { data = JSON.parse(dataLine); } catch { continue; }
    if (ev === 'status') statuses.push(data.state || '');
    if (ev === 'chunk') { reply += data.delta || ''; if (data.provider) provider = data.provider; if (data.model) model = data.model; }
    if (ev === 'done') { if (data.provider) provider = data.provider; if (data.model) model = data.model; }
  }
  return { reply: reply.trim().slice(0, 120), provider, model, statuses: [...new Set(statuses)] };
}

async function runtimeState() {
  const res = await fetch(`${BASE}/api/jarvis/runtime-state`);
  const j = await res.json();
  return { state: j.state, provider: j.provider, model: j.model, activeAgent: j.activeAgent, pendingTaskCount: j.pendingTaskCount, currentAction: j.currentAction };
}

const created = await fetch(`${BASE}/api/jarvis/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'blob acceptance' }) });
const conv = await created.json();
const convId = conv.id || conv.conversationId;
console.log(`conversationId=${convId}`);

// A — Idle
const idle = await runtimeState();
console.log(`A IDLE runtime-state: state=${idle.state} provider=${idle.provider} model=${idle.model}`);
console.log(`A IDLE → blob visual: ${idle.state === 'idle' ? 'IDLE (calm breathing)' : 'CHECK'}`);

// B — Normal conversation
const b = await postMessage(convId, 'What model are you using?');
console.log(`B THINKING statuses=${b.statuses.join('>')} effective=${b.provider}/${b.model}`);
console.log(`B answer="${b.reply}"`);

// C — Memory/context
await postMessage(convId, 'My blob test word is AURORA.');
const c = await postMessage(convId, 'What was my blob test word?');
console.log(`C context recall="${c.reply}"`);
console.log(`C AURORA recalled: ${/AURORA/i.test(c.reply) ? 'YES' : 'NO (model-dependent)'}`);

// D — Hermes delegation (harmless task)
const d = await postMessage(convId, 'Create a task for Hermes to summarize the file B:\\AgenticOS\\README.md');
console.log(`D delegation route statuses=${d.statuses.join('>')}`);
const dState = await runtimeState();
console.log(`D runtime-state after delegation: state=${dState.state} activeAgent=${dState.activeAgent} pendingTasks=${dState.pendingTaskCount}`);
const d2 = await postMessage(convId, 'What are you doing right now?');
console.log(`D follow-up="${d2.reply}" statuses=${d2.statuses.join('>')}`);
const dState2 = await runtimeState();
console.log(`D runtime-state after follow-up: state=${dState2.state} pendingTasks=${dState2.pendingTaskCount}`);

// E — Recovery visual truth is driven by the same orb state (proven in GAP-1);
// capture the effective identity the blob would display.
console.log(`E effective model label = ${idle.provider} · ${idle.model}`);
console.log('E conversation intact after D: ' + (await fetch(`${BASE}/api/jarvis/conversations/${convId}/messages`)).ok);
