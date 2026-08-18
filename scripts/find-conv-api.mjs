// Find the most recent Jarvis conversation via the running backend API (read-only).
const API = 'http://127.0.0.1:4000/api';
async function main() {
  // Try known list endpoints
  const candidates = [
    `${API}/jarvis/conversations`,
    `${API}/conversations`,
    `${API}/jarvis/conversations?limit=5`
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const text = await res.text();
        console.log('OK', url, text.slice(0, 600));
        return;
      }
      console.log('HTTP', res.status, url);
    } catch (e) {
      console.log('ERR', url, String(e).slice(0, 120));
    }
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
