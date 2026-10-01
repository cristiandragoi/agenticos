import { terminalExecutor } from '../src/domains/jarvis/execution/executors/terminalExecutor.js';
import { filesystemExecutor } from '../src/domains/jarvis/execution/executors/filesystemExecutor.js';
import { gitExecutor } from '../src/domains/jarvis/execution/executors/gitExecutor.js';
import { desktopExecutor } from '../src/domains/jarvis/execution/executors/desktopExecutor.js';
import { engineeringExecutor } from '../src/domains/jarvis/execution/executors/engineeringExecutor.js';
import { browserExecutor } from '../src/domains/jarvis/execution/executors/browserExecutor.js';

async function runLiveExecutorTests() {
  console.log('=== LIVE EXECUTOR INDEPENDENT AUDIT ===\n');

  // 1. TERMINAL EXECUTOR
  console.log('--- 1. Testing Terminal Executor ---');
  try {
    const termRes = await terminalExecutor.runCommand({
      command: 'Write-Output "TERMINAL_LIVE_OK"',
      cwd: 'D:\\AgenticOS',
      shell: 'powershell',
    });
    console.log('Terminal result:', {
      exitCode: termRes.exitCode,
      stdout: termRes.stdout.trim(),
      durationMs: termRes.durationMs,
    });
  } catch (err: any) {
    console.error('Terminal executor failed:', err.message);
  }

  // 2. FILESYSTEM EXECUTOR
  console.log('\n--- 2. Testing Filesystem Executor ---');
  try {
    const fsStep = {
      stepId: 'fs-test',
      capabilityId: 'filesystem',
      executorId: 'filesystem',
      action: 'read',
      parameters: { path: 'D:\\AgenticOS\\package.json' },
    };
    const fsRes = await filesystemExecutor.executeStep(fsStep as any, { conversationId: 'test', workspacePath: 'D:\\AgenticOS' });
    const fsVerify = await filesystemExecutor.verify(fsRes);
    console.log('Filesystem read result:', {
      success: fsRes.success,
      output: fsRes.output,
      verified: fsVerify.verified,
      realityCheck: fsVerify.realityCheck,
    });
  } catch (err: any) {
    console.error('Filesystem executor failed:', err.message);
  }

  // 3. GIT EXECUTOR
  console.log('\n--- 3. Testing Git Executor ---');
  try {
    const gitStep = {
      stepId: 'git-test',
      capabilityId: 'git',
      executorId: 'git',
      action: 'status',
      parameters: { cwd: 'D:\\AgenticOS' },
    };
    const gitRes = await gitExecutor.executeStep(gitStep as any, { conversationId: 'test', workspacePath: 'D:\\AgenticOS' });
    const gitVerify = await gitExecutor.verify(gitRes);
    console.log('Git status result:', {
      success: gitRes.success,
      output: gitRes.output,
      verified: gitVerify.verified,
    });
  } catch (err: any) {
    console.error('Git executor failed:', err.message);
  }

  // 4. DESKTOP EXECUTOR
  console.log('\n--- 4. Testing Desktop Executor ---');
  try {
    const appResolved = desktopExecutor.resolveApp('notepad');
    console.log('Desktop resolveApp("notepad"):', appResolved ? appResolved.displayName : 'NOT_FOUND');
    // Verify process running check (query existing processes like powershell/node)
    const nodeRunning = await desktopExecutor.verifyProcessRunning('node');
    console.log('Desktop verifyProcessRunning("node"):', nodeRunning);
  } catch (err: any) {
    console.error('Desktop executor failed:', err.message);
  }

  // 5. ENGINEERING EXECUTOR
  console.log('\n--- 5. Testing Engineering Executor ---');
  try {
    const engStep = {
      stepId: 'eng-test',
      capabilityId: 'engineering',
      executorId: 'engineering',
      action: 'diagnose',
      parameters: { goal: 'Verify health of logging subsystem' },
    };
    const engRes = await engineeringExecutor.executeStep(engStep as any, { conversationId: 'test', workspacePath: 'D:\\AgenticOS' });
    console.log('Engineering executor result:', {
      success: engRes.success,
      output: engRes.output,
      error: engRes.error,
    });
  } catch (err: any) {
    console.error('Engineering executor failed:', err.message);
  }

  // 6. BROWSER EXECUTOR (inspecting current state / target)
  console.log('\n--- 6. Testing Browser Executor ---');
  try {
    const target = browserExecutor.resolveTarget('YouTube');
    console.log('Browser resolveTarget("YouTube"):', target);
  } catch (err: any) {
    console.error('Browser executor failed:', err.message);
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

runLiveExecutorTests().catch(console.error);
