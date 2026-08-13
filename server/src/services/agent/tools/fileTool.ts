/**
 * File I/O tool — read and write text files on the host filesystem.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceRoot } from '../../workspaceStore.js';

/**
 * Resolve the search_files path argument against the authoritative
 * workspace root (workspaceStore.getWorkspaceRoot — same source as
 * WorkspaceIndexer). Relative paths anchor at the root; absolute paths are
 * allowed only when they resolve INSIDE the root; traversal and outside
 * paths are denied. Returns the bounded search path or a truthful error.
 */
export function resolveBoundedSearchPath(requested: string | undefined, workspaceRoot: string):
  { searchPath: string } | { error: string } {
  if (!workspaceRoot) {
    // No authoritative workspace configured — nothing to bound against.
    // Preserve the legacy cwd-relative default; agents operate inside a
    // configured workspace in practice (workspaceStore always resolves a
    // root via selection → env → git detection).
    return { searchPath: (requested || '').trim() || '.' };
  }
  const req = (requested || '').trim();
  if (!req) return { searchPath: workspaceRoot };
  const resolved = path.isAbsolute(req) ? path.normalize(req) : path.resolve(workspaceRoot, req);
  const rel = path.relative(workspaceRoot, resolved);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (!inside) {
    return { error: `Path outside the workspace is not allowed: ${requested}` };
  }
  return { searchPath: resolved };
}

export const readFileTool = {
  name: 'read_file',
  description: 'Read the contents of a text file from the filesystem. Supports optional line offset and limit for large files.',
  parameters: [
    { name: 'path', type: 'string', description: 'Absolute path to the file to read', required: true },
    { name: 'offset', type: 'number', description: 'Starting line number (1-indexed, default: 1)', required: false },
    { name: 'limit', type: 'number', description: 'Maximum lines to return (default: 500, max: 2000)', required: false },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.path as string;
    if (!filePath) return JSON.stringify({ error: 'No path provided' });

    try {
      await access(filePath);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const offset = ((args.offset as number) || 1) - 1;
      const limit = Math.min((args.limit as number) || 500, 2000);

      const selected = lines.slice(offset, offset + limit);
      const result = {
        content: selected.join('\n'),
        totalLines: lines.length,
        startLine: offset + 1,
        endLine: Math.min(offset + limit, lines.length),
      };
      return JSON.stringify(result);
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  },
};

export const writeFileTool = {
  name: 'write_file',
  description: 'Write content to a file on the filesystem. Creates parent directories automatically. Completely overwrites existing files.',
  parameters: [
    { name: 'path', type: 'string', description: 'Absolute path to the file to write', required: true },
    { name: 'content', type: 'string', description: 'The complete content to write to the file', required: true },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.path as string;
    const content = args.content as string;
    if (!filePath) return JSON.stringify({ error: 'No path provided' });
    if (content === undefined) return JSON.stringify({ error: 'No content provided' });

    try {
      // Ensure parent directory exists
      const { dirname } = await import('node:path');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dirname(filePath), { recursive: true });

      await writeFile(filePath, content, 'utf-8');
      return JSON.stringify({ success: true, path: filePath, bytesWritten: Buffer.byteLength(content, 'utf-8') });
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  },
};

export const searchFilesTool = {
  name: 'search_files',
  description: 'Search for files by name pattern or search inside file contents using regex. Use this to find files or locate code.',
  parameters: [
    { name: 'pattern', type: 'string', description: 'Glob pattern (file search) or regex (content search)', required: true },
    { name: 'target', type: 'string', description: 'Target: "content" to search inside files, "files" to find files by name', required: false, enum: ['content', 'files'] },
    { name: 'path', type: 'string', description: 'Directory to search in (default: current working directory)', required: false },
    { name: 'limit', type: 'number', description: 'Max results (default: 50)', required: false },
    { name: 'file_glob', type: 'string', description: 'Filter by file extension for content search, e.g. "*.ts"', required: false },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const pattern = args.pattern as string;
    const target = (args.target as string) || 'content';
    const limit = Math.min((args.limit as number) || 50, 200);
    const fileGlob = args.file_glob as string | undefined;

    if (!pattern) return JSON.stringify({ error: 'No pattern provided' });

    // Workspace boundary (same authoritative semantics as WorkspaceIndexer):
    // relative paths anchor at the workspace root; absolute paths must be
    // inside it; traversal/outside paths are denied with a truthful error.
    const boundary = resolveBoundedSearchPath(args.path as string | undefined, getWorkspaceRoot());
    if ('error' in boundary) return JSON.stringify({ error: boundary.error });
    const searchPath = boundary.searchPath;

    // Cross-platform content search: the pattern is ALWAYS a regex, on every
    // OS (previously Windows used findstr /c: literal while Unix used grep
    // regex — same parameter, different semantics; documented audit defect).
    // No shell is involved: paths/patterns are passed through Node fs APIs,
    // so spaces in paths and special characters are safe (no injection).
    try {
      const { statSync, readdirSync, readFileSync } = await import('node:fs');
      const pathMod = await import('node:path');

      const SKIP_DIRS = new Set([
        'node_modules', '.git', 'dist', 'dist-electron', 'build', '.agentos',
        '.agentic', 'coverage', '.venv', 'venv', '__pycache__', '.cache',
        '.turbo', 'target', '.next', 'release',
      ]);
      const MAX_FILE_BYTES = 512 * 1024;
      const MAX_FILES_SCANNED = 30000;
      const TIMEOUT_MS = 10000;

      function isBinary(buf: Buffer): boolean {
        return buf.subarray(0, 8192).includes(0);
      }

      // Minimal glob → regex (*, **, ?); escaped otherwise.
      function globToRegExp(glob: string): RegExp {
        const escaped = glob
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '[^/]*')
          .replace(/\u0000/g, '.*')
          .replace(/\?/g, '[^/]');
        return new RegExp(`^${escaped}$`, 'i');
      }

      const matches: string[] = [];
      let truncated = false;
      let scanned = 0;
      const started = Date.now();
      const stack: string[] = [searchPath];

      const fileMatchesName = (rel: string): boolean => {
        const name = pathMod.basename(rel);
        try {
          return globToRegExp(pattern).test(name) || globToRegExp(pattern).test(rel);
        } catch {
          return false;
        }
      };

      while (stack.length > 0) {
        if (Date.now() - started > TIMEOUT_MS) { truncated = true; break; }
        if (scanned > MAX_FILES_SCANNED) { truncated = true; break; }
        const dir = stack.pop()!;
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch { continue; }
        for (const entry of entries) {
          if (matches.length >= limit) { truncated = true; break; }
          if (scanned++ > MAX_FILES_SCANNED) { truncated = true; break; }
          const full = pathMod.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.git')) stack.push(full);
            continue;
          }
          if (!entry.isFile()) continue;
          // Skip hidden/secret files (e.g. .env) — they are not searchable.
          if (entry.name.startsWith('.')) continue;
          const rel = pathMod.relative(searchPath, full).replace(/\\/g, '/');

          if (target === 'files') {
            if (fileMatchesName(rel)) matches.push(rel);
            continue;
          }

          // target === 'content'
          if (fileGlob && !globToRegExp(fileGlob).test(pathMod.basename(rel))) continue;
          let stat;
          try { stat = statSync(full); } catch { continue; }
          if (stat.size > MAX_FILE_BYTES) continue;
          let buf: Buffer;
          try { buf = readFileSync(full); } catch { continue; }
          if (isBinary(buf)) continue;
          let re: RegExp;
          try {
            re = new RegExp(pattern);
          } catch (err: any) {
            return JSON.stringify({ error: `Invalid regex pattern: ${err?.message ?? 'unknown'}` });
          }
          const text = buf.toString('utf-8');
          const hitLines: string[] = [];
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length && hitLines.length < 5; i++) {
            if (re.test(lines[i])) hitLines.push(`${rel}:${i + 1}:${lines[i].slice(0, 160)}`);
          }
          if (hitLines.length > 0) matches.push(...hitLines);
        }
        if (truncated) break;
      }

      return JSON.stringify({ matches: matches.slice(0, limit), truncated });
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  },
};
