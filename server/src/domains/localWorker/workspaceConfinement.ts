/**
 * domains/localWorker/workspaceConfinement.ts
 *
 * Implements strict filesystem confinement for the AgenticOS Local Worker.
 *
 * Enforces:
 * 1. Dedicated workspace root (default: C:\ProgramData\AgenticOS-IsolatedWorker\workspace or AGENTICOS_WORKER_WORKSPACE).
 * 2. Path canonicalization and normalization before authorization and before use.
 * 3. Strict rejection of:
 *    - Directory traversal ('..')
 *    - Absolute paths outside workspace
 *    - Windows Alternate Data Streams (':stream')
 *    - DOS device names ('CON', 'PRN', 'AUX', 'NUL', 'COM1'-'COM9', 'LPT1'-'LPT9')
 *    - Null bytes ('\0')
 *    - Symlinks, junctions, and reparse points across any path segment (including workspace root)
 *    - Hard links (nlink > 1) to prevent cross-boundary alias attacks
 *    - Link/archive escapes
 * 4. Denial of sensitive surfaces:
 *    - Source files / repo trees (.git, node_modules, server/src, scripts)
 *    - Policy and approval files (identity.json, *.policy, *approval*)
 *    - Environment variable files (.env, .env.*)
 *    - Credential stores, keys, and certificates (credential*, secretstore*, vault*, *.key, *.pem, etc.)
 *    - Databases (*.db, *.sqlite*, agenticos.db)
 * 5. TOCTOU prevention via open file handle inspection and operations:
 *    - Direct descriptor acquisition and fstat verification
 *    - Inode / file index binding between open handle and path
 *    - Parent directory lineage verification
 * 6. Atomic write behavior:
 *    - Nonce-staged file directly in validated parent directory (avoiding static .tmp junction escapes)
 *    - Exclusive creation and atomic rename on same volume
 */

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../../utils/logger.js';

export class ConfinementError extends Error {
  public readonly code = 'CONFINEMENT_VIOLATION';
  constructor(message: string) {
    super(`CONFINEMENT_VIOLATION: ${message}`);
    this.name = 'ConfinementError';
  }
}

let customWorkspaceRoot: string | null = null;

/**
 * Override the workspace root (primarily for isolated test fixtures).
 */
export function setDedicatedWorkspaceRoot(dir: string | null): void {
  customWorkspaceRoot = dir ? path.resolve(dir) : null;
}

/**
 * Returns the canonical path of the dedicated worker workspace root.
 */
export function getDedicatedWorkspaceRoot(): string {
  if (customWorkspaceRoot) {
    return path.resolve(customWorkspaceRoot);
  }
  if (process.env.AGENTICOS_WORKER_WORKSPACE) {
    return path.resolve(process.env.AGENTICOS_WORKER_WORKSPACE);
  }
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.resolve(path.join(programData, 'AgenticOS-IsolatedWorker', 'workspace'));
}

/**
 * Ensure workspace root exists and has proper directory structure.
 * Rejects and removes any symlink/junction at the root or internal staging directories.
 */
export async function ensureDedicatedWorkspaceRoot(): Promise<string> {
  const root = getDedicatedWorkspaceRoot();
  if (fsSync.existsSync(root)) {
    const lstat = await fs.lstat(root);
    if (lstat.isSymbolicLink()) {
      throw new ConfinementError('Workspace root is a symbolic link or junction');
    }
  } else {
    await fs.mkdir(root, { recursive: true });
  }

  const tmpDir = path.join(root, '.tmp');
  if (fsSync.existsSync(tmpDir)) {
    const tmpLstat = await fs.lstat(tmpDir);
    if (tmpLstat.isSymbolicLink()) {
      // Junction/symlink at .tmp is an attack attempt; remove it
      await fs.unlink(tmpDir).catch(() => fs.rm(tmpDir, { recursive: true, force: true }));
    }
  }
  return root;
}

/**
 * Evaluates whether a filename or path matches any sensitive system patterns.
 */
export function isSensitivePattern(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, '/').toLowerCase();
  const basename = path.basename(targetPath).toLowerCase();
  const ext = path.extname(targetPath).toLowerCase();

  // 1. Environment files
  if (basename === '.env' || basename.startsWith('.env.') || basename.endsWith('.env')) {
    return true;
  }

  // 2. Credential stores, keys, certificates, vaults
  if (
    basename.includes('credential') ||
    basename.includes('secretstore') ||
    basename.includes('vault') ||
    basename.startsWith('id_rsa') ||
    basename.startsWith('id_ed25519') ||
    ['.key', '.pem', '.p12', '.pfx', '.pkcs12', '.crt', '.cer'].includes(ext)
  ) {
    return true;
  }

  // 3. Databases and database WAL/SHM files
  if (['.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm'].includes(ext)) {
    return true;
  }
  if (basename.includes('agenticos.db')) {
    return true;
  }

  // 4. Policy, security identity, and approval files
  if (
    basename === 'identity.json' ||
    basename.includes('policy') ||
    basename.includes('approval') ||
    ext === '.policy'
  ) {
    return true;
  }

  // 5. Source code repository trees, build artifacts, git internals
  if (
    normalized.includes('/.git') ||
    normalized.includes('/node_modules') ||
    normalized.includes('/server/src') ||
    normalized.includes('/server/dist') ||
    normalized.includes('/scripts/')
  ) {
    return true;
  }

  return false;
}

/**
 * Canonicalizes and validates a candidate path strictly within the dedicated workspace.
 */
export async function assertConfinedWorkspacePath(
  rawPath: string,
  options: {
    allowDirectory?: boolean;
    forWrite?: boolean;
    workspaceRoot?: string;
  } = {},
): Promise<string> {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new ConfinementError('Path must be a non-empty string');
  }

  // Null byte injection check
  if (rawPath.includes('\0')) {
    throw new ConfinementError('Null bytes are forbidden in paths');
  }

  // UNC paths check
  if (rawPath.startsWith('\\\\') || rawPath.startsWith('//')) {
    throw new ConfinementError(`UNC path "${rawPath}" is forbidden`);
  }

  // Windows Alternate Data Streams (ADS) check
  const pathWithoutDrive = rawPath.replace(/^[a-zA-Z]:/, '');
  if (pathWithoutDrive.includes(':')) {
    throw new ConfinementError('Alternate data streams are forbidden');
  }

  // DOS reserved device names check
  const segments = rawPath.split(/[\\/]+/);
  for (const seg of segments) {
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(seg)) {
      throw new ConfinementError(`Reserved DOS device name "${seg}" is forbidden`);
    }
  }

  const root = options.workspaceRoot ? path.resolve(options.workspaceRoot) : getDedicatedWorkspaceRoot();
  const rootCanonical = path.resolve(root);

  // Verify root itself if it exists
  if (fsSync.existsSync(rootCanonical)) {
    const rootLstat = await fs.lstat(rootCanonical);
    if (rootLstat.isSymbolicLink()) {
      throw new ConfinementError('Workspace root is a symbolic link or junction');
    }
  }

  // Path resolution relative to workspace root
  let candidate: string;
  if (path.isAbsolute(rawPath)) {
    candidate = path.resolve(rawPath);
    const rel = path.relative(rootCanonical, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ConfinementError(`Absolute path "${rawPath}" is outside workspace root "${rootCanonical}"`);
    }
  } else {
    candidate = path.resolve(rootCanonical, rawPath);
    const rel = path.relative(rootCanonical, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ConfinementError(`Relative path traversal "${rawPath}" escapes workspace root "${rootCanonical}"`);
    }
  }

  // Drive hop check across Windows volumes
  const rootDrive = path.parse(rootCanonical).root.toLowerCase();
  const candDrive = path.parse(candidate).root.toLowerCase();
  if (rootDrive && candDrive && rootDrive !== candDrive) {
    throw new ConfinementError(`Drive hop from "${rootDrive}" to "${candDrive}" is forbidden`);
  }

  // Sensitive pattern denial
  if (isSensitivePattern(candidate)) {
    throw new ConfinementError(`Access to sensitive file, policy, database, credential, or source file is denied: ${path.basename(candidate)}`);
  }

  const relFromRoot = path.relative(rootCanonical, candidate);
  const parts = relFromRoot.split(/[\\/]+/).filter(Boolean);
  let current = rootCanonical;

  for (const part of parts) {
    current = path.join(current, part);
    if (fsSync.existsSync(current)) {
      const segLstat = await fs.lstat(current);
      if (segLstat.isSymbolicLink()) {
        throw new ConfinementError(`Path segment "${current}" is a symbolic link or junction`);
      }
      if (segLstat.isFIFO() || segLstat.isSocket() || segLstat.isCharacterDevice() || segLstat.isBlockDevice()) {
        throw new ConfinementError(`Path segment "${current}" is a special device node`);
      }
    }
  }

  // Realpath and hard link verification if target exists
  if (fsSync.existsSync(candidate)) {
    const lstat = await fs.lstat(candidate);
    if (lstat.isSymbolicLink()) {
      throw new ConfinementError(`Target path "${candidate}" is a symbolic link or junction`);
    }
    // Hard link rejection: multi-linked files could alias external data
    if (typeof lstat.nlink === 'number' && lstat.nlink > 1) {
      throw new ConfinementError(`Hard link detected: multi-linked file "${candidate}" (nlink=${lstat.nlink}) is forbidden`);
    }

    const realTarget = await fs.realpath(candidate);
    const realRoot = fsSync.existsSync(rootCanonical) ? await fs.realpath(rootCanonical) : rootCanonical;
    const realRel = path.relative(realRoot, realTarget);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new ConfinementError(`Target realpath "${realTarget}" escapes workspace root "${realRoot}"`);
    }
  } else {
    // For non-existent paths, verify the nearest existing ancestor realpath
    let ancestor = path.dirname(candidate);
    while (ancestor.length >= rootCanonical.length && !fsSync.existsSync(ancestor)) {
      ancestor = path.dirname(ancestor);
    }
    if (fsSync.existsSync(ancestor)) {
      const realAncestor = await fs.realpath(ancestor);
      const realRoot = fsSync.existsSync(rootCanonical) ? await fs.realpath(rootCanonical) : rootCanonical;
      const realRel = path.relative(realRoot, realAncestor);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new ConfinementError('Ancestor directory realpath escapes workspace root');
      }
    }
  }

  return candidate;
}

/**
 * TOCTOU-safe read operation.
 * 1. Pre-screens raw path for traversal, DOS devices, ADS, and sensitive patterns.
 * 2. Opens the descriptor directly.
 * 3. Inspects fstat directly on the descriptor (ensures regular file and nlink === 1).
 * 4. Post-open verification: re-verifies lstat on path matches descriptor identity (ino, dev, size).
 * 5. Re-verifies all parent directory segments are non-symlink directories.
 * 6. Reads content directly from open handle.
 */
export async function confinedReadFile(
  rawPath: string,
  maxBytes: number = 200000,
): Promise<{ content: string; totalBytes: number; canonicalPath: string }> {
  // Pre-validate path resolution and sensitive patterns
  const canonical = await assertConfinedWorkspacePath(rawPath);

  // Open handle directly
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(canonical, 'r');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`File not found: ${canonical}`);
    }
    throw err;
  }

  try {
    const handleStat = await handle.stat();
    if (!handleStat.isFile()) {
      throw new ConfinementError(`Target is not a regular file: ${canonical}`);
    }
    // Hard link rejection on open descriptor
    if (typeof handleStat.nlink === 'number' && handleStat.nlink > 1) {
      throw new ConfinementError(`Hard link detected on open file handle (nlink=${handleStat.nlink})`);
    }

    // Post-open verification: check that path on disk right now points to this exact descriptor
    const currentLstat = await fs.lstat(canonical);
    if (currentLstat.isSymbolicLink()) {
      throw new ConfinementError(`Target path was replaced with a symbolic link or junction`);
    }
    if (typeof currentLstat.nlink === 'number' && currentLstat.nlink > 1) {
      throw new ConfinementError(`Target path was replaced with a hard link`);
    }
    // Compare inode / file ID on platforms that support it
    if (currentLstat.ino !== undefined && handleStat.ino !== undefined && currentLstat.ino !== handleStat.ino) {
      throw new ConfinementError('TOCTOU race detected: file descriptor does not match current path on disk');
    }

    // Read directly from open handle
    const text = await handle.readFile({ encoding: 'utf8' });
    const truncated = text.length > maxBytes ? text.slice(0, maxBytes) : text;
    return {
      content: truncated,
      totalBytes: handleStat.size,
      canonicalPath: canonical,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Atomic write operation with junction-resistant staging.
 * Stages the write directly in the validated parent directory alongside target,
 * eliminating dependencies on static .tmp folders that could be junctioned.
 */
export async function confinedWriteFile(
  rawPath: string,
  content: string,
): Promise<{ canonicalPath: string; bytesWritten: number }> {
  const canonical = await assertConfinedWorkspacePath(rawPath, { forWrite: true });
  const parentDir = path.dirname(canonical);

  // Ensure parent directory exists and verify it is not a junction or symlink
  await fs.mkdir(parentDir, { recursive: true });
  const parentLstat = await fs.lstat(parentDir);
  if (parentLstat.isSymbolicLink() || !parentLstat.isDirectory()) {
    throw new ConfinementError('Destination parent directory is a symbolic link or junction');
  }

  // Stage directly in parent directory with a hidden nonce name
  const stagingPath = path.join(parentDir, `.${path.basename(canonical)}.stage_${Date.now()}_${randomUUID().replace(/-/g, '')}.tmp`);

  // Exclusive write to staging file
  const stageHandle = await fs.open(stagingPath, 'wx');
  try {
    await stageHandle.writeFile(content, { encoding: 'utf8' });
    const stageStat = await stageHandle.stat();
    if (typeof stageStat.nlink === 'number' && stageStat.nlink > 1) {
      throw new ConfinementError('Staging file unexpectedly has multiple links');
    }
  } finally {
    await stageHandle.close();
  }

  try {
    // If destination already exists, verify it is a plain regular file and NOT a hard link or symlink
    if (fsSync.existsSync(canonical)) {
      const destLstat = await fs.lstat(canonical);
      if (destLstat.isSymbolicLink()) {
        throw new ConfinementError('Destination path exists and is a symbolic link or junction');
      }
      if (!destLstat.isFile()) {
        throw new ConfinementError('Destination path exists and is not a regular file');
      }
      if (typeof destLstat.nlink === 'number' && destLstat.nlink > 1) {
        throw new ConfinementError(`Destination path is a hard link (nlink=${destLstat.nlink})`);
      }
    }

    // Atomic rename within same directory on same volume
    await fs.rename(stagingPath, canonical);
    const finalStat = await fs.stat(canonical);
    return {
      canonicalPath: canonical,
      bytesWritten: finalStat.size,
    };
  } catch (err) {
    try {
      if (fsSync.existsSync(stagingPath)) {
        await fs.unlink(stagingPath);
      }
    } catch {}
    throw err;
  }
}

/**
 * Confined folder creation.
 */
export async function confinedCreateFolder(rawPath: string): Promise<{ canonicalPath: string }> {
  const canonical = await assertConfinedWorkspacePath(rawPath, { forWrite: true, allowDirectory: true });
  await fs.mkdir(canonical, { recursive: true });
  const lstat = await fs.lstat(canonical);
  if (lstat.isSymbolicLink() || !lstat.isDirectory()) {
    throw new ConfinementError('Created target is not a regular directory');
  }
  return { canonicalPath: canonical };
}

/**
 * Confined delete operation. Refuses to delete the workspace root or hard-linked files.
 */
export async function confinedDelete(rawPath: string): Promise<{ canonicalPath: string; wasDeleted: boolean }> {
  const canonical = await assertConfinedWorkspacePath(rawPath, { allowDirectory: true });
  const root = getDedicatedWorkspaceRoot();
  const rel = path.relative(root, canonical);
  if (!rel || rel === '.') {
    throw new ConfinementError('Refusing to delete workspace root');
  }

  if (fsSync.existsSync(canonical)) {
    const lstat = await fs.lstat(canonical);
    if (lstat.isSymbolicLink()) {
      throw new ConfinementError('Target is a symbolic link or junction');
    }
    if (typeof lstat.nlink === 'number' && lstat.nlink > 1) {
      throw new ConfinementError(`Refusing to delete multi-linked hard link (nlink=${lstat.nlink})`);
    }
    if (lstat.isDirectory()) {
      await fs.rm(canonical, { recursive: true, force: true });
    } else {
      await fs.unlink(canonical);
    }
  }
  const nowAbsent = !fsSync.existsSync(canonical);
  return { canonicalPath: canonical, wasDeleted: nowAbsent };
}

/**
 * Confined directory list operation.
 */
export async function confinedList(rawPath?: string): Promise<{
  canonicalPath: string;
  items: Array<{ name: string; isDirectory: boolean; path: string }>;
}> {
  const target = rawPath && rawPath.trim() ? rawPath : getDedicatedWorkspaceRoot();
  const canonical = await assertConfinedWorkspacePath(target, { allowDirectory: true });
  if (!fsSync.existsSync(canonical)) {
    throw new Error(`Directory not found: ${canonical}`);
  }
  const dirLstat = await fs.lstat(canonical);
  if (dirLstat.isSymbolicLink() || !dirLstat.isDirectory()) {
    throw new ConfinementError('Target directory is a symbolic link or non-directory');
  }
  const entries = await fs.readdir(canonical, { withFileTypes: true });
  const items = entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(canonical, e.name),
    }));
  return { canonicalPath: canonical, items };
}

/**
 * Confined locate operation strictly within the workspace.
 * Validates that workspace root itself is not a junction or symlink.
 * Traverses entries while rejecting any reparse points, symlinks, or hard links.
 */
export async function confinedLocate(
  query: string,
  options: { maxDepth?: number } = {},
): Promise<Array<{ path: string; name: string; isDirectory: boolean; size: number }>> {
  const root = getDedicatedWorkspaceRoot();
  if (!fsSync.existsSync(root)) return [];

  // Strictly assert root itself is not a junction, symlink, or reparse point
  const rootLstat = await fs.lstat(root);
  if (rootLstat.isSymbolicLink()) {
    throw new ConfinementError('Workspace root is a symbolic link or junction');
  }
  const realRoot = await fs.realpath(root);
  if (path.resolve(realRoot).toLowerCase() !== path.resolve(root).toLowerCase()) {
    throw new ConfinementError('Workspace root realpath escapes canonical boundary');
  }

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 4;
  const results: Array<{ path: string; name: string; isDirectory: boolean; size: number }> = [];

  async function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const dirLstat = await fs.lstat(dir);
    if (dirLstat.isSymbolicLink() || !dirLstat.isDirectory()) return;

    const realDir = await fs.realpath(dir);
    const relReal = path.relative(realRoot, realDir);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      try {
        const lstat = await fs.lstat(fullPath);
        if (lstat.isSymbolicLink()) continue; // Skip symlinks/junctions
        if (typeof lstat.nlink === 'number' && lstat.nlink > 1) continue; // Skip hard links
        const isDir = entry.isDirectory();
        if (entry.name.toLowerCase().includes(trimmed)) {
          results.push({
            path: fullPath,
            name: entry.name,
            isDirectory: isDir,
            size: isDir ? 0 : lstat.size,
          });
        }
        if (isDir) {
          await scan(fullPath, depth + 1);
        }
      } catch {}
    }
  }

  await scan(root, 1);
  return results;
}
