// END-TO-END VOICE PROOF: synthesize real speech, publish it as a microphone
// track into the isolated room, and verify STT → same turn router → answer.
import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import { Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } from '@livekit/rtc-node';

const HOST = 'http://127.0.0.1:7880';
const WS = 'ws://127.0.0.1:7880';
const ROOM = process.env.VERIFY_ROOM || 'voice-verify';
const DIST = 'D:/AgenticOS/server/dist';

const PHRASES = [
  ['V1 arithmetic', 'What is 2 + 2?'],
  ['V2 project list', 'What projects do we have?'],
  ['V3 open project', 'Open Free Cash.'],
  ['V4 ctx blocked', 'What is blocked?'],
  ['V5 find operator', 'Find Revenue Operator.'],
  ['V6 ctx what is it doing', 'What is it doing?'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { synthesizeLocally } = await import(`file:///${DIST}/services/voice/localTts.js`);
const { mp3ToPcmFrames } = await import(`file:///${DIST}/domains/jarvisNext/audioUtils.js`);
import fs from 'node:fs';

const svc = new RoomServiceClient(HOST, 'devkey', 'secret');
const rooms = await svc.listRooms();
if (!rooms.find((r) => r.name === ROOM)) { console.error(`VERIFY_ROOM_NOT_FOUND: ${ROOM}`); process.exit(2); }
console.log(`TEST_ROOM=${ROOM}`);

const at = new AccessToken('devkey', 'secret', { identity: 'voice-e2e-speaker' });
at.addGrant({ roomJoin: true, room: ROOM, canSubscribe: true, canPublish: true, canPublishData: true });

const rtc = new Room();
let inbox = [];
let transcripts = [];
rtc.on(RoomEvent.DataReceived, (payload) => {
  try {
    const d = JSON.parse(new TextDecoder().decode(payload));
    if (d.type === 'assistant_text' && d.text) inbox.push(d.text);
    if (d.type === 'transcript' || d.type === 'user_transcript') transcripts.push(d.text || JSON.stringify(d));
  } catch {}
});
await rtc.connect(WS, await at.toJwt(), { autoSubscribe: false });

const source = new AudioSource(24000, 1);
const track = LocalAudioTrack.createAudioTrack('e2e-microphone', source);
await rtc.localParticipant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
console.log('speaker published microphone track\n');
await sleep(3000);

const silence = (ms) => {
  const frames = [];
  for (let i = 0; i < ms / 20; i++) frames.push(new AudioFrame(new Int16Array(480), 24000, 1, 480));
  return frames;
};

const TRACE_PATH = 'D:/AgenticOS/data/jarvis-runtime-trace.log';

function parseTraceLatencies(sinceMs) {
  try {
    if (!fs.existsSync(TRACE_PATH)) return null;
    const lines = fs.readFileSync(TRACE_PATH, 'utf8').split('\n');
    const recent = lines.filter(l => {
      const m = l.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
      return m && new Date(m[1]).getTime() >= sinceMs - 1000;
    });

    const events = {};
    for (const l of recent) {
      const tsMatch = l.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
      if (!tsMatch) continue;
      const ts = new Date(tsMatch[1]).getTime();
      if (l.includes('[JRT] USER_SPEECH_END')) events.USER_SPEECH_END = ts;
      if (l.includes('[JRT] VAD_END_OF_TURN')) events.VAD_END_OF_TURN = ts;
      if (l.includes('[JRT] STT_START')) events.STT_START = ts;
      if (l.includes('[JRT] STT_FINAL')) events.STT_FINAL = ts;
      if (l.includes('[JRT] ROUTER_START')) events.ROUTER_START = ts;
      if (l.includes('[JRT] ROUTER_RESULT')) events.ROUTER_RESULT = ts;
      if (l.includes('[JRT] TTS_START')) events.TTS_START = ts;
      if (l.includes('[JRT] TTS_FIRST_PCM')) events.TTS_FIRST_PCM = ts;
      if (l.includes('[JRT] LIVEKIT_FIRST_FRAME')) events.LIVEKIT_FIRST_FRAME = ts;
      if (l.includes('[JRT] CLIENT_FIRST_AUDIO')) events.CLIENT_FIRST_AUDIO = ts;
    }
    return events;
  } catch {
    return null;
  }
}

const results = [];
for (const [label, phrase] of PHRASES) {
  inbox = []; transcripts = [];
  console.log(`=== ${label}`);
  console.log(`  SPEAKING: "${phrase}"`);
  const mp3 = await synthesizeLocally(phrase);
  const speech = await mp3ToPcmFrames(mp3, 24000, 20);

  const t0 = Date.now();
  for (const f of [...silence(300), ...speech, ...silence(1800)]) {
    await source.captureFrame(f);
  }
  console.log(`  spoke ${speech.length} frames (${(speech.length * 0.02).toFixed(2)}s), waiting for reply...`);

  while (Date.now() - t0 < 60000 && inbox.length === 0) await sleep(300);
  if (inbox.length) await sleep(1200);

  const ms = Date.now() - t0;
  console.log(`  TRANSCRIPTS: ${transcripts.join(' | ') || '(none seen on data channel)'}`);
  console.log(`  <<< [${(ms / 1000).toFixed(1)}s] ${inbox.join(' | ') || '(NO ANSWER)'}`);

  const ev = parseTraceLatencies(t0);
  let latencies = null;
  if (ev?.USER_SPEECH_END && ev?.LIVEKIT_FIRST_FRAME) {
    latencies = {
      speechEndToSttFinal: (ev.STT_FINAL && ev.USER_SPEECH_END) ? Math.max(0, ev.STT_FINAL - ev.USER_SPEECH_END) : null,
      sttFinalToRoute: (ev.ROUTER_RESULT && ev.STT_FINAL) ? Math.max(0, ev.ROUTER_RESULT - ev.STT_FINAL) : null,
      routeToTtsStart: (ev.TTS_START && ev.ROUTER_RESULT) ? Math.max(0, ev.TTS_START - ev.ROUTER_RESULT) : null,
      ttsToFirstAudio: (ev.LIVEKIT_FIRST_FRAME && ev.TTS_START) ? Math.max(0, ev.LIVEKIT_FIRST_FRAME - ev.TTS_START) : null,
      totalSpeechEndToFirstAudio: Math.max(0, ev.LIVEKIT_FIRST_FRAME - ev.USER_SPEECH_END),
    };
    console.log(`  LATENCIES:`, JSON.stringify(latencies, null, 2));
  }
  console.log('');

  results.push({ label, phrase, answer: inbox.join(' | '), ms, latencies });
  await rtc.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'stop_speaking' })), { reliable: true });
  await sleep(2000);
}

console.log('================== VOICE SPEED & ACCURACY SUMMARY ==================');
for (const r of results) {
  const l = r.latencies;
  const lStr = l ? `total=${l.totalSpeechEndToFirstAudio}ms (stt=${l.speechEndToSttFinal}ms route=${l.sttFinalToRoute}ms tts=${l.ttsToFirstAudio}ms)` : `e2e=${r.ms}ms`;
  console.log(`${r.label.padEnd(24)} ${lStr.padEnd(52)} ${r.answer.slice(0, 100) || 'NO ANSWER'}`);
}
await rtc.disconnect();
process.exit(0);

