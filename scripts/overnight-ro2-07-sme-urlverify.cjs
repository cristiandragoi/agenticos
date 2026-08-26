/* OVERNIGHT RO2 — Phase 6: verify SME websites actually exist (anti-fabrication).
 * Uses its OWN state file to avoid racing with the build script's writes. */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const OUT = 'B:/AgenticOS/workspace/root/overnight-ro2-sme-urls.json';
const missionId = JSON.parse(FS.readFileSync('B:/AgenticOS/workspace/root/overnight-ro2-state.json', 'utf-8')).missionId;

async function api(path, opts) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 250)}`);
  return body;
}

function urlsOf(exp) {
  const text = [exp.hypothesis, exp.problem, exp.targetCustomer, ...(exp.evidence || []).map(e => (e.summary || '') + ' ' + (e.source || ''))].filter(Boolean).join(' ');
  return [...new Set(text.match(/https?:\/\/[^\s,)"']+/g) || [])];
}

(async () => {
  const exps = (await api(`/api/revenue-operator/experiments?missionId=${missionId}`)).experiments;
  const sme = exps.filter(e => e.engine === 'german_sme' && e.status !== 'KILLED');
  console.log('SME candidates with URLs to verify:', sme.length);
  const out = [];
  for (const exp of sme) {
    const urls = urlsOf(exp);
    let live = null;
    for (const u of urls.slice(0, 2)) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(u, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(t);
        live = { url: u, status: r.status, ok: r.ok, contentType: (r.headers.get('content-type') || '').slice(0, 40) };
        if (r.ok) break;
      } catch (e) {
        live = { url: u, error: String(e.message).slice(0, 100) };
      }
    }
    out.push({ id: exp.id, name: (exp.targetCustomer || exp.hypothesis).slice(0, 80), live });
    console.log(`${live?.ok ? 'LIVE' : 'DEAD'} ${exp.id} ${(exp.targetCustomer || '').slice(0, 48)} -> ${live ? (live.status || live.error) : 'no url'}`);
    FS.writeFileSync(OUT, JSON.stringify(out, null, 2));
  }
  const liveCount = out.filter(c => c.live?.ok).length;
  console.log(`\nURL VERIFY: ${liveCount}/${out.length} websites live`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
