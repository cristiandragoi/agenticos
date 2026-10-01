const { execSync } = require('child_process');

async function inspect() {
  try {
    const netstat = execSync('netstat -ano | findstr :9223', { encoding: 'utf8' });
    console.log('Netstat 9223:\n', netstat);
    const match = netstat.match(/LISTENING\s+(\d+)/);
    if (match) {
      const pid = parseInt(match[1], 10);
      console.log('Automation Chrome PID on 9223:', pid);
      const { WindowsBrowserWindowHelper } = require('./server/dist/services/browser/browserSession.js');
      const winWithPid = WindowsBrowserWindowHelper.inspectWindow(pid);
      console.log('Window inspected WITH PID:', winWithPid);
    }
  } catch (e) {
    console.log('Error inspecting 9223:', e.message);
  }
}

inspect();
