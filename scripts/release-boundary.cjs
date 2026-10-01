/**
 * release-boundary.cjs — shared checks that keep the source repository and the
 * installed runtime as two physically separate trees (Phase 1 release boundary).
 *
 * Background: the installed runtime's resources/server/dist was observed changing
 * the moment the repository was rebuilt, without any deploy (no backup was
 * created, mtimes identical, orphan files mirrored). That is the behaviour of a
 * junction/symlink (or a parent directory link) between the two trees.
 *
 * Node reports Windows directory junctions as symbolic links via lstat(), and
 * realpath() resolves through them. We use both: a path component is "linked"
 * when lstat says so OR when its realpath is not <realpath(parent)>/<name>.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..');
const INSTALLED = process.env.AGENTICOS_INSTALLED
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'AgenticOS');
const RESOURCES = path.join(INSTALLED, 'resources');

const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();

function realpathOrNull(p) {
  try { return fs.realpathSync.native(p); } catch { return null; }
}

/** Is this single path entry itself a link/junction (does not inspect ancestors)? */
function isLinkEntry(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return false; }
  if (st.isSymbolicLink()) return true;
  const parentReal = realpathOrNull(path.dirname(p));
  const real = realpathOrNull(p);
  if (!parentReal || !real) return false;
  return norm(real) !== norm(path.join(parentReal, path.basename(p)));
}

/**
 * Every linked component of `p`, from `stopAt` (exclusive) down to `p` (inclusive),
 * outermost first. Returns [{ path, target }].
 */
function linkedComponents(p, stopAt) {
  const out = [];
  const stop = norm(stopAt);
  const chain = [];
  let cur = path.resolve(p);
  while (norm(cur) !== stop && path.dirname(cur) !== cur) {
    chain.unshift(cur);
    cur = path.dirname(cur);
  }
  for (const c of chain) {
    if (fs.existsSync(c) && isLinkEntry(c)) out.push({ path: c, target: realpathOrNull(c) });
  }
  return out;
}

/** True when `p` physically resolves to somewhere inside the source repository. */
function resolvesIntoRepo(p) {
  const real = realpathOrNull(p);
  if (!real) return false;
  const repoReal = realpathOrNull(REPO) || REPO;
  const r = norm(real);
  const base = norm(repoReal);
  return r === base || r.startsWith(base + path.sep.toLowerCase()) || r.startsWith(base + '/');
}

/** Installed locations that must never resolve into the repository. */
const INSTALLED_RUNTIME_PATHS = [
  INSTALLED,
  RESOURCES,
  path.join(RESOURCES, 'server'),
  path.join(RESOURCES, 'server', 'dist'),
  path.join(RESOURCES, 'server', 'scripts'),
  path.join(RESOURCES, 'app'),
  path.join(RESOURCES, 'app', 'dist'),
  path.join(RESOURCES, 'app', 'dist-electron'),
];

/** Report of every link or repo-shared directory in the installed runtime. */
function inspectInstalled() {
  const findings = [];
  const seen = new Set();
  for (const p of INSTALLED_RUNTIME_PATHS) {
    if (!fs.existsSync(p)) continue;
    for (const l of linkedComponents(p, path.dirname(INSTALLED))) {
      if (seen.has(norm(l.path))) continue;
      seen.add(norm(l.path));
      findings.push({ kind: 'link', path: l.path, target: l.target, intoRepo: resolvesIntoRepo(l.path) });
    }
    if (resolvesIntoRepo(p) && !seen.has('repo:' + norm(p))) {
      seen.add('repo:' + norm(p));
      findings.push({ kind: 'shared_with_repo', path: p, target: realpathOrNull(p), intoRepo: true });
    }
  }
  return findings;
}

/**
 * Remove a link/junction entry WITHOUT following it. Never recursive: a recursive
 * delete through a junction would destroy the repository tree it points at.
 */
function removeLinkOnly(p) {
  if (!isLinkEntry(p)) throw new Error(`refusing to remove ${p}: not a link`);
  const target = realpathOrNull(p);
  let removed = false;
  let lastErr = null;
  for (const fn of [() => fs.unlinkSync(p), () => fs.rmdirSync(p)]) {
    try { fn(); removed = true; break; } catch (e) { lastErr = e; }
  }
  if (!removed) throw new Error(`could not remove link ${p}: ${lastErr && lastErr.message}`);
  if (fs.existsSync(p)) throw new Error(`link ${p} still present after removal`);
  if (target && !fs.existsSync(target)) throw new Error(`SAFETY: link target ${target} vanished after unlinking ${p}`);
  return target;
}

/**
 * Replace a linked directory with a real, independent copy of what it currently
 * shows, so the installed runtime keeps working but no longer shares storage.
 */
function materializeLink(p) {
  const target = realpathOrNull(p);
  if (!target) throw new Error(`cannot resolve link ${p}`);
  const tmp = `${p}.materialize-${Date.now()}`;
  fs.cpSync(target, tmp, { recursive: true, dereference: false, verbatimSymlinks: true });
  removeLinkOnly(p);
  fs.renameSync(tmp, p);
  if (isLinkEntry(p)) throw new Error(`${p} is still a link after materialization`);
  return target;
}

module.exports = {
  REPO, INSTALLED, RESOURCES, INSTALLED_RUNTIME_PATHS,
  isLinkEntry, linkedComponents, resolvesIntoRepo, inspectInstalled, removeLinkOnly, materializeLink, realpathOrNull,
};

if (require.main === module) {
  const findings = inspectInstalled();
  console.log(JSON.stringify({ repo: REPO, installed: INSTALLED, findings }, null, 2));
  process.exit(findings.length ? 2 : 0);
}
