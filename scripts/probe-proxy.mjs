const base = 'http://127.0.0.1:5176/api';
async function main() {
  // Through the vite proxy → source backend 4001
  const det = await fetch(base + '/workspace/detect', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ basePath: 'B:\\AgenticOS' }),
  });
  console.log('proxy detect:', det.status, JSON.stringify(await det.json()));

  const tts = await fetch(base + '/voice/tts/status');
  console.log('proxy tts/status:', tts.status, await tts.text());

  const health = await fetch(base + '/health');
  console.log('proxy health:', health.status, (await health.text()).slice(0, 200));
}
main().catch((e) => { console.error(e); process.exit(1); });
