/* RO1 deploy: verify E2E trace marker in canonical packaged data dir + live data via API */
const fs = require('fs');
const marker = 'C:/Users/Cris/AppData/Roaming/agenticos/data/revenue-operator/e2e-mission-trace.json';
console.log('packaged marker exists:', fs.existsSync(marker));
if (fs.existsSync(marker)) {
  const t = JSON.parse(fs.readFileSync(marker, 'utf-8'));
  console.log('marker status:', t.status, '| mission:', t.missionId, '| experiment:', t.experimentId, '| expStatus:', t.experimentStatus, '| next:', t.nextAction);
}
(async () => {
  const missions = await (await fetch('http://localhost:4000/api/revenue-operator/missions')).json();
  console.log('missions via packaged API:', missions.missions.length, missions.missions.map(m => `${m.id} target=${m.targetAmount} status=${m.status}`).join(' | '));
  const exps = await (await fetch('http://localhost:4000/api/revenue-operator/experiments')).json();
  console.log('experiments via packaged API:', exps.experiments.length, exps.experiments.map(e => `${e.id} ${e.engine} ${e.status}`).join(' | '));
  const obs = await (await fetch(`http://localhost:4000/api/revenue-operator/observability/${missions.missions[0]?.id || 'x'}`)).json();
  console.log('observability keys:', Object.keys(obs).join(','));
})();
