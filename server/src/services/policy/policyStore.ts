/**
 * PolicyStore V1 (Stage 2) — project-level policy persistence.
 *
 * Storage: a single `policy` TEXT (JSON) column on the existing `projects`
 * table, added via the codebase's established guarded PRAGMA+ALTER pattern
 * (backgroundTasks/store.ts workspace_root precedent). No drizzle migration
 * file, no new table — the column is additive and defaults to NULL (=
 * DEFAULT_POLICY).
 */
import { rawDb } from '../../db/index.js';
import { DEFAULT_POLICY, parsePolicy, validatePolicy, type ProjectPolicy } from './policyService.js';

let ensured = false;

function ensurePolicyColumn(): void {
  if (ensured) return;
  try {
    const cols = rawDb.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'policy')) {
      rawDb.exec('ALTER TABLE projects ADD COLUMN policy TEXT');
    }
  } catch { /* table missing or fresh DB — nothing to add */ }
  ensured = true;
}

export const policyStore = {
  /** Read the effective policy for a project (never throws; NULL → default). */
  getPolicy(projectId: string | null | undefined): ProjectPolicy {
    ensurePolicyColumn();
    if (!projectId) return { ...DEFAULT_POLICY };
    try {
      const row = rawDb.prepare('SELECT policy FROM projects WHERE id = ?').get(projectId) as { policy: string | null } | undefined;
      return parsePolicy(row?.policy ?? null);
    } catch {
      return { ...DEFAULT_POLICY };
    }
  },

  /** Validate + persist. Throws on invalid policy (router maps to 400). */
  setPolicy(projectId: string, policyInput: unknown): ProjectPolicy {
    ensurePolicyColumn();
    const policy = validatePolicy(policyInput);
    rawDb.prepare('UPDATE projects SET policy = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(policy), new Date().toISOString(), projectId);
    return policy;
  },
};
