import { execSync } from 'child_process';

try {
  const out = execSync('tasklist /v /fo csv', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  const lines = out.trim().split('\n');
  const results: any[] = [];
  for (const line of lines.slice(1)) {
    // parse CSV line
    const match = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
    if (match) {
      const [_, name, pid, sessionName, sessionNum, mem, status, user, cpu, windowTitle] = match;
      if (windowTitle && windowTitle !== 'Nicht zutreffend' && windowTitle !== 'N/A') {
        results.push({ name, pid, sessionNum, windowTitle });
      }
    }
  }
  console.log(`Found ${results.length} windows:`);
  for (const r of results) {
    console.log(`[PID ${r.pid}] ${r.name} (Session ${r.sessionNum}): "${r.windowTitle}"`);
  }
} catch (e) {
  console.error(e);
}
