import { execSync } from 'child_process';
import http from 'http';

async function main() {
  console.log('=== CHECKING CDP ON PORT 9222 ===');
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version');
    const version = await res.json();
    console.log('CDP 9222 Version:', JSON.stringify(version, null, 2));

    const listRes = await fetch('http://127.0.0.1:9222/json/list');
    const targets = await listRes.json();
    console.log('CDP 9222 Targets count:', targets.length);
    for (const t of targets) {
      console.log(` - [${t.type}] ${t.title} -> ${t.url}`);
    }
  } catch (err: any) {
    console.log('CDP 9222 check error:', err.message);
  }

  console.log('\n=== CHECKING PLAYWRIGHT / CHROME PROCESSES ===');
  try {
    const cmd = 'powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'chrome.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"';
    const out = execSync(cmd, { encoding: 'utf-8' });
    const procs = JSON.parse(out);
    const procArray = Array.isArray(procs) ? procs : [procs];
    console.log(`Found ${procArray.length} chrome.exe processes`);
    for (const p of procArray) {
      if (p.CommandLine && p.CommandLine.includes('ms-playwright')) {
        console.log(`\nPlaywright Chrome PID: ${p.ProcessId}`);
        console.log(`CommandLine: ${p.CommandLine}`);
      }
    }
  } catch (err: any) {
    console.log('Process check error:', err.message);
  }
}

main().catch(console.error);
