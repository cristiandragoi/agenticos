import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { WindowsJob } from "../../domains/securitySupervisor/windowsJob.js";
import type { GitPlan } from "../../domains/localWorker/structuredGit.js";
import { logger } from "../../utils/logger.js";

function findJobRunnerHelper(): { helperPath: string; helperSha256: string } | null {
  if (process.platform !== 'win32') return null;
  const candidates = [
    path.resolve(process.cwd(), '.tmp/security-native/JobRunner.exe'),
    path.resolve(process.cwd(), '../.tmp/security-native/JobRunner.exe'),
    path.resolve(process.cwd(), '.tmp/phase2-job-object/JobRunner.exe'),
    path.resolve(process.cwd(), '../.tmp/phase2-job-object/JobRunner.exe'),
    path.resolve('D:/AgenticOS/.tmp/security-native/JobRunner.exe'),
    path.resolve('D:/AgenticOS/.tmp/phase2-job-object/JobRunner.exe'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const helperSha256 = createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
        return { helperPath: candidate, helperSha256 };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

const cachedExeHashes = new Map<string, string>();
function getExeHash(filePath: string): string {
  let hash = cachedExeHashes.get(filePath);
  if (!hash) {
    hash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    cachedExeHashes.set(filePath, hash);
  }
  return hash;
}

function resolveDirectExe(binary: string): string | null {

  if (binary === 'node') {
    return process.execPath;
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, binary.endsWith('.exe') ? binary : binary + '.exe');
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return full;
      }
    } catch {}
  }
  return null;
}

export async function runProcess(
  cmd: string,
  args: string[],
  cwd: string
): Promise<string> {
  const isWin = process.platform === 'win32';
  if (isWin) {
    const isTestOptOut = process.env.AGENTICOS_UNCONFINED_TEST_ONLY === 'true';
    const helperInfo = findJobRunnerHelper();

    if (!helperInfo) {
      if (!isTestOptOut) {
        logger.error('[runProcess] JOB_BOUNDARY_UNAVAILABLE: Phase 2 native helper missing; failing closed by default.');
        throw new Error('BLOCKED_UNCONFINED: Worker process execution outside Phase 2 Windows Job boundary is blocked by policy');
      }
      logger.warn('[runProcess] JOB_BOUNDARY_OPT_OUT: Phase 2 native helper missing; bypassing boundary under AGENTICOS_UNCONFINED_TEST_ONLY=true.');
    } else {
      const sysRoot = process.env.SystemRoot || 'C:\\Windows';
      const directExe = resolveDirectExe(cmd);
      let exePath: string;
      let exeArgs: string[];
      let exeHash: string;

      if (directExe) {
        exePath = directExe;
        exeArgs = args;
        exeHash = getExeHash(exePath);
      } else {
        exePath = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        exeHash = getExeHash(exePath);
        const psArgsArray = args.map(a => `'${a.replace(/'/g, "''")}'`).join(', ');
        const psScript = `
$ProgressPreference = 'SilentlyContinue'
$target = '${cmd.replace(/'/g, "''")}'
$targetArgs = @(${psArgsArray})
& $target @targetArgs
`;
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        exeArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
      }

      const job = new WindowsJob(helperInfo.helperPath, helperInfo.helperSha256);
      const plan: GitPlan = {
        executable: exePath,
        executableSha256: exeHash,
        cwd: path.resolve(cwd),
        args: exeArgs,
        env: {
          SystemRoot: sysRoot,
          WINDIR: sysRoot,
          PATH: process.env.PATH || '',
          PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
        },
        timeoutMs: 60000,
        maxOutputBytes: 1048576,
        shell: false,
        windowsHide: true,
      };

      let output = '';
      try {
        const exitCode = await job.run(plan, (chunk) => {
          output += chunk.toString('utf8');
        });

        if (exitCode === 0) {
          return output;
        }
        throw new Error(output || `exit ${exitCode}`);
      } finally {
        await job.terminateAndWait().catch(() => {});
      }
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))
    );
  });
}


export async function dispatchClaude({
  input,
  config,
}: {
  input: unknown;
  config: Record<string, unknown>;
}) {
  const prompt = (input as { prompt?: string }).prompt ?? "";
  const args = [
    "launch",
    "--profile",
    "auto",
    "--",
    "-p",
    prompt,
    "--model",
    "auto",
    "--max-turns",
    String(config.maxTurns ?? 8),
    "--output-format",
    "json",
  ];
  const cwd = String(config.workdir ?? ".");
  return await runProcess("omniroute", args, cwd);
}
