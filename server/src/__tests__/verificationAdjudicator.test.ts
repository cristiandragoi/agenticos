import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { adjudicateVerificationPass, adjudicateVerificationReport } from '../services/agentTeams/verificationAdjudicator.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const teamSheet = {
  workspaceRoot: 'B:\\Repo',
  agents: [
    { id: 'planner', role: 'Planner', outputArtifacts: [] },
    { id: 'builder', role: 'Builder', outputArtifacts: ['src/app.ts', 'README.md'] },
    { id: 'verifier', role: 'Verifier', outputArtifacts: [] }
  ]
};

const allExist = () => ({ exists: true, size: 100 });
const noneExist = () => ({ exists: false, size: 0 });

describe('adjudicateVerificationPass', () => {
  it('accepts a pass when every expected artifact exists and is non-empty', () => {
    const result = adjudicateVerificationPass(teamSheet, true, 'B:\\Repo', allExist);
    expect(result.passed).toBe(true);
    expect(result.overridden).toBe(false);
    expect(result.missingArtifacts).toEqual([]);
  });

  it('overrides a pass when file creation failed (artifacts missing on disk)', () => {
    const result = adjudicateVerificationPass(teamSheet, true, 'B:\\Repo', noneExist);
    expect(result.passed).toBe(false);
    expect(result.overridden).toBe(true);
    expect(result.missingArtifacts).toEqual(['src/app.ts', 'README.md']);
    expect(result.blockingIssues.length).toBe(2);
    expect(result.blockingIssues[0]).toContain('builder');
  });

  it('overrides a pass when an artifact exists but is empty', () => {
    const result = adjudicateVerificationPass(teamSheet, true, 'B:\\Repo', () => ({ exists: true, size: 0 }));
    expect(result.passed).toBe(false);
    expect(result.overridden).toBe(true);
  });

  it('passes a self-reported failure through unchanged', () => {
    const result = adjudicateVerificationPass(teamSheet, false, 'B:\\Repo', allExist);
    expect(result.passed).toBe(false);
    expect(result.overridden).toBe(false);
    expect(result.blockingIssues).toEqual([]);
  });

  it('accepts a pass for teams that declare no output artifacts', () => {
    const researchSheet = {
      workspaceRoot: 'B:\\Repo',
      agents: [
        { id: 'analyst', role: 'Builder', outputArtifacts: [] },
        { id: 'verifier', role: 'Verifier', outputArtifacts: [] }
      ]
    };
    const result = adjudicateVerificationPass(researchSheet, true, 'B:\\Repo', noneExist);
    expect(result.passed).toBe(true);
    expect(result.overridden).toBe(false);
  });

  it('ignores artifacts declared by the Verifier itself', () => {
    const sheet = {
      workspaceRoot: 'B:\\Repo',
      agents: [
        { id: 'builder', role: 'Builder', outputArtifacts: ['out.txt'] },
        { id: 'verifier', role: 'Verifier', outputArtifacts: ['verifier-notes.txt'] }
      ]
    };
    const stat = (p: string) => (p.endsWith('out.txt') ? { exists: true, size: 10 } : { exists: false, size: 0 });
    const result = adjudicateVerificationPass(sheet, true, 'B:\\Repo', stat);
    expect(result.passed).toBe(true);
    expect(result.overridden).toBe(false);
  });
});

describe('adjudicateVerificationReport', () => {
  const sheet = {
    workspaceRoot: 'B:\Repo',
    agents: [
      { id: 'a2', role: 'Builder', outputArtifacts: ['jarvis-integration-test.txt'] },
      { id: 'a3', role: 'Verifier', outputArtifacts: [] }
    ]
  };
  const EXPECTED = 'Jarvis Agent Teams integration verified.';

  function ioWith(content: string | null) {
    return {
      stat: () => (content === null ? { exists: false, size: 0 } : { exists: true, size: Buffer.byteLength(content) }),
      read: () => (content === null ? null : Buffer.from(content, 'utf-8'))
    };
  }

  const reportWithCheck = (passed: boolean) => ({
    passed,
    checks: [{ name: 'exact bytes', passed, evidence: 'claimed', path: 'jarvis-integration-test.txt', expectedContent: EXPECTED }]
  });

  it('passes only when the real bytes match exactly, with SHA-256 evidence from real bytes', () => {
    const result = adjudicateVerificationReport(sheet, reportWithCheck(true), 'B:\Repo', ioWith(EXPECTED));
    expect(result.passed).toBe(true);
    expect(result.overridden).toBe(false);
    expect(result.evidence).toHaveLength(1);
    const ev = result.evidence[0];
    expect(ev.resolvedPath).toContain('jarvis-integration-test.txt');
    expect(ev.expectedSha256).toBe(sha256(EXPECTED));
    expect(ev.actualSha256).toBe(sha256(EXPECTED));
    expect(ev.contentMatches).toBe(true);
  });

  it('overrides an LLM-claimed pass when the real bytes do not match', () => {
    const wrong = 'completely wrong content';
    const result = adjudicateVerificationReport(sheet, reportWithCheck(true), 'B:\Repo', ioWith(wrong));
    expect(result.passed).toBe(false);
    expect(result.overridden).toBe(true);
    const ev = result.evidence[0];
    expect(ev.contentMatches).toBe(false);
    expect(ev.expectedSha256).toBe(sha256(EXPECTED));
    expect(ev.actualSha256).toBe(sha256(wrong));
    expect(result.blockingIssues[0]).toContain('does not match');
  });

  it('overrides a pass when the file does not exist at all', () => {
    const result = adjudicateVerificationReport(sheet, reportWithCheck(true), 'B:\Repo', ioWith(null));
    expect(result.passed).toBe(false);
    expect(result.overridden).toBe(true);
    expect(result.blockingIssues.some(i => i.includes('missing or empty'))).toBe(true);
  });

  it('compares expectedSha256 against the real file hash when supplied', () => {
    const report = {
      passed: true,
      checks: [{ name: 'hash', passed: true, evidence: 'claimed', path: 'jarvis-integration-test.txt', expectedSha256: sha256(EXPECTED) }]
    };
    const ok = adjudicateVerificationReport(sheet, report, 'B:\Repo', ioWith(EXPECTED));
    expect(ok.passed).toBe(true);

    const bad = adjudicateVerificationReport(sheet, report, 'B:\Repo', ioWith('tampered'));
    expect(bad.passed).toBe(false);
    expect(bad.evidence[0].contentMatches).toBe(false);
  });
});
