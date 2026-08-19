const base = 'http://127.0.0.1:4001/api';
async function main() {
  const paths = [
    '/voice/health',
    '/settings/gateway/credentials-status',
    '/settings/agent-provider-assignments/agent-jarvis',
    '/health',
    '/health/gateway',
    '/providers',
  ];
  for (const p of paths) {
    try {
      const res = await fetch(base + p);
      const txt = await res.text();
      console.log(p, '->', res.status, txt.slice(0, 400));
    } catch (e) { console.log(p, 'ERROR', e.message); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
