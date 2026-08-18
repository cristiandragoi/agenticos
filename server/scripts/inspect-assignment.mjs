// Inspect the agent-jarvis assignment + the gateway's resolved model for jarvis.
import { rawDb } from '../dist/db/index.js';
try {
  const rows = rawDb.prepare("SELECT agent_id, provider, model, enabled FROM agent_provider_assignments WHERE agent_id = 'agent-jarvis'").all();
  console.log('agent-jarvis assignment rows:', JSON.stringify(rows));
  const all = rawDb.prepare('SELECT agent_id, provider, model, enabled FROM agent_provider_assignments').all();
  console.log('all assignments:', JSON.stringify(all).slice(0, 600));
} catch (e) {
  console.log('query error:', String(e).slice(0, 200));
}
