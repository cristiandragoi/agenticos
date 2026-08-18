// Final consolidated Phase-15 runtime evidence dump.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:4000';
const OUT_DIR = path.join(__dirname, 'p3-shots', 'voice-p15');
mkdirSync(OUT_DIR, { recursive: true });

const proof1 = JSON.parse(readFileSync(path.join(OUT_DIR, 'p15-proof.json'), 'utf8'));
const proof2 = JSON.parse(readFileSync(path.join(OUT_DIR, 'p15-proof2.json'), 'utf8'));

// Latest current-work answers with real text.
const convRes = await fetch(`${BASE}/api/jarvis/conversations`);
const convs = await convRes.json();
const list = Array.isArray(convs) ? convs : [];
const sorted = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
const cwAnswers = [];
for (const c of sorted.slice(0, 6)) {
  const msgsRes = await fetch(`${BASE}/api/jarvis/conversations/${c.id}/messages`);
  const msgs = await msgsRes.json();
  const rows = Array.isArray(msgs) ? msgs : [];
  for (const m of rows) {
    if (m?.metadata?.model === 'current-work-context') {
      cwAnswers.push({ conv: c.id, at: m.createdAt, text: String(m.content || '').slice(0, 300) });
    }
  }
}

// Latency breakdown from the renderer timeline (first fresh turn only).
const tl = proof1.rendererResult.timeline || [];
const map = new Map(tl.map((e) => [e.key, e.at]));
const delta = (a, b) => (map.get(a) && map.get(b) ? map.get(b) - map.get(a) : null);
const latency = {
  sendToFirstModelToken: delta('modelRequestStartAt', 'firstModelTokenAt'),
  firstTokenToTtsRequest: delta('firstModelTokenAt', 'ttsRequestStartAt'),
  ttsRequestToAudioReady: delta('ttsRequestStartAt', 'ttsAudioReadyAt'),
  audioReadyToPlaybackStart: delta('ttsAudioReadyAt', 'audioPlaybackStartAt'),
  sendToPlaybackStart: proof1.rendererResult.elapsedMs,
  note: 'elapsedMs is the REAL fresh-turn measurement (send click → audioPlaybackStartAt) on the deployed packaged app',
};

const out = {
  serverLatencyMs: {
    presence: { firstChunkMs: proof1.serverLatency.p1.firstChunkMs, doneMs: proof1.serverLatency.p1.doneMs, route: proof1.serverLatency.p1.route },
    localKnowledge: { firstChunkMs: proof1.serverLatency.p2.firstChunkMs, route: proof1.serverLatency.p2.route },
    currentWork: { firstChunkMs: proof1.serverLatency.p3.firstChunkMs, route: proof1.serverLatency.p3.route },
    llmExplanation: { firstChunkMs: proof1.serverLatency.p4.firstChunkMs, route: proof1.serverLatency.p4.route },
  },
  rendererLatency: latency,
  voiceIdentity: {
    synthesisCount: proof2.identity.count,
    distinctVoiceIds: proof2.identity.distinct,
    records: proof2.identity.records,
  },
  currentWorkAnswers: cwAnswers.slice(-4),
};
writeFileSync(path.join(OUT_DIR, 'p15-final-evidence.json'), JSON.stringify(out, null, 2));
console.log('FINAL_EVIDENCE ' + JSON.stringify(out, null, 2));
