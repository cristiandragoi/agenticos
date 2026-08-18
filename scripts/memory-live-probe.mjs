// Live production memory endpoints against the RUNNING backend (PID from process list).
const API = 'http://127.0.0.1:4000/api';
async function main() {
  const endpoints = [
    `${API}/memory/memories?status=active&limit=5`,
    `${API}/memory/search?q=laguna&limit=3`,
    `${API}/memory/search?q=model&limit=3`,
    `${API}/memory/decisions`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      let preview = text.slice(0, 500);
      try { preview = JSON.stringify(JSON.parse(text).slice ? JSON.parse(text).slice(0, 3) : JSON.parse(text), null, 1).slice(0, 700); } catch {}
      console.log('===', url.split('/api/')[1], 'HTTP', res.status);
      console.log(preview);
    } catch (e) {
      console.log('===', url.split('/api/')[1], 'ERR', String(e).slice(0, 150));
    }
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
