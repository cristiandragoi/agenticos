// Phase 2 acceptance — LongCat as a real selectable model (via OpenRouter).
// Chain: CATALOG → SAVED ASSIGNMENT → TEST (configured vs resolved) →
// Jarvis SSE live turn → override precedence → regression.
const BASE = 'http://localhost:4000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const results = {};

// Parse SSE text into [{event, data}] pairs; the jarvis stream's `done`
// event carries no `type` field, so match on the event name.
function parseSse(text) {
  const out = [];
  let ev = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('event:')) { ev = line.slice(6).trim(); continue; }
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let obj = null;
      try { obj = JSON.parse(payload); } catch {}
      out.push({ event: ev, data: obj, raw: payload.slice(0, 120) });
    }
  }
  return out;
}

// 1. CATALOG: LongCat present, key status real, metadata real.
const provs = await j('/api/providers');
const list = Array.isArray(provs.body) ? provs.body : (provs.body?.providers || []);
const lc = list.find((p) => p.id === 'prov-longcat');
results.catalog = {
  present: !!lc,
  name: lc?.name,
  category: lc?.category,
  defaultModel: lc?.defaultModel,
  models: lc?.models,
  hasKey: lc?.hasKey,
};

// 2. SAVED ASSIGNMENT: agent-jarvis → prov-longcat / meituan/longcat-2.0 (forced).
const save = await j('/api/settings/agent-provider-assignments/agent-jarvis', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerId: 'prov-longcat', modelId: 'meituan/longcat-2.0', routingMode: 'forced', enabled: true }),
});
results.savedAssignment = { status: save.status, providerId: save.body?.providerId, modelId: save.body?.modelId, routingMode: save.body?.routingMode, enabled: save.body?.enabled };

// 3. CHECK CONTROL: configured vs resolved via the existing test endpoint.
const test = await j('/api/settings/agent-provider-assignments/agent-jarvis/test', { method: 'POST' });
results.checkControl = test.body;

// 4. Jarvis SSE live turn through the ASSIGNMENT (no override) — must hit LongCat.
const stamp = Date.now().toString(36).slice(-5);
const conv = await j('/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: `LongCat acceptance ${stamp}` }),
});
const convId = conv.body?.id || conv.body?.conversation?.id || conv.body?.conversationId;
results.createConversation = { status: conv.status, id: convId };

if (convId) {
  const op = 'lc-' + stamp;
  const sse = await fetch(BASE + `/api/jarvis/conversations/${convId}/message/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Reply with exactly: LONGCAT_RUNTIME_OK', operationId: op }),
  });
  const text = await sse.text();
  const events = parseSse(text);
  const done = events.find((e) => e.event === 'done')?.data;
  const completed = events.find((e) => e.data?.type === 'gateway.completed')?.data;
  const statusEvt = events.find((e) => e.data?.type === 'status')?.data;
  results.streamTurn = {
    httpStatus: sse.status,
    eventCount: events.length,
    tokenEvents: events.filter((e) => e.event === 'message.delta' || e.event === 'assistant.delta' || e.event === 'delta').length,
    done: done ? { provider: done.provider, model: done.model, route: done.route, operationId: done.operationId } : null,
    gatewayCompleted: completed ? { provider: completed.provider, model: completed.model, requestId: completed.requestId } : null,
    statusEvent: statusEvt ? { provider: statusEvt.provider, model: statusEvt.model, currentAction: (statusEvt.currentAction || '').slice(0, 60) } : null,
    containsPayload: text.includes('LONGCAT_RUNTIME_OK'),
    fallbackVisible: done && done.provider !== 'openrouter',
  };
  // Verify the actual reply text persisted.
  const msgs = await j(`/api/jarvis/conversations/${convId}/messages`);
  const arr = Array.isArray(msgs.body) ? msgs.body : (msgs.body?.messages || []);
  const last = arr[arr.length - 1];
  results.replyText = last ? { role: last.role, text: String(last.text || last.content || '').slice(0, 60) } : null;
  results.replyOk = !!last && /LONGCAT_RUNTIME_OK/.test(String(last.text || last.content || ''));
}

// 5. OVERRIDE PRECEDENCE: assignment → DeepSeek, manual override → LongCat must win.
await j('/api/settings/agent-provider-assignments/agent-jarvis', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerId: 'prov-deepseek', modelId: 'deepseek-v4-flash', routingMode: 'preferred', enabled: true }),
});
const conv2 = await j('/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: `LongCat override ${stamp}` }),
});
const conv2Id = conv2.body?.id || conv2.body?.conversation?.id || conv2.body?.conversationId;
if (conv2Id) {
  const sse2 = await fetch(BASE + `/api/jarvis/conversations/${conv2Id}/message/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Reply with exactly: OVERRIDE_WINS',
      operationId: 'lc-ov-' + stamp,
      overrideProvider: 'prov-longcat',
      overrideModel: 'meituan/longcat-2.0',
    }),
  });
  const text2 = await sse2.text();
  const events2 = parseSse(text2);
  const done2 = events2.find((e) => e.event === 'done')?.data;
  results.overridePrecedence = {
    httpStatus: sse2.status,
    done: done2 ? { provider: done2.provider, model: done2.model, route: done2.route } : null,
    routedToLongCat: !!done2 && done2.model === 'meituan/longcat-2.0',
  };
}

// 6. REGRESSION: restore DeepSeek assignment; DeepSeek turn still works.
await j('/api/settings/agent-provider-assignments/agent-jarvis', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ providerId: 'prov-deepseek', modelId: 'deepseek-v4-flash', routingMode: 'preferred', enabled: true }),
});
const conv3 = await j('/api/jarvis/conversations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: `DeepSeek regression ${stamp}` }),
});
const conv3Id = conv3.body?.id || conv3.body?.conversation?.id || conv3.body?.conversationId;
if (conv3Id) {
  const sse3 = await fetch(BASE + `/api/jarvis/conversations/${conv3Id}/message/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Reply with exactly: DS_OK', operationId: 'lc-ds-' + stamp }),
  });
  const text3 = await sse3.text();
  const events3 = parseSse(text3);
  const done3 = events3.find((e) => e.event === 'done')?.data;
  results.deepseekRegression = {
    httpStatus: sse3.status,
    done: done3 ? { provider: done3.provider, model: done3.model } : null,
    routedToDeepSeek: !!done3 && done3.model === 'deepseek-v4-flash',
  };
}

// 7. Conversations preserved.
const convs = await j('/api/jarvis/conversations');
results.conversationCount = Array.isArray(convs.body) ? convs.body.length : -1;

console.log('RESULT ' + JSON.stringify(results, null, 1));
