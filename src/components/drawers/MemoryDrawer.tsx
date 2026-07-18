// @ts-nocheck
import { useData } from '../../store/dataStore';
import React from 'react';

import { Brain, Tag, Lock } from 'lucide-react';
import DrawerShell from './DrawerShell';
import StatusBadge from '../ui/StatusBadge';
import ContextChip from '../ui/ContextChip';

interface MemoryDrawerProps {
  scopeId: string;
  onClose: () => void;
  onPin?: () => void;
  isPinned?: boolean;
}

const scopeTypeColor: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  global: 'info',
  board: 'success',
  agent: 'warning',
  session: 'default',
  task: 'default',
};

const entryKindType: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  note: 'default',
  fact: 'info',
  artifact: 'success',
  conversation: 'default',
  decision: 'warning',
  summary: 'info',
};

const MemoryDrawer: React.FC<MemoryDrawerProps> = ({ scopeId, onClose, onPin, isPinned }) => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;

  const scope = mockMemoryScopes.find(s => s.id === scopeId);
  const entries = mockMemoryEntries.filter(e => e.scopeId === scopeId);

  if (!scope) {
    return (
      <DrawerShell title="Memory Scope Not Found" onClose={onClose} icon={<Brain size={18} />}>
        <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 60 }}>
          No memory scope found with ID "{scopeId}"
        </div>
      </DrawerShell>
    );
  }

  return (
    <DrawerShell
      title={scope.name}
      subtitle={`${scope.type} scope · ${scope.entryCount ?? entries.length} entries`}
      icon={<Brain size={16} />}
      onClose={onClose}
      onPin={onPin}
      isPinned={isPinned}
    >
      {/* SCOPE INFO */}
      <div className="drawer-section">
        <div className="drawer-section__label">Scope Info</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <StatusBadge status={scope.type} type={scopeTypeColor[scope.type] ?? 'default'} />
          {scope.entryCount !== undefined && (
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
              {scope.entryCount} entries
            </span>
          )}
        </div>
        {scope.summary && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            {scope.summary}
          </p>
        )}
      </div>

      {/* TAGS */}
      {scope.tags.length > 0 && (
        <div className="drawer-section">
          <div className="drawer-section__label">Tags</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {scope.tags.map(tag => (
              <ContextChip key={tag} label={tag} icon={<Tag size={10} />} />
            ))}
          </div>
        </div>
      )}

      {/* PERMISSIONS */}
      {scope.permissions.length > 0 && (
        <div className="drawer-section">
          <div className="drawer-section__label">Permissions</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {scope.permissions.map(perm => (
              <ContextChip key={perm} label={perm} icon={<Lock size={10} />} />
            ))}
          </div>
        </div>
      )}

      {/* ENTRIES */}
      <div className="drawer-section">
        <div className="drawer-section__label">Entries</div>
        {entries.length === 0 ? (
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>No entries in scope</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map(entry => (
              <div
                key={entry.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <StatusBadge status={entry.kind} type={entryKindType[entry.kind] ?? 'default'} />
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {entry.title}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.6875rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}>
                  {entry.content}
                </div>
                {entry.syncStatus === 'synced' && (
                  <div style={{ marginTop: 8, padding: 6, background: '#1e1e1e', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.65rem', color: '#a8a8a8', overflowX: 'auto' }}>
                    <div style={{ color: '#569cd6' }}>---</div>
                    <div style={{ color: '#ce9178' }}>id: {entry.id}</div>
                    <div style={{ color: '#ce9178' }}>kind: {entry.kind}</div>
                    <div style={{ color: '#ce9178' }}>source: {entry.sourceType}/{entry.sourceId}</div>
                    <div style={{ color: '#ce9178' }}>date: {entry.createdAt}</div>
                    <div style={{ color: '#569cd6' }}>---</div>
                    <div style={{ marginTop: 4, color: '#d4d4d4' }}># {entry.title}</div>
                    <div style={{ marginTop: 4, color: '#d4d4d4' }}>{entry.content}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DrawerShell>
  );
};

export default MemoryDrawer;


