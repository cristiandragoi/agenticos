/** Structured read-only Git policy. Worker execution remains disabled until the independent supervisor is enrolled. */
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { getDedicatedWorkspaceRoot } from './workspaceConfinement.js';

export const GIT_EXECUTABLE = 'C:\\Program Files\\Git\\cmd\\git.exe';
export interface GitPlan {
  executable: string; executableSha256: string; cwd: string; args: string[];
  env: Record<string,string>; timeoutMs: number; maxOutputBytes: number;
  shell: false; windowsHide: true;
}
function refuse(reason: string): never { throw new Error(`GIT_CONFINEMENT: ${reason}`); }
function plainPath(target: string, installedExecutable = false): void {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1 && !installedExecutable)) refuse('LINKED_PATH');
  }
  if (fs.realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) refuse('PATH_ALIAS');
}
export function prepareGitPlan(operation: string, input: Record<string,unknown> = {}): GitPlan {
  if (!['status','diff','log','branch'].includes(operation)) refuse('OPERATION_DISABLED');
  if (Object.keys(input).some(key => key !== 'count' || operation !== 'log')) refuse('ARBITRARY_ARGUMENTS_DISABLED');
  const count = input.count ?? 5;
  if (!Number.isSafeInteger(count) || Number(count) < 1 || Number(count) > 50) refuse('INVALID_COUNT');
  const cwd = path.join(getDedicatedWorkspaceRoot(), 'repository');
  plainPath(cwd);
  const gitDir = path.join(cwd, '.git');
  plainPath(gitDir);
  if (!fs.statSync(gitDir).isDirectory()) refuse('LINKED_WORKTREE_DISABLED');
  // Reject includes, aliases, fsmonitor, filters, external commands, URL rewrites and all unknown config.
  const configPath = path.join(gitDir, 'config');
  plainPath(configPath);
  if (fs.statSync(configPath).size > 4096) refuse('CONFIG_TOO_LARGE');
  let core = false;
  for (const line of fs.readFileSync(configPath,'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#') || value.startsWith(';')) continue;
    if (value === '[core]') { core = true; continue; }
    if (!core || !/^(repositoryformatversion\s*=\s*0|bare\s*=\s*false|(?:filemode|logallrefupdates|ignorecase|symlinks)\s*=\s*(?:true|false))$/i.test(value)) refuse('UNREVIEWED_REPOSITORY_CONFIG');
  }
  for (const entry of ['commondir','gitdir','objects/info/alternates','objects/info/http-alternates','shallow']) {
    if (fs.existsSync(path.join(gitDir,entry))) refuse('EXTERNAL_OR_PARTIAL_REPOSITORY_DISABLED');
  }
  // Full tree validation is conservative; a separate OS boundary must prevent mutation after validation.
  function inspect(dir: string): void {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,entry.name); const stat=fs.lstatSync(full);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) refuse('LINKED_REPOSITORY_ENTRY');
      if (stat.isDirectory()) inspect(full);
    }
  }
  inspect(cwd);
  // Git for Windows installs git.exe as a hard link. This fixed installed identity
  // is hashed; production requires OS-protected installation and enrolled hash.
  plainPath(GIT_EXECUTABLE, true);
  const executableSha256=createHash('sha256').update(fs.readFileSync(GIT_EXECUTABLE)).digest('hex');
  const args = ['--no-pager','--no-optional-locks',
    '-c','core.hooksPath=NUL','-c','core.fsmonitor=false','-c','core.untrackedCache=false',
    '-c','core.pager=','-c','credential.helper=','-c','protocol.allow=never',
    '-c','submodule.recurse=false'];
  const commands: Record<string,string[]> = {
    status: ['status','--porcelain=v1','--untracked-files=no','--ignore-submodules=all'],
    diff: ['diff','--no-ext-diff','--no-textconv','--ignore-submodules=all','--'],
    log: ['log',`-n${count}`,'--format=%h %s','--no-decorate','--no-show-signature','--no-ext-diff','--no-textconv'],
    branch: ['branch','--show-current'],
  };
  return { executable:GIT_EXECUTABLE, executableSha256, cwd, args:[...args,...commands[operation]],
    env:{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PATH:'C:\\Windows\\System32',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'NUL',GIT_CONFIG_GLOBAL:'NUL',
      GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',
      GIT_ATTR_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'',GIT_CEILING_DIRECTORIES:cwd,
      GIT_DIR:gitDir,GIT_WORK_TREE:cwd,HOME:cwd,USERPROFILE:cwd},
    timeoutMs:10000,maxOutputBytes:65536,shell:false,windowsHide:true };
}
export async function executeWorkerGit(_operation: string, _input: Record<string,unknown>): Promise<never> {
  // No env flag, caller field or injected callback may enroll an OS launcher.
  throw new Error('GIT_TRUSTED_SUPERVISOR_NOT_ENROLLED');
}
