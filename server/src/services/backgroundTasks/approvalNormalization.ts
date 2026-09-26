/**
 * Canonical Approval Normalization & Safety Classification Layer.
 *
 * Provides a single deterministic classification layer for all worker tool
 * execution requests (Hermes, CodeX, Revenue, Teams).
 *
 * Maps disparate runtime tool vocabularies ('execute_code', 'terminal', 'patch',
 * 'read_file', shell commands, etc.) into canonical action types and security tiers.
 */

import path from 'node:path';

export type CanonicalApprovalAction =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'terminal.execute'
  | 'process.execute'
  | 'git.read'
  | 'git.write'
  | 'test.execute'
  | 'network.request'
  | 'destructive.delete'
  | 'code.execute'
  | 'unknown';

export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface NormalizedApproval {
  canonicalAction: CanonicalApprovalAction;
  label: string;
  category: string;
  riskLevel: ApprovalRiskLevel;
  isReadOnly: boolean;
  isWorkspaceSafe: boolean;
  summary: string;
}

export interface RawApprovalInput {
  action?: string | null;
  tool?: string | null;
  toolName?: string | null;
  command?: string | null;
  reason?: string | null;
  files?: string[] | null;
  workspaceRoot?: string | null;
}

const DESTRUCTIVE_CMD_PATTERNS = [
  /\brm\s+(-[rfRF]+\s+|--recursive\s+|--force\s+)/i,
  /\brmdir\s+\/s\b/i,
  /\bdel\s+(\/[fsyq]\s+)+/i,
  /\bgit\s+clean\s+(-[fdxX]+)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdrop\s+(database|table|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+[a-z]:/i,
  /\bshred\b/i,
];

const GIT_READ_PATTERNS = [
  /\bgit\s+(status|branch|log|diff|show|rev-parse|describe|tag|ls-files|config\s+--get)/i,
];

const GIT_WRITE_PATTERNS = [
  /\bgit\s+(commit|push|checkout\s+-b|switch\s+-c|merge|rebase|cherry-pick|tag\s+-a|stash)/i,
];

const TEST_EXEC_PATTERNS = [
  /\b(vitest|jest|pytest|mocha|playwright|cypress)\b/i,
  /\bnpm\s+(test|run\s+test)/i,
  /\bpnpm\s+(test|run\s+test)/i,
  /\byarn\s+test\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
];

const NETWORK_PATTERNS = [
  /\b(curl|wget|http|https|fetch|axios)\b/i,
  /\b(ssh|scp|sftp|ftp|telnet)\b/i,
  /\bnpm\s+(publish|login)/i,
];

/**
 * Check if path is strictly inside workspace root without path traversal.
 */
function isPathInsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  try {
    if (!workspaceRoot) return false;
    const normWorkspace = path.resolve(workspaceRoot).toLowerCase();
    const normTarget = path.resolve(workspaceRoot, targetPath).toLowerCase();
    return normTarget.startsWith(normWorkspace);
  } catch {
    return false;
  }
}

/**
 * Classify raw execute_code payloads (e.g. Python scripts)
 */
function classifyCodePayload(code: string, workspaceRoot?: string | null): {
  canonicalAction: CanonicalApprovalAction;
  isReadOnly: boolean;
  riskLevel: ApprovalRiskLevel;
} {
  const clean = code.trim();
  // Check for destructive python patterns
  if (/shutil\.rmtree|os\.remove|os\.unlink|os\.rmdir|subprocess\.run\(.*rm\s+-rf/i.test(clean)) {
    return { canonicalAction: 'destructive.delete', isReadOnly: false, riskLevel: 'critical' };
  }
  // Check for network access in python
  if (/urllib\.request|requests\.(get|post|put|delete)|http\.client|socket\./i.test(clean)) {
    return { canonicalAction: 'network.request', isReadOnly: false, riskLevel: 'high' };
  }
  // Check for file writing in python
  if (/open\([^)]+['"][wa\+][^)]*\)|write_text|writelines|\.write\(/i.test(clean)) {
    return { canonicalAction: 'filesystem.write', isReadOnly: false, riskLevel: 'medium' };
  }
  // Pure inspection checks (os.path.exists, json.load, read_text, glob)
  if (
    /os\.path\.(exists|isfile|isdir)|pathlib\.Path|glob\.glob|json\.load|read_text|\.read\(\)/i.test(clean) &&
    !/subprocess|os\.system|exec\(|eval\(/i.test(clean)
  ) {
    return { canonicalAction: 'filesystem.read', isReadOnly: true, riskLevel: 'low' };
  }

  return { canonicalAction: 'code.execute', isReadOnly: false, riskLevel: 'medium' };
}

/**
 * Primary Canonical Normalization Entry Point.
 */
export function normalizeApprovalAction(input: RawApprovalInput): NormalizedApproval {
  const rawAction = (input.action || input.tool || input.toolName || '').trim();
  const rawCmd = (input.command || '').trim();
  const workspaceRoot = input.workspaceRoot || null;
  const files = Array.isArray(input.files) ? input.files : [];

  // 1. Destructive Commands check (Highest Precedence)
  for (const pat of DESTRUCTIVE_CMD_PATTERNS) {
    if (pat.test(rawCmd)) {
      return {
        canonicalAction: 'destructive.delete',
        label: 'Destructive Deletion',
        category: 'destructive',
        riskLevel: 'critical',
        isReadOnly: false,
        isWorkspaceSafe: false,
        summary: 'Deletes files or directories irreversibly.',
      };
    }
  }

  // 2. Python / Code Execution Payload Check (e.g. `execute_code << 'PY' ...`)
  if (rawAction.toLowerCase() === 'execute_code' || rawCmd.startsWith('execute_code') || /^python(\d+)?\s+-c/i.test(rawCmd)) {
    const codeBody = rawCmd.replace(/^execute_code(\s*<<\s*['"][A-Z]+['"])?/i, '').trim();
    const codeAnalysis = classifyCodePayload(codeBody || rawCmd, workspaceRoot);
    const isSafeRead = codeAnalysis.isReadOnly && (files.length === 0 || files.every(f => isPathInsideWorkspace(f, workspaceRoot || '')));

    return {
      canonicalAction: codeAnalysis.canonicalAction,
      label: codeAnalysis.canonicalAction === 'filesystem.read' ? 'Inspect File / Path' : 'Execute Python Script',
      category: 'code',
      riskLevel: codeAnalysis.riskLevel,
      isReadOnly: codeAnalysis.isReadOnly,
      isWorkspaceSafe: isSafeRead,
      summary: codeAnalysis.isReadOnly ? 'Read-only code inspection.' : 'Executes Python code in execution environment.',
    };
  }

  // 3. Test Execution Check
  for (const pat of TEST_EXEC_PATTERNS) {
    if (pat.test(rawCmd) || pat.test(rawAction)) {
      return {
        canonicalAction: 'test.execute',
        label: 'Run Test Suite',
        category: 'test',
        riskLevel: 'low',
        isReadOnly: true,
        isWorkspaceSafe: true,
        summary: 'Runs unit or integration test suites.',
      };
    }
  }

  // 4. Git Read vs Write
  for (const pat of GIT_READ_PATTERNS) {
    if (pat.test(rawCmd) || pat.test(rawAction)) {
      return {
        canonicalAction: 'git.read',
        label: 'Read Git / Repository Status',
        category: 'git',
        riskLevel: 'low',
        isReadOnly: true,
        isWorkspaceSafe: true,
        summary: 'Inspects repository history, branch, or working tree state.',
      };
    }
  }
  for (const pat of GIT_WRITE_PATTERNS) {
    if (pat.test(rawCmd) || pat.test(rawAction)) {
      return {
        canonicalAction: 'git.write',
        label: 'Modify Git Repository',
        category: 'git',
        riskLevel: 'medium',
        isReadOnly: false,
        isWorkspaceSafe: true,
        summary: 'Mutates git branches, commits, or working tree.',
      };
    }
  }

  // 5. Network Requests
  for (const pat of NETWORK_PATTERNS) {
    if (pat.test(rawCmd) || pat.test(rawAction)) {
      return {
        canonicalAction: 'network.request',
        label: 'External Network Request',
        category: 'network',
        riskLevel: 'high',
        isReadOnly: false,
        isWorkspaceSafe: false,
        summary: 'Initiates external network communication.',
      };
    }
  }

  // 6. Filesystem Tool Aliases & Code Inspection
  const normAction = rawAction.toLowerCase();
  if (
    normAction === 'repository.inspect' ||
    normAction.startsWith('repository.inspect') ||
    /^(?:where in the code|where is .*implemented|where are .*implemented|how is .*implemented|which file|what file)\b/i.test(normAction) ||
    (/\b(?:in the code|codebase|source code|implementation)\b/i.test(normAction) && !/\b(?:modify|write|edit|change|delete|remove|patch)\b/i.test(normAction))
  ) {
    const allFilesSafe = workspaceRoot ? files.every(f => isPathInsideWorkspace(f, workspaceRoot)) : false;
    return {
      canonicalAction: 'filesystem.read',
      label: 'Inspect Repository Code',
      category: 'filesystem',
      riskLevel: 'low',
      isReadOnly: true,
      isWorkspaceSafe: allFilesSafe || files.length === 0,
      summary: 'Reads or inspects repository code structure and implementation.',
    };
  }

  if (normAction === 'read_file' || normAction === 'search_files' || normAction === 'list_dir' || /^(cat|head|tail|grep|find|dir|ls)\b/i.test(rawCmd)) {
    const allFilesSafe = workspaceRoot ? files.every(f => isPathInsideWorkspace(f, workspaceRoot)) : false;
    return {
      canonicalAction: 'filesystem.read',
      label: 'Read Filesystem',
      category: 'filesystem',
      riskLevel: 'low',
      isReadOnly: true,
      isWorkspaceSafe: allFilesSafe || files.length === 0,
      summary: 'Reads repository files or directory structures.',
    };
  }

  if (normAction === 'write_file' || normAction === 'patch' || normAction === 'edit' || normAction === 'append_file' || /^(mkdir|touch)\b/i.test(rawCmd)) {
    const allFilesSafe = workspaceRoot ? files.every(f => isPathInsideWorkspace(f, workspaceRoot)) : true;
    return {
      canonicalAction: 'filesystem.write',
      label: 'Write / Modify Files',
      category: 'filesystem',
      riskLevel: 'medium',
      isReadOnly: false,
      isWorkspaceSafe: allFilesSafe,
      summary: 'Modifies files or creates directories on the filesystem.',
    };
  }

  // 7. Generic Terminal / Process Execution
  if (normAction === 'terminal' || normAction === 'process' || normAction === 'bash' || normAction === 'shell' || (rawCmd.length > 0 && normAction !== 'unknown')) {
    return {
      canonicalAction: 'terminal.execute',
      label: 'Execute Shell Command',
      category: 'terminal',
      riskLevel: 'medium',
      isReadOnly: false,
      isWorkspaceSafe: false,
      summary: 'Executes a command line instruction in the terminal.',
    };
  }

  // 8. Unknown action -> FAIL CLOSED (Strict Review Required)
  return {
    canonicalAction: 'unknown',
    label: rawAction && rawAction !== 'Unknown action' ? `Unknown Action (${rawAction})` : 'Unrecognized Action (Strict Review Required)',
    category: 'unknown',
    riskLevel: 'critical',
    isReadOnly: false,
    isWorkspaceSafe: false,
    summary: 'Unrecognized action or tool. Fails closed and requires manual authorization.',
  };
}

/**
 * Helper to determine whether an operation is eligible for workspace-bounded auto-approval.
 */
export function isWorkspaceSafeReadOnlyOperation(input: RawApprovalInput): boolean {
  const norm = normalizeApprovalAction(input);
  if (!norm.isReadOnly || !norm.isWorkspaceSafe) return false;
  if (norm.canonicalAction === 'destructive.delete' || norm.canonicalAction === 'unknown') return false;
  return true;
}
