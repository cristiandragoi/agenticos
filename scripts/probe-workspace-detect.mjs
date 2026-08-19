const base = 'http://127.0.0.1:4001/api';
async function main() {
  for (const bp of ['B:\\AgenticOS', 'C:\\Users\\Cris', '', 'C:\\nonexistent\\path']) {
    const res = await fetch(base + '/workspace/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bp ? { basePath: bp } : {}),
    });
    const data = await res.json();
    console.log(JSON.stringify({ requested: bp || '(empty→cwd)', ...data }));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
