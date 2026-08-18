/**
 * Detects shell commands that perform file I/O for which a safer native
 * tool exists (writeFile / readFile). The sandbox blocks these commands by
 * policy; this guard lets the loop explain the correct native tool BEFORE
 * the command is attempted, so the agent can correct itself immediately.
 */

export interface ShellFileIoDetection {
  nativeTool: 'writeFile' | 'readFile';
  detail: string;
}

const WRITE_COMMANDS = new Set(['echo', 'printf']);
const READ_COMMANDS = new Set(['cat', 'type', 'get-content', 'gc', 'more']);
const SHELL_WRAPPERS = new Set(['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'sh', 'bash']);

const REDIRECTION_PATTERN = /(^|\s)>>?\s*[^\s&|]/;
const WRITE_PATTERN = /\b(echo|printf|out-file|set-content|add-content)\b/i;
const READ_PATTERN = /\b(cat|type|get-content|gc|more)\b/i;

export function detectShellFileIo(cmd: string, args: string[] = []): ShellFileIoDetection | null {
  const normalized = (cmd || '').trim().toLowerCase();
  const base = normalized.split(/[\\/]/).pop() || normalized;
  const joinedArgs = (args || []).join(' ');

  // Direct file-I/O commands: `echo ...`, `cat file`, `type file`, `Get-Content file`
  if (WRITE_COMMANDS.has(base)) {
    return { nativeTool: 'writeFile', detail: `'${cmd}' writes files through the shell` };
  }
  if (READ_COMMANDS.has(base)) {
    return { nativeTool: 'readFile', detail: `'${cmd}' reads files through the shell` };
  }

  // Shell wrappers performing redirection or piping file I/O:
  // `cmd /c echo x > f`, `powershell -Command Get-Content f`, `sh -c "cat f"`, etc.
  if (SHELL_WRAPPERS.has(base)) {
    // Any shell redirection creates or modifies a file.
    if (REDIRECTION_PATTERN.test(joinedArgs)) {
      return { nativeTool: 'writeFile', detail: `shell redirection via '${cmd}' writes files` };
    }
    if (WRITE_PATTERN.test(joinedArgs) && !READ_PATTERN.test(joinedArgs)) {
      return { nativeTool: 'writeFile', detail: `'${cmd}' writes files through the shell` };
    }
    if (READ_PATTERN.test(joinedArgs)) {
      return { nativeTool: 'readFile', detail: `'${cmd}' reads files through the shell` };
    }
  }

  return null;
}
