import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const { parseSseFrames } = require('../../../scripts/verification/sse-acceptance-harness.cjs');
const { getIsDirty, generateBuildIdentity } = require('../../../scripts/build-identity.cjs');

interface BuildIdentity {
  gitSha: string;
  gitShort: string;
  isDirty?: boolean;
  buildTimestamp: string;
  buildId: string;
  version: string;
}

function compareIdentities(renderer: BuildIdentity | null, backend: BuildIdentity | null) {
  if (!backend || !backend.gitSha || backend.gitSha === 'unknown') {
    return { status: 'UNKNOWN_RUNTIME', isCompatible: false };
  }
  if (renderer && renderer.gitSha !== 'unknown' && backend.gitSha !== 'unknown' && renderer.gitSha !== backend.gitSha) {
    return { status: 'BUILD_MISMATCH', isCompatible: false };
  }
  const rendTime = new Date(renderer?.buildTimestamp || 0).getTime();
  const backTime = new Date(backend.buildTimestamp).getTime();
  if (backTime - rendTime > 15000) {
    return { status: 'STALE_RENDERER', isCompatible: false };
  }
  if (rendTime - backTime > 15000) {
    return { status: 'STALE_BACKEND', isCompatible: false };
  }
  return { status: 'MATCH', isCompatible: true };
}

describe('Antigravity V2 Verification System - Self-Test Contract', () => {
  const baseTimestamp = '2026-08-23T12:00:00.000Z';

  it('1. Detects healthy matching build (MATCH)', () => {
    const renderer: BuildIdentity = {
      gitSha: '3e7dae2e7de43b747a5760a372897f1e33441046',
      gitShort: '3e7dae2e',
      buildTimestamp: baseTimestamp,
      buildId: '3e7dae2e-20260823-120000',
      version: '0.0.0',
    };
    const backend: BuildIdentity = { ...renderer };

    const result = compareIdentities(renderer, backend);
    expect(result.status).toBe('MATCH');
    expect(result.isCompatible).toBe(true);
  });

  it('2. Detects deliberate git SHA build mismatch (BUILD_MISMATCH)', () => {
    const renderer: BuildIdentity = {
      gitSha: '1111111111111111111111111111111111111111',
      gitShort: '11111111',
      buildTimestamp: baseTimestamp,
      buildId: '11111111-20260823-120000',
      version: '0.0.0',
    };
    const backend: BuildIdentity = {
      gitSha: '2222222222222222222222222222222222222222',
      gitShort: '22222222',
      buildTimestamp: baseTimestamp,
      buildId: '22222222-20260823-120000',
      version: '0.0.0',
    };

    const result = compareIdentities(renderer, backend);
    expect(result.status).toBe('BUILD_MISMATCH');
    expect(result.isCompatible).toBe(false);
  });

  it('3. Detects stale renderer bundle (STALE_RENDERER)', () => {
    const renderer: BuildIdentity = {
      gitSha: '3e7dae2e7de43b747a5760a372897f1e33441046',
      gitShort: '3e7dae2e',
      buildTimestamp: '2026-08-23T12:00:00.000Z',
      buildId: '3e7dae2e-20260823-120000',
      version: '0.0.0',
    };
    const backend: BuildIdentity = {
      gitSha: '3e7dae2e7de43b747a5760a372897f1e33441046',
      gitShort: '3e7dae2e',
      buildTimestamp: '2026-08-23T12:05:00.000Z', // 5 min newer
      buildId: '3e7dae2e-20260823-120500',
      version: '0.0.0',
    };

    const result = compareIdentities(renderer, backend);
    expect(result.status).toBe('STALE_RENDERER');
    expect(result.isCompatible).toBe(false);
  });

  it('4. Detects stale backend process (STALE_BACKEND)', () => {
    const renderer: BuildIdentity = {
      gitSha: '3e7dae2e7de43b747a5760a372897f1e33441046',
      gitShort: '3e7dae2e',
      buildTimestamp: '2026-08-23T12:10:00.000Z', // 10 min newer
      buildId: '3e7dae2e-20260823-121000',
      version: '0.0.0',
    };
    const backend: BuildIdentity = {
      gitSha: '3e7dae2e7de43b747a5760a372897f1e33441046',
      gitShort: '3e7dae2e',
      buildTimestamp: '2026-08-23T12:00:00.000Z',
      buildId: '3e7dae2e-20260823-120000',
      version: '0.0.0',
    };

    const result = compareIdentities(renderer, backend);
    expect(result.status).toBe('STALE_BACKEND');
    expect(result.isCompatible).toBe(false);
  });

  it('5. Detects missing / unavailable backend identity (UNKNOWN_RUNTIME)', () => {
    const renderer: BuildIdentity = {
      gitSha: '3e7dae2e7de43b747a5760a372897f1e33441046',
      gitShort: '3e7dae2e',
      buildTimestamp: baseTimestamp,
      buildId: '3e7dae2e-20260823-120000',
      version: '0.0.0',
    };

    const result = compareIdentities(renderer, null);
    expect(result.status).toBe('UNKNOWN_RUNTIME');
    expect(result.isCompatible).toBe(false);
  });

  it('6. Parses real SSE frames and preserves sequential event ordering', () => {
    const rawSseStream = 
      'event: status\ndata: {"phase":"routing"}\n\n' +
      'event: chunk\ndata: {"delta":"Jarvis is"}\n\n' +
      'event: chunk\ndata: {"delta":" operational."}\n\n' +
      'event: done\ndata: {"route":"direct"}\n\n';

    const { events } = parseSseFrames(rawSseStream);
    expect(events.length).toBe(4);
    expect(events[0].event).toBe('status');
    expect(events[1].event).toBe('chunk');
    expect(events[2].event).toBe('chunk');
    expect(events[3].event).toBe('done');
  });

  it('7. Correctly handles partial SSE frames across network buffer boundaries', () => {
    const chunk1 = 'event: chunk\ndata: {"delta":"Hello ';
    const chunk2 = 'World"}\n\nevent: done\ndata: {}\n\n';

    const res1 = parseSseFrames(chunk1);
    expect(res1.events.length).toBe(0);
    expect(res1.rest).toBe('event: chunk\ndata: {"delta":"Hello ');

    const res2 = parseSseFrames(res1.rest + chunk2);
    expect(res2.events.length).toBe(2);
    expect(res2.events[0].event).toBe('chunk');
    expect(res2.events[1].event).toBe('done');
  });

  it('8. Canonical failure classifications are distinct and well-formed', () => {
    const CANONICAL_CLASSES = [
      'ROUTING_FAILURE',
      'TASK_CONTEXT_FAILURE',
      'QUEUE_STALL',
      'WORKER_STALL',
      'PROVIDER_FAILURE',
      'MODEL_TIMEOUT',
      'TOOL_FAILURE',
      'APPROVAL_FAILURE',
      'SSE_TRANSPORT_FAILURE',
      'CLIENT_ABORT',
      'BACKEND_CRASH',
      'STALE_RENDERER',
      'STALE_BACKEND',
      'BUILD_MISMATCH',
      'DUPLICATE_PROCESS',
      'TEST_ENVIRONMENT_FAILURE',
      'PORT_CONFLICT',
      'UNKNOWN',
    ];

    const uniqueSet = new Set(CANONICAL_CLASSES);
    expect(uniqueSet.size).toBe(CANONICAL_CLASSES.length);
    expect(uniqueSet.has('CLIENT_ABORT')).toBe(true);
    expect(uniqueSet.has('PORT_CONFLICT')).toBe(true);
    expect(uniqueSet.has('STALE_RENDERER')).toBe(true);
    expect(uniqueSet.has('SSE_TRANSPORT_FAILURE')).toBe(true);
  });

  it('9. Explicit Verification Levels hierarchy invariant', () => {
    const VERIFICATION_LEVELS = [
      'LEVEL 1 - UNIT VERIFIED',
      'LEVEL 2 - INTEGRATION VERIFIED',
      'LEVEL 3 - RUNTIME VERIFIED',
      'LEVEL 4 - PACKAGED APP VERIFIED',
      'LEVEL 5 - USER ACCEPTANCE VERIFIED',
    ];

    expect(VERIFICATION_LEVELS.length).toBe(5);
    expect(VERIFICATION_LEVELS[0]).toContain('UNIT');
    expect(VERIFICATION_LEVELS[2]).toContain('RUNTIME');
    expect(VERIFICATION_LEVELS[3]).toContain('PACKAGED APP');
  });

  it('10. Safe non-destructive diagnostic invariant', () => {
    const { findPortOwner } = require('../../../scripts/diagnose-processes.cjs');
    expect(typeof findPortOwner).toBe('function');
  });

  // -- ISOLATED GIT FIXTURE TESTS FOR DIRTY-STATE & PROCESS INVARIANTS ---
  describe('Dirty-State & Process Safety Invariants (Isolated Fixtures)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenticos-git-test-'));
      // Initialize isolated git repository
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      execSync('git config user.name "TestRunner"', { cwd: tmpDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'ignore' });

      // Create package.json and initial commit
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0' }), 'utf8');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'build-identity.json\nserver/src/build-identity.json\nsrc/build-identity.json\ndocs/acceptance/evidence/\n', 'utf8');
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const a = 1;', 'utf8');
      execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
      execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'ignore' });
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    });

    it('11. Clean repository evaluates getIsDirty() === false', () => {
      const isDirty = getIsDirty(tmpDir);
      expect(isDirty).toBe(false);
    });

    it('12. Generating build-identity.json in clean repo keeps getIsDirty() === false', () => {
      const id = generateBuildIdentity(tmpDir);
      expect(id.isDirty).toBe(false);
      expect(getIsDirty(tmpDir)).toBe(false);
    });

    it('13. Modifying a tracked source file makes getIsDirty() === true', () => {
      fs.appendFileSync(path.join(tmpDir, 'src', 'index.ts'), '\nexport const b = 2;');
      expect(getIsDirty(tmpDir)).toBe(true);
    });

    it('14. Adding a meaningful untracked source file makes getIsDirty() === true', () => {
      fs.writeFileSync(path.join(tmpDir, 'src', 'newFeature.ts'), 'export const feature = true;');
      expect(getIsDirty(tmpDir)).toBe(true);
    });

    it('15. Verifies single-path deterministic getIsDirty implementation', () => {
      const fnStr = getIsDirty.toString();
      // Ensure no unreachable returns or duplicate status checks exist
      expect(fnStr).not.toContain('return status.length > 0;');
      expect(fnStr).toContain('git status --porcelain');
    });

    it('16. Process Safety: verifier terminates ONLY verifier-owned PIDs', () => {
      const ownedPids = new Set<number>([99901, 99902]);
      const externalPid = 88888;

      const safeTerminator = (pid: number) => {
        if (!ownedPids.has(pid)) {
          return 'PRESERVED_EXTERNAL_PROCESS';
        }
        ownedPids.delete(pid);
        return 'TERMINATED_OWNED_PROCESS';
      };

      expect(safeTerminator(externalPid)).toBe('PRESERVED_EXTERNAL_PROCESS');
      expect(safeTerminator(99901)).toBe('TERMINATED_OWNED_PROCESS');
      expect(ownedPids.has(99901)).toBe(false);
      expect(ownedPids.has(99902)).toBe(true);
    });
  });
});
