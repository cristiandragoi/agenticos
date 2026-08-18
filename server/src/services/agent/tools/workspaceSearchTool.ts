/**
 * workspace.search — explicit agent bridge to WorkspaceIndexer V1 (P11).
 *
 * Bounded evidence retrieval over the authoritative project/workspace root.
 * The agent must call this EXPLICITLY (no automatic repo-wide context
 * injection in V1). Results carry provenance (relPath + real line numbers
 * where available); snippets are bounded; truncation is truthful.
 */
import { searchWorkspace, WI_MAX_RESULTS } from '../../workspaceIndexer.js';

export const workspaceSearchTool = {
  name: 'workspace.search',
  description: 'Search the selected AgenticOS workspace for source/config evidence. '
    + 'Returns bounded results with exact file paths and line provenance. '
    + 'Use this to answer "where is X defined/used", "find the code that does Y", '
    + 'or locate documentation — instead of reading the whole repository.',
  parameters: [
    { name: 'query', type: 'string', description: 'Search text (literal token for exact match, phrase for text/FTS search)', required: true },
    { name: 'projectId', type: 'string', description: 'Optional project id; defaults to the current active workspace', required: false },
    { name: 'mode', type: 'string', description: 'auto | exact | text (default auto)', required: false, enum: ['auto', 'exact', 'text'] },
    { name: 'limit', type: 'number', description: `Max results (default ${WI_MAX_RESULTS}, max 25)`, required: false },
    { name: 'fileTypes', type: 'string', description: 'Comma-separated extensions to filter, e.g. "ts,tsx"', required: false },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const query = (args.query as string || '').trim();
    if (!query) return JSON.stringify({ error: 'No query provided' });
    const resp = searchWorkspace({
      projectId: (args.projectId as string) || null,
      query,
      mode: (args.mode as 'auto' | 'exact' | 'text') || 'auto',
      limit: typeof args.limit === 'number' ? args.limit : undefined,
      fileTypes: typeof args.fileTypes === 'string' && args.fileTypes ? args.fileTypes.split(',') : undefined,
    });
    if (resp.error && resp.results.length === 0) {
      return JSON.stringify({ error: resp.error });
    }
    return JSON.stringify({
      query: resp.query,
      mode: resp.chosenMode,
      total: resp.total,
      truncated: resp.truncated,
      durationMs: resp.durationMs,
      results: resp.results.map((r: { relPath: string; line?: number; lineResolved: boolean; snippet: string; score?: number }) => ({
        path: r.relPath,
        line: r.line ?? null,
        lineResolved: r.lineResolved,
        snippet: r.snippet,
        score: r.score ?? null,
      })),
    });
  },
};
