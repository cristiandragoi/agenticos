/**
 * buildIdentity.ts
 *
 * Authoritative runtime build identity. The content fingerprint is the
 * authority: it is a deterministic SHA-256 over the executable server dist the
 * running process was loaded from (every file, excluding the metadata file
 * build-identity.json), so it reflects the ACTUAL code being executed — not a
 * stamped value that can itself go stale.
 *
 * The same algorithm is implemented identically in:
 *   - scripts/compute-dist-fingerprint.cjs  (offline tooling / CI)
 *   - scripts/build-identity.cjs            (stamps the value into dist at build)
 * so repo-dist fingerprint, packaged-dist fingerprint, and the running health
 * fingerprint can be compared for equality.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FINGERPRINT_ALGORITHM = 'content-sha256-v1';

/** Directory names excluded from the fingerprint (dependency trees are not code). */
const EXCLUDED_DIR_NAMES = new Set(['node_modules']);
/** File names excluded from the fingerprint (this metadata file is stamped with the fingerprint itself). */
const EXCLUDED_FILE_NAMES = new Set(['build-identity.json']);

export interface DistFingerprint {
  fingerprint: string;
  algorithm: string;
  filesCount: number;
}

export interface RuntimeBuildIdentity {
  fingerprint: string;
  algorithm: string;
  filesCount: number;
  gitSha: string | null;
  gitShort: string | null;
  isDirty: boolean | null;
  buildTimestamp: string | null;
  buildId: string | null;
  version: string | null;
  component: string | null;
}

/**
 * Compute a deterministic content fingerprint of a server dist directory.
 *
 * Algorithm (content-sha256-v1):
 *   1. Recursively walk <distDir>, skipping `node_modules` dirs and
 *      `build-identity.json` files.
 *   2. For each remaining file, record "<relative/path>\0<sha256-hex-of-bytes>".
 *   3. Sort records lexicographically (deterministic regardless of FS order).
 *   4. fingerprint = sha256 hex of the newline-joined records.
 */
export function computeDistFingerprint(distDir: string): DistFingerprint {
  const records: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (EXCLUDED_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && !EXCLUDED_FILE_NAMES.has(name)) {
        const rel = path.relative(distDir, full).split(path.sep).join('/');
        const fileHash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        records.push(`${rel}\u0000${fileHash}`);
      }
    }
  };
  walk(path.resolve(distDir));
  records.sort();
  const fingerprint = crypto.createHash('sha256').update(records.join('\n')).digest('hex');
  return { fingerprint, algorithm: FINGERPRINT_ALGORITHM, filesCount: records.length };
}

let cached: RuntimeBuildIdentity | null = null;

/**
 * Build identity of the running server. Fingerprint is recomputed live over the
 * dist dir (defaults to the parent of this module, i.e. <dist>/services → <dist>);
 * git/build metadata is read from the stamped build-identity.json if present.
 * Cached after first computation (the loaded code does not change mid-process).
 */
export function getBuildIdentity(distDir?: string): RuntimeBuildIdentity {
  if (cached && distDir === undefined) return cached;
  const dir = path.resolve(distDir ?? path.join(__dirname, '..'));
  const { fingerprint, algorithm, filesCount } = computeDistFingerprint(dir);

  let stamped: any = null;
  try {
    stamped = JSON.parse(fs.readFileSync(path.join(dir, 'build-identity.json'), 'utf8'));
  } catch {
    /* no stamped identity — git/build metadata simply reports null */
  }

  const identity: RuntimeBuildIdentity = {
    fingerprint,
    algorithm,
    filesCount,
    gitSha: typeof stamped?.gitSha === 'string' ? stamped.gitSha : null,
    gitShort: typeof stamped?.gitShort === 'string' ? stamped.gitShort : null,
    isDirty: typeof stamped?.isDirty === 'boolean' ? stamped.isDirty : null,
    buildTimestamp: typeof stamped?.buildTimestamp === 'string' ? stamped.buildTimestamp : null,
    buildId: typeof stamped?.buildId === 'string' ? stamped.buildId : null,
    version: typeof stamped?.version === 'string' ? stamped.version : null,
    component: typeof stamped?.component === 'string' ? stamped.component : null,
  };
  if (distDir === undefined) cached = identity;
  return identity;
}
