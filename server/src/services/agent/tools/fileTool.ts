/**
 * File I/O tool — read and write text files on the host filesystem.
 */
import { readFile, writeFile, access } from 'node:fs/promises';

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
    const searchPath = (args.path as string) || '.';
    const limit = (args.limit as number) || 50;
    const fileGlob = args.file_glob as string | undefined;

    if (!pattern) return JSON.stringify({ error: 'No pattern provided' });

    try {
      const { spawnSync } = await import('node:child_process');

      if (target === 'files') {
        // Use find
        const findCmd = process.platform === 'win32'
          ? `dir /s /b "${searchPath}\\${pattern}"`
          : `find "${searchPath}" -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/\\.*" 2>/dev/null | head -${limit}`;
        const result = spawnSync(findCmd, [], { shell: true, timeout: 10000, maxBuffer: 1024 * 1024 });
        const files = (result.stdout?.toString() || '').split('\n').filter(Boolean).slice(0, limit);
        return JSON.stringify({ matches: files });
      } else {
        // Use grep
        const globFilter = fileGlob ? `--include="${fileGlob}"` : '';
        const grepCmd = process.platform === 'win32'
          ? `findstr /s /n /p /c:"${pattern.replace(/"/g, '\\"')}" "${searchPath}\\*"`
          : `grep -rn "${pattern.replace(/"/g, '\\"')}" "${searchPath}" ${globFilter} --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null | head -${limit}`;
        const result = spawnSync(grepCmd, [], { shell: true, timeout: 15000, maxBuffer: 1024 * 1024 });
        const output = (result.stdout?.toString() || '').split('\n').filter(Boolean).slice(0, limit);
        return JSON.stringify({ matches: output });
      }
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  },
};
