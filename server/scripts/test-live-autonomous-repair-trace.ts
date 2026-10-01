import { universalExecutionController } from '../src/domains/jarvis/execution/universalExecutionController.js';
import { failureDetector } from '../src/domains/selfHeal/FailureDetector.js';
import { selfHealSupervisor } from '../src/domains/selfHeal/SelfHealSupervisor.js';
import { terminalExecutor } from '../src/domains/jarvis/execution/executors/terminalExecutor.js';
import { filesystemExecutor } from '../src/domains/jarvis/execution/executors/filesystemExecutor.js';
import { gitExecutor } from '../src/domains/jarvis/execution/executors/gitExecutor.js';
import { desktopExecutor } from '../src/domains/jarvis/execution/executors/desktopExecutor.js';
import { browserExecutor } from '../src/domains/jarvis/execution/executors/browserExecutor.js';
import { engineeringExecutor } from '../src/domains/jarvis/execution/executors/engineeringExecutor.js';
import { executeSupervisorTool } from '../src/domains/jarvis/supervisorTools.js';
import { deploymentGate } from '../src/domains/selfHeal/DeploymentGate.js';

async function main() {
  console.log('================================================================');
  console.log('LIVE AUDIT: DOES AGENTICOS HAVE A WORKING AUTONOMOUS SELF-REPAIR?');
  console.log('================================================================\n');

  // 1. REPRODUCE REAL CASE
  console.log('--- EXECUTING REAL FAILURE CASE ---');
  console.log('Prompt: "Open YouTube, find the C Adler channel and start it."\n');

  const conversationId = `audit-${Date.now()}`;
  const turnResult = await universalExecutionController.handleUserTurn({
    prompt: 'Open YouTube, find the C Adler channel and start it.',
    rawStt: 'Open YouTube, find the C Adler channel and start it.',
    sttConfidence: 0.95,
    conversationId,
    workspacePath: 'D:\\AgenticOS',
  });

  console.log('Turn Result:');
  console.log('  Handled:', turnResult.handled);
  console.log('  Success:', turnResult.success);
  console.log('  Route:', turnResult.route);
  console.log('  Entity:', turnResult.entityName);
  console.log('  Response text:', turnResult.response);
  console.log('  Plan steps count:', (turnResult as any).plan?.steps?.length ?? 'none');

  // Check incidents created
  const { repairMemory } = await import('../src/domains/selfHeal/RepairMemory.js');
  const incidents = await repairMemory.listIncidents(10);
  console.log('\nIncident Registry state:');
  console.log('  Total incidents in DB:', incidents.length);
  const recentIncidents = incidents.slice(-3);
  console.log('  Recent incidents:', recentIncidents.map(i => ({ id: i.incidentId, comp: i.component, status: i.status, symptom: i.symptom })));

  // Check SelfHealSupervisor status
  const shStatus = selfHealSupervisor.getStatus();
  console.log('\nSelfHealSupervisor state:');
  console.log('  Active incidents:', shStatus.activeIncidents);

  console.log('\n================================================================');
}

main().catch(console.error);
