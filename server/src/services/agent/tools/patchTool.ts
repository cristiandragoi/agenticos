/**
 * Patch tool — replace specific blocks of text in a file safely.
 */
import { readFile, writeFile, access } from 'node:fs/promises';

export const patchFileTool = {
  name: 'patch_file',
  description: 'Safely replace a specific block of text in an existing file. Use this instead of write_file to modify parts of a file without overwriting the whole thing. The search string must match EXACTLY (including whitespace).',
  parameters: [
    { name: 'path', type: 'string', description: 'Absolute path to the file to modify', required: true },
    { name: 'search', type: 'string', description: 'The exact string block to search for and replace. Must match exactly.', required: true },
    { name: 'replace', type: 'string', description: 'The replacement string block.', required: true },
    { name: 'expectedCount', type: 'number', description: 'The exact number of occurrences of the search string you expect to find. (Default: 1)', required: false },
    { name: 'preview', type: 'boolean', description: 'If true, do not perform the write. Just return match metadata and preview.', required: false },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const filePath = args.path as string;
    const search = args.search as string;
    const replace = args.replace as string;
    const expectedCount = typeof args.expectedCount === 'number' ? args.expectedCount : undefined;
    const preview = !!args.preview;

    if (!filePath) return JSON.stringify({ ok: false, error: 'No path provided' });
    if (!search) return JSON.stringify({ ok: false, error: 'No search string provided' });
    if (replace === undefined) return JSON.stringify({ ok: false, error: 'No replace string provided' });

    try {
      await access(filePath);
      const content = await readFile(filePath, 'utf-8');

      const splitContent = content.split(search);
      const occurrences = splitContent.length - 1;

      if (occurrences === 0) {
        return JSON.stringify({ 
          ok: false, 
          error: 'Search string not found in the file. Make sure whitespace and formatting match exactly.' 
        });
      }

      if (expectedCount !== undefined && occurrences !== expectedCount) {
        return JSON.stringify({ 
          ok: false, 
          error: `Ambiguity error: found ${occurrences} occurrences, but expected exactly ${expectedCount}. Please provide a larger, more unique search block or adjust expectedCount.` 
        });
      } else if (expectedCount === undefined && occurrences > 1) {
        return JSON.stringify({ 
          ok: false, 
          error: `Ambiguity error: found ${occurrences} occurrences. Please provide a larger, more unique search block or explicitly set expectedCount.` 
        });
      }

      if (preview) {
        return JSON.stringify({
          ok: true,
          path: filePath,
          matches: occurrences,
          changed: false,
          preview: true,
        });
      }

      // Safe to replace
      const newContent = content.split(search).join(replace);
      await writeFile(filePath, newContent, 'utf-8');

      return JSON.stringify({ 
        ok: true, 
        path: filePath, 
        matches: occurrences, 
        changed: true, 
        preview: false 
      });
    } catch (err: any) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  },
};
