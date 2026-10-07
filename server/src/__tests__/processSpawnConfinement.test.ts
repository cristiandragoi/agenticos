import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Authoritative static allow-list for child_process usage in server/src.
 * Every entry corresponds to an audited, classified call site in audit/phase2b/spawn-inventory.md.
 * Any new child_process invocation outside this list will fail this test.
 */
const AUDITED_ALLOW_LIST = new Set([
  // ── Phase 2 Boundary Supervisors (ROUTED) ──
  'domains/securitySupervisor/windowsJob.ts',
  'domains/securitySupervisor/phase2JobBoundary.ts',

  // ── Core Terminal Executor (ROUTED programmatic + UNCONFINED visibleWindow) ──
  'domains/jarvis/execution/executors/terminalExecutor.ts',

  // ── Coding Runtime (UNCONFINED) ──
  'domains/codingRuntime/codexRuntimeAdapter.ts',
  'domains/codingRuntime/gitWorktree.ts',

  // ── Control Plane (UNCONFINED) ──
  'domains/controlPlane/adapters/AppCapabilityAdapter.ts',
  'domains/controlPlane/adapters/ChatCapabilityAdapter.ts',
  'domains/controlPlane/AgenticOsGitService.ts',
  'domains/controlPlane/ArgusService.ts',
  'domains/controlPlane/AutonomousCapabilityCertificationRunner.ts',
  'domains/controlPlane/browser/BrowserCodeSession.ts',
  'domains/controlPlane/CapabilityDiscovery.ts',
  'domains/controlPlane/computerUse/AgentSComputerUseProvider.ts',
  'domains/controlPlane/computerUse/AuthoritativeDesktopComputerUseProvider.ts',
  'domains/controlPlane/computerUse/DesktopInput.ts',
  'domains/controlPlane/computerUse/WhatsAppChatNavigator.ts',
  'domains/controlPlane/ControlPlaneExecutor.ts',
  'domains/controlPlane/EngineeringWorkerRegistry.ts',
  'domains/controlPlane/RepositoryAuthority.ts',
  'domains/controlPlane/TargetResolver.ts',
  'domains/controlPlane/UniversalContentAcquisition.ts',
  'domains/controlPlane/UniversalPerceptionService.ts',
  'domains/controlPlane/UniversalVerifier.ts',
  'domains/controlPlane/WindowsApplicationResolver.ts',

  // ── Hermes & Jarvis Diagnostics (UNCONFINED) ──
  'domains/hermes/hermesOrchestrator.ts',
  'domains/jarvis/behavioralHealth.ts',
  'domains/jarvis/canonicalTurnExecutionService.ts',

  // ── Internal Desktop / Perception / Infrastructure (UNCONFINED) ──
  'domains/jarvis/execution/executors/desktopExecutor.ts',
  'domains/jarvis/execution/executors/filesystemExecutor.ts',
  'domains/jarvis/execution/recoveryController.ts',
  'domains/jarvis/hermesGatewayHealth.ts',
  'domains/jarvis/perception/targetContentExtractor.ts',
  'domains/jarvisNext/audioUtils.ts',
  'domains/jarvisNext/livekitServerManager.ts',
  'domains/jarvisNext/turnRouter.ts',
  'domains/repositoryResearch/evaluation.ts',
  'domains/selfHeal/RepairExecutor.ts',
  'domains/selfHeal/RepairPlanner.ts',
  'domains/selfHeal/RepairTestRunner.ts',
  'domains/selfHeal/SelfHealSupervisor.ts',
  'domains/selfHeal/SnapshotManager.ts',
  'domains/selfHeal/TraceCollector.ts',
  'domains/selfHeal/acceptance-tests.mts',
  'domains/selfHeal/run-incident-002.mts',
  'domains/turnLifecycle/probes.ts',
  'domains/workerAdapters/deepseekHarnessAdapter.ts',
  'routers/agentic.ts',
  'routers/chat.ts',
  'routers/diagnostics.ts',
  'routers/health.ts',
  'scripts/verify-hermes-acceptance.ts',
  'scripts/verify-hermes-live-progress.ts',
  'services/argus/argusService.ts',
  'services/backgroundTasks/antigravityAdapter.ts',
  'services/backgroundTasks/manager.ts',
  'services/browser/browserOperator.ts',
  'services/browser/browserSession.ts',
  'services/browser/browserSessionAuthority.ts',
  'services/gates/registry.ts',
  'services/gateway/codexBridge.ts',
  'services/hermesApiService.ts',
  'services/hermesWatchdog.ts',
  'services/maintenance/gitState.ts',
  'services/perception/CameraPerceptionService.ts',
  'services/perception/DesktopPerceptionService.ts',
  'services/perception/LocationService.ts',
  'services/perception/foregroundScreenReader.ts',
  'services/revenueOperator/browser/browserWorkerSupervisor.ts',
  'services/revenuePipeline/pipelineService.ts',
  'services/system/hardwareProfiler.ts',
  'services/voice/localTranscribe.ts',
  'services/voice/localTts.ts',
  'services/voice/piperTts.ts',
  'utils/sandbox.ts',
  'workflows/workers/claude.ts',
  'adapters/hermesAdapter.ts',
]);

function walkDirectory(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        files.push(...walkDirectory(full));
      }
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Process Spawn Confinement Static Audit', () => {
  const srcRoot = path.resolve(__dirname, '..');
  const allFiles = walkDirectory(srcRoot);

  it('scans all server/src files and ensures no unapproved child_process invocations exist', () => {
    const violatingFiles: { file: string; line: number; text: string }[] = [];

    const pattern = /(?:from\s+['"](?:node:)?child_process['"]|require\(['"](?:node:)?child_process['"]\)|import\(['"](?:node:)?child_process['"]\))/;

    for (const file of allFiles) {
      const relPath = path.relative(srcRoot, file).replace(/\\/g, '/');
      const content = fs.readFileSync(file, 'utf8');

      if (pattern.test(content)) {
        if (!AUDITED_ALLOW_LIST.has(relPath)) {
          // Identify the exact matching line
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              violatingFiles.push({ file: relPath, line: i + 1, text: lines[i].trim() });
            }
          }
        }
      }
    }

    expect(violatingFiles).toEqual([]);
  });

  it('verifies terminalTool does NOT import child_process and is routed through terminalExecutor', () => {
    const terminalToolPath = path.join(srcRoot, 'services/agent/tools/terminalTool.ts');
    const content = fs.readFileSync(terminalToolPath, 'utf8');

    expect(content).not.toContain('child_process');
    expect(content).toContain('terminalExecutor.runCommand');
  });

  it('verifies gitExecutor delegates to terminalExecutor', () => {
    const gitExecutorPath = path.join(srcRoot, 'domains/jarvis/execution/executors/gitExecutor.ts');
    const content = fs.readFileSync(gitExecutorPath, 'utf8');

    expect(content).not.toContain('child_process');
    expect(content).toContain('terminalExecutor.runCommand');
  });

  it('verifies shell.execute in toolRegistryBridge routes to terminalExecutor', () => {
    const bridgePath = path.join(srcRoot, 'domains/localWorker/toolRegistryBridge.ts');
    const content = fs.readFileSync(bridgePath, 'utf8');

    expect(content).toContain("case 'shell.execute':");
    expect(content).toContain('terminalExecutor.runCommand');
  });

  it('verifies terminalExecutor routes programmatic commands through WindowsJob on win32', () => {
    const terminalExecutorPath = path.join(srcRoot, 'domains/jarvis/execution/executors/terminalExecutor.ts');
    const content = fs.readFileSync(terminalExecutorPath, 'utf8');

    expect(content).toContain('WindowsJob');
    expect(content).toContain('findJobRunnerHelper');
    expect(content).toContain('job.run(plan');
    expect(content).toContain('AGENTICOS_UNCONFINED_TEST_ONLY');
    expect(content).toContain('JOB_BOUNDARY_OPT_OUT_REJECTED');
  });

  it('verifies sandbox.ts routes commands through WindowsJob on win32 and fails closed', () => {
    const sandboxPath = path.join(srcRoot, 'utils/sandbox.ts');
    const content = fs.readFileSync(sandboxPath, 'utf8');

    expect(content).toContain('WindowsJob');
    expect(content).toContain('findJobRunnerHelper');
    expect(content).toContain('job.run(plan');
    expect(content).toContain('BLOCKED_UNCONFINED');
    expect(content).toContain('AGENTICOS_UNCONFINED_TEST_ONLY');
  });

  it('verifies workflows/workers/claude.ts routes runProcess through WindowsJob on win32 and fails closed', () => {
    const claudePath = path.join(srcRoot, 'workflows/workers/claude.ts');
    const content = fs.readFileSync(claudePath, 'utf8');

    expect(content).toContain('WindowsJob');
    expect(content).toContain('findJobRunnerHelper');
    expect(content).toContain('job.run(plan');
    expect(content).toContain('BLOCKED_UNCONFINED');
    expect(content).toContain('AGENTICOS_UNCONFINED_TEST_ONLY');
  });

  it('enforces that terminalExecutor rejects unconfined execution on win32 by default and fails closed', async () => {
    if (process.platform !== 'win32') return;
    const { terminalExecutor } = await import('../domains/jarvis/execution/executors/terminalExecutor.js');
    const { runWithTurnOwnership } = await import('../domains/jarvis/perception/turnOwnership.js');
    const { beginOperation, noteConversationTurn } = await import('../domains/jarvis/perception/perceptionOperation.js');

    const CID = 'test-job-confinement-opt-out';
    const op = beginOperation({ conversationId: CID, turnId: 1, capability: 'terminal' });
    noteConversationTurn(CID, 1);
    const frame = { conversationId: CID, turnId: 1, operationId: op.operationId, capability: 'terminal' };

    const oldOptOut = process.env.AGENTICOS_UNCONFINED_TEST_ONLY;
    delete process.env.AGENTICOS_UNCONFINED_TEST_ONLY;

    try {
      // 1. Attempting to bypass job boundary without test opt-out must fail closed
      const resOptOut = await runWithTurnOwnership(frame, () =>
        terminalExecutor.runCommand({
          command: 'echo unconfined_blocked',
          cwd: process.cwd(),
          useJobBoundary: false,
        })
      );

      expect(resOptOut.exitCode).toBe(-1);
      expect(resOptOut.stderr).toContain('JOB_BOUNDARY_REQUIRED');

      // 2. Setting test opt-out permits unconfined fallback
      process.env.AGENTICOS_UNCONFINED_TEST_ONLY = 'true';
      const resPermitted = await runWithTurnOwnership(frame, () =>
        terminalExecutor.runCommand({
          command: 'echo allowed_opt_out',
          cwd: process.cwd(),
          useJobBoundary: false,
        })
      );

      expect(resPermitted.exitCode).toBe(0);
      expect(resPermitted.stdout).toContain('allowed_opt_out');
    } finally {
      if (oldOptOut !== undefined) {
        process.env.AGENTICOS_UNCONFINED_TEST_ONLY = oldOptOut;
      } else {
        delete process.env.AGENTICOS_UNCONFINED_TEST_ONLY;
      }
    }
  });

  it('enforces that claude.ts runProcess routes commands through WindowsJob on win32', async () => {
    if (process.platform !== 'win32') return;
    const { runProcess } = await import('../workflows/workers/claude.js');
    const oldOptOut = process.env.AGENTICOS_UNCONFINED_TEST_ONLY;
    delete process.env.AGENTICOS_UNCONFINED_TEST_ONLY;

    try {
      const out = await runProcess('node', ['-e', 'console.log("worker-job-pass")'], process.cwd());
      expect(out.trim()).toContain('worker-job-pass');
    } finally {
      if (oldOptOut !== undefined) {
        process.env.AGENTICOS_UNCONFINED_TEST_ONLY = oldOptOut;
      } else {
        delete process.env.AGENTICOS_UNCONFINED_TEST_ONLY;
      }
    }
  });
});


