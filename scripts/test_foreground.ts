import { WindowsBrowserWindowHelper } from '../server/dist/services/browser/browserSession.js';

async function testBringToForeground() {
  console.log('Testing bringToForeground on Chrome...');
  const res = WindowsBrowserWindowHelper.bringToForeground(undefined, 'Chrome');
  console.log('bringToForeground result:', res);

  const inspected = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  console.log('Inspected window after bringToForeground:', inspected);
}

testBringToForeground().catch(console.error);
