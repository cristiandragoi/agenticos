import React, { useState } from 'react';
import { revenueClient, type OpportunityEvidence, type RevenueOpportunity } from '../../api/revenueClient';
import { createPortal } from 'react-dom';

interface Props {
  sourceFinding: any;
  onClose: () => void;
  onSuccess: (opportunity: RevenueOpportunity) => void;
}

const RevenueOpportunityDraftModal: React.FC<Props> = ({ sourceFinding, onClose, onSuccess }) => {
  const [title, setTitle] = useState(sourceFinding.title || '');
  const [description, setDescription] = useState(sourceFinding.content || '');
  const [opportunityType, setOpportunityType] = useState('digital_product');
  const [sourcePlatform, setSourcePlatform] = useState('web');
  const [sourceUrl, setSourceUrl] = useState('');
  const [estimatedRevenue, setEstimatedRevenue] = useState<number | ''>('');
  const [estimatedCost, setEstimatedCost] = useState<number | ''>('');

  const [checking, setChecking] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{ duplicate: boolean; opportunity?: RevenueOpportunity } | null>(null);

  const handleCheckAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !opportunityType) return;

    setChecking(true);
    try {
      const check = await revenueClient.checkDuplicate(sourceUrl || undefined, title, sourcePlatform);
      if (check.duplicate && check.opportunity) {
        setDuplicateWarning(check);
      } else {
        await submitDraft();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  const submitDraft = async () => {
    try {
      const evidence: OpportunityEvidence = {
        id: crypto.randomUUID(),
        type: 'manual_note',
        title: title,
        sourcePlatform,
        sourceUrl,
        capturedAt: new Date().toISOString(),
        summary: description,
        reliability: 'estimated'
      };

      const opp = await revenueClient.createOpportunity({
        title,
        description,
        opportunityType,
        sourcePlatform,
        sourceUrl,
        estimatedRevenue: Number(estimatedRevenue) || 0,
        estimatedCost: Number(estimatedCost) || 0,
        evidencePayload: JSON.stringify([evidence])
      });
      onSuccess(opp);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAppendEvidence = async () => {
    if (!duplicateWarning?.opportunity) return;
    try {
      const evidence: OpportunityEvidence = {
        id: crypto.randomUUID(),
        type: 'manual_note',
        title: title,
        sourcePlatform,
        sourceUrl,
        capturedAt: new Date().toISOString(),
        summary: description,
        reliability: 'estimated'
      };
      const updated = await revenueClient.appendEvidence(duplicateWarning.opportunity.id, evidence);
      onSuccess(updated);
    } catch (err) {
      console.error(err);
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#1a1a1f', padding: '24px', borderRadius: '12px', width: '600px', border: '1px solid #333'
      }}>
        <h2 style={{ marginTop: 0 }}>Create Revenue Opportunity</h2>
        <p style={{ color: '#888' }}>Convert this research finding into a tracked opportunity.</p>

        {duplicateWarning ? (
          <div style={{ background: '#3a2a1a', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #7a5a2a' }}>
            <h3 style={{ color: '#ffb84d', marginTop: 0 }}>Possible Duplicate Detected</h3>
            <p style={{ color: '#eee' }}>An opportunity matching this URL or title already exists:</p>
            <div style={{ background: '#000', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
              <strong>{duplicateWarning.opportunity?.title}</strong>
              <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>Stage: {duplicateWarning.opportunity?.stage}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn" onClick={() => setDuplicateWarning(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAppendEvidence}>Append Evidence to Existing</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCheckAndSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label>Title</label>
                <input required className="input" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Opportunity Type</label>
                <select className="input" value={opportunityType} onChange={e => setOpportunityType(e.target.value)}>
                  <option value="digital_product">Digital Product</option>
                  <option value="newsletter_sponsorship">Newsletter Sponsorship</option>
                  <option value="affiliate_campaign">Affiliate Campaign</option>
                  <option value="ecommerce">E-Commerce</option>
                </select>
              </div>
            </div>

            <div>
              <label>Description & Evidence Summary</label>
              <textarea className="input" rows={4} value={description} onChange={e => setDescription(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label>Source Platform</label>
                <input className="input" value={sourcePlatform} onChange={e => setSourcePlatform(e.target.value)} />
              </div>
              <div style={{ flex: 2 }}>
                <label>Source URL</label>
                <input className="input" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <label>Est. Revenue</label>
                <input type="number" className="input" value={estimatedRevenue} onChange={e => setEstimatedRevenue(Number(e.target.value))} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Est. Cost</label>
                <input type="number" className="input" value={estimatedCost} onChange={e => setEstimatedCost(Number(e.target.value))} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={checking}>
                {checking ? 'Checking...' : 'Save Draft'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
};

export default RevenueOpportunityDraftModal;
