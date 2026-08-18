// Project Files — minimal project-scoped file/reference view built on the
// EXISTING AgenticOS workspace infrastructure (/api/workspace/current,
// /api/workspace/search-files). This is NOT a second file-management system:
// it shows the canonical workspace root and lets the user search files the
// same way the agents resolve them (exact/relative + bounded repository scan).
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useProjects } from '../../store/projectStore';

interface FileSearchResult {
  query: string;
  workspaceRoot: string | null;
  matches: string[];
  truncated: boolean;
  searchedScopes: string[];
}

export const ProjectFiles: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { projects } = useProjects();
  const project = projects.find((p) => p.id === projectId) || null;

  const [root, setRoot] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FileSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const loadRoot = useCallback(async () => {
    try {
      const res = await apiFetch('/api/workspace/current');
      if (res.ok) {
        const data = await res.json();
        setRoot(data.workspaceRoot || null);
      }
    } catch { /* best effort */ }
  }, []);

  useEffect(() => { void loadRoot(); }, [loadRoot]);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await apiFetch('/api/workspace/search-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      if (res.ok) setResult(await res.json());
    } catch { /* best effort */ }
    setSearching(false);
  };

  return (
    <div data-testid="project-files">
      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
        Files — workspace references
      </div>

      <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0f172a', marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Canonical Workspace
        </div>
        {project?.workspacePath && (
          <div style={{ fontSize: 11, color: '#67e8f9', marginBottom: 4 }}>
            Project path: <b>{project.workspacePath}</b>
          </div>
        )}
        <div style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-all' }}>
          {root ? root : 'No workspace root selected yet.'}
        </div>
        {!project?.workspacePath && (
          <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
            This project has no dedicated workspace path — files resolve against the canonical workspace root above.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
          placeholder="Search files in the workspace… (e.g. ProjectBoard.tsx)"
          style={{
            flex: 1, background: '#0a0f16', border: '1px solid #334155', borderRadius: 6,
            color: '#e2e8f0', fontSize: 12, padding: '6px 10px', outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => void doSearch()}
          disabled={searching || !query.trim()}
          style={{ background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 600, cursor: searching ? 'wait' : 'pointer' }}
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: '#475569' }}>
            {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''} for “{result.query}”
            {result.truncated ? ' (scan truncated)' : ''} — {(result.searchedScopes || []).join('; ') || ''}
          </div>
          {result.matches.length === 0 ? (
            <div style={{ fontSize: 11, color: '#334155', padding: '12px 0' }}>
              No files found. Try a filename, a path fragment, or a stem (e.g. <code>jarvis</code>).
            </div>
          ) : (
            result.matches.map((m) => (
              <div key={m} data-testid={`project-file-match-${m}`} style={{
                fontSize: 11, color: '#cbd5e1', padding: '5px 10px', borderRadius: 5,
                background: 'rgba(15,23,42,0.6)', border: '1px solid #1e293b', wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}>
                {m}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectFiles;
