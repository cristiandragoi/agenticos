/**
 * Canonical workspace resolution (workspace/file-reliability milestone).
 *
 * ONE authoritative runtime value — workspaceRoot — for every agent and
 * worker (Jarvis, Hermes, CodeX, background tasks, repository analysis,
 * tool execution). Nobody infers the repository independently and nobody
 * trusts process.cwd() as repository truth.
 *
 * Resolution order:
 *   1. Explicit selection persisted in server/data/workspace-selection.json
 *      (set by the Jarvis workspace bar / CodeX store via POST /api/workspace/select)
 *   2. AGENTICOS_WORKSPACE env override
 *   3. Git root of the server's working directory (dev host: B:\AgenticOS)
 *
 * Packaged-Electron safety: the selected workspace is USER DATA. It is
 * persisted in the backend data directory (same location as agentic-os.db)
 * and is never confused with app.getAppPath()/process.resourcesPath/server
 * dist paths. The store only ever returns a value that is an existing
 * directory or '' — it never invents a path from Electron internals.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { detectGitRepository } from '../utils/workspaceValidation.js';

/* ── Persistence location (same data dir as agentic-os.db) ──
   §10 packaged-Electron safety: the selection lives in the backend data
   directory — user-selectable workspace data, never confused with
   app.getAppPath()/process.resourcesPath/server dist paths. The expression
   mirrors db/index.ts exactly so both files always share one directory. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoServerRoot = path.resolve(__dirname, '..', '..');
const defaultDataDir = path.join(repoServerRoot, 'data');
const dbDir = path.dirname(process.env.AGENT_TEAMS_DB_PATH || path.join(defaultDataDir, 'agentic-os.db'));
const SELECTION_FILE = path.join(dbDir, 'workspace-selection.json');

interface PersistedSelection {
  workspaceRoot: string;
  selectedAt: string;
  source: 'user-selection' | 'env' | 'detected';
}

let cachedRoot: string | null = null;

function readPersistedSelection(): PersistedSelection | null {
  try {
    if (!fs.existsSync(SELECTION_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(SELECTION_FILE, 'utf-8'));
    if (raw && typeof raw.workspaceRoot === 'string' && raw.workspaceRoot.trim()) {
      return { workspaceRoot: raw.workspaceRoot.trim(), selectedAt: String(raw.selectedAt || ''), source: raw.source === 'env' ? 'env' : raw.source === 'detected' ? 'detected' : 'user-selection' };
    }
  } catch (err: any) {
    logger.warn(`[workspace] could not read selection file: ${err?.message}`);
  }
  return null;
}

function writePersistedSelection(sel: PersistedSelection): void {
  try {
    fs.mkdirSync(path.dirname(SELECTION_FILE), { recursive: true });
    fs.writeFileSync(SELECTION_FILE, JSON.stringify(sel, null, 2), 'utf-8');
  } catch (err: any) {
    logger.warn(`[workspace] could not persist selection: ${err?.message}`);
  }
}

function normalizeWindowsPath(value: string): string {
  // Preserve drive-letter casing, normalize separators for comparisons only.
  return value.replace(/\//g, '\\').replace(/\\+$/, '');
}

/** Git-root detection without throwing — '' when nothing found. */
function detectRoot(basePath: string): string {
  try {
    const { isValid, gitRoot } = detectGitRepository(basePath);
    if (isValid && gitRoot) return gitRoot;
  } catch { /* fall through */ }
  return '';
}

/**
 * The ONE canonical workspace root. '' means genuinely unresolved (the UI
 * must then say so — never guess).
 */
export function getWorkspaceRoot(): string {
  if (cachedRoot !== null) return cachedRoot;

  // 1. Explicit persisted selection wins (§9: user changed repository).
  const persisted = readPersistedSelection();
  if (persisted?.workspaceRoot && fs.existsSync(persisted.workspaceRoot)) {
    cachedRoot = persisted.workspaceRoot;
    return cachedRoot;
  }

  // 2. Env override.
  const envRoot = process.env.AGENTICOS_WORKSPACE?.trim();
  if (envRoot && fs.existsSync(envRoot)) {
    cachedRoot = envRoot;
    writePersistedSelection({ workspaceRoot: envRoot, selectedAt: new Date().toISOString(), source: 'env' });
    return cachedRoot;
  }

  // 3. Git root of the server's working directory (dev host default).
  const detected = detectRoot(process.cwd());
  if (detected && fs.existsSync(detected)) {
    cachedRoot = detected;
    writePersistedSelection({ workspaceRoot: detected, selectedAt: new Date().toISOString(), source: 'detected' });
    return cachedRoot;
  }

  cachedRoot = '';
  return cachedRoot;
}

/**
 * Change the canonical workspace root (§9). Validates that the directory
 * exists. Existing tasks keep the root captured at THEIR creation time
 * (metadata.workspaceRoot) — only NEW tasks see the new root.
 */
export function setWorkspaceRoot(root: string): { ok: boolean; workspaceRoot: string; error?: string } {
  const candidate = (root || '').trim();
  if (!candidate) return { ok: false, workspaceRoot: getWorkspaceRoot(), error: 'No workspace path provided.' };
  if (!fs.existsSync(candidate)) {
    return { ok: false, workspaceRoot: getWorkspaceRoot(), error: `Directory does not exist: ${candidate}` };
  }
  const gitRoot = detectRoot(candidate) || candidate;
  cachedRoot = gitRoot;
  writePersistedSelection({ workspaceRoot: gitRoot, selectedAt: new Date().toISOString(), source: 'user-selection' });
  logger.info(`[workspace] canonical workspace root set: ${gitRoot}`);
  return { ok: true, workspaceRoot: gitRoot };
}

/* ── Path resolution contract (§4) ─────────────────────────────── */

const ABS_RE = /^([a-zA-Z]:[\\/]|\\\\|\/\/)/; // drive-letter or UNC
const POSIX_ABS_RE = /^\//;
const DRIVE_PREFIX_RE = /[a-zA-Z]:[\\/]/g;

/**
 * Resolve a user/model-supplied path against the canonical workspace root.
 *
 * - Relative path            → root + relative (Windows separators normalized)
 * - Absolute path inside root→ returned as-is (canonical form)
 * - Absolute path outside    → returned as-is (external reference, caller decides)
 * - Double-prefix            → corrected: `B:\X\B:\X\file` → `B:\X\file`
 */
export function resolveWorkspacePath(candidate: string, rootOverride?: string): string {
  const root = rootOverride ?? getWorkspaceRoot();
  const raw = (candidate || '').trim();
  if (!raw) return '';
  if (!root) return raw; // no root → nothing to resolve against; caller reports truthfully

  if (ABS_RE.test(raw) || POSIX_ABS_RE.test(raw)) {
    let abs = raw;
    // Double-prefix guard (§4): `B:\AgenticOS\B:\AgenticOS\server\...` —
    // keep everything from the LAST drive prefix onward.
    if (!POSIX_ABS_RE.test(raw)) {
      const driveMatches = [...abs.matchAll(DRIVE_PREFIX_RE)];
      if (driveMatches.length > 1) {
        const last = driveMatches[driveMatches.length - 1];
        abs = abs.slice(last.index!);
      }
    }
    return path.normalize(abs);
  }

  // Relative → anchor at the workspace root.
  return path.normalize(path.join(root, raw));
}

/** True when absPath is inside root (case-insensitive on Windows). */
export function isPathInsideWorkspace(absPath: string, rootOverride?: string): boolean {
  const root = rootOverride ?? getWorkspaceRoot();
  if (!root || !absPath) return false;
  const rel = path.relative(root, absPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* ── File search (§5, §6, §7) ───────────────────────────────────── */

export interface FileSearchResult {
  query: string;
  workspaceRoot: string;
  matches: string[];      // workspace-relative POSIX paths
  truncated: boolean;
  searchedScopes: string[];
}

const SEARCH_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'build', '.agentos', '.agentic',
  'coverage', '.venv', 'venv', '__pycache__', '.cache', '.turbo', 'target',
]);
const SEARCH_SKIP_EXT = new Set(['.map', '.lock', '.min.js', '.bundle.js']);
const MAX_MATCHES = 25;
const MAX_FILES_SCANNED = 60000;

/**
 * Search the canonical workspace for a filename (or basename without
 * extension). Bounded walk — deterministic, never scans node_modules.
 */
export function searchWorkspaceFiles(query: string, rootOverride?: string): FileSearchResult {
  const root = rootOverride ?? getWorkspaceRoot();
  const searchedScopes: string[] = [];
  if (!root || !fs.existsSync(root)) {
    return { query, workspaceRoot: root, matches: [], truncated: false, searchedScopes };
  }

  const wanted = query.trim().replace(/\\/g, '/');
  const wantedLower = wanted.toLowerCase();
  const wantedBase = path.basename(wantedLower).replace(/\.[a-z0-9]+$/i, ''); // extensionless stem
  const matches: string[] = [];
  let scanned = 0;
  let truncated = false;

  const stack: string[] = [root];
  searchedScopes.push('* (full repository, excluding node_modules/.git/dist/build artifacts)');
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      if (scanned++ > MAX_FILES_SCANNED) { truncated = true; break; }
      if (matches.length >= MAX_MATCHES) { truncated = true; break; }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SEARCH_SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.git')) stack.push(full);
      } else if (entry.isFile()) {
        const nameLower = entry.name.toLowerCase();
        const stemLower = nameLower.replace(/\.[a-z0-9]+$/i, '');
        if (nameLower === wantedLower || stemLower === wantedBase) {
          matches.push(path.relative(root, full).replace(/\\/g, '/'));
        }
      }
    }
    if (truncated) break;
  }
  matches.sort();
  return { query, workspaceRoot: root, matches, truncated, searchedScopes };
}

/**
 * Resolve a file reference before delegation (§5):
 * exact relative path → unique filename search match → multiple matches →
 * truthful not-found report. Never answers "file not found" without having
 * actually searched.
 */
export function resolveFileReference(candidate: string, rootOverride?: string):
  { status: 'found'; resolvedPath: string; relativePath: string } |
  { status: 'ambiguous'; matches: string[] } |
  { status: 'not_found'; report: string } {
  const root = rootOverride ?? getWorkspaceRoot();
  const attempted: string[] = [];

  if (!root) {
    return {
      status: 'not_found',
      report: 'File not found — no repository is currently selected. Select a repository in the Jarvis workspace bar first.',
    };
  }

  // 1. Exact relative path as given.
  const resolved = resolveWorkspacePath(candidate, root);
  attempted.push(`exact path: ${candidate} → ${resolved}`);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return { status: 'found', resolvedPath: resolved, relativePath: path.relative(root, resolved).replace(/\\/g, '/') };
  }

  // 2. Repository search for the filename.
  const search = searchWorkspaceFiles(candidate, root);
  attempted.push(`repository filename search: "${candidate}" (${search.truncated ? 'truncated' : 'complete'} scan)`);
  if (search.matches.length === 1) {
    const rel = search.matches[0];
    return { status: 'found', resolvedPath: path.join(root, rel), relativePath: rel };
  }
  if (search.matches.length > 1) {
    return { status: 'ambiguous', matches: search.matches };
  }

  // 3. Truthful report (§7).
  const report = [
    'File not found in selected repository.',
    '',
    `Repository: ${root}`,
    '',
    'Search attempted:',
    ...attempted.map((a) => `  • ${a}`),
  ].join('\n');
  return { status: 'not_found', report };
}

/** Test/diagnostic hook — reset the cached root. */
export function resetWorkspaceCache(): void {
  cachedRoot = null;
}

/** Where the selection is persisted (diagnostics only). */
export function workspaceSelectionFile(): string {
  return SELECTION_FILE;
}
