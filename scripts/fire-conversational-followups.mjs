// fire-conversational-followups.mjs — send the 4 maintenance follow-up questions
// through the canonical route. These route to answerStatus (persisted evidence,
// no paid LLM). Prints each response.
const CONV = 'conv-fcf6c9a8-';
const BASE = 'http://127.0.0.1:4000';

const questions = [
  'what did Hermes recommend?',
  'what did CodeX change?',
  'did the fix work?',
  'where were we?'
];

for (const q of questions) {
  const body = JSON.stringify({ prompt: q, operationId: `op-followup-${Date.now()}` });
  try {
    const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    console.log('\n=== Q:', q, '===');
    console.log('HTTP', res.status, 'route=', parsed?.route, 'status=', parsed?.status, 'error=', parsed?.error || '(none)');
  } catch (e) {
    console.log('\n=== Q:', q, '=== ERROR', e?.message);
  }
}

// Also pull the latest conversation messages to capture Jarvis's natural replies.
try {
  const res = await fetch(`${BASE}/api/jarvis/conversations/${CONV}/messages`);
  const msgs = await res.json();
  const arr = Array.isArray(msgs) ? msgs : [];
  console.log('\n\n=== LATEST AGENT MESSAGES ===');
  for (const m of arr.slice(-8)) {
    if (m.role === 'agent') console.log('\n[agent]', String(m.content || '').slice(0, 400));
  }
} catch (e) { console.log('messages err', e?.message); }
