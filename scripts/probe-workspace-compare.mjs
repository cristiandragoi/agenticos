const bases = ['http://127.0.0.1:4000/api', 'http://127.0.0.1:4001/api'];
async function main() {
  for (const base of bases) {
    console.log('=== backend', base, '===');
    // 1) current workspace (canonical store)
    try {
      const cur = await fetch(base + '/workspace/current');
      console.log('workspace/current:', JSON.stringify(await cur.json()));
    } catch (e) { console.log('current ERROR', e.message); }
    // 2) detect with empty body (frontend sends this when no path selected)
    try {
      const det = await fetch(base + '/workspace/detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      console.log('detect {}:', JSON.stringify(await det.json()));
    } catch (e) { console.log('detect ERROR', e.message); }
    // 3) detect with explicit repo path
    try {
      const det2 = await fetch(base + '/workspace/detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath: 'B:\\AgenticOS' }),
      });
      console.log('detect B:\\AgenticOS:', JSON.stringify(await det2.json()));
    } catch (e) { console.log('detect2 ERROR', e.message); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
