import { browserOperator } from '../server/src/services/browser/browserOperator.js';

async function testOpen() {
  console.log('Calling browserOperator.openTarget("YouTube")...');
  const res = await browserOperator.openTarget('YouTube', {
    goalText: 'open YouTube',
    actionKind: 'navigate'
  });
  console.log('Result:', JSON.stringify(res, null, 2));

  const page = (browserOperator as any).activePage;
  if (page) {
    console.log('Active page URL:', page.url());
    console.log('Active page title:', await page.title());
  }

  // Keep alive for 10 seconds to inspect processes
  console.log('Waiting 10 seconds to inspect window...');
  await new Promise(r => setTimeout(r, 10000));
}

testOpen().catch(console.error);
