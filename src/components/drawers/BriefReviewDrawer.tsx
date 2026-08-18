import React from 'react';
import { useDrawer } from '../../store/appStore';
import { useData } from '../../store/dataStore';
import DrawerShell from './DrawerShell';
import { Download, Check, RefreshCw } from 'lucide-react';
import { apiClient } from '../../api/client';

const BriefReviewDrawer: React.FC = () => {
  const drawer = useDrawer();
  const { researchBriefs, artifacts, refresh } = useData();

  if (drawer.entityType !== 'brief' || !drawer.entityId) return null;

  const brief = researchBriefs.find(b => b.id === drawer.entityId);
  if (!brief) return <div className="p-4">Brief not found.</div>;

  const artifact = brief.artifactIds.length > 0 
    ? artifacts.find(a => a.id === brief.artifactIds[brief.artifactIds.length - 1])
    : null;

  const handleApprove = async () => {
    try {
      await apiClient.approveResearchBrief(brief.id);
      refresh();
      drawer.close();
    } catch (err) {
      console.error('Failed to approve brief:', err);
    }
  };

  const handleExport = () => {
    if (!artifact) return;
    const blob = new Blob([artifact.content || ''], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${brief.title.replace(/\s+/g, '_')}_Research_Brief.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <DrawerShell
      title="Research Brief Review"
      subtitle={`Type: ${brief.requestType}`}
      onClose={drawer.close}
      onPin={drawer.pin}
      isPinned={drawer.isPinned}
      accentColor="var(--color-hermes)"
    >
      <div className="flex-col gap-4 p-4 h-full" style={{ overflowY: 'auto' }}>
        
        <div className="flex-row gap-2" style={{ marginBottom: 10 }}>
          <span className="nav-badge" style={{ padding: '4px 8px', fontSize: '0.75rem', background: 'var(--bg-base)' }}>
            Status: {brief.status}
          </span>
          <span className="nav-badge" style={{ padding: '4px 8px', fontSize: '0.75rem', background: 'var(--bg-base)' }}>
            Priority: {brief.priority}
          </span>
        </div>

        <div className="glass-panel p-4" style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-base)' }}>
          {artifact ? (
            <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {artifact.content}
            </div>
          ) : (
            <div className="flex-col items-center justify-center h-full text-muted gap-2">
              <RefreshCw size={24} className={brief.status === 'researching' || brief.status === 'drafting' ? 'spin' : ''} />
              <p>{brief.status === 'queued' ? 'Waiting for Hermes to start...' : 
                  brief.status === 'researching' ? 'Gathering intelligence...' :
                  brief.status === 'drafting' ? 'Drafting brief...' : 'No artifact available.'}</p>
            </div>
          )}
        </div>

        <div className="flex-row gap-3 pt-2" style={{ borderTop: '1px solid var(--border-subtle)', justifyContent: 'flex-end' }}>
          <button 
            className="btn btn-secondary flex-row gap-2"
            onClick={handleExport}
            disabled={!artifact}
          >
            <Download size={14} /> Export Markdown
          </button>
          
          {(brief.status === 'awaiting_review' || brief.status === 'drafting' || brief.status === 'researching') && (
            <button 
              className="btn btn-primary flex-row gap-2"
              onClick={handleApprove}
              disabled={brief.status !== 'awaiting_review'}
              style={{ background: 'var(--color-hermes)' }}
            >
              <Check size={14} /> Approve Brief
            </button>
          )}
        </div>

      </div>
    </DrawerShell>
  );
};

export default BriefReviewDrawer;
