import { describe, it, expect } from 'vitest';
import {
  engineeringWorkerRegistry,
  EngineeringExecutionEvent,
} from '../domains/controlPlane/EngineeringWorkerRegistry.js';
import { capabilityCertificationRegistry } from '../domains/controlPlane/CapabilityCertificationRegistry.js';

describe('EngineeringWorkerRegistry & Unified Telemetry Contract', () => {
  it('1. Registers AntiGravity as first-class coder with all required engineering capabilities', () => {
    const ag = engineeringWorkerRegistry.getWorker('antigravity');
    expect(ag).toBeDefined();
    expect(ag?.role).toBe('coder');
    expect(ag?.status).toBe('ONLINE');

    const requiredCaps = [
      'engineering.inspect_repository',
      'engineering.search_code',
      'engineering.read_file',
      'engineering.edit_file',
      'engineering.run_command',
      'engineering.run_tests',
      'engineering.build',
      'engineering.deploy',
      'engineering.git_diff',
      'engineering.git_status',
      'engineering.commit',
      'engineering.antigravity',
    ];

    for (const cap of requiredCaps) {
      expect(ag?.capabilities).toContain(cap);
    }
  });

  it('2. Registers Codex as secondary/fallback engineering worker', () => {
    const codex = engineeringWorkerRegistry.getWorker('codex');
    expect(codex).toBeDefined();
    expect(codex?.role).toBe('coder');
    expect(codex?.capabilities).toContain('engineering.edit_file');
    expect(codex?.capabilities).toContain('engineering.run_command');
  });

  it('3. Prefers AntiGravity for substantial engineering repairs when auto-routing', () => {
    const preferred = engineeringWorkerRegistry.resolvePreferredWorker('auto');
    expect(preferred).toBe('antigravity');

    const explicitCodex = engineeringWorkerRegistry.resolvePreferredWorker('codex');
    expect(explicitCodex).toBe('codex');
  });

  it('4. CapabilityCertificationRegistry includes engineering.antigravity and probes online', async () => {
    await capabilityCertificationRegistry.probeAll();
    const cert = capabilityCertificationRegistry.getCertification('engineering.antigravity');
    expect(cert).toBeDefined();
    expect(cert?.capability).toBe('engineering.antigravity');
    expect(cert?.status).toBe('VERIFIED');
    expect(cert?.evidence.worker).toBe('antigravity');
  }, 15000);

  it('5. Records real-time execution events and updates live console state for AntiGravity', () => {
    const taskId = 'task-test-ag-001';
    const convId = 'conv-test-ag-999';

    // 1. WORKER_ACCEPTED
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'WORKER_ACCEPTED',
      metadata: { conversationId: convId },
    });

    // 2. REPOSITORY_OPENED
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'REPOSITORY_OPENED',
      file: 'D:\\AgenticOS',
    });

    // 3. FILE_READ
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'FILE_READ',
      file: 'D:\\AgenticOS\\server\\src\\index.ts',
    });

    // 4. COMMAND_STARTED
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'COMMAND_STARTED',
      command: 'npm test',
    });

    // 5. COMMAND_OUTPUT
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'COMMAND_OUTPUT',
      command: 'npm test',
      output: 'All tests passed (exit 0)',
      exitCode: 0,
    });

    // 6. WORKER_DONE
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId,
      workerId: 'antigravity',
      runId: convId,
      eventType: 'WORKER_DONE',
    });

    const consoleState = engineeringWorkerRegistry.getLiveConsoleState('antigravity');
    expect(consoleState.worker).toBeDefined();
    expect(consoleState.worker?.currentTaskId).toBe(taskId);
    expect(consoleState.worker?.sessionId).toBe(convId);
    expect(consoleState.worker?.filesRead).toContain('D:\\AgenticOS\\server\\src\\index.ts');
    expect(consoleState.worker?.currentCommand).toBe('npm test');

    const taskEvents = consoleState.events.filter(e => e.taskId === taskId);
    expect(taskEvents.map(e => e.eventType)).toEqual([
      'WORKER_ACCEPTED',
      'REPOSITORY_OPENED',
      'FILE_READ',
      'COMMAND_STARTED',
      'COMMAND_OUTPUT',
      'WORKER_DONE',
    ]);
  });

  it('6. Supports unified event schema across Codex and AntiGravity', () => {
    const codexTaskId = 'task-test-codex-002';
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: codexTaskId,
      workerId: 'codex',
      eventType: 'WORKER_ACCEPTED',
    });
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: codexTaskId,
      workerId: 'codex',
      eventType: 'FILE_EDITED',
      file: 'D:\\AgenticOS\\server\\src\\test.ts',
      changedFiles: ['D:\\AgenticOS\\server\\src\\test.ts'],
    });
    engineeringWorkerRegistry.recordWorkerEvent({
      taskId: codexTaskId,
      workerId: 'codex',
      eventType: 'WORKER_DONE',
    });

    const codexEvents = engineeringWorkerRegistry.getWorkerEvents('codex', 10);
    const related = codexEvents.filter(e => e.taskId === codexTaskId);
    expect(related.length).toBe(3);
    expect(related[0].eventType).toBe('WORKER_ACCEPTED');
    expect(related[1].eventType).toBe('FILE_EDITED');
    expect(related[2].eventType).toBe('WORKER_DONE');
  });
});
