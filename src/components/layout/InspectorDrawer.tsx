import React from 'react';
import { useDrawer } from '../../store/appStore';
import AgentDrawer from '../drawers/AgentDrawer';
import ProviderDrawer from '../drawers/ProviderDrawer';
import RunDrawer from '../drawers/RunDrawer';
import { MemoryDrawer, BuildDrawer } from '../drawers/StubDrawers';
import JarvisDrawer from '../drawers/JarvisDrawer';
import BriefReviewDrawer from '../drawers/BriefReviewDrawer';
import LeadReviewDrawer from '../drawers/LeadReviewDrawer';
import HermesDrawer from '../drawers/HermesDrawer';

const InspectorDrawer: React.FC = () => {
  const drawer = useDrawer();

  // If no entity type or ID, we can't render anything, but we keep the container
  // for the exit animation.
  const content = (() => {
    if (!drawer.entityId) return <div className="p-4 text-muted text-sm text-center mt-10">Select an entity to inspect</div>;
    
    switch (drawer.entityType) {
      case 'jarvis':
        return <JarvisDrawer />;
      case 'brief':
        return <BriefReviewDrawer />;
      case 'lead':
        return <LeadReviewDrawer entityId={drawer.entityId} />;
      case 'agent':
        return <AgentDrawer entityId={drawer.entityId} onClose={drawer.close} onPin={drawer.pin} isPinned={drawer.isPinned} />;
      case 'provider':
        return <ProviderDrawer entityId={drawer.entityId} onClose={drawer.close} onPin={drawer.pin} isPinned={drawer.isPinned} />;
      case 'run':
        return <RunDrawer entityId={drawer.entityId} onClose={drawer.close} onPin={drawer.pin} isPinned={drawer.isPinned} />;
      case 'memory':
        return <MemoryDrawer entityId={drawer.entityId} onClose={drawer.close} onPin={drawer.pin} isPinned={drawer.isPinned} />;
      case 'build':
      case 'artifact':
        return <BuildDrawer entityId={drawer.entityId} onClose={drawer.close} onPin={drawer.pin} isPinned={drawer.isPinned} />;
      case 'hermes':
        return <HermesDrawer />;
      default:
        return <div className="p-4 text-muted text-sm text-center mt-10">Select an entity to inspect</div>;
    }
  })();

  return (
    <>
      <div 
        className={`drawer-overlay ${drawer.isOpen && !drawer.isPinned ? 'visible' : ''}`} 
        onClick={drawer.close}
      />
      <div 
        className={`inspector-drawer ${drawer.entityType === 'hermes' ? 'hermes-cockpit-drawer' : ''} ${drawer.isOpen ? 'open' : ''}`}
      >
        {content}
      </div>
    </>
  );
};

export default InspectorDrawer;

