import React from 'react';
import DrawerShell from './DrawerShell';

const StubDrawer: React.FC<{ entityId: string; onClose: () => void; onPin: () => void; isPinned: boolean, title: string }> = ({ entityId, onClose, onPin, isPinned, title }) => (
  <DrawerShell title={title} subtitle={`ID: ${entityId}`} onClose={onClose} onPin={onPin} isPinned={isPinned}>
    <div className="drawer-section">
      <div className="text-muted text-sm">Details for {title} will appear here.</div>
    </div>
  </DrawerShell>
);

export const MemoryDrawer: React.FC<any> = (props) => <StubDrawer {...props} title="Memory Scope" />;
export const BuildDrawer: React.FC<any> = (props) => <StubDrawer {...props} title="Artifact/Build" />;

