/**
 * Process ownership & recovery subsystem (Electron main-process domain).
 *
 * Implements deterministic process ownership, classification, and self-recovery:
 *
 * 1. Single-Instance Ownership:
 *    Distinguishes a healthy existing AgenticOS instance from stale orphan
 *    Chromium helper processes. Cleans up only verified AgenticOS processes.
 *
 * 2. Port 4600 Ownership:
 *    Distinguishes 4 states:
 *      - FREE_PORT: Port 4600 is available for spawn.
 *      - HEALTHY_AGENTICOS_BACKEND: An existing compatible backend is answering /api/health; adopt it.
 *      - STALE_AGENTICOS_BACKEND: Verified AgenticOS backend process (matching metadata or entry script)
 *        that is dead, hung, or unresponsive. Safely terminated, waited for release, and respawned.
 *      - FOREIGN_PROCESS: An unrelated process owns port 4600. NEVER terminated; surfaces an
 *        actionable error with PID and executable info.
 *
 * 3. Process Ownership Metadata:
 *    Writes backend-ownership.json containing parent PID, parent execPath,
 *    child PID, backend entry, port, start timestamp, and build identity.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface BackendOwnershipRecord {
  parentPid: number;
  parentExecPath: string;
  pid: number;
  entry: string;
  cwd: string;
  port: number;
  startedAt: number;
  buildIdentity?: {
    buildId?: string | null;
    gitSha?: string | null;
    buildTimestamp?: string | null;
  };
}

export interface ProcessInfo {
  pid: number;
  parentPid?: number;
  name?: string;
  executablePath?: string;
  commandLine?: string;
  responding?: boolean;
}

export type PortOwnerClassification =
  | { type: 'FREE_PORT'; port: number }
  | { type: 'HEALTHY_AGENTICOS_BACKEND'; port: number; pid?: number; healthData?: unknown }
  | {
      type: 'STALE_AGENTICOS_BACKEND';
      port: number;
      pid: number;
      reason: string;
      ownershipRecord?: BackendOwnershipRecord | null;
      processInfo?: ProcessInfo | null;
    }
  | { type: 'FOREIGN_PROCESS'; port: number; pid: number; processInfo: ProcessInfo };

export function getOwnershipFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'backend-ownership.json');
}

export function writeBackendOwnership(userDataDir: string, record: BackendOwnershipRecord): void {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const target = getOwnershipFilePath(userDataDir);
    const tmp = `${target}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    // Best-effort metadata write
  }
}

export function readBackendOwnership(userDataDir: string): BackendOwnershipRecord | null {
  try {
    const file = getOwnershipFilePath(userDataDir);
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.pid === 'number' && typeof parsed.port === 'number') {
      return parsed as BackendOwnershipRecord;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearBackendOwnership(userDataDir: string): void {
  try {
    const file = getOwnershipFilePath(userDataDir);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // Ignore error if file does not exist
  }
}

/**
 * Returns the PID of the process listening on the given TCP port, or null if port is free.
 */
export function getListeningPidOnPort(port: number): number | null {
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('lsof', ['-i', `:${port}`, '-t'], { encoding: 'utf8', timeout: 3000 }).trim();
      const pid = parseInt(out.split('\n')[0], 10);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  // 1. Try netstat first (fast ~10ms, language-agnostic socket check)
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    for (const line of out.split(/\r?\n/)) {
      // Matches local address ending with :<port> and remote ending with :0 (listening socket)
      const match = line.match(new RegExp(`:${port}\\s+(?:0\\.0\\.0\\.0:0|\\[::\\]:0|\\*:\\*)\\s+\\S+\\s+(\\d+)`));
      if (match && match[1]) {
        const pid = parseInt(match[1], 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
    }
  } catch {
    // Fall through to PowerShell
  }

  // 2. PowerShell Get-NetTCPConnection (authoritative fallback)
  try {
    const psCmd = `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    if (out) {
      const pid = parseInt(out.split(/\r?\n/)[0], 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    // Ignore error
  }

  return null;
}

/**
 * Inspect detailed process information for a specific PID on Windows.
 */
export function getProcessInfo(pid: number): ProcessInfo | null {
  if (process.platform !== 'win32') {
    return isProcessAlive(pid) ? { pid } : null;
  }

  try {
    const psCmd = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $cim = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + ${pid}) -ErrorAction SilentlyContinue; [PSCustomObject]@{ pid = $p.Id; parentPid = $cim.ParentProcessId; name = $p.ProcessName; executablePath = $cim.ExecutablePath; commandLine = $cim.CommandLine; responding = $p.Responding } | ConvertTo-Json -Compress }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    if (!out) return null;
    const parsed = JSON.parse(out);
    return {
      pid: parsed.pid,
      parentPid: parsed.parentPid,
      name: parsed.name,
      executablePath: parsed.executablePath,
      commandLine: parsed.commandLine,
      responding: parsed.responding,
    };
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    return code === 'EPERM';
  }
}

export function killProcessTree(pid: number): boolean {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      });
      return true;
    } catch {
      return !isProcessAlive(pid);
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return !isProcessAlive(pid);
    }
  }
}

export async function waitForPortFree(port: number, timeoutMs = 5000, pollIntervalMs = 200): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = getListeningPidOnPort(port);
    if (pid === null) return true;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return getListeningPidOnPort(port) === null;
}

export interface ClassifyPortOptions {
  port: number;
  userDataDir: string;
  entry: string;
}

export interface ClassifyProbeResult {
  reachable: boolean;
  healthy: boolean;
  httpStatus?: number;
  error?: string;
}

/**
 * Categorize port ownership into:
 *  - FREE_PORT
 *  - HEALTHY_AGENTICOS_BACKEND
 *  - STALE_AGENTICOS_BACKEND
 *  - FOREIGN_PROCESS
 */
export async function classifyPortOwner(
  options: ClassifyPortOptions,
  probe: ClassifyProbeResult
): Promise<PortOwnerClassification> {
  const { port, userDataDir, entry } = options;

  if (probe.healthy) {
    const pid = getListeningPidOnPort(port) ?? undefined;
    return { type: 'HEALTHY_AGENTICOS_BACKEND', port, pid, healthData: probe };
  }

  let pid = getListeningPidOnPort(port);
  if (!pid && !probe.reachable) {
    return { type: 'FREE_PORT', port };
  }

  // If reachable but PID not yet captured, give netstat another chance
  if (!pid && probe.reachable) {
    await new Promise((r) => setTimeout(r, 200));
    pid = getListeningPidOnPort(port);
  }

  if (!pid) {
    // Port answered something or is blocked, but no PID could be queried
    return {
      type: 'FOREIGN_PROCESS',
      port,
      pid: 0,
      processInfo: {
        pid: 0,
        name: 'unknown',
        commandLine: `Port unreachable/unhealthy (${probe.error || `HTTP ${probe.httpStatus}`})`,
      },
    };
  }

  const ownership = readBackendOwnership(userDataDir);
  const procInfo = getProcessInfo(pid);

  let isAgenticBackend = false;
  let staleReason = '';

  // Evidence check 1: Matches backend-ownership.json record
  if (ownership && ownership.pid === pid) {
    isAgenticBackend = true;
    staleReason = `Verified AgenticOS backend matching backend-ownership.json (PID ${pid}, parentPid ${ownership.parentPid}, startedAt ${new Date(ownership.startedAt).toISOString()})`;
  }

  // Evidence check 2: Command line explicitly targets AgenticOS server entry
  if (!isAgenticBackend && procInfo?.commandLine) {
    const cmdNorm = procInfo.commandLine.replace(/\\/g, '/').toLowerCase();
    const entryNorm = entry.replace(/\\/g, '/').toLowerCase();
    if (
      cmdNorm.includes(entryNorm) ||
      cmdNorm.includes('server/dist/index.js') ||
      cmdNorm.includes('resources/server/dist/index.js')
    ) {
      isAgenticBackend = true;
      staleReason = `Command line references AgenticOS backend entry: ${procInfo.commandLine.slice(0, 150)}`;
    }
  }

  if (isAgenticBackend) {
    return {
      type: 'STALE_AGENTICOS_BACKEND',
      port,
      pid,
      reason: staleReason,
      ownershipRecord: ownership,
      processInfo: procInfo,
    };
  }

  return {
    type: 'FOREIGN_PROCESS',
    port,
    pid,
    processInfo: procInfo || { pid, name: 'unknown' },
  };
}

export interface InstanceLockResolution {
  action: 'EXIT_HEALTHY_INSTANCE_EXISTS' | 'RELAUNCHED_AFTER_STALE_CLEANUP';
  evidence: Record<string, unknown>;
}

/**
 * Called when app.requestSingleInstanceLock() returns false.
 * Determines whether a healthy AgenticOS instance is active, or if stale processes
 * are holding the lock.
 */
export function resolveSingleInstanceConflict(options: {
  execPath: string;
  currentPid: number;
  userDataDir: string;
  log?: (msg: string) => void;
}): InstanceLockResolution {
  const log = options.log || console.log;
  const execPathNorm = options.execPath.toLowerCase();

  let processes: ProcessInfo[] = [];
  try {
    const procName = path.basename(options.execPath, path.extname(options.execPath));
    const psCmd = `Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | ForEach-Object { $cim = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_.Id) -ErrorAction SilentlyContinue; [PSCustomObject]@{ pid = $_.Id; parentPid = $cim.ParentProcessId; name = $_.ProcessName; executablePath = $cim.ExecutablePath; commandLine = $cim.CommandLine; responding = $_.Responding } } | ConvertTo-Json -Compress`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    if (out) {
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      processes = list.filter(
        (p: any) =>
          p &&
          p.pid !== options.currentPid &&
          p.executablePath &&
          p.executablePath.toLowerCase() === execPathNorm
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[watchdog] Error querying processes for single-instance conflict: ${msg}`);
  }

  // Filter main processes vs helper processes (helper processes have --type=...)
  const mainProcesses = processes.filter((p) => {
    if (!p.commandLine) return true;
    return !p.commandLine.includes('--type=');
  });

  const respondingMain = mainProcesses.find((p) => p.responding !== false);

  if (respondingMain) {
    // Check if the existing process actually has an active, visible desktop window
    let hasActiveDesktopWindow = false;
    try {
      const desktopRuntimePath = path.join(options.userDataDir, 'desktop-runtime.json');
      if (fs.existsSync(desktopRuntimePath)) {
        const state = JSON.parse(fs.readFileSync(desktopRuntimePath, 'utf8'));
        const ageMs = Date.now() - new Date(state.updatedAt || 0).getTime();
        if (state.mainWindowExists && state.mainWindowVisible && state.hwnd && ageMs < 45000) {
          hasActiveDesktopWindow = true;
        }
      }
    } catch {
      // If reading fails, fall through
    }

    if (hasActiveDesktopWindow) {
      log(`[watchdog] Healthy existing AgenticOS main process with visible desktop confirmed (PID: ${respondingMain.pid}). Exiting second launcher.`);
      return {
        action: 'EXIT_HEALTHY_INSTANCE_EXISTS',
        evidence: { mainPid: respondingMain.pid, responding: respondingMain.responding, hasActiveDesktopWindow: true },
      };
    }

    log(`[watchdog] Existing AgenticOS main process (PID: ${respondingMain.pid}) has NO visible desktop window or is headless/stale. Recovering...`);
    killProcessTree(respondingMain.pid);
  }

  // If no responding main process exists, or if stale headless process was killed, clean remaining
  log(`[watchdog] Stale AgenticOS process lock detected. Found ${processes.length} matching processes.`);
  const evidence = {
    foundProcesses: processes.map((p) => ({
      pid: p.pid,
      cmd: p.commandLine?.slice(0, 100),
      responding: p.responding,
    })),
  };

  // Terminate ONLY these verified AgenticOS processes
  for (const proc of processes) {
    log(`[watchdog] Terminating stale AgenticOS process (PID: ${proc.pid})`);
    killProcessTree(proc.pid);
  }

  // Clean dangling Chromium singleton lock artifacts safely
  try {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const lf of lockFiles) {
      const p = path.join(options.userDataDir, lf);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        log(`[watchdog] Cleaned stale Chromium lock artifact: ${lf}`);
      }
    }
  } catch {
    // Ignore
  }

  return {
    action: 'RELAUNCHED_AFTER_STALE_CLEANUP',
    evidence,
  };
}

