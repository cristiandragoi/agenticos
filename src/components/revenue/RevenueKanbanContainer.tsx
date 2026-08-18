import React, { useEffect, useState } from 'react';
import { revenueClient, type RevenueOpportunity } from '../../api/revenueClient';
import OpportunityModal from './OpportunityModal';

export default function RevenueKanbanContainer() {
  const [opportunities, setOpportunities] = useState<RevenueOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOpp, setSelectedOpp] = useState<RevenueOpportunity | null>(null);

  const STAGES = [
    'discovered', 'researching', 'scored', 'awaiting_approval', 
    'approved', 'in_production', 'published', 'measuring', 'rejected', 'archived'
  ];

  useEffect(() => {
    fetchOpps();
  }, []);

  const fetchOpps = async () => {
    try {
      setLoading(true);
      const data = await revenueClient.getOpportunities();
      setOpportunities(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = (updated: RevenueOpportunity) => {
    setOpportunities(prev => prev.map(o => o.id === updated.id ? updated : o));
  };

  if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16, overflowX: 'auto', paddingBottom: 16 }}>
      {STAGES.map(stage => {
        const oppsInStage = opportunities.filter(o => o.stage === stage);
        return (
          <div key={stage} style={{ 
            minWidth: 300, 
            background: 'var(--bg-glass)', 
            border: '1px solid var(--border-subtle)', 
            borderRadius: 8, 
            display: 'flex', 
            flexDirection: 'column' 
          }}>
            <div style={{ 
              padding: '12px 16px', 
              borderBottom: '1px solid var(--border-subtle)', 
              fontWeight: 'bold', 
              textTransform: 'capitalize',
              display: 'flex',
              justifyContent: 'space-between'
            }}>
              {stage.replace('_', ' ')}
              <span style={{ background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 12, fontSize: '0.8em' }}>
                {oppsInStage.length}
              </span>
            </div>
            
            <div style={{ padding: 12, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loading && oppsInStage.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Loading...</div>
              ) : oppsInStage.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>No opportunities</div>
              ) : (
                oppsInStage.map(opp => (
                  <div 
                    key={opp.id} 
                    onClick={() => setSelectedOpp(opp)}
                    style={{ 
                      background: 'var(--bg-elevated)', 
                      border: '1px solid var(--border-subtle)', 
                      padding: 12, 
                      borderRadius: 6, 
                      cursor: 'pointer',
                      borderLeft: opp.approvalStatus === 'pending' ? '3px solid #f59e0b' : 
                                  opp.approvalStatus === 'approved' ? '3px solid #10b981' : 
                                  opp.approvalStatus === 'rejected' ? '3px solid #ef4444' : '1px solid var(--border-subtle)'
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{opp.title}</div>
                    
                    {/* Metrics and Indicators */}
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: 8 }}>
                      <span title="Score">🏅 {opp.overallScore !== null ? opp.overallScore : 'N/A'}</span>
                      <span title="Est Revenue">💵 ${opp.estimatedRevenue || 0}</span>
                      
                      {(() => {
                        let evCount = 0;
                        if (opp.evidencePayload) {
                          try { evCount = JSON.parse(opp.evidencePayload).length; } catch(e){}
                        }
                        return <span title="Evidence Count">📎 {evCount}</span>;
                      })()}

                      {opp.scoringConfidence && (
                        <span title="Confidence" style={{ 
                          color: opp.scoringConfidence === 'high' ? '#10b981' : 
                                 opp.scoringConfidence === 'low' ? '#ef4444' : '#f59e0b' 
                        }}>
                          🎯 {opp.scoringConfidence}
                        </span>
                      )}

                      {opp.researchPayload && JSON.parse(opp.researchPayload).missingInformation?.length > 0 && (
                        <span title="Missing Info" style={{ color: '#ef4444' }}>⚠️ Missing Info</span>
                      )}
                    </div>

                    {/* Quick Actions */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }} onClick={e => e.stopPropagation()}>
                      {['discovered', 'researching'].includes(opp.stage) && (
                        <button 
                          className="btn" 
                          style={{ fontSize: '10px', padding: '2px 6px' }}
                          onClick={async () => {
                            try {
                              const updated = await revenueClient.scoreOpportunity(opp.id);
                              handleUpdate(updated);
                            } catch (e: any) { alert(e.message); }
                          }}
                        >
                          Score
                        </button>
                      )}
                      {opp.stage === 'scored' && (
                        <button 
                          className="btn btn-primary" 
                          style={{ fontSize: '10px', padding: '2px 6px' }}
                          onClick={async () => {
                            try {
                              const updated = await revenueClient.requestApproval(opp.id);
                              handleUpdate(updated);
                            } catch (e: any) { alert(e.message); }
                          }}
                        >
                          Request Approval
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}

      {selectedOpp && (
        <OpportunityModal 
          opportunity={selectedOpp} 
          onClose={() => setSelectedOpp(null)} 
          onUpdate={handleUpdate} 
        />
      )}
    </div>
  );
}
