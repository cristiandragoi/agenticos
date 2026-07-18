import React, { useEffect, useState } from 'react';
import { obsidianAdapter } from '../../api/obsidianAdapter';
import { RefreshCw, Database, AlertTriangle } from 'lucide-react';

const MemorySyncWidget: React.FC = () => {
  const [pendingCount, setPendingCount] = useState(obsidianAdapter.getPendingCount());
  const [failedCount, setFailedCount] = useState(obsidianAdapter.getFailedCount());
  const [lastSynced, setLastSynced] = useState(obsidianAdapter.getLastSyncedTime());
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setPendingCount(obsidianAdapter.getPendingCount());
      setFailedCount(obsidianAdapter.getFailedCount());
      setLastSynced(obsidianAdapter.getLastSyncedTime());
      setIsSyncing(false);
    };

    obsidianAdapter.subscribe(handleUpdate);
    return () => { /* no-op */ };
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    await obsidianAdapter.syncNow();
    setIsSyncing(false);
  };

  const handleRetry = async () => {
    setIsSyncing(true);
    await obsidianAdapter.retryFailed();
    setIsSyncing(false);
  };

  const statusColor = failedCount > 0 ? 'var(--color-error)' : (pendingCount > 0 ? 'var(--color-warning)' : 'var(--text-tertiary)');

  return (
    <div className="flex-row gap-2 text-xs align-center" style={{ 
      background: 'var(--bg-elevated)', 
      padding: '4px 8px', 
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-subtle)'
    }}>
      <Database size={14} color={statusColor} />
      
      <span className="text-secondary font-mono">
        {pendingCount} pending
      </span>
      
      {failedCount > 0 && (
        <span className="text-error font-mono flex-row align-center gap-1" style={{ marginLeft: 4 }}>
          <AlertTriangle size={12} /> {failedCount} failed
        </span>
      )}

      {lastSynced && pendingCount === 0 && failedCount === 0 && (
        <span className="text-dim text-xxs" style={{ marginLeft: 4 }}>
          (Last: {new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
        </span>
      )}

      <div className="flex-row gap-1 ml-1">
        <button 
          className="quick-action-btn" 
          onClick={handleSync} 
          disabled={isSyncing || pendingCount === 0}
          title="Sync to Obsidian Vault Now"
        >
          <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
        </button>

        {failedCount > 0 && (
          <button 
            className="quick-action-btn" 
            onClick={handleRetry} 
            disabled={isSyncing}
            title="Retry Failed Sync Jobs"
            style={{ color: 'var(--color-error)' }}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

export default MemorySyncWidget;
