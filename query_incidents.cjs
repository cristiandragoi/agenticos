async function main() {
  const { rawDb } = await import('./server/dist/db/index.js');
  const ids = ['SELFHEAL-259', 'SELFHEAL-260', 'SELFHEAL-261', 'SELFHEAL-6158', 'SELFHEAL-2136', 'SELFHEAL-1466'];
  const placeholders = ids.map(() => '?').join(',');
  const incidents = rawDb.prepare(`SELECT * FROM repair_incidents WHERE id IN (${placeholders})`).all(...ids);
  console.log('FOUND INCIDENTS:', incidents.length);
  for (const inc of incidents) {
    console.log('\n======================================================');
    console.log('ID:', inc.id);
    console.log('STATUS:', inc.status);
    console.log('COMPONENT:', inc.component);
    console.log('DOMAIN:', inc.failure_domain);
    console.log('SYMPTOM:', inc.symptom);
    console.log('DETECTED_AT:', inc.detected_at);
    console.log('RESOLVED_AT:', inc.resolved_at);
    console.log('TRIGGERED_BY:', inc.triggered_by);
    console.log('METADATA:', inc.metadata);
  }
}
main().catch(console.error);
