import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export interface AdjudicationResult {
  passed: boolean;
  overridden: boolean;
  missingArtifacts: string[];
  blockingIssues: string[];
  recommendedFixes: string[];
}

export type StatFn = (absPath: string) => { exists: boolean; size: number };

const defaultStat: StatFn = (absPath) => {
  try {
    const s = fs.statSync(absPath);
    return { exists: true, size: s.size };
  } catch {
    return { exists: false, size: 0 };
  }
};

export interface FileIo {
  stat?: StatFn;
  read?: (absPath: string) => Buffer | null;
}

const defaultRead = (absPath: string): Buffer | null => {
  try {
    return fs.readFileSync(absPath);
  } catch {
    return null;
  }
};

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Objective guard for LLM-declared verification passes.
 *
 * A Verifier agent self-reports `passed` in its finish payload. That claim is
 * only accepted when every non-Verifier agent's declared outputArtifacts
 * actually exist (and are non-empty) on disk under the workspace root.
 * If any expected artifact is missing — e.g. file creation failed due to a
 * sandbox restriction — the pass is overridden to a failure so the run state
 * machine takes the repair/pause path instead of completing falsely.
 */
export function adjudicateVerificationPass(
  teamSheet: any,
  reportPassed: boolean,
  workspaceRoot: string,
  statFn: StatFn = defaultStat
): AdjudicationResult {
  const result: AdjudicationResult = {
    passed: reportPassed,
    overridden: false,
    missingArtifacts: [],
    blockingIssues: [],
    recommendedFixes: []
  };

  // A self-reported failure needs no adjudication.
  if (!reportPassed) return result;

  const agents = Array.isArray(teamSheet?.agents) ? teamSheet.agents : [];
  for (const agent of agents) {
    if (agent?.role === 'Verifier') continue;
    const outputs: string[] = Array.isArray(agent?.outputArtifacts) ? agent.outputArtifacts : [];
    for (const rel of outputs) {
      if (!rel) continue;
      const { exists, size } = statFn(path.join(workspaceRoot || '', rel));
      if (!exists || size === 0) {
        result.missingArtifacts.push(rel);
        result.blockingIssues.push(`Expected artifact '${rel}' from agent '${agent.id}' is missing or empty on disk.`);
        result.recommendedFixes.push(`Re-run agent '${agent.id}' so it creates '${rel}' within its allowed write scopes.`);
      }
    }
  }

  if (result.missingArtifacts.length > 0) {
    result.passed = false;
    result.overridden = true;
  }

  return result;
}

/* ── Report-level adjudication with exact-bytes / SHA-256 evidence ── */

export interface ObjectiveCheckEvidence {
  path: string;
  resolvedPath: string;
  exists: boolean;
  size: number;
  expectedContent?: string;
  actualContentPreview?: string;
  expectedSha256?: string;
  actualSha256?: string;
  contentMatches?: boolean;
  passed: boolean;
}

export interface ReportAdjudicationResult extends AdjudicationResult {
  evidence: ObjectiveCheckEvidence[];
}

const PREVIEW_LIMIT = 200;

function preview(buf: Buffer | string): string {
  const s = typeof buf === 'string' ? buf : buf.toString('utf-8');
  return s.length > PREVIEW_LIMIT ? s.slice(0, PREVIEW_LIMIT) + `… (${s.length} bytes total)` : s;
}

/**
 * Independently verifies an LLM verification report against the real files:
 * - every expected output artifact must exist and be non-empty;
 * - every check carrying a `path` is re-evaluated against the real file:
 *   exact byte comparison when `expectedContent` is supplied, and a SHA-256
 *   comparison when `expectedSha256` is supplied. The actual SHA-256 is always
 *   computed from the real file bytes — never from the LLM's statement.
 *
 * The returned `evidence` records resolved paths, expected vs actual bytes
 * (safe previews), expected vs actual SHA-256, and the per-file outcome.
 */
export function adjudicateVerificationReport(
  teamSheet: any,
  report: { passed: boolean; checks?: any[] } | null,
  workspaceRoot: string,
  io: FileIo = {}
): ReportAdjudicationResult {
  const statFn = io.stat || defaultStat;
  const readFn = io.read || defaultRead;

  const base = adjudicateVerificationPass(teamSheet, report?.passed ?? false, workspaceRoot, statFn);
  const result: ReportAdjudicationResult = { ...base, evidence: [] };

  // Self-reported failure: nothing more to prove, but still record artifact evidence.
  const checks = Array.isArray(report?.checks) ? report!.checks! : [];

  for (const check of checks) {
    const rel = check?.path;
    if (!rel || typeof rel !== 'string') continue;

    const resolvedPath = path.join(workspaceRoot || '', rel);
    const { exists, size } = statFn(resolvedPath);
    const evidence: ObjectiveCheckEvidence = {
      path: rel,
      resolvedPath,
      exists,
      size,
      passed: true
    };

    if (!exists || size === 0) {
      evidence.passed = false;
      result.blockingIssues.push(`Verification check '${check.name || rel}': file '${rel}' is missing or empty on disk.`);
      result.recommendedFixes.push(`Create '${rel}' with the expected content using the writeFile tool.`);
    } else {
      const actualBytes = readFn(resolvedPath);
      if (actualBytes) {
        evidence.actualSha256 = sha256(actualBytes);

        if (typeof check.expectedContent === 'string') {
          evidence.expectedContent = check.expectedContent;
          evidence.expectedSha256 = sha256(check.expectedContent);
          evidence.contentMatches = actualBytes.equals(Buffer.from(check.expectedContent, 'utf-8'));
          if (!evidence.contentMatches) {
            evidence.actualContentPreview = preview(actualBytes);
            evidence.passed = false;
            result.blockingIssues.push(
              `Verification check '${check.name || rel}': content of '${rel}' does not match the expected bytes ` +
              `(expected sha256 ${evidence.expectedSha256.slice(0, 12)}…, actual ${evidence.actualSha256.slice(0, 12)}…).`
            );
            result.recommendedFixes.push(`Rewrite '${rel}' with exactly the expected content using the writeFile tool.`);
          }
        } else if (typeof check.expectedSha256 === 'string' && check.expectedSha256) {
          evidence.expectedSha256 = check.expectedSha256;
          evidence.contentMatches = evidence.actualSha256 === check.expectedSha256;
          if (!evidence.contentMatches) {
            evidence.passed = false;
            result.blockingIssues.push(
              `Verification check '${check.name || rel}': SHA-256 of '${rel}' does not match ` +
              `(expected ${check.expectedSha256.slice(0, 12)}…, actual ${evidence.actualSha256.slice(0, 12)}…).`
            );
            result.recommendedFixes.push(`Rewrite '${rel}' so its bytes hash to the expected SHA-256.`);
          }
        }
      }
    }

    result.evidence.push(evidence);
  }

  const anyCheckFailed = result.evidence.some(e => !e.passed);
  if ((report?.passed ?? false) && anyCheckFailed) {
    result.passed = false;
    result.overridden = true;
  }
  if (anyCheckFailed) {
    result.passed = false;
  }

  return result;
}
