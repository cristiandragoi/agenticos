const { browserOperator } = require('./server/dist/services/browser/browserOperator.js');
const { browserSessionManager, WindowsBrowserWindowHelper } = require('./server/dist/services/browser/browserSession.js');
const { browserSessionAuthority } = require('./server/dist/services/browser/browserSessionAuthority.js');
const { execSync } = require('child_process');

async function testLaunch() {
  console.log('1. Launching visible browser via browserOperator.ensureBrowser()...');
  const res = await browserOperator.ensureBrowser('VISIBLE_USER_BROWSER');
  console.log('Active page URL:', res.page.url());

  const sess = browserSessionManager.getSession();
  console.log('Session from manager:', sess);

  const netstat = execSync('netstat -ano | findstr :9223', { encoding: 'utf8' });
  console.log('Netstat 9223:\n', netstat);
  const match = netstat.match(/LISTENING\s+(\d+)/);
  const pid = match ? parseInt(match[1], 10) : undefined;
  console.log('CDP listening PID:', pid);

  const winGeneric = WindowsBrowserWindowHelper.inspectWindow(undefined, 'Chrome');
  console.log('inspectWindow(undefined, "Chrome"):', winGeneric);

  const winPid = WindowsBrowserWindowHelper.inspectWindow(pid);
  console.log('inspectWindow(pid):', winPid);

  const cdpTargets = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
  console.log('CDP targets count:', cdpTargets.length);
  for (const t of cdpTargets) {
    console.log(`Target: id=${t.id} type=${t.type} title="${t.title}" url="${t.url}"`);
  }

  const visState = await res.page.evaluate(() => ({
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
  }));
  console.log('Page visibility evaluation:', visState);
}

testLaunch().catch(e => console.error(e));
