const { magnitudeService } = require('../server/dist/domains/magnitude/service.js');

async function runDirectTests() {
  console.log('=== TESTING MAGNITUDE DIRECT BROWSER WORKER ===\n');

  // TEST 1E: https://example.com
  console.log('--- TEST 1E: https://example.com ---');
  const run1 = magnitudeService.createRun('Open https://example.com and inspect the page.');
  console.log(`Created Run 1: ${run1.id}`);
  
  const result1 = await magnitudeService.executeInspect(run1.id);
  console.log('Result 1:', {
    title: result1.title,
    finalUrl: result1.finalUrl,
    textLength: result1.text.length,
    textSnippet: result1.text.slice(0, 100),
    durationMs: result1.durationMs
  });

  if (!result1.title.includes('Example Domain')) {
    throw new Error(`Test 1E failed: title was "${result1.title}"`);
  }
  if (!result1.text.includes('Example Domain')) {
    throw new Error(`Test 1E failed: text did not contain "Example Domain"`);
  }
  const completedRun1 = magnitudeService.getRun(run1.id);
  if (completedRun1.status !== 'completed') {
    throw new Error(`Test 1E failed: status was "${completedRun1.status}"`);
  }
  console.log('[PASS] Test 1E (example.com): PASS\n');

  // TEST 1F: https://www.wikipedia.org/
  console.log('--- TEST 1F: https://www.wikipedia.org/ ---');
  const run2 = magnitudeService.createRun('https://www.wikipedia.org/');
  console.log(`Created Run 2: ${run2.id}`);
  
  const result2 = await magnitudeService.executeInspect(run2.id);
  console.log('Result 2:', {
    title: result2.title,
    finalUrl: result2.finalUrl,
    textLength: result2.text.length,
    durationMs: result2.durationMs
  });

  if (!result2.title.toLowerCase().includes('wikipedia')) {
    throw new Error(`Test 1F failed: title was "${result2.title}"`);
  }
  const completedRun2 = magnitudeService.getRun(run2.id);
  if (completedRun2.status !== 'completed') {
    throw new Error(`Test 1F failed: status was "${completedRun2.status}"`);
  }
  console.log('[PASS] Test 1F (wikipedia.org): PASS\n');

  // TEST 1G: Failure Recovery
  console.log('--- TEST 1G: Invalid/Unreachable URL & Recovery ---');
  const run3 = magnitudeService.createRun('https://this-domain-definitely-does-not-exist-123456789.org');
  console.log(`Created Run 3 (Invalid): ${run3.id}`);
  
  let failedAsExpected = false;
  try {
    await magnitudeService.executeInspect(run3.id);
  } catch (err) {
    failedAsExpected = true;
    console.log('Caught expected failure:', err.message);
  }

  if (!failedAsExpected) throw new Error('Test 1G failed: invalid URL did not throw');
  const completedRun3 = magnitudeService.getRun(run3.id);
  if (completedRun3.status !== 'failed') {
    throw new Error(`Test 1G failed: status was "${completedRun3.status}", expected "failed"`);
  }
  console.log('Failed run transitioned to "failed" truthfully.');

  // Immediately run example.com again to prove no poisoning
  console.log('Immediately running example.com again...');
  const run4 = magnitudeService.createRun('https://example.com');
  const result4 = await magnitudeService.executeInspect(run4.id);
  if (!result4.title.includes('Example Domain')) {
    throw new Error(`Test 1G recovery failed: title was "${result4.title}"`);
  }
  console.log('[PASS] Test 1G (Failure Recovery): PASS\n');

  // TEST 1D: Cancellation
  console.log('--- TEST 1D: Cancellation & Stop ---');
  const run5 = magnitudeService.createRun('https://example.com');
  console.log(`Created Run 5: ${run5.id}`);
  
  const inspectPromise = magnitudeService.executeInspect(run5.id);
  // Cancel almost immediately
  await new Promise(r => setTimeout(r, 100));
  const cancelled = await magnitudeService.cancelRun(run5.id);
  console.log('cancelRun result:', cancelled);

  try {
    await inspectPromise;
  } catch (err) {
    console.log('Caught expected abort error:', err.message);
  }

  const completedRun5 = magnitudeService.getRun(run5.id);
  console.log('Run 5 final status:', completedRun5.status);
  if (completedRun5.status !== 'stopped') {
    throw new Error(`Test 1D failed: status was "${completedRun5.status}", expected "stopped"`);
  }
  console.log('[PASS] Test 1D (Cancellation): PASS\n');

  console.log('=== ALL PHASE 1 DIRECT TESTS PASSED! ===');
}

runDirectTests().then(() => process.exit(0)).catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
