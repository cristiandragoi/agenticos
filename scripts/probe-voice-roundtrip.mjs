// Real audio round-trip: TTS generates speech → transcribe that audio → text back.
// Proves the STT+TTS endpoints work with ACTUAL speech audio, from source.
const base = 'http://127.0.0.1:4001/api';
import fs from 'node:fs';

async function main() {
  // 1) TTS: generate real speech audio
  const ttsRes = await fetch(base + '/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Hello Jarvis, this is a microphone test.',
      agentId: 'agent-jarvis',
      voice: 'aura-helios-en',
    }),
  });
  const ttsJson = await ttsRes.json();
  console.log('TTS status:', ttsRes.status, '| success:', ttsJson.success, '| voice:', ttsJson.voice, '| sizeBytes:', ttsJson.sizeBytes);
  if (!ttsJson.audioData) { console.log('TTS body:', JSON.stringify(ttsJson).slice(0, 400)); return; }

  const audioBuf = Buffer.from(ttsJson.audioData, 'base64');
  fs.writeFileSync('B:/AgenticOS/scripts/voice-roundtrip.mp3', audioBuf);

  // 2) Transcription: feed that audio back. Deepgram listen accepts mp3.
  const fd = new FormData();
  fd.append('audio', new Blob([audioBuf], { type: 'audio/mpeg' }), 'roundtrip.mp3');
  const sttRes = await fetch(base + '/voice/transcribe', { method: 'POST', body: fd });
  const sttJson = await sttRes.json();
  console.log('STT status:', sttRes.status);
  console.log('STT text:', sttJson.text || JSON.stringify(sttJson).slice(0, 400));
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
