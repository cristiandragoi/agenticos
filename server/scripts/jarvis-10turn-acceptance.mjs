// 10-turn natural multi-turn acceptance over the REAL LiveKit data channel.
// Harness identity is synthetic (not the user's mic) — proves transport, routing,
// response composition, ownership markers end-to-end on the deployed backend.
import { Room, RoomEvent } from '@livekit/rtc-node';

const API = 'http://127.0.0.1:4600';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const turns = [
  { t: 'Hello Jarvis, quick one: what model are you?', kind: 'T1 short answer' },
  { t: 'Nice. Now explain fully in a long answer everything you can do for me on this machine, all the main things in order.', kind: 'T2 long multi-sentence' },
  { t: 'What is the status of the Free Cash project?', kind: 'T3 project status' },
  { t: 'Yes, go ahead.', kind: 'T4 follow-up yes' },
  { t: 'No, you did not actually start anything.', kind: 'T5 correction' },
  { t: 'Forget that. What is the weather like for working today?', kind: 'T6 topic change' },
  { t: 'Give me a very long detailed status of every single project you know about, with all the tasks and blockers, read them all out.', kind: 'T7 barge-in target' },
  { t: 'Stop, ignore that, quick question instead: are you still there?', kind: 'T7b barge-in' },
  { t: 'Good. Is anything running for me right now?', kind: 'T8 task-event window' },
  { t: 'Thank you, that is all for today. Goodbye.', kind: 'T9 final no interruption' },
];

const tokRes = await fetch(`${API}/api/jarvis-next/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: 'acceptance-harness-01', name: 'Acceptance Harness' }),
});
const tok = await tokRes.json();
if (!tok.token || !tok.wsUrl) { console.log('TOKEN_FAIL ' + JSON.stringify(tok).slice(0, 200)); process.exit(1); }
console.log('TOKEN_OK ws=' + tok.wsUrl);

const enc = new TextEncoder();
const room = new Room();
const events = [];
let lastAssistantAt = 0;
let lastAssistantText = '';

room.on(RoomEvent.DataReceived, (payload) => {
  try {
    const d = JSON.parse(new TextDecoder().decode(payload));
    const at = Date.now();
    if (d.type === 'assistant_text') { lastAssistantAt = at; lastAssistantText = d.text || ''; events.push({ at, ev: 'assistant_text', text: (d.text || '').slice(0, 220) }); }
    else if (d.type === 'status') events.push({ at, ev: 'status', state: d.state, speaking: !!d.isSpeaking });
    else if (d.type === 'stop_playback') events.push({ at, ev: 'stop_playback', reason: d.reason });
    else if (d.type === 'provisional_barge_in') events.push({ at, ev: 'provisional_barge_in' });
    else if (d.type === 'NAVIGATE_REQUEST') {
      const ack = enc.encode(JSON.stringify({
        type: 'NAVIGATE_ACK', navigationId: d.navigationId, success: true,
        actualRoute: d.route || '/dashboard',
      }));
      room.localParticipant.publishData(ack, { reliable: true }).catch(() => {});
      events.push({ at, ev: 'navigate_ack_sent', route: d.route });
    }
  } catch { /* ignore non-JSON */ }
});

await room.connect(tok.wsUrl, tok.token);
const SESSION_START = Date.now();
console.log('CONNECTED ' + new Date().toISOString() + ' SESSION_START_MS=' + SESSION_START);

async function publish(text) {
  await room.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'user_text', text })), { reliable: true });
  events.push({ at: Date.now(), ev: 'SEND', text: text.slice(0, 90) });
}

async function waitForAssistant(afterMs, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (lastAssistantAt >= afterMs) return true;
    await sleep(200);
  }
  return false;
}

for (let i = 0; i < turns.length; i++) {
  const u = turns[i];
  const mark = Date.now();
  await publish(u.t);
  if (u.kind === 'T7 barge-in target') {
    await sleep(4000); // interrupt mid-playout with the next user_text
    events.push({ at: Date.now(), ev: 'TURN_RESULT', turn: u.kind, answered: lastAssistantAt >= mark, note: 'interrupted_by_T7b' });
    continue;
  }
  const ok = await waitForAssistant(mark, 75000);
  events.push({ at: Date.now(), ev: 'TURN_RESULT', turn: u.kind, answered: ok, text: ok ? lastAssistantText.slice(0, 160) : '' });
  await sleep(1500);
}

await sleep(25000); // let the final playout finish completely
events.push({ at: Date.now(), ev: 'HARNESS_DONE' });
console.log('EVENTS_JSON_BEGIN');
console.log(JSON.stringify(events));
console.log('EVENTS_JSON_END');
await room.disconnect();
process.exit(0);
