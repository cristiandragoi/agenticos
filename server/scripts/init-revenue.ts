/**
 * Initialize and start Revenue Operator capability.
 * Registers supervisor state, opens fresh session, reads ledger.
 */
import { db, databasePath } from '../src/index.js';
import { readFileSync } from 'fs';

async function main() {
  const session = `revenue-boot-$(date +%s)`;
  
  // Initialize supervisor singleton
  const existing = db.prepare(
    "SELECT status FROM revenue_supervisor_state WHERE id = ?"
  ).get('supervisor-singleton');
  
  if (!existing) {
    console.log('[INIT] Creating supervisor singleton state...');
    const inserted = db.insert(revenue_missions).values({
      id: 'mission-$(date +%s)',
      status: 'PAUSED',
      cycle_count: 0,
      last_cycle_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    console.log(`[INIT] Created mission placeholder: ${inserted}`);
  }
  
  const allMissions = db.prepare(
    "SELECT id, status FROM revenue_missions ORDER BY created_at DESC LIMIT 1"
  ).get();
  
  console.log('[READY] Revenue Operator initialized');
  console.log('   Mission:', allMissions?.status || 'no mission yet');
}

main().catch(console.error);
