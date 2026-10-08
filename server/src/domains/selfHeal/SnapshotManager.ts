import type { SnapshotManifest, SnapshotFileEntry } from './types.js';
import { logger } from '../../utils/logger.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class SnapshotManager {
  /** Compute SHA-256 hex digest of a file */
  private hashFile(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) {
        return '';
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return '';
      }
      const fileBuffer = fs.readFileSync(filePath);
      return createHash('sha256').update(fileBuffer).digest('hex');
    } catch (err) {
      logger.warn(`[SelfHeal:Snapshot] Failed to compute hash for ${filePath}:`, err);
      return '';
    }
  }

  /**
   * Create an isolated worktree reflecting current dirty working tree state,
   * applying tracked modifications and copying relevant untracked files with hash verification.
   */
  async createSnapshot(incidentId: string, relevantPaths?: string[]): Promise<SnapshotManifest> {
    const sourceDir = 'D:\\AgenticOS';
    const worktreePath = `D:\\AgenticOS-Recovery\\${incidentId}`;

    // 1. Get HEAD commit hash from source repository
    const sourceHead = execSync('git rev-parse HEAD', {
      cwd: sourceDir,
      encoding: 'utf-8',
    }).trim();

    // 2. Parse modified (M) and untracked (??) files from porcelain status
    const statusOutput = execSync('git status --porcelain -uall', {
      cwd: sourceDir,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    const rawModifiedFiles: string[] = [];
    const rawUntrackedFiles: string[] = [];

    for (const rawLine of statusOutput.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (line.length < 4) continue;
      const code = line.slice(0, 2);
      let filePath = line.slice(3).trim();
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ')[1].trim();
      }

      if (code === '??') {
        rawUntrackedFiles.push(filePath);
      } else if (code[0] === 'M' || code[1] === 'M') {
        rawModifiedFiles.push(filePath);
      }
    }

    const modifiedFiles = Array.from(new Set(rawModifiedFiles));
    const untrackedFiles = Array.from(new Set(rawUntrackedFiles));

    // 3. Export tracked dirty changes to a temporary patch file
    const recoveryBaseDir = path.dirname(worktreePath);
    if (!fs.existsSync(recoveryBaseDir)) {
      fs.mkdirSync(recoveryBaseDir, { recursive: true });
    }
    const tempDiffFile = path.join(recoveryBaseDir, `diff-${incidentId}-${Date.now()}.patch`);

    let diff = '';
    try {
      diff = execSync('git diff HEAD --binary', {
        cwd: sourceDir,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch {
      diff = execSync('git diff HEAD', {
        cwd: sourceDir,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
    }
    fs.writeFileSync(tempDiffFile, diff, 'utf-8');

    // 4. Remove existing worktree if present
    if (fs.existsSync(worktreePath)) {
      logger.info(`[SelfHeal:Snapshot] Worktree ${worktreePath} exists, removing it first`);
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: sourceDir });
      } catch (rmError) {
        logger.warn(`[SelfHeal:Snapshot] git worktree remove failed, removing folder manually:`, rmError);
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch {}
        try {
          execSync('git worktree prune', { cwd: sourceDir });
        } catch {}
      }
    }

    // 5. Create parent directory and add worktree at HEAD
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    logger.info(`[SelfHeal:Snapshot] Adding worktree at ${worktreePath}`);
    execSync(`git -c core.longpaths=true worktree add "${worktreePath}" HEAD`, { cwd: sourceDir });

    // Link node_modules junctions so compiler and test runner can resolve types and packages in worktree
    try {
      const rootModules = path.join(sourceDir, 'node_modules');
      const targetRootModules = path.join(worktreePath, 'node_modules');
      if (fs.existsSync(rootModules) && !fs.existsSync(targetRootModules)) {
        fs.symlinkSync(rootModules, targetRootModules, 'junction');
      }
      const serverModules = path.join(sourceDir, 'server', 'node_modules');
      const targetServerModules = path.join(worktreePath, 'server', 'node_modules');
      if (fs.existsSync(serverModules) && !fs.existsSync(targetServerModules)) {
        fs.mkdirSync(path.join(worktreePath, 'server'), { recursive: true });
        fs.symlinkSync(serverModules, targetServerModules, 'junction');
      }
    } catch (symlinkErr) {
      logger.warn('[SelfHeal:Snapshot] Failed to link node_modules to worktree:', symlinkErr);
    }

    // 6. Apply tracked dirty diff in worktree
    try {
      if (fs.existsSync(tempDiffFile) && fs.statSync(tempDiffFile).size > 0) {
        logger.info(`[SelfHeal:Snapshot] Applying tracked dirty diff to worktree at ${worktreePath}`);
        try {
          execSync(`git apply "${tempDiffFile}"`, { cwd: worktreePath });
        } catch {
          execSync(`git apply --ignore-whitespace "${tempDiffFile}"`, { cwd: worktreePath });
        }
      }
    } catch (applyError) {
      logger.warn(`[SelfHeal:Snapshot] Failed to apply tracked dirty diff:`, applyError);
    } finally {
      try {
        if (fs.existsSync(tempDiffFile)) {
          fs.unlinkSync(tempDiffFile);
        }
      } catch {
        // Ignore cleanup failure
      }
    }

    // 7. Copy relevant untracked files (filter by relevantPaths if provided, otherwise skip)
    const copiedUntrackedFiles: string[] = [];
    if (relevantPaths && relevantPaths.length > 0) {
      const normalizedRelevant = relevantPaths.map(p => {
        let rel = p;
        if (path.isAbsolute(p)) {
          rel = path.relative(sourceDir, p);
        }
        return rel.replace(/\\/g, '/').toLowerCase();
      });

      for (const untracked of untrackedFiles) {
        const normUntracked = untracked.replace(/\\/g, '/').toLowerCase();
        const isRelevant = normalizedRelevant.some(r => {
          return normUntracked === r || normUntracked.startsWith(r.endsWith('/') ? r : r + '/');
        }) || normUntracked.startsWith('src/') || normUntracked.startsWith('server/src/');

        if (isRelevant) {
          const srcPath = path.join(sourceDir, untracked);
          const destPath = path.join(worktreePath, untracked);

          try {
            if (fs.existsSync(srcPath)) {
              const stat = fs.statSync(srcPath);
              if (stat.isFile()) {
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.copyFileSync(srcPath, destPath);
                copiedUntrackedFiles.push(untracked);
              } else if (stat.isDirectory()) {
                fs.mkdirSync(destPath, { recursive: true });
                fs.cpSync(srcPath, destPath, { recursive: true });
                const collectFiles = (dir: string, baseDir: string) => {
                  const entries = fs.readdirSync(dir, { withFileTypes: true });
                  for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isFile()) {
                      copiedUntrackedFiles.push(path.relative(baseDir, full).replace(/\\/g, '/'));
                    } else if (entry.isDirectory()) {
                      collectFiles(full, baseDir);
                    }
                  }
                };
                collectFiles(srcPath, sourceDir);
              }
            }
          } catch (copyError) {
            logger.warn(`[SelfHeal:Snapshot] Failed to copy untracked file ${untracked}:`, copyError);
          }
        }
      }
    }

    let verified = true;

    // 8. Hash each tracked modified file in both source and worktree
    const trackedModifiedFiles: SnapshotFileEntry[] = [];
    for (const file of modifiedFiles) {
      const sourceFilePath = path.join(sourceDir, file);
      const worktreeFilePath = path.join(worktreePath, file);

      const sourceHash = this.hashFile(sourceFilePath);
      const worktreeHash = this.hashFile(worktreeFilePath);

      trackedModifiedFiles.push({
        path: file.replace(/\\/g, '/'),
        hash: sourceHash,
      });

      if (!sourceHash || sourceHash !== worktreeHash) {
        logger.info(`[SelfHeal:Snapshot] Synchronizing modified file ${file} to ensure exact hash parity`);
        try {
          if (fs.existsSync(sourceFilePath)) {
            fs.mkdirSync(path.dirname(worktreeFilePath), { recursive: true });
            fs.copyFileSync(sourceFilePath, worktreeFilePath);
            const synchedHash = this.hashFile(worktreeFilePath);
            if (!sourceHash || sourceHash !== synchedHash) {
              verified = false;
              logger.warn(
                `[SelfHeal:Snapshot] Hash mismatch after sync for file ${file}: source=${sourceHash}, worktree=${synchedHash}`
              );
            }
          } else {
            verified = false;
          }
        } catch (syncError) {
          verified = false;
          logger.warn(`[SelfHeal:Snapshot] Failed to sync modified file ${file}:`, syncError);
        }
      }
    }

    // 9. Hash each copied untracked file in both source and worktree
    const untrackedIncludedFiles: SnapshotFileEntry[] = [];
    for (const file of copiedUntrackedFiles) {
      const sourceFilePath = path.join(sourceDir, file);
      const worktreeFilePath = path.join(worktreePath, file);

      const sourceHash = this.hashFile(sourceFilePath);
      const worktreeHash = this.hashFile(worktreeFilePath);

      untrackedIncludedFiles.push({
        path: file.replace(/\\/g, '/'),
        hash: sourceHash,
      });

      if (!sourceHash || sourceHash !== worktreeHash) {
        verified = false;
        logger.warn(
          `[SelfHeal:Snapshot] Hash mismatch for untracked file ${file}: source=${sourceHash}, worktree=${worktreeHash}`
        );
      }
    }

    // 10. Write snapshotManifest.json to worktreePath
    const manifest: SnapshotManifest = {
      incidentId,
      sourceHead,
      trackedModifiedFiles,
      untrackedIncludedFiles,
      worktreePath,
      verified,
      createdAt: new Date().toISOString(),
    };

    const manifestPath = path.join(worktreePath, 'snapshotManifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    return manifest;
  }

  /**
   * Verify an existing snapshot manifest by re-hashing all tracked modified and untracked included files
   * against both the source directory and the worktree. Returns true if all hashes match.
   */
  async verifySnapshot(manifest: SnapshotManifest): Promise<boolean> {
    const sourceDir = 'D:\\AgenticOS';
    const worktreePath = manifest.worktreePath;

    if (!fs.existsSync(worktreePath)) {
      logger.warn(`[SelfHeal:Snapshot] Worktree path does not exist: ${worktreePath}`);
      return false;
    }

    for (const entry of manifest.trackedModifiedFiles) {
      const sourceFile = path.join(sourceDir, entry.path);
      const worktreeFile = path.join(worktreePath, entry.path);

      const sourceHash = this.hashFile(sourceFile);
      const worktreeHash = this.hashFile(worktreeFile);

      if (!sourceHash || sourceHash !== entry.hash || worktreeHash !== entry.hash) {
        logger.warn(
          `[SelfHeal:Snapshot] Verification failed for tracked file ${entry.path}: expected=${entry.hash}, source=${sourceHash}, worktree=${worktreeHash}`
        );
        return false;
      }
    }

    for (const entry of manifest.untrackedIncludedFiles) {
      const sourceFile = path.join(sourceDir, entry.path);
      const worktreeFile = path.join(worktreePath, entry.path);

      const sourceHash = this.hashFile(sourceFile);
      const worktreeHash = this.hashFile(worktreeFile);

      if (!sourceHash || sourceHash !== entry.hash || worktreeHash !== entry.hash) {
        logger.warn(
          `[SelfHeal:Snapshot] Verification failed for untracked file ${entry.path}: expected=${entry.hash}, source=${sourceHash}, worktree=${worktreeHash}`
        );
        return false;
      }
    }

    return true;
  }
}

export const snapshotManager = new SnapshotManager();
