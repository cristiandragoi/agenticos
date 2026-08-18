import React, { useState, useEffect } from 'react';
import { revenueClient, type RevenueOpportunity, type OpportunityScoreResult, type OpportunityEvidence } from '../../api/revenueClient';
import ProductionBriefModal from './ProductionBriefModal';

interface Props {
  opportunity: RevenueOpportunity;
  onClose: () => void;
  onUpdate: (updated: RevenueOpportunity) => void;
}

export default function OpportunityModal({ opportunity, onClose, onUpdate }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [showBriefModal, setShowBriefModal] = useState(false);

  useEffect(() => {
    revenueClient.getEvents(opportunity.id)
      .then(setEvents)
      .catch(e => console.error("Failed to load events", e));
  }, [opportunity.id]);

  const handleApprove = async () => {
    try {
      const updated = await revenueClient.approve(opportunity.id);
      onUpdate(updated);
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async () => {
    if (!reason) {
      setError('A rejection reason is required.');
      return;
    }
    try {
      const updated = await revenueClient.reject(opportunity.id, reason);
      onUpdate(updated);
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  let scoreDetails: OpportunityScoreResult | null = null;
  if (opportunity.researchPayload) {
    try { scoreDetails = JSON.parse(opportunity.researchPayload); } catch (e) {}
  }

  let evidenceList: OpportunityEvidence[] = [];
  if (opportunity.evidencePayload) {
    try { evidenceList = JSON.parse(opportunity.evidencePayload); } catch (e) {}
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        background: 'var(--bg-glass)', border: '1px solid var(--border-subtle)', borderRadius: 12,
        padding: 32, width: 800, maxWidth: '90%', color: 'var(--text-primary)', maxHeight: '90vh', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ marginTop: 0 }}>{opportunity.title}</h2>
            <p style={{ color: 'var(--text-secondary)' }}>{opportunity.description}</p>
          </div>
          <span style={{ padding: '4px 12px', background: 'var(--bg-elevated)', borderRadius: 16, border: '1px solid var(--border-subtle)', textTransform: 'capitalize' }}>
            {opportunity.stage.replace('_', ' ')}
          </span>
        </div>
        
        {/* 1. Overview */}
        <h3 style={{ borderBottom: '1px solid #333', paddingBottom: 8 }}>Overview</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div><strong>Type:</strong> {opportunity.opportunityType}</div>
          <div><strong>Source:</strong> {opportunity.sourcePlatform}</div>
          <div><strong>URL:</strong> {opportunity.sourceUrl ? <a href={opportunity.sourceUrl} target="_blank" rel="noreferrer">Link</a> : 'N/A'}</div>
          <div><strong>Est. Revenue:</strong> ${opportunity.estimatedRevenue}</div>
          <div><strong>Est. Cost:</strong> ${opportunity.estimatedCost}</div>
          <div><strong>Status:</strong> {opportunity.approvalStatus}</div>
        </div>

        {/* 2. Scores */}
        <h3 style={{ borderBottom: '1px solid #333', paddingBottom: 8 }}>Scoring & Confidence</h3>
        {scoreDetails ? (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div><strong>Overall:</strong> {scoreDetails.overallScore}/100</div>
              <div><strong>Confidence:</strong> {scoreDetails.confidence}</div>
              <div><strong>Demand:</strong> {scoreDetails.demandScore}/100</div>
              <div><strong>Competition:</strong> {scoreDetails.competitionScore}/100</div>
              <div><strong>Profitability:</strong> {scoreDetails.profitabilityScore}/100</div>
              <div><strong>Ev. Quality:</strong> {scoreDetails.evidenceQualityScore}/100</div>
              <div><strong>Compliance Risk:</strong> {scoreDetails.complianceRiskScore}/100</div>
              <div><strong>Version:</strong> v{scoreDetails.scoringVersion}</div>
            </div>
            {scoreDetails.reasons?.length > 0 && (
              <div>
                <strong>Scoring Reasons:</strong>
                <ul style={{ color: 'var(--text-secondary)', margin: '8px 0 0 20px', padding: 0 }}>
                  {scoreDetails.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>Not scored yet.</div>
        )}

        <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
          {/* 4. Assumptions */}
          <div style={{ flex: 1 }}>
            <h3 style={{ borderBottom: '1px solid #333', paddingBottom: 8 }}>Assumptions</h3>
            {scoreDetails?.assumptions && scoreDetails.assumptions.length > 0 ? (
              <ul style={{ color: 'var(--text-secondary)', paddingLeft: 20 }}>
                {scoreDetails.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            ) : <div style={{ color: '#888' }}>None recorded.</div>}
          </div>

          {/* 5. Missing Info */}
          <div style={{ flex: 1 }}>
            <h3 style={{ borderBottom: '1px solid #333', paddingBottom: 8, color: '#ef4444' }}>Missing Information</h3>
            {scoreDetails?.missingInformation && scoreDetails.missingInformation.length > 0 ? (
              <ul style={{ color: '#ef4444', paddingLeft: 20 }}>
                {scoreDetails.missingInformation.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            ) : <div style={{ color: '#888' }}>None missing.</div>}
          </div>
        </div>

        {/* 3. Evidence */}
        <h3 style={{ borderBottom: '1px solid #333', paddingBottom: 8 }}>Evidence ({evidenceList.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {evidenceList.length === 0 ? <div style={{ color: '#888' }}>No evidence.</div> : evidenceList.map(ev => (
            <div key={ev.id} style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 6, border: '1px solid #333' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{ev.title}</strong>
                <span style={{ fontSize: 12, color: ev.reliability === 'verified' ? '#10b981' : '#f59e0b' }}>
                  {ev.reliability}
                </span>
              </div>
              <p style={{ color: 'var(--text-secondary)', margin: '0 0 8px 0', fontSize: 13 }}>{ev.summary}</p>
              <div style={{ fontSize: 11, color: '#666', display: 'flex', gap: 16 }}>
                <span>Type: {ev.type}</span>
                {ev.sourcePlatform && <span>Source: {ev.sourcePlatform}</span>}
                <span>Captured: {new Date(ev.capturedAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 6. Event History */}
        <h3 style={{ borderBottom: '1px solid #333', paddingBottom: 8 }}>Event History</h3>
        <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 24, fontSize: 13, color: 'var(--text-secondary)' }}>
          {events.length === 0 ? <div>No events found.</div> : events.map(evt => (
            <div key={evt.id} style={{ padding: '4px 0', borderBottom: '1px solid #222' }}>
              <span style={{ color: '#888', marginRight: 12 }}>{new Date(evt.createdAt).toLocaleString()}</span>
              <strong>{evt.eventType}</strong> 
              {evt.previousStage && evt.nextStage && <span> ({evt.previousStage} ➔ {evt.nextStage})</span>}
            </div>
          ))}
        </div>

        {/* 7. Approval Actions */}
        {error && <div style={{ color: 'red', marginBottom: 16 }}>{error}</div>}
        {opportunity.stage === 'awaiting_approval' && (
          <div style={{ paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
            <h3>Manual Review Required</h3>
            {!rejecting ? (
              <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
                <button onClick={handleApprove} style={{ background: '#10b981', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
                  Approve Opportunity
                </button>
                <button onClick={() => setRejecting(true)} style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' }}>
                  Reject
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <textarea 
                  value={reason} 
                  onChange={e => setReason(e.target.value)}
                  placeholder="Reason for rejection..."
                  style={{ width: '100%', height: 80, padding: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-subtle)', color: 'white', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 16 }}>
                  <button onClick={handleReject} style={{ background: '#ef4444', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
                    Confirm Rejection
                  </button>
                  <button onClick={() => setRejecting(false)} style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

          {opportunity.stage === 'approved' && (
            <div style={{ paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
              <h3>Production Planning</h3>
              <p style={{ color: 'var(--text-secondary)' }}>This opportunity has been approved. You can now define a brief and execute.</p>
              <button onClick={() => setShowBriefModal(true)} style={{ background: '#3b82f6', color: 'white', padding: '8px 16px', borderRadius: 4, border: 'none', cursor: 'pointer', marginTop: 8 }}>
                Manage Production Brief
              </button>
            </div>
          )}

        <div style={{ marginTop: 24, textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: 'var(--bg-elevated)', color: 'white', padding: '8px 16px', borderRadius: 4, border: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
      
      {showBriefModal && (
        <ProductionBriefModal 
          opportunityId={opportunity.id} 
          onClose={() => setShowBriefModal(false)} 
        />
      )}
    </div>
  );
}
