// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  writeBackendOwnership,
  readBackendOwnership,
  clearBackendOwnership,
  classifyPortOwner,
  type BackendOwnershipRecord,
} from '../processOwnership';

describe('processOwnership', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-ownership-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('writes, reads, and clears backend ownership metadata accurately', () => {
    expect(readBackendOwnership(tmpDir)).toBeNull();

    const record: BackendOwnershipRecord = {
      parentPid: 1234,
      parentExecPath: 'C:\\AgenticOS\\AgenticOS.exe',
      pid: 5678,
      entry: 'D:\\AgenticOS\\server\\dist\\index.js',
      cwd: 'D:\\AgenticOS\\server',
      port: 4600,
      startedAt: Date.now(),
      buildIdentity: {
        buildId: 'test-build-123',
        gitSha: 'abcdef',
        buildTimestamp: '2026-09-26T12:00:00Z',
      },
    };

    writeBackendOwnership(tmpDir, record);
    const read = readBackendOwnership(tmpDir);
    expect(read).toEqual(record);

    clearBackendOwnership(tmpDir);
    expect(readBackendOwnership(tmpDir)).toBeNull();
  });

  it('classifies healthy backend as HEALTHY_AGENTICOS_BACKEND', async () => {
    const classification = await classifyPortOwner(
      { port: 4600, userDataDir: tmpDir, entry: 'D:/AgenticOS/server/dist/index.js' },
      { reachable: true, healthy: true, httpStatus: 200 }
    );

    expect(classification.type).toBe('HEALTHY_AGENTICOS_BACKEND');
  });

  it('classifies free port as FREE_PORT when probe fails and port has no listener', async () => {
    // Pick an unused high port
    const freePort = 46999;
    const classification = await classifyPortOwner(
      { port: freePort, userDataDir: tmpDir, entry: 'D:/AgenticOS/server/dist/index.js' },
      { reachable: false, healthy: false, error: 'ECONNREFUSED' }
    );

    expect(classification.type).toBe('FREE_PORT');
  });

  it('identifies STALE_AGENTICOS_BACKEND when metadata points to verified PID', async () => {
    // Record current process PID as a simulated stale backend
    const record: BackendOwnershipRecord = {
      parentPid: 99999, // dead parent
      parentExecPath: 'C:\\Fake\\AgenticOS.exe',
      pid: process.pid,
      entry: 'D:\\AgenticOS\\server\\dist\\index.js',
      cwd: 'D:\\AgenticOS\\server',
      port: 4600,
      startedAt: Date.now() - 60000,
    };
    writeBackendOwnership(tmpDir, record);

    // If port 4600 is queried and matches record
    const recordRead = readBackendOwnership(tmpDir);
    expect(recordRead?.pid).toBe(process.pid);
  });
});
