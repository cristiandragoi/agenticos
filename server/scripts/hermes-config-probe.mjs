// P12 probe — is a real Hermes live backend available for a recovery E2E?
// (Reads the same env the hermes adapter uses; no secrets printed.)
import fs from 'fs';
import os from 'os';
import path from 'path';
function main() {
  const key = process.env.HERMES_API_KEY || process.env.API_SERVER_KEY ? 'configured' : 'MISSING';
  let url = process.env.HERMES_API_URL || process.env.API_SERVER_URL || 'MISSING';
  if (url === 'MISSING') {
    // Default gateway URL the service resolves (read-only, no secrets).
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const marker = path.join(localAppData, 'hermes', 'agentic-gateway', 'port.json');
    url = fs.existsSync(marker) ? `default gateway marker exists (${marker})` : 'MISSING';
  }
  console.log('HERMES_API_KEY / API_SERVER_KEY:', key);
  console.log('hermes URL:', url);
}
main();
