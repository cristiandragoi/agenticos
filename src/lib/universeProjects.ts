/**
 * universeProjects — pure derivation of the JARVIS Visual Universe project
 * set from persisted project records.
 *
 * Visual Universe rule: ONLY canonical persisted user projects become
 * persistent stars. Acceptance/test artifacts created by the harness
 * (scripts/accept-*.mjs) and the acceptance suites are NEVER stars, even
 * when they exist as DB rows. Future real projects created through the
 * canonical Projects workflow appear automatically — no whitelist to keep.
 */

export interface ProjectRecordLike {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  color?: string | null;
}

export interface UniverseProjectNode {
  id: string;
  name: string;
  color?: string | null;
}

/** Acceptance harness id prefixes (scripts/accept-*.mjs pass explicit ids). */
const JUNK_ID_PREFIX = /^proj-(hermes|plan|cancel|dsh|escape|truth|test)(-|$)/i;

/**
 * Junk name shapes observed in the live + repo DBs. Deliberately specific:
 * a real user project ("Production", "Affiliate Business", "Recruiting") must
 * never match; a harness artifact ("Hermes Smoke 1786906088448", "Packaged
 * Production CodeX Project", "Production Memory Proof") always does.
 */
const JUNK_NAME = /(\d{13}\s*$|smoke|acceptance|canonical|overnight|verifier evidence|isolation|\bpoc\b|escape test|provider truth|policy e2e|architecture test|cancellation test|hermes research|packaged codex|packaged production|memory proof|\bproof\b|\bdsh\b|^project:|^test$|codex c\b|magnitude b\b|misfire|runnow|cancelj|enablee|diagj|memoryisob)/i;

/** Tags the harness will use on every acceptance project (see accept-*.mjs). */
const JUNK_TAGS = /acceptance|fixture|smoke|harness|test/i;

/** True when a persisted project row is a proven acceptance/test artifact. */
export function isAcceptanceArtifactProject(p: ProjectRecordLike): boolean {
  if (JUNK_ID_PREFIX.test(p.id)) return true;
  if (JUNK_NAME.test(p.name || '')) return true;
  if (Array.isArray(p.tags) && p.tags.some((t) => JUNK_TAGS.test(String(t)))) return true;
  return false;
}

/** Human-readable star label: strip harness timestamps and prefixes. */
export function humanProjectName(p: ProjectRecordLike): string {
  return (p.name || '')
    .replace(/\s+\d{13}\s*$/, '')
    .replace(/^project:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The universe project set: real persisted records only, readable names. */
export function toUniverseProjects(rows: ProjectRecordLike[]): UniverseProjectNode[] {
  return rows
    .filter((r) => !isAcceptanceArtifactProject(r))
    .map((r) => ({ id: r.id, name: humanProjectName(r) || r.name, color: r.color ?? null }));
}
