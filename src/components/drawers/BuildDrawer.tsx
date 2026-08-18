// @ts-nocheck
import { useData } from '../../store/dataStore';
import React from 'react';

import { Package, Play, Bot } from 'lucide-react';
import DrawerShell from './DrawerShell';
import StatusBadge from '../ui/StatusBadge';
import ContextChip from '../ui/ContextChip';
import { useDrawer } from '../../store/appStore';

interface BuildDrawerProps {
  artifactId: string;
  onClose: () => void;
  onPin?: () => void;
  isPinned?: boolean;
}

const artifactStatusType = (status: string): 'success' | 'warning' | 'error' | 'info' | 'default' => {
  if (status === 'active' || status === 'done') return 'success';
  if (status === 'draft') return 'default';
  if (status === 'review') return 'warning';
  if (status === 'archived') return 'default';
  return 'default';
};

const BuildDrawer: React.FC<BuildDrawerProps> = ({ artifactId, onClose, onPin, isPinned }) => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;

  const drawer = useDrawer();
  const artifact = mockArtifacts.find(a => a.id === artifactId);

  if (!artifact) {
    return (
      <DrawerShell title="Artifact Not Found" onClose={onClose} icon={<Package size={18} />}>
        <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 60 }}>
          No artifact found with ID "{artifactId}"
        </div>
      </DrawerShell>
    );
  }

  const sourceRun = artifact.sourceRunId ? mockRuns.find(r => r.id === artifact.sourceRunId) : undefined;
  const linkedAgent = artifact.linkedAgentId ? mockAgents.find(a => a.id === artifact.linkedAgentId) : undefined;

  return (
    <DrawerShell
      title={artifact.title}
      subtitle={`v${artifact.version} · ${artifact.type}`}
      icon={<Package size={16} />}
      onClose={onClose}
      onPin={onPin}
      isPinned={isPinned}
    >
      {/* STATUS */}
      <div className="drawer-section">
        <div className="drawer-section__label">Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusBadge status={artifact.status} type={artifactStatusType(artifact.status)} />
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)' }}>
            v{artifact.version}
          </span>
        </div>
      </div>

      {/* PREVIEW */}
      <div className="drawer-section">
        <div className="drawer-section__label">Preview</div>
        <div style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
        }}>
          {artifact.preview}
        </div>
      </div>

      {/* TYPE */}
      <div className="drawer-section">
        <div className="drawer-section__label">Type</div>
        <ContextChip label={artifact.type} icon={<Package size={10} />} />
      </div>

      {/* SOURCE RUN */}
      {artifact.sourceRunId && (
        <div className="drawer-section">
          <div className="drawer-section__label">Source Run</div>
          <ContextChip
            label={sourceRun ? `${sourceRun.id} (${sourceRun.status})` : artifact.sourceRunId}
            icon={<Play size={10} />}
            onClick={() => drawer.open('run', artifact.sourceRunId!)}
          />
        </div>
      )}

      {/* LINKED AGENT */}
      {linkedAgent && (
        <div className="drawer-section">
          <div className="drawer-section__label">Linked Agent</div>
          <ContextChip
            label={linkedAgent.name}
            icon={<Bot size={10} />}
            color={linkedAgent.color}
            onClick={() => drawer.open('agent', linkedAgent.id)}
          />
        </div>
      )}
    </DrawerShell>
  );
};

export default BuildDrawer;


