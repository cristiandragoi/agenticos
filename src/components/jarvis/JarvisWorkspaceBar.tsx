import React, { useEffect, useRef, useState } from 'react';
import { FolderGit2, Loader2, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';
import { apiFetch, apiUrl } from '../../api/client';

/**
 * Compact workspace + approval-policy bar for Jarvis.
 * The selection is persisted into the shared codex run settings, so Jarvis
 * and CodeX Studio always agree on "the currently selected repository".
 * CodeX / Agent Team routes are rejected server-side when no valid
 * repository is selected — this bar makes that state visible upfront.
 */
export const JarvisWorkspaceBar: React.FC = () => {
  const { runSettings, setRunSettings } = useCodexStore();
  const [gitRoots, setGitRoots] = useState<string[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const firstRun = useRef(true);

  const detect = async (basePath?: string) => {
    const requestedPath = basePath?.trim();
    setIsDetecting(true);
    setWorkspaceError(null);
    try {
      const res = await apiFetch('/api/workspace/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath: requestedPath || undefined })
      });
      const data = await res.json();
      if (!data.isValid) {
        setGitRoots([]);
        setRunSettings(prev => ({ ...prev, workspacePath: '' }));
        setWorkspaceError(data.errorMessage || 'No git repository found at this path.');
      } else {
        const roots: string[] = data.gitRoots || [];
        setGitRoots(roots);
        if (roots.length === 1) {
          setRunSettings(prev => ({ ...prev, folderTree: requestedPath || roots[0], workspacePath: roots[0] }));
          // §1: publish the confirmed repository to the canonical server
          // workspace store — every agent/worker resolves files against it.
          void apiFetch('/api/workspace/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspaceRoot: roots[0] }),
          }).catch(() => { /* backend not up yet */ });
        } else if (roots.length > 1) {
          setRunSettings(prev => ({
            ...prev,
            folderTree: requestedPath || prev.folderTree,
            workspacePath: roots.includes(prev.workspacePath) ? prev.workspacePath : roots[0]
          }));
        }
      }
    } catch (err) {
      setGitRoots([]);
      setWorkspaceError('Could not reach the backend to validate the workspace.');
    } finally {
      setIsDetecting(false);
    }
  };

  // Initial detection on mount (validates any pre-existing selection too).
  useEffect(() => {
    detect(runSettings.folderTree || runSettings.workspacePath || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced re-detection when the user edits the folder path.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => detect(runSettings.folderTree || undefined), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSettings.folderTree]);

  const hasValidWorkspace = !!runSettings.workspacePath && !workspaceError && !isDetecting;

  return (
    <div
      data-testid="jarvis-workspace-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'nowrap',
        padding: '3px 8px',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.02)',
        fontSize: '0.8125rem'
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.6875rem', letterSpacing: '0.05em' }}>
        <FolderGit2 size={14} /> Repository
      </span>

      <input
        type="text"
        aria-label="Workspace path"
        value={runSettings.folderTree}
        placeholder="Enter repository path…"
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            detect((e.currentTarget as HTMLInputElement).value);
          }
        }}
        onBlur={e => detect(e.currentTarget.value)}
        onChange={e => {
          setTouched(true);
          setRunSettings(prev => ({ ...prev, folderTree: e.target.value }));
        }}
        style={{
          flex: '1 1 140px',
          minWidth: '120px',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: 'var(--text-primary)',
          padding: '3px 8px',
          fontSize: '0.8125rem',
          fontFamily: 'monospace',
          outline: 'none'
        }}
      />

      {gitRoots.length > 1 && (
        <select
          aria-label="Repository root"
          value={runSettings.workspacePath}
          onChange={e => setRunSettings(prev => ({ ...prev, folderTree: prev.folderTree || e.target.value, workspacePath: e.target.value }))}
          style={{
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            padding: '6px 8px',
            fontSize: '0.8125rem'
          }}
        >
          {gitRoots.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      )}

      {isDetecting && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)' }}>
          <Loader2 size={14} className="animate-spin" /> Detecting…
        </span>
      )}

      {hasValidWorkspace && (
        <span
          data-testid="jarvis-workspace-valid"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-success)', fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={runSettings.workspacePath}
        >
          <CheckCircle2 size={14} /> {runSettings.workspacePath}
        </span>
      )}

      {!isDetecting && !hasValidWorkspace && (
        <span
          data-testid="jarvis-workspace-error"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-error)', fontWeight: 600 }}
        >
          <AlertTriangle size={14} />
          {workspaceError ? `Select repository — ${workspaceError}` : 'Select repository — execution actions are disabled until a valid repository is chosen.'}
        </span>
      )}

      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)', marginLeft: 'auto', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.6875rem', letterSpacing: '0.05em' }}>
        <ShieldCheck size={14} /> Approval
      </span>
      <select
        aria-label="Approval policy"
        value={runSettings.approvalPolicy}
        onChange={e => setRunSettings(prev => ({ ...prev, approvalPolicy: e.target.value }))}
        style={{
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          color: 'var(--text-primary)',
          padding: '3px 6px',
          fontSize: '0.8125rem'
        }}
      >
        <option value="strict">Require review</option>
        <option value="auto">Auto-approve safe actions</option>
      </select>
    </div>
  );
};
