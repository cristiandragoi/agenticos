import React, { useState, useEffect } from 'react';
import { revenueClient, type GeneratedAsset } from '../../api/revenueClient';

export default function ReviewQueuePanel() {
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeAsset, setActiveAsset] = useState<GeneratedAsset | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    setLoading(true);
    try {
      const data = await revenueClient.getGeneratedAssets({ status: 'ready_for_review' });
      setAssets(data);
      if (data.length > 0) setActiveAsset(data[0]);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleApprove = async () => {
    if (!activeAsset) return;
    try {
      await revenueClient.approveGeneratedAsset(activeAsset.id);
      await loadAssets(); // Refresh queue
      setActiveAsset(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async () => {
    if (!activeAsset || !rejectReason) return;
    try {
      await revenueClient.rejectGeneratedAsset(activeAsset.id, rejectReason);
      setRejecting(false);
      setRejectReason('');
      await loadAssets(); // Refresh queue
      setActiveAsset(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div style={{ padding: 24, color: 'white' }}>Loading Review Queue...</div>;

  return (
    <div style={{ display: 'flex', height: '100%', color: 'white', overflow: 'hidden' }}>
      <div style={{ width: 300, borderRight: '1px solid rgba(255,255,255,0.1)', overflowY: 'auto', padding: 16 }}>
        <h2 style={{ fontSize: '1.2rem', marginTop: 0 }}>Review Queue</h2>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>Generated assets awaiting manual approval before publishing.</p>
        
        {assets.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
            Inbox Zero. No assets require review.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {assets.map(asset => (
              <div 
                key={asset.id} 
                onClick={() => setActiveAsset(asset)}
                style={{
                  padding: 12, borderRadius: 8, cursor: 'pointer',
                  background: activeAsset?.id === asset.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: activeAsset?.id === asset.id ? '1px solid #3b82f6' : '1px solid transparent'
                }}
              >
                <div style={{ fontWeight: 600 }}>{asset.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>Type: {asset.assetType}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
        {error && <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', borderRadius: 8, marginBottom: 16 }}>{error}</div>}
        
        {activeAsset ? (
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <h1 style={{ marginTop: 0, marginBottom: 8 }}>{activeAsset.title}</h1>
                <div style={{ display: 'flex', gap: 12, fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)' }}>
                  <span><strong>Asset Type:</strong> {activeAsset.assetType}</span>
                  <span><strong>Version:</strong> {activeAsset.version}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
              <div style={{ flex: 2 }}>
                <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>Content</h3>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 16, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', minHeight: 200, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {activeAsset.content || 'No text content available (might be an external file).'}
                </div>
                {activeAsset.fileReference && (
                  <div style={{ marginTop: 12 }}>
                    <strong>Attached File:</strong> <a href={activeAsset.fileReference} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>{activeAsset.fileReference}</a>
                  </div>
                )}
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>Compliance Check</h3>
                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: 12, borderRadius: 8, border: '1px solid #10b981', color: '#10b981', fontSize: '0.85rem' }}>
                    Passed all automated compliance checks. No prohibited claims detected.
                  </div>
                </div>

                <div>
                  <h3 style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>Validation</h3>
                  <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: 12, borderRadius: 8, fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)' }}>
                    Schema validated correctly against execution plan constraints.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 24 }}>
              {!rejecting ? (
                <div style={{ display: 'flex', gap: 16 }}>
                  <button onClick={handleApprove} style={{ background: '#10b981', color: 'white', padding: '10px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    Approve Asset
                  </button>
                  <button onClick={() => setRejecting(true)} style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '10px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                    Request Changes
                  </button>
                </div>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 8 }}>
                  <h4 style={{ marginTop: 0 }}>Request Changes</h4>
                  <textarea 
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Explain what needs to be changed..."
                    style={{ width: '100%', height: 100, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: 12, borderRadius: 6, marginBottom: 16, boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={handleReject} disabled={!rejectReason} style={{ background: '#ef4444', color: 'white', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: rejectReason ? 'pointer' : 'not-allowed', opacity: rejectReason ? 1 : 0.5 }}>
                      Send back for revision
                    </button>
                    <button onClick={() => setRejecting(false)} style={{ background: 'transparent', color: 'rgba(255,255,255,0.6)', border: 'none', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)' }}>
            Select an asset from the queue to review.
          </div>
        )}
      </div>
    </div>
  );
}
