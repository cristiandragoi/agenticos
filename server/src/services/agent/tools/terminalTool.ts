import { logger } from '../../../utils/logger.js';
/**
 * Terminal tool — execute shell commands on the host machine.
 *
 * On Windows, transparently maps common Unix commands to their
 * Windows equivalents (ls→dir, cat→type, etc.) so the LLM's
 * natural Unix-style commands work regardless of the host OS.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const isWindows = process.platform === 'win32';

/** Map common Unix commands to Windows cmd.exe equivalents */
function translateCommand(cmd: string): string {
  if (!isWindows) return cmd;

  // Only do top-level command mapping — not inside pipes or quoted strings
  const firstWord = cmd.trim().split(/\s+/)[0];
  const rest = cmd.trim().slice(firstWord.length);

  switch (firstWord) {
    case 'ls': return `dir${rest} /b`;  // /b = bare format (no size/date)
    case 'cat': return `type${rest}`;
    case 'rm': return `del${rest} 2>nul`; // suppress "file not found"
    case 'mv': return `move${rest}`;
    case 'cp': return `copy${rest}`;
    case 'mkdir': return `mkdir${rest} 2>nul`;
    case 'rmdir':
    case 'rm -rf':
    case 'rm -r': return `rmdir /s /q${rest} 2>nul`;
    case 'pwd': return 'cd';
    case 'touch': return `type nul >${rest}`;
    case 'find': return `dir /s /b${rest.includes('*') ? '' : ` *${rest}*`}`;
    case 'clear': return 'cls';
    case 'which': return `where${rest}`;
    case 'grep': {
      // grep "pattern" file → findstr /s /n /c:"pattern" file
      const match = rest.match(/["'](.+?)["']\s*(.+)/);
      if (match) return `findstr /s /n /c:"${match[1]}" ${match[2] || '*'}`;
      return cmd; // fallback to literal
    }
    case 'head':
    case 'tail': {
      // head -5 file → cmd /c type file | more, fallback
      return cmd; // try literal; might work if git-bash is in PATH
    }
    case 'chmod':
    case 'chown':
      return `echo [Windows: ${firstWord} has no effect] && ${cmd}`;
    case 'ps': return 'tasklist';
    case 'kill': {
      // kill -9 1234 → taskkill /F /PID 1234
      const pidMatch = rest.match(/(?:-9\s+)?(\d+)/);
      if (pidMatch) return `taskkill /F /PID ${pidMatch[1]} 2>nul`;
      return cmd;
    }
    case 'wget':
    case 'curl':
      // curl works on Windows, wget doesn't. Suggest curl if wget was called.
      if (firstWord === 'wget') {
        const urlMatch = rest.match(/(?:-O\s+\S+\s+)?(https?:\/\/\S+)/);
        if (urlMatch) return `curl -L -O ${urlMatch[1]}`;
        return `echo wget not available on Windows.`;
      }
      return cmd;
    case 'uname': return 'ver';
    default:
      return cmd;
  }
}

export const terminalTool = {
  name: 'terminal',
  description: 'Execute a shell command on the host machine and get its output. Use this for running scripts, git commands, builds, file operations, and any system-level task.',
  parameters: [
    { name: 'command', type: 'string', description: 'The shell command to execute', required: true },
    { name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default: 30000)', required: false },
    { name: 'workdir', type: 'string', description: 'Working directory for the command', required: false },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const rawCommand = args.command as string;
    const timeout = (args.timeout as number) || 30000;
    const workdir = args.workdir as string | undefined;

    if (!rawCommand) return JSON.stringify({ error: 'No command provided' });

    // Apply Unix→Windows command translation
    const command = translateCommand(rawCommand);
    if (command !== rawCommand) {
      logger.info(`[Terminal] Translated: "${rawCommand}" → "${command.slice(0, 100)}"`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd: workdir,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: isWindows ? 'cmd.exe' : '/bin/bash',
      });

      const result: Record<string, unknown> = {};
      if (stdout) result.stdout = stdout.slice(0, 50000);
      if (stderr) result.stderr = stderr.slice(0, 10000);
      result.exitCode = 0;

      return JSON.stringify(result);
    } catch (err: any) {
      const result: Record<string, unknown> = {
        exitCode: err.code || -1,
        error: err.message,
      };
      if (err.stdout) result.stdout = (err.stdout as string).slice(0, 50000);
      if (err.stderr) result.stderr = (err.stderr as string).slice(0, 10000);
      return JSON.stringify(result);
    }
  },
};
