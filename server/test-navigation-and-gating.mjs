import { routeTurn, getFocus } from './dist/domains/jarvisNext/turnRouter.js';

async function run() {
  console.log('=== STARTING NAVIGATION & GATING ACCEPTANCE TESTS ===\n');

  // Test 1: Open Free Cash.
  const t1 = await routeTurn({ prompt: 'Open Free Cash.', conversationId: 'conv-t1' });
  console.log('TEST 1: Open Free Cash.');
  console.log('  Route:', t1.route);
  console.log('  Entity:', t1.entityName, `(${t1.entityId}, ${t1.entityType})`);
  console.log('  UiRoute:', t1.uiRoute);
  console.log('  Spoken:', t1.text);
  console.log('  Self-Heal?:', t1.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t1.route === 'navigate' && !t1.fallbackReason?.includes('self_heal') && t1.text.includes('Free Cash') ? 'PASS' : 'FAIL');
  console.log();

  // Test 2: Open Revenue Operator.
  const t2 = await routeTurn({ prompt: 'Open Revenue Operator.', conversationId: 'conv-t2' });
  console.log('TEST 2: Open Revenue Operator.');
  console.log('  Route:', t2.route);
  console.log('  Entity:', t2.entityName, `(${t2.entityId}, ${t2.entityType})`);
  console.log('  UiRoute:', t2.uiRoute);
  console.log('  Spoken:', t2.text);
  console.log('  Self-Heal?:', t2.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t2.route === 'navigate' && t2.uiRoute === '/revenue-operator' && !t2.fallbackReason?.includes('self_heal') && t2.text.includes('Revenue Operator') ? 'PASS' : 'FAIL');
  console.log();

  // Test 3: Show Shopify.
  const t3 = await routeTurn({ prompt: 'Show Shopify.', conversationId: 'conv-t3' });
  console.log('TEST 3: Show Shopify.');
  console.log('  Route:', t3.route);
  console.log('  Entity:', t3.entityName, `(${t3.entityId}, ${t3.entityType})`);
  console.log('  UiRoute:', t3.uiRoute);
  console.log('  Spoken:', t3.text);
  console.log('  Self-Heal?:', t3.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t3.route === 'navigate' && !t3.fallbackReason?.includes('self_heal') && t3.text.includes('Shopify') ? 'PASS' : 'FAIL');
  console.log();

  // Test 4: Go to Hermes Operational Acceptance.
  const t4 = await routeTurn({ prompt: 'Go to Hermes Operational Acceptance.', conversationId: 'conv-t4' });
  console.log('TEST 4: Go to Hermes Operational Acceptance.');
  console.log('  Route:', t4.route);
  console.log('  Entity:', t4.entityName, `(${t4.entityId}, ${t4.entityType})`);
  console.log('  UiRoute:', t4.uiRoute);
  console.log('  Spoken:', t4.text);
  console.log('  Self-Heal?:', t4.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t4.route === 'navigate' && !t4.fallbackReason?.includes('self_heal') && t4.text.includes('Hermes Operational Acceptance') ? 'PASS' : 'FAIL');
  console.log();

  // Test 5: Open Revenue Operator -> What is it doing?
  const conv5 = 'conv-t5';
  await routeTurn({ prompt: 'Open Revenue Operator.', conversationId: conv5 });
  const t5 = await routeTurn({ prompt: 'What is it doing?', conversationId: conv5 });
  console.log('TEST 5: Open Revenue Operator. -> What is it doing?');
  console.log('  Route:', t5.route);
  console.log('  Entity:', t5.entityName, `(${t5.entityId}, ${t5.entityType})`);
  console.log('  Spoken:', t5.text);
  console.log('  Self-Heal?:', t5.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t5.route === 'fast_read' && t5.text.toLowerCase().includes('revenue operator') ? 'PASS' : 'FAIL');
  console.log();

  // Test 6: Open Free Cash -> What is blocked?
  const conv6 = 'conv-t6';
  await routeTurn({ prompt: 'Open Free Cash.', conversationId: conv6 });
  const t6 = await routeTurn({ prompt: 'What is blocked?', conversationId: conv6 });
  console.log('TEST 6: Open Free Cash. -> What is blocked?');
  console.log('  Route:', t6.route);
  console.log('  Entity:', t6.entityName, `(${t6.entityId}, ${t6.entityType})`);
  console.log('  Spoken:', t6.text);
  console.log('  Self-Heal?:', t6.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t6.route === 'fast_read' && t6.text.toLowerCase().includes('free cash') ? 'PASS' : 'FAIL');
  console.log();

  // Test 7: Start Revenue Operator.
  const t7 = await routeTurn({ prompt: 'Start Revenue Operator.', conversationId: 'conv-t7' });
  console.log('TEST 7: Start Revenue Operator.');
  console.log('  Route:', t7.route);
  console.log('  Entity:', t7.entityName, `(${t7.entityId}, ${t7.entityType})`);
  console.log('  Executed:', t7.executed, 'Verified:', t7.verified);
  console.log('  Spoken:', t7.text);
  console.log('  Self-Heal?:', t7.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t7.route === 'action' && t7.executed && t7.verified && !t7.fallbackReason?.includes('self_heal') ? 'PASS' : 'FAIL');
  console.log();

  // Test 8: Real missing capability fixture: Rename Free Cash to Cash Engine.
  const t8 = await routeTurn({ prompt: 'Rename Free Cash to Cash Engine.', conversationId: 'conv-t8' });
  console.log('TEST 8: Rename Free Cash to Cash Engine. (Genuine expected capability missing)');
  console.log('  Route:', t8.route);
  console.log('  Entity:', t8.entityName, `(${t8.entityId}, ${t8.entityType})`);
  console.log('  Spoken:', t8.text);
  console.log('  Self-Heal?:', t8.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t8.route === 'action' && t8.fallbackReason?.includes('self_heal') ? 'PASS' : 'FAIL');
  console.log();

  // Test 9: Open Quantum Harvester Operator.
  const t9 = await routeTurn({ prompt: 'Open Quantum Harvester Operator.', conversationId: 'conv-t9' });
  console.log('TEST 9: Open Quantum Harvester Operator.');
  console.log('  Route:', t9.route);
  console.log('  Spoken:', t9.text);
  console.log('  Self-Heal?:', t9.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t9.route === 'unknown_entity' && t9.text.includes('Quantum Harvester') && !t9.fallbackReason?.includes('self_heal') ? 'PASS' : 'FAIL');
  console.log();

  // Test 10: Teleport Revenue Operator.
  const t10 = await routeTurn({ prompt: 'Teleport Revenue Operator.', conversationId: 'conv-t10' });
  console.log('TEST 10: Teleport Revenue Operator.');
  console.log('  Route:', t10.route);
  console.log('  Spoken:', t10.text);
  console.log('  FallbackReason:', t10.fallbackReason);
  console.log('  Self-Heal?:', t10.fallbackReason?.includes('self_heal') ? 'YES' : 'NO');
  console.log('  PASS:', t10.route === 'action' && t10.fallbackReason === 'unsupported_operation' && !t10.fallbackReason?.includes('self_heal') ? 'PASS' : 'FAIL');
  console.log();

  console.log('=== ALL TESTS EXECUTED ===');
}

run().catch(console.error).finally(() => process.exit(0));
