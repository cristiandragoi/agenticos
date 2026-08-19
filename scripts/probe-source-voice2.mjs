const base = 'http://127.0.0.1:4001/api';
async function main() {
  // 1) TTS status — is Deepgram configured for THIS process?
  const tts = await fetch(base + '/voice/tts/status');
  console.log('tts/status:', tts.status, await tts.text());

  // 2) Create a Jarvis conversation (typed path groundwork)
  const conv = await fetch(base + '/jarvis/conversations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const convTxt = await conv.text();
  console.log('create conversation:', conv.status, convTxt.slice(0, 400));

  // 3) health/gateway (provider reachability)
  const gw = await fetch(base + '/health/gateway');
  console.log('health/gateway:', gw.status, (await gw.text()).slice(0, 300));
}
main().catch((e) => { console.error(e); process.exit(1); });
