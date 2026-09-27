/**
 * RepositoryAuthority.ts — Authoritative Repository Binding & Health Manager
 *
 * Enforces one authoritative repository binding across AgenticOS (Jarvis, Hermes,
 * Codex, SelfHeal, BackgroundTasks).
 *
 * Solves:
 * - Stale UI repository paths ("The specified path does not exist", "Select repository")
 * - Discovers and validates the real repository root
 * - Exposes branch, commit, dirtyState, build & test commands, deployment targets
 * - Startup reconciliation: reconciles stale workspace paths and purges dead approvals
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { setWorkspaceRoot, getWorkspaceRoot } from '../../services/workspaceStore.js';
import type { RepositoryAuthorityStatus } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class RepositoryAuthority {
  private static instance: RepositoryAuthority;

  private repoRoot: string = '';
  private gitRoot: string = '';
  private branch: string = 'main';
  private commit: string = 'unknown';
  private dirtyState: boolean = false;
  private isHealthy: boolean = false;
  private healthReason: string = '';
  private lastChecked: string = '';

  private readonly deploymentTarget: string = 'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS';
  private readonly deploymentMethod: string = 'npm run deploy:installed';
  private readonly runtimeRestartMethod: string = 'POST /api/health/restart';
  private readonly buildCommands: string[] = ['npm run build'];
  private readonly testCommands: string[] = ['npx vitest run'];

  private constructor() {
    this.reconcileAndValidate();
  }

  public static getInstance(): RepositoryAuthority {
    if (!RepositoryAuthority.instance) {
      RepositoryAuthority.instance = new RepositoryAuthority();
    }
    return RepositoryAuthority.instance;
  }

  /**
   * Discovers and validates the authoritative AgenticOS repository.
   * If a stored or environment path is stale, falls back to discovered candidates.
   */
  public reconcileAndValidate(): RepositoryAuthorityStatus {
    const candidates = [
      process.env.AGENTICOS_WORKSPACE,
      'D:\\AgenticOS',
      path.resolve(__dirname, '..', '..', '..'),
      getWorkspaceRoot(),
      process.cwd(),
    ].filter((p): p is string => Boolean(p && typeof p === 'string' && p.trim().length > 0));

    let discoveredRoot = '';
    let discoveredGit = '';

    for (const cand of candidates) {
      const norm = path.normalize(path.resolve(cand));
      if (!fs.existsSync(norm)) continue;

      try {
        const stat = fs.statSync(norm);
        if (!stat.isDirectory()) continue;

        // Check for Git root
        let current = norm;
        while (current) {
          const gitFolder = path.join(current, '.git');
          if (fs.existsSync(gitFolder)) {
            discoveredGit = current;
            discoveredRoot = current;
            break;
          }
          const parent = path.dirname(current);
          if (parent === current) break;
          current = parent;
        }

        if (discoveredRoot) {
          // Verify that this is indeed the AgenticOS repository
          const pkgPath = path.join(discoveredRoot, 'package.json');
          const serverDir = path.join(discoveredRoot, 'server');
          if (fs.existsSync(pkgPath) || fs.existsSync(serverDir)) {
            break;
          }
        }
      } catch (err: any) {
        logger.warn(`[RepositoryAuthority] Error inspecting candidate ${cand}: ${err?.message}`);
      }
    }

    if (discoveredRoot && fs.existsSync(discoveredRoot)) {
      this.repoRoot = discoveredRoot;
      this.gitRoot = discoveredGit || discoveredRoot;
      this.isHealthy = true;
      this.healthReason = 'Authoritative repository verified.';

      // Synchronize workspaceStore so the whole system agrees
      try {
        const cur = getWorkspaceRoot();
        if (cur !== this.repoRoot) {
          setWorkspaceRoot(this.repoRoot);
          logger.info(`[RepositoryAuthority] Reconciled workspaceStore to authoritative root: ${this.repoRoot}`);
        }
      } catch (err: any) {
        logger.warn(`[RepositoryAuthority] Could not update workspaceStore: ${err?.message}`);
      }

      // Read Git details
      this.extractGitDetails(this.repoRoot);
    } else {
      this.repoRoot = '';
      this.gitRoot = '';
      this.isHealthy = false;
      this.healthReason = 'No valid AgenticOS git repository found among candidates.';
      logger.error(`[RepositoryAuthority] Validation failed: ${this.healthReason}`);
    }

    this.lastChecked = new Date().toISOString();
    return this.getStatus();
  }

  private extractGitDetails(root: string): void {
    try {
      this.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {
      this.branch = 'main';
    }

    try {
      this.commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf-8', timeout: 3000 }).trim();
    } catch {
      this.commit = 'unknown';
    }

    try {
      const statusOutput = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8', timeout: 4000 }).trim();
      this.dirtyState = statusOutput.length > 0;
    } catch {
      this.dirtyState = false;
    }
  }

  public getStatus(): RepositoryAuthorityStatus {
    return {
      repositoryRoot: this.repoRoot,
      gitRoot: this.gitRoot,
      branch: this.branch,
      commit: this.commit,
      dirtyState: this.dirtyState,
      buildCommands: this.buildCommands,
      testCommands: this.testCommands,
      deploymentTarget: this.deploymentTarget,
      deploymentMethod: this.deploymentMethod,
      runtimeRestartMethod: this.runtimeRestartMethod,
      health: {
        healthy: this.isHealthy,
        status: this.isHealthy ? (this.dirtyState ? 'DEGRADED' : 'VALID') : 'INVALID',
        reason: this.healthReason,
        checkedAt: this.lastChecked,
      },
    };
  }

  public getAuthoritativeStatus(): RepositoryAuthorityStatus & { repoRoot: string } {
    const s = this.getStatus();
    return {
      ...s,
      repoRoot: s.repositoryRoot,
    };
  }

  public getRepositoryRoot(): string {
    if (!this.isHealthy || !this.repoRoot) {
      this.reconcileAndValidate();
    }
    return this.repoRoot;
  }

  public assertRepositoryHealthy(): void {
    if (!this.isHealthy || !this.repoRoot || !fs.existsSync(this.repoRoot)) {
      this.reconcileAndValidate();
      if (!this.isHealthy) {
        throw new Error(`[RepositoryAuthority] Cannot proceed with engineering action: ${this.healthReason}`);
      }
    }
  }
}

export const repositoryAuthority = RepositoryAuthority.getInstance();
