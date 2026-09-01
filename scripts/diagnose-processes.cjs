/**
 * diagnose-processes.cjs
 *
 * Windows-compatible Process & Port Truth Diagnostic Engine for Agentic OS.
 *
 * Discovers:
 *  - PID owning backend port (default 4000)
 *  - Executable path and command line for the listening PID
 *  - Process start time, uptime, memory, parent process
 *  - Duplicate backend / electron / hermes processes
 *  - Hermes gateway configured vs actual endpoint & status
 *
 * Read-only & non-destructive: Never kills unidentified processes automatically.
 *
 * Usage:
 *   node scripts/diagnose-processes.cjs [--json]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

const BACKEND_PORT = parseInt(process.env.AGENTICOS_BACKEND_PORT || process.env.PORT || '4600', 10);

function resolveConfiguredHermes() {
  if (process.env.HERMES_API_URL) {
    try {
      const u = new URL(process.env.HERMES_API_URL);
      return { url: process.env.HERMES_API_URL, port: parseInt(u.port || '8643', 10), source: 'env' };
    } catch {}
  }

  try {
    const localAppData = process.env.LOCALAPPDATA || '';
    if (localAppData) {
      const cfgPath = path.join(localAppData, 'hermes', 'profiles', 'backend-engineer', 'config.yaml');
      if (fs.existsSync(cfgPath)) {
        const content = fs.readFileSync(cfgPath, 'utf8');
        const match = content.match(/platforms:\r?\n[\s\S]*?api_server:\r?\n[\s\S]*?port:[ \t]*['"]?(\d+)['"]?/);
        if (match && match[1]) {
          const p = parseInt(match[1], 10);
          if (!isNaN(p) && p > 0) {
            return { url: `http://127.0.0.1:${p}`, port: p, source: 'config.yaml' };
          }
        }
      }
    }
  } catch {}

  // Canonical runtime default from hermesApi.ts
  return { url: 'http://127.0.0.1:8643', port: 8643, source: 'canonical_default' };
}

function runPowerShell(cmd) {
  try {
    const raw = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${cmd}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 10000,
    });
    return raw.trim();
  } catch {
    return '';
  }
}

function findPortOwner(port) {
  try {
    const output = execSync(`netstat -ano -p tcp`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = output.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[0] === 'TCP') {
        const localAddress = parts[1];
        const state = parts[3];
        const pid = parseInt(parts[4], 10);
        if (state === 'LISTENING' && localAddress.endsWith(`:${port}`)) {
          return pid;
        }
      }
    }
  } catch {}
  return null;
}

function getProcessDetails(pid) {
  if (!pid) return null;
  const psCmd = `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate | ConvertTo-Json -Compress`;
  const jsonStr = runPowerShell(psCmd);
  if (!jsonStr) return null;
  try {
    const data = JSON.parse(jsonStr);
    return {
      pid: data.ProcessId,
      parentPid: data.ParentProcessId,
      name: data.Name,
      executablePath: data.ExecutablePath,
      commandLine: data.CommandLine,
      creationDate: data.CreationDate,
    };
  } catch {
    return null;
  }
}

function listMatchingProcesses(names) {
  const filterList = names.map(n => `Name LIKE '${n}%'`).join(' OR ');
  const psCmd = `Get-CimInstance Win32_Process -Filter "${filterList}" | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate | ConvertTo-Json -Compress`;
  const jsonStr = runPowerShell(psCmd);
  if (!jsonStr) return [];
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function probeEndpoint(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ reachable: true, statusCode: res.statusCode, body: json || data });
      });
    });
    req.on('error', (err) => resolve({ reachable: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ reachable: false, error: 'TIMEOUT' }); });
  });
}

async function runDiagnostics() {
  const backendPid = findPortOwner(BACKEND_PORT);
  const backendDetails = backendPid ? getProcessDetails(backendPid) : null;
  let backendIdentityProbe = await probeEndpoint('http://127.0.0.1:' + BACKEND_PORT + '/api/runtime/identity');
  if (!backendIdentityProbe.reachable || backendIdentityProbe.statusCode !== 200) {
    const hp = await probeEndpoint('http://127.0.0.1:' + BACKEND_PORT + '/api/health');
    if (hp.reachable && hp.statusCode === 200) backendIdentityProbe = hp;
  }

  const hermesCfg = resolveConfiguredHermes();
  const hermesPid = findPortOwner(hermesCfg.port);
  const hermesDetails = hermesPid ? getProcessDetails(hermesPid) : null;
  const hermesProbe = await probeEndpoint(`${hermesCfg.url}/v1/models`);

  // Detect duplicates
  const electronProcs = listMatchingProcesses(['Agentic OS', 'electron']);
  const nodeProcs = listMatchingProcesses(['node']);

  const isBackendHealthy = backendIdentityProbe.reachable && backendIdentityProbe.statusCode === 200;
  const hasDuplicateElectrons = electronProcs.length > 3;

  const report = {
    timestamp: new Date().toISOString(),
    backendPort: BACKEND_PORT,
    portOwnerPid: backendPid,
    backendListening: !!backendPid,
    backendHealthy: isBackendHealthy,
    backendDetails,
    runtimeIdentity: isBackendHealthy ? backendIdentityProbe.body : null,
    hermes: {
      configuredEndpoint: hermesCfg.url,
      configuredPort: hermesCfg.port,
      configSource: hermesCfg.source,
      listeningPid: hermesPid,
      isListening: !!hermesPid,
      probeStatus: hermesProbe.reachable ? 'HEALTHY' : 'NOT_RESPONDING',
      details: hermesDetails,
      matchesConfigured: !!hermesPid,
    },
    duplicateCheck: {
      electronProcessCount: electronProcs.length,
      nodeProcessCount: nodeProcs.length,
      potentialDuplicateElectron: hasDuplicateElectrons,
    },
    electronProcesses: electronProcs.map(p => ({
      pid: p.ProcessId,
      name: p.Name,
      path: p.ExecutablePath,
      commandLine: p.CommandLine ? p.CommandLine.slice(0, 140) : null,
    })),
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n======================================================');
    console.log('       AGENTIC OS � PROCESS & PORT TRUTH DIAGNOSTIC    ');
    console.log('======================================================\n');
    console.log(`[Backend Port ${BACKEND_PORT}]`);
    console.log(`  - Listening PID:        ${backendPid || 'NONE (PORT FREE)'}`);
    if (backendDetails) {
      console.log(`  - Executable:           ${backendDetails.executablePath}`);
      console.log(`  - Command Line:         ${backendDetails.commandLine?.slice(0, 100)}...`);
    }
    console.log(`  - HTTP Identity Probe:   ${isBackendHealthy ? 'HEALTHY (200 OK)' : 'UNREACHABLE / OFFLINE'}`);
    if (isBackendHealthy && report.runtimeIdentity?.buildIdentity) {
      console.log(`  - Build ID:             ${report.runtimeIdentity.buildIdentity.buildId}`);
      console.log(`  - Git SHA:              ${report.runtimeIdentity.buildIdentity.gitShort} (${report.runtimeIdentity.buildIdentity.isDirty ? 'DIRTY' : 'CLEAN'})`);
      console.log(`  - Process Uptime:       ${report.runtimeIdentity.process?.uptimeSeconds}s`);
    }

    console.log(`\n[Hermes Gateway]`);
    console.log(`  - Configured Endpoint:  ${report.hermes.configuredEndpoint} (source: ${report.hermes.configSource})`);
    console.log(`  - Listening PID:        ${report.hermes.listeningPid || 'NONE'}`);
    console.log(`  - Probe Status:         ${report.hermes.probeStatus}`);
    if (report.hermes.details) {
      console.log(`  - Executable:           ${report.hermes.details.executablePath}`);
    }

    console.log(`\n[Process Summary]`);
    console.log(`  - Electron Instances:   ${electronProcs.length} process(es)`);
    console.log(`  - Node Processes:       ${nodeProcs.length} process(es)`);
    console.log(`  - Potential Duplicate:   ${hasDuplicateElectrons ? 'WARNING: Multiple Electron instances running' : 'CLEAN'}`);
    console.log('\n======================================================\n');
  }

  return report;
}

if (require.main === module) {
  runDiagnostics().catch(console.error);
}

module.exports = { runDiagnostics, findPortOwner, getProcessDetails, resolveConfiguredHermes };
