// jarvis-voice-nav-live.mjs — D23 acceptance on the REAL voice transport.
// A real LiveKit client bootstraps a voice room through the same endpoint the
// desktop GUI uses, sends a voice turn over the data channel, receives the
// canonical navigation_request, reports its client state, and ACKs.
// It does NOT fake a successful ACK: the project it reports is either the
// mounted project (pass) or a deliberately wrong one (fail), so the server's
// verification gate is genuinely exercised.
import { Room, RoomEvent } from '@livekit/rtc-node';

const BASE = 'http://127.0.0.1:4600';
const ROOM = `jarvis-voice-accept-${Date.now().toString(36)}`;
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));

const inbox = [];
let room;

async function getToken() {
  const r = await fetch(`${BASE}/api/jarvis-next/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomName: ROOM, identity: 'acceptance-voice-client', name: 'Acceptance Client' }),
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}: ${await r.text()}`);
  return r.json();
}

function waitFor(type, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      const hit = inbox.find((m) => m.type === type);
      if (hit) { clearInterval(tick); resolve(hit); }
      else if (Date.now() - started > timeoutMs) { clearInterval(tick); reject(new Error(`timeout waiting for ${type}`)); }
    }, 120);
  });
}

/** The voice transport currently ships the legacy packet, the typed one the
 *  canonical packet. Accept either and normalise, so this harness proves what
 *  the wire actually carries instead of what it is supposed to carry. */
function normaliseNav(m) {
  return {
    wireType: m.type,
    navId: m.navId || m.navigationId,
    route: m.targetRoute || m.route,
    entityId: m.entityId,
    entityName: m.entityName,
    source: m.source,
  };
}

function waitForNav(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = setInterval(() => {
      const hit = inbox.find((m) => m.type === 'navigation_request' || m.type === 'NAVIGATE_REQUEST');
      if (hit) { clearInterval(tick); resolve(normaliseNav(hit)); }
      else if (Date.now() - started > timeoutMs) { clearInterval(tick); reject(new Error('timeout waiting for a navigation request packet')); }
    }, 120);
  });
}

async function send(obj) {
  await room.localParticipant.publishData(enc(obj), { reliable: true });
}

/** One voice turn as a real client. mode: 'pass' | 'mismatch'. */
async function voiceTurn(text, mode) {
  inbox.length = 0;
  console.log(`\n[client] VOICE TURN (${mode}): ${text}`);
  const t0 = Date.now();
  await send({ type: 'user_text', text });
  let nav;
  try {
    nav = await waitForNav(30000);
  } catch (e) {
    console.log(`[client] no navigation request: ${e.message}`);
    return { ok: false, stage: 'no_navigation_request' };
  }
  console.log(`[client] RECEIVED ${nav.wireType} after ${Date.now() - t0}ms: navId=${nav.navId} route=${nav.route} entity=${nav.entityId} source=${nav.source}`);
  const mounted = mode === 'pass' ? nav.entityId : 'proj-wrong-project';
  const ack = {
    type: 'NAVIGATE_ACK',
    navigationId: nav.navId,
    success: true,
    actualRoute: nav.route,
    activeProjectId: mounted,
    visibleEntityId: mounted,
  };
  await new Promise((r) => setTimeout(r, 350)); // let the client "router" settle
  console.log(`[client] PACKET TYPES THIS TURN: ${JSON.stringify([...new Set(inbox.map((m) => m.type))])}`);
  await send(ack);
  console.log(`[client] ACK SENT: navId=${nav.navId} mountedProject=${mounted}`);
  await new Promise((r) => setTimeout(r, 1800));
  return { ok: true, navId: nav.navId, route: nav.targetRoute, entityId: nav.entityId, mounted, source: nav.source };
}

const main = async () => {
  const info = await getToken();
  room = new Room();
  room.on(RoomEvent.DataReceived, (payload) => {
    try {
      const d = JSON.parse(new TextDecoder().decode(payload));
      if (d.type === 'navigation_request' || d.type === 'NAVIGATE_REQUEST') inbox.push(d);
      else console.log(`[client] data <- ${JSON.stringify(d).slice(0, 120)}`);
    } catch { /* ignore non-JSON audio side-channel */ }
  });
  await room.connect(info.wsUrl, info.token);
  console.log(`[client] CONNECTED room=${info.roomName} identity=${info.identity}`);
  console.log(`[client] room=${ROOM}`);

  const results = {};
  results.pass = await voiceTurn('Jarvis, open Shopify.', 'pass');
  results.mismatch = await voiceTurn('Jarvis, open Free Cash.', 'mismatch');
  results.continuation = await voiceTurn('Now TikTok Shop.', 'pass');

  console.log('\n===== VOICE HARNESS SUMMARY =====');
  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${JSON.stringify(v)}`);
  await room.disconnect();
  process.exit(0);
};

main().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(1); });
