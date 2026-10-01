import { revenueSupervisor } from './src/services/revenueOperator/revenueSupervisor.js';
import { logger } from './src/utils/logger.js';

logger.info('[Revenue Operator] Initializing...');

// Initialize - ensure supervisor is active
const initialState = revenueSupervisor.setControlState('START');
logger.info(`[Revenue Operator] Initial state: ${initialState.state}`);

// Run one cycle to verify it's operational
async function demonstrate() {
  try {
    logger.info('[Revenue Operator] Running demonstration cycle...');
    const result = await revenueSupervisor.runSupervisorCycle();
    
    console.log('\n=== Revenue Operator Status ===');
    console.log('Control State:', result.status.controlState);
    console.log('Active Mission:', result.status.activeMissionId ?? 'None');
    console.log('Cycle Count:', result.status.cycleCount);
    console.log('Last Cycle At:', result.status.lastCycleAt);
    console.log('Branches:', result.status.branches.length);
    console.log('Active Branches:', result.status.activeBranchesCount);
    console.log('Completed:', result.status.completedBranchesCount);
    console.log('Outcome:', result.outcome);
    console.log('Reason:', result.reason);
    
    if (result.action) {
      logger.info('[Revenue Operator] Executed action:', result.action.actionType);
    } else {
      logger.info('[Revenue Operator] No action needed in this cycle');
    }
    
    return result;
  } catch (err) {
    logger.error(`[Revenue Operator] Error during demonstration: ${err.message}`, err.errors);
    console.log('\n=== Revenue Operator Error ===');
    console.log('Error:', err?.message);
    if (err.errors) {
      for (const e of err.errors) {
        console.log('  -', e.message, 'code:', e.code);
      }
    }
  }
}

await demonstrate();
logger.info('[Revenue Operator] Ready');
