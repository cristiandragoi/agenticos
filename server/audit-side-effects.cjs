const path = require('path');
const Database = require(path.resolve('B:/AgenticOS/server/node_modules/better-sqlite3'));
const db = new Database('C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db', { readonly: true });

console.log('=== EXTERNAL SIDE-EFFECT AUDIT (Roaming) ===');

const mission = db.prepare("SELECT id, realized_revenue, verified_revenue, pipeline_value, actual_cost, net_revenue, actual_spend, status FROM revenue_missions WHERE id = 'mission-616808fe-'").get();
console.log('mission KPIs:', JSON.stringify(mission));
console.log('  => no money spent/moved:', mission.realized_revenue === 0 && mission.verified_revenue === 0 && mission.actual_cost === 0 && mission.actual_spend === 0 && mission.net_revenue === 0);

const pubStatus = db.prepare("SELECT status, COUNT(*) c FROM revenue_experiments WHERE mission_id='mission-616808fe-' AND status IN ('PUBLISHING','LIVE','SCALING','WON') GROUP BY status").all();
console.log('published/live/scaling/won experiments:', JSON.stringify(pubStatus), '=> none published:', pubStatus.length === 0);

const outreach = db.prepare("SELECT COUNT(*) c FROM revenue_compliance_records WHERE outreach_history IS NOT NULL AND outreach_history != 'null'").get().c;
console.log('compliance records with outreach history:', outreach, '=> no outreach sent:', outreach === 0);

const ledgerTypes = db.prepare("SELECT entry_type, COUNT(*) c FROM revenue_ledger_entries WHERE mission_id='mission-616808fe-' GROUP BY entry_type").all();
console.log('ledger entries by type:', JSON.stringify(ledgerTypes));
const externalLedger = ledgerTypes.filter(r => ['REALIZED_REVENUE','VERIFIED_REVENUE','ACTUAL_COST'].includes(r.entry_type));
console.log('  => no external revenue/cost entries:', externalLedger.length === 0);

// Distribution channel auth state (Shopify must still be auth_required)
const shopify = db.prepare("SELECT channel, status FROM revenue_distribution_channels WHERE channel='SHOPIFY'").get();
console.log('Shopify channel status:', JSON.stringify(shopify), '=> not authenticated:', shopify && shopify.status === 'auth_required');

// Gates: 5 resolved (preserved) + 5 open (replacement)
const gates = db.prepare("SELECT status, COUNT(*) c FROM revenue_human_gates GROUP BY status").all();
console.log('gates by status:', JSON.stringify(gates));

// Relay events
const relock = db.prepare("SELECT COUNT(*) c FROM revenue_experiment_events WHERE event_type='test_resolution_relocked' AND actor_id='user-confirmed-ui-test'").get().c;
console.log('test_resolution_relocked events (actor user-confirmed-ui-test):', relock);

// No external web / publish capability used in the continuation runs
const contRuns = db.prepare("SELECT id, trigger FROM runs WHERE task_id LIKE 'task-gate-resume-%'").all();
console.log('gate-resume runs (should be completed, capability_dispatcher trigger, filesystem/http only):', JSON.stringify(contRuns));

db.close();
