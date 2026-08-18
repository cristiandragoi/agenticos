const path = require('path');

async function main() {
  console.log('=== VERIFYING JARVIS ROUTING PRECEDENCE RULES ===\n');

  // Import compiled intentRouter and executiveIntent
  const { intentRouter, detectDelegationSignals } = await import('../server/dist/domains/jarvis/intentRouter.js');
  const { classifyExecutiveIntent } = await import('../server/dist/domains/jarvis/executiveIntent.js');

  const testCases = [
    {
      id: 'TEST 1',
      prompt: 'Jarvis, use Magnitude to open https://example.com, inspect the page, and bring the result back here. Do not use CodeX and do not create an automation.',
      expectedRoute: 'magnitude',
      expectedCategory: 'browser_automation'
    },
    {
      id: 'TEST 2',
      prompt: 'Use CodeX to inspect the browser automation architecture.',
      expectedRoute: 'codex',
      expectedCategory: 'repository_analysis'
    },
    {
      id: 'TEST 3',
      prompt: 'Do not use CodeX. Use Magnitude to inspect https://www.wikipedia.org/.',
      expectedRoute: 'magnitude',
      expectedCategory: 'browser_automation'
    },
    {
      id: 'TEST 4',
      prompt: 'Create an automation that checks the backend every day at 9.',
      expectedExecutive: 'automation_request'
    },
    {
      id: 'TEST 5',
      prompt: 'Do not create an automation. Open https://example.com with Magnitude.',
      expectedRoute: 'magnitude',
      expectedCategory: 'browser_automation'
    },
    {
      id: 'TEST 6',
      prompt: 'Answer directly. What is Magnitude?',
      expectedRoute: 'direct'
    }
  ];

  let allPassed = true;

  for (const tc of testCases) {
    console.log(`--- ${tc.id} ---`);
    console.log(`Prompt: "${tc.prompt}"`);

    const delegationSignals = detectDelegationSignals(tc.prompt);
    console.log('Delegation signals:', JSON.stringify(delegationSignals));

    const executive = classifyExecutiveIntent(tc.prompt);
    console.log('Executive Intent:', executive ? { intent: executive.intent, cap: executive.capability?.id } : null);

    const intent = await intentRouter.routeIntent(tc.prompt, { activeAgent: 'Jarvis', historyLength: 0 });
    console.log(`Classified Intent: route=${intent.route}, category=${intent.category}, reason="${intent.reason}"`);

    let pass = true;
    if (tc.expectedExecutive) {
      if (!executive || executive.intent !== tc.expectedExecutive) {
        pass = false;
        console.error(`[FAIL] Expected executive intent ${tc.expectedExecutive}, got ${executive?.intent}`);
      }
    } else {
      if (intent.route !== tc.expectedRoute) {
        pass = false;
        console.error(`[FAIL] Expected route ${tc.expectedRoute}, got ${intent.route}`);
      }
      if (tc.expectedCategory && intent.category !== tc.expectedCategory) {
        pass = false;
        console.error(`[FAIL] Expected category ${tc.expectedCategory}, got ${intent.category}`);
      }
    }

    if (pass) {
      console.log(`[PASS] ${tc.id} PASSED!\n`);
    } else {
      allPassed = false;
      console.log(`[FAIL] ${tc.id} FAILED!\n`);
    }
  }

  if (!allPassed) {
    throw new Error('Some routing tests failed!');
  }
  console.log('=== ALL ROUTING PRECEDENCE TESTS PASSED 100%! ===');
}

main().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
