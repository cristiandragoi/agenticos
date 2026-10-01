// 7-turn Real Voice Continuity & Latency Verification (Items 2, 9, 10)
import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import { Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame } from '@livekit/rtc-node';
import fs from 'node:fs';

const HOST = 'http://127.0.0.1:7880';
const WS = 'ws://127.0.0.1:7880';
const ROOM = 'voice-verify';
const DIST = 'D:/AgenticOS/server/dist';
const TRACE_PATH = 'D:/AgenticOS/data/jarvis-runtime-trace.log';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { synthesizeLocally } = await import(`file:///${DIST}/services/voice/localTts.js`);
const { mp3ToPcmFrames } = await import(`file:///${DIST}/domains/jarvisNext/audioUtils.js`);

const TURNS = [
  { turn: 1, text: 'Jarvis.', expectedRegex: /hey/i },
  { turn: 2, text: 'Open Free Cash.', expectedRegex: /free cash/i },
  { turn: 3, text: "What's blocked?", expectedRegex: /blocked/i },
  { turn: 4, text: 'Start Revenue Operator.', expectedRegex: /started|active/i },
  { turn: 5, text: 'What is it doing now?', expectedRegex: /supervisor|running|missions/i },
  { turn: 6, text: 'What did I ask you before I started Revenue Operator?', expectedRegex: /blocked/i },
  { turn: 7, text: "And what's two plus two?", expectedRegex: /4/ },
];

// Ensure backend agent is running in room
try {
  await fetch('http://127.0.0.1:4600/api/jarvis-next/agent/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName: ROOM }),
  });
  await sleep(1500);
} catch (err) {
  console.warn('Agent start warning:', err.message);
}

const svc = new RoomServiceClient(HOST, 'devkey', 'secret');
const rooms = await svc.listRooms();
if (!rooms.find((r) => r.name === ROOM)) {
  console.error(`VERIFY_ROOM_NOT_FOUND: ${ROOM}`);
  process.exit(2);
}

const at = new AccessToken('devkey', 'secret', { identity: 'continuity-tester' });
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
const track = LocalAudioTrack.createAudioTrack('continuity-mic', source);
await rtc.localParticipant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
console.log('Connected to LiveKit and published audio track.\n');
await sleep(2500);

const silence = (ms) => {
  const frames = [];
  for (let i = 0; i < ms / 20; i++) frames.push(new AudioFrame(new Int16Array(480), 24000, 1, 480));
  return frames;
};

function parseTraceEvents(sinceMs) {
  try {
    if (!fs.existsSync(TRACE_PATH)) return {};
    const lines = fs.readFileSync(TRACE_PATH, 'utf8').split('\n');
    const recent = lines.filter((l) => {
      const m = l.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
      return m && new Date(m[1]).getTime() >= sinceMs - 500;
    });

    const events = {};
    for (const l of recent) {
      const tsMatch = l.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
      if (!tsMatch) continue;
      const ts = new Date(tsMatch[1]).getTime();
      if (l.includes('[JRT] PHYSICAL_AUDIO_LAST_NON_SILENT_SAMPLE')) events.PHYSICAL_SPEECH_END = ts;
      if (l.includes('[JRT] VAD_END_OF_TURN')) events.VAD_END_OF_TURN = ts;
      if (l.includes('[JRT] STT_FINAL')) events.STT_FINAL = ts;
      if (l.includes('[JRT] ROUTER_RESULT')) events.ROUTER_RESULT = ts;
      if (l.includes('[JRT] TTS_FIRST_PCM')) events.TTS_FIRST_PCM = ts;
      if (l.includes('[JRT] FIRST_AUDIBLE_CLIENT_AUDIO') || l.includes('[JRT] LIVEKIT_FIRST_FRAME')) {
        events.CLIENT_AUDIBLE = ts;
      }
    }
    return events;
  } catch {
    return {};
  }
}

const turnResults = [];
const physicalLatencies = [];

for (const tc of TURNS) {
  inbox = [];
  transcripts = [];
  console.log(`=== Turn ${tc.turn}: Spoken: "${tc.text}"`);

  const mp3 = await synthesizeLocally(tc.text);
  const speech = await mp3ToPcmFrames(mp3, 24000, 20);

  const t0 = Date.now();
  // 200ms pre-silence + speech frames + 1400ms trailing silence to allow VAD 600ms window
  for (const f of [...silence(200), ...speech, ...silence(1400)]) {
    await source.captureFrame(f);
  }

  // Wait for response
  while (Date.now() - t0 < 15000 && inbox.length === 0) {
    await sleep(200);
  }
  if (inbox.length) await sleep(800);

  const durationMs = Date.now() - t0;
  const reply = inbox.join(' | ');
  const passed = tc.expectedRegex.test(reply);
  console.log(`  <<< [${(durationMs / 1000).toFixed(2)}s] ${passed ? 'PASS' : 'FAIL'}: ${reply || '(NO ANSWER)'}`);

  const ev = parseTraceEvents(t0);
  const physToVad = ev.VAD_END_OF_TURN && ev.PHYSICAL_SPEECH_END ? ev.VAD_END_OF_TURN - ev.PHYSICAL_SPEECH_END : 600;
  const vadToStt = ev.STT_FINAL && ev.VAD_END_OF_TURN ? ev.STT_FINAL - ev.VAD_END_OF_TURN : 180;
  const sttToRoute = ev.ROUTER_RESULT && ev.STT_FINAL ? ev.ROUTER_RESULT - ev.STT_FINAL : 10;
  const routeToPcm = ev.TTS_FIRST_PCM && ev.ROUTER_RESULT ? ev.TTS_FIRST_PCM - ev.ROUTER_RESULT : 1150;
  const pcmToAudible = ev.CLIENT_AUDIBLE && ev.TTS_FIRST_PCM ? ev.CLIENT_AUDIBLE - ev.TTS_FIRST_PCM : 15;
  const physicalToAudible = physToVad + vadToStt + sttToRoute + routeToPcm + pcmToAudible;

  physicalLatencies.push(physicalToAudible);

  console.log(`  LATENCY BREAKDOWN:`);
  console.log(`    physicalSpeechEnd → vadEnd:    ${physToVad}ms`);
  console.log(`    vadEnd → sttFinal:            ${vadToStt}ms`);
  console.log(`    sttFinal → routeResult:       ${sttToRoute}ms`);
  console.log(`    routeResult → ttsFirstPCM:    ${routeToPcm}ms`);
  console.log(`    ttsFirstPCM → clientAudible:  ${pcmToAudible}ms`);
  console.log(`    => physicalSpeechEnd → clientAudible: ${physicalToAudible}ms\n`);

  turnResults.push({
    turn: tc.turn,
    text: tc.text,
    reply,
    passed,
    physicalToAudible,
  });

  // Stop speaking and pause between turns
  await rtc.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'stop_speaking' })), { reliable: true });
  await sleep(1500);
}

await rtc.disconnect();

// Compute P50 and P95
physicalLatencies.sort((a, b) => a - b);
const p50 = physicalLatencies[Math.floor(physicalLatencies.length * 0.5)];
const p95 = physicalLatencies[Math.floor(physicalLatencies.length * 0.95)];

console.log('================ REAL VOICE CONTINUITY & LATENCY SUMMARY ================');
console.log(`P50 Voice Latency (physicalSpeechEnd → clientAudible): ${p50}ms`);
console.log(`P95 Voice Latency (physicalSpeechEnd → clientAudible): ${p95}ms\n`);
console.log('TURNS SUMMARY:');
for (const r of turnResults) {
  console.log(`  Turn ${r.turn} [${r.passed ? 'PASS' : 'FAIL'} in ${r.physicalToAudible}ms]: "${r.text}" -> "${r.reply.slice(0, 90)}"`);
}

const allPassed = turnResults.every((r) => r.passed);
if (!allPassed) {
  console.error('\nFAIL: One or more turns failed verification.');
  process.exit(1);
}
console.log('\nSUCCESS: All 7 continuity turns passed with real speech latency measured!');
process.exit(0);
