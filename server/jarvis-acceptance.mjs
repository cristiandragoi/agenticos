// JARVIS functional acceptance suite. Binds explicitly to the isolated room.
import Database from 'better-sqlite3';
import path from 'node:path';
import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import { Room, RoomEvent } from '@livekit/rtc-node';

const HOST = 'http://127.0.0.1:7880';
const WS = 'ws://127.0.0.1:7880';
const VERIFY_ROOM = process.env.VERIFY_ROOM || 'voice-verify';
const DRIVER_ID = 'voice-test-driver';
const AGENT_ID = 'jarvis-next-assistant';
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 45000);
const DB = path.join(process.env.APPDATA, 'AgenticOS', 'data', 'agentic-os.db');

const UNIQUE = `The violet pangolin audits ledger ${Math.floor(Math.random() * 100000)}.`;

const SUITE = [
  ['01 basic reasoning',      'What is 2 + 2?',                                   /(^|\D)4(\D|$)/],
  ['02a seed memory',         UNIQUE,                                             /(?:got it|noted|understood|okay)/i],
  ['02b immediate memory',    'Repeat exactly what I just said.',                 new RegExp(UNIQUE.slice(4, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')],
  ['03 project list',         'What projects do we have?',                        /free cash/i],
  ['04 open project',         'Open Free Cash.',                                  /free cash/i],
  ['05 ctx blocked',          'What is blocked?',                                 /free cash/i],
  ['06 ctx running',          'What is running?',                                 /free cash/i],
  ['07 find operator',        'Find Revenue Operator.',                           /revenue operator/i],
  ['08 ctx what is it doing', 'What is it doing?',                                /revenue operator/i],
  ['09 ctx its missions',     'What missions does it have?',                      /7 missions|seven missions/i],
  ['10 ctx association',      'Which project is it associated with?',             /project/i],
  ['11 ctx start it',         'Start it.',                                        /start|capability|supervisor/i],
  ['12 priority mutation',    'Set Hermes Operational Acceptance to priority 4.', /priority 4|verification/i],
  ['13 priority read back',   'What priority is it now?',                         /priority 4/i],
  ['14 unknown operator',     'Start Quantum Harvester Operator.',                /can't find|cannot find|no .*operator/i],
  ['15a offer choices',       'Find Revenue Operator.',                           /I can start/i],
  ['15b do the first one',    'Do the first one.',                                /revenue operator|supervisor|start/i],
  ['16 code delegation',      'Where in the code is Revenue Operator implemented?', /codex|repositor|implement/i],
  ['17 self-heal trigger',    'Rename Free Cash to Cash Engine.',                 /no executable rename|self-heal incident/i],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svc = new RoomServiceClient(HOST, 'devkey', 'secret');

const rooms = await svc.listRooms();
const room = rooms.find((r) => r.name === VERIFY_ROOM);
if (!room) { console.error(`VERIFY_ROOM_NOT_FOUND: '${VERIFY_ROOM}' (have: ${rooms.map(r=>r.name).join(', ')||'none'})`); process.exit(2); }
const participants = await svc.listParticipants(VERIFY_ROOM);
console.log(`TEST_ROOM=${room.name}`);
console.log(`PARTICIPANTS=${participants.map((p) => p.identity).join(', ') || '(none)'}`);
if (!participants.find((p) => p.identity === AGENT_ID)) { console.error('AGENT_NOT_IN_VERIFY_ROOM'); process.exit(3); }
const strangers = participants.filter((p) => p.identity !== AGENT_ID && p.identity !== DRIVER_ID);
if (strangers.length) { console.error(`ROOM_NOT_ISOLATED: ${strangers.map(p=>p.identity).join(', ')}`); process.exit(4); }
console.log('ISOLATION=OK\n');

// Baseline DB read for the mutation test.
const dbRead = (sql, ...a) => { const d = new Database(DB, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const before = dbRead('SELECT id,name,priority FROM projects WHERE id=?', 'proj-3edb8bb8');
console.log(`DB_BEFORE: ${JSON.stringify(before)}\n`);

const at = new AccessToken('devkey', 'secret', { identity: DRIVER_ID });
at.addGrant({ roomJoin: true, room: VERIFY_ROOM, canSubscribe: true, canPublish: false, canPublishData: true });

const rtc = new Room();
let inbox = [];
rtc.on(RoomEvent.DataReceived, (payload) => {
  try { const d = JSON.parse(new TextDecoder().decode(payload)); if (d.type === 'assistant_text' && d.text) inbox.push(d.text); } catch {}
});
await rtc.connect(WS, await at.toJwt(), { autoSubscribe: false });
await sleep(1500);

const enc = new TextEncoder();
const results = [];
for (const [label, prompt, expect] of SUITE) {
  inbox = [];
  const t0 = Date.now();
  console.log(`=== ${label}`);
  console.log(`  >>> ${prompt}`);
  await rtc.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'user_text', text: prompt })), { reliable: true });
  while (Date.now() - t0 < MAX_WAIT_MS && inbox.length === 0) await sleep(300);
  if (inbox.length) await sleep(900);
  const ms = Date.now() - t0;
  const answer = inbox.join(' | ') || '(NO ANSWER)';
  const pass = expect === null ? true : expect.test(answer);
  console.log(`  <<< [${(ms/1000).toFixed(1)}s] ${pass ? 'PASS' : 'FAIL'} ${answer}\n`);
  results.push({ label, prompt, answer, ms, pass });
  await rtc.localParticipant.publishData(enc.encode(JSON.stringify({ type: 'stop_speaking' })), { reliable: true });
  await sleep(1200);
}

// Self-heal verification: did an incident actually get recorded?
try {
  const inc = await fetch('http://127.0.0.1:4600/api/self-heal/incidents').then((r) => r.json());
  const list = inc?.incidents || inc || [];
  const recent = (Array.isArray(list) ? list : []).slice(0, 3);
  console.log(`SELF_HEAL_INCIDENTS=${Array.isArray(list) ? list.length : 'n/a'}`);
  for (const i of recent) console.log(`  incident ${i.id || i.incidentId} component=${i.component} status=${i.status}`);
} catch (e) { console.log(`SELF_HEAL_QUERY_ERR ${e?.message}`); }

const after = dbRead('SELECT id,name,priority FROM projects WHERE id=?', 'proj-3edb8bb8');
console.log(`DB_AFTER: ${JSON.stringify(after)}`);
console.log(`MUTATION_VERIFIED_IN_STORE=${after && after.priority === 4 ? 'YES' : 'NO'}\n`);

console.log('================= ACCEPTANCE SUMMARY =================');
let passed = 0;
for (const r of results) {
  if (r.pass) passed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label.padEnd(26)} ${(r.ms/1000).toFixed(1).padStart(5)}s  ${r.answer.slice(0,110)}`);
}
console.log(`\nTOTAL ${passed}/${results.length} passed`);
await rtc.disconnect();
process.exit(0);
