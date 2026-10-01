/**
 * deploymentIdentity.ts — release boundary evidence for the RUNNING backend (Phase 1).
 *
 * Exposes and persists, at every boot:
 *  - git commit, dirty/clean state and build id of the code this process LOADED
 *    (build-identity.json stamped at build time + live dist fingerprint),
 *  - the deployment record written by scripts/deploy-installed.cjs
 *    (<server>/deployment.json): who deployed, when, and the deployed fingerprint,
 *  - whether <server>/dist is a link/junction into another tree (it must not be:
 *    a repository build must never silently change the installed runtime).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawDb } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { getBuildIdentity, type RuntimeBuildIdentity } from './buildIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DeploymentRecord {
  deployedAt: string;
  deployedBy: string;
  sourceRepo: string;
  gitSha: string | null;
  isDirty: boolean | null;
  buildId: string | null;
  fingerprint: string | null;
}

export interface RuntimeDeploymentIdentity {
  bootAt: string;
  pid: number;
  loaded: RuntimeBuildIdentity;
  distPath: string;
  distRealPath: string;
  distIsLink: boolean;
  deployment: DeploymentRecord | null;
  /** The code this process loaded is byte-identical to what deploy-installed.cjs deployed. */
  deploymentMatchesLoadedCode: boolean | null;
  warnings: string[];
}

let bootIdentity: RuntimeDeploymentIdentity | null = null;

function distDir(): string {
  // dist/services -> dist
  return path.resolve(__dirname, '..');
}

function readDeploymentRecord(dir: string): DeploymentRecord | null {
  const file = path.join(path.dirname(dir), 'deployment.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      deployedAt: String(raw.deployedAt),
      deployedBy: String(raw.deployedBy || 'unknown'),
      sourceRepo: String(raw.sourceRepo || ''),
      gitSha: raw.gitSha ?? null,
      isDirty: typeof raw.isDirty === 'boolean' ? raw.isDirty : null,
      buildId: raw.buildId ?? null,
      fingerprint: raw.fingerprint ?? null,
    };
  } catch {
    return null;
  }
}

export function computeRuntimeDeploymentIdentity(): RuntimeDeploymentIdentity {
  const dir = distDir();
  let distIsLink = false;
  let distRealPath = dir;
  try { distIsLink = fs.lstatSync(dir).isSymbolicLink(); } catch { /* ignore */ }
  try { distRealPath = fs.realpathSync.native(dir); } catch { /* ignore */ }
  if (path.resolve(distRealPath).toLowerCase() !== path.resolve(dir).toLowerCase()) distIsLink = true;
  // Also catch a link one level up (resources/server -> repo/server).
  try { if (fs.lstatSync(path.dirname(dir)).isSymbolicLink()) distIsLink = true; } catch { /* ignore */ }

  const loaded = getBuildIdentity();
  const deployment = readDeploymentRecord(dir);
  const warnings: string[] = [];
  if (distIsLink) warnings.push(`dist is a link/junction to ${distRealPath}; the repository build can change this runtime`);
  if (loaded.isDirty) warnings.push('running code was built from a DIRTY working tree');
  const packaged = process.env.AGENTICOS_IS_PACKAGED === 'true';
  if (packaged && !deployment) warnings.push('installed runtime has no deployment.json; it was not deployed by scripts/deploy-installed.cjs');
  const matches = deployment?.fingerprint ? deployment.fingerprint === loaded.fingerprint : null;
  if (deployment && matches === false) warnings.push('loaded code fingerprint differs from the deployed fingerprint (modified after deployment)');

  return {
    bootAt: new Date().toISOString(),
    pid: process.pid,
    loaded,
    distPath: dir,
    distRealPath,
    distIsLink,
    deployment,
    deploymentMatchesLoadedCode: matches,
    warnings,
  };
}

/** Called once at backend start: compute, persist, and log loudly on violations. */
export function recordBootIdentity(): RuntimeDeploymentIdentity {
  const id = computeRuntimeDeploymentIdentity();
  bootIdentity = id;
  try {
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS runtime_boot_identity (
        boot_at TEXT NOT NULL,
        pid INTEGER NOT NULL,
        build_id TEXT,
        git_sha TEXT,
        is_dirty INTEGER,
        fingerprint TEXT,
        deployed_at TEXT,
        deployed_by TEXT,
        deployed_build_id TEXT,
        deployment_matches INTEGER,
        dist_path TEXT,
        dist_real_path TEXT,
        dist_is_link INTEGER,
        packaged INTEGER,
        warnings_json TEXT
      );
    `);
    rawDb.prepare(`INSERT INTO runtime_boot_identity VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id.bootAt, id.pid, id.loaded.buildId, id.loaded.gitSha,
      id.loaded.isDirty === null ? null : id.loaded.isDirty ? 1 : 0,
      id.loaded.fingerprint, id.deployment?.deployedAt ?? null, id.deployment?.deployedBy ?? null,
      id.deployment?.buildId ?? null,
      id.deploymentMatchesLoadedCode === null ? null : id.deploymentMatchesLoadedCode ? 1 : 0,
      id.distPath, id.distRealPath, id.distIsLink ? 1 : 0,
      process.env.AGENTICOS_IS_PACKAGED === 'true' ? 1 : 0, JSON.stringify(id.warnings),
    );
  } catch (err: any) {
    logger.warn('[DeploymentIdentity] persist failed', { error: err?.message });
  }
  if (id.warnings.length) logger.error('[DeploymentIdentity] RELEASE BOUNDARY WARNINGS', { warnings: id.warnings, buildId: id.loaded.buildId });
  else logger.info('[DeploymentIdentity] boot identity', { buildId: id.loaded.buildId, gitSha: id.loaded.gitSha, isDirty: id.loaded.isDirty, deployedAt: id.deployment?.deployedAt });
  return id;
}

export function getBootIdentity(): RuntimeDeploymentIdentity {
  return bootIdentity ?? recordBootIdentity();
}
