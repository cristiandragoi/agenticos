/* OVERNIGHT RO2 — Phase 4b: fix score field in state, re-dedupe digital clusters */
const BASE = 'http://localhost:4000';
const FS = require('fs');
const STATE_FILE = 'B:/AgenticOS/workspace/root/overnight-ro2-state.json';
const state = JSON.parse(FS.readFileSync(STATE_FILE, 'utf-8'));

async function api(path, opts) {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(body).slice(0, 250)}`);
  return body;
}

(async () => {
  // Refresh scores from persisted scorePayload (rebuild scoring array if lost)
  const exps = (await api(`/api/revenue-operator/experiments?missionId=${state.missionId}`)).experiments;
  const dp = exps.filter(e => e.engine === 'digital_products');
  if (!Array.isArray(state.scoring)) state.scoring = [];
  const scoreOf = (e) => {
    if (!e.scorePayload) return null;
    try { return (typeof e.scorePayload === 'string' ? JSON.parse(e.scorePayload) : e.scorePayload).overallScore ?? null; } catch { return null; }
  };
  for (const e of dp) {
    const overall = scoreOf(e);
    if (overall == null) continue;
    const existing = state.scoring.find(s => s.id === e.id);
    if (existing) existing.overall = overall;
    else state.scoring.push({ id: e.id, title: (e.product || e.hypothesis).slice(0, 100), overall, go: true });
  }
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  // Dedupe clusters among non-killed digital experiments
  const alive = dp.filter(e => e.status !== 'KILLED');
  const norm = (t) => (t || '').toLowerCase().replace(/[^a-zäöüß ]/g, ' ').split(/\s+/).filter(w => w.length > 3).slice(0, 6).join(' ');
  const clusters = new Map();
  for (const e of alive) {
    const key = norm(e.product || e.hypothesis);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(e);
  }
  state.killedDuplicates = state.killedDuplicates || [];
  let killed = 0;
  const spOf = (e) => { try { return (typeof e.scorePayload === 'string' ? JSON.parse(e.scorePayload) : (e.scorePayload || {})).overallScore || 0; } catch { return 0; } };
  for (const [key, members] of clusters) {
    if (members.length < 2) continue;
    members.sort((a, b) => spOf(b) - spOf(a));
    const [keep, ...rest] = members;
    for (const dup of rest) {
      try {
        await api(`/api/revenue-operator/experiments/${dup.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'KILLED' }) });
        state.killedDuplicates.push({ id: dup.id, title: (dup.product || dup.hypothesis).slice(0, 100), clusterKey: key, keptInstead: keep.id });
        killed++;
        console.log(`DEDUPE KILL ${dup.id}: ${(dup.product || dup.hypothesis).slice(0, 70)}`);
      } catch (e) { console.log(`dedupe kill failed ${dup.id}: ${e.message}`); }
    }
    console.log(`CLUSTER "${key.slice(0, 50)}": kept ${keep.id}, killed ${rest.length}`);
  }
  FS.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  const goList = alive.filter(e => !state.killedDuplicates.some(k => k.id === e.id));
  console.log(`\nDEDUPE DONE: killed=${killed}, remaining digital experiments=${goList.length}`);
  for (const e of goList.slice(0, 40)) {
    const sp = JSON.parse(typeof e.scorePayload === 'string' ? e.scorePayload : JSON.stringify(e.scorePayload || '{}'));
    console.log(`  ${e.id} [${e.status}] score=${sp.overallScore} ${(e.product || e.hypothesis).slice(0, 80)}`);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
