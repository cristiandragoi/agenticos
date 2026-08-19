import React, { useEffect, useState } from 'react';
import { revenueClient } from '../../api/revenueClient';
import type { RevenueOpportunity } from '../../api/revenueClient';

const cardStyle: React.CSSProperties = {
  background: '#111318',
  color: 'white',
  border: '1px solid rgba(255,255,255,0.1)',
  padding: 12,
  marginBottom: 8,
  borderRadius: 6,
};

const btnStyle: React.CSSProperties = {
  marginRight: 8,
  padding: '4px 12px',
  cursor: 'pointer',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'transparent',
  color: 'white',
};

const fmtCurrency = (n?: number) =>
  n === undefined || n === null
    ? ''
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function ApprovalsInbox() {
  const [items, setItems] = useState<RevenueOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await revenueClient.getOpportunities({ approvalStatus: 'pending' });
      setItems(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (id: string) => {
    setStatus('');
    try {
      await revenueClient.approve(id);
      setStatus('Approved successfully');
      await load();
    } catch (e: any) {
      setStatus('Approve failed: ' + (e?.message || 'unknown error'));
    }
  };

  const reject = async (id: string) => {
    setStatus('');
    const reason = window.prompt('Reason for rejection:') || 'No reason provided';
    try {
      await revenueClient.reject(id, reason);
      setStatus('Rejected successfully');
      await load();
    } catch (e: any) {
      setStatus('Reject failed: ' + (e?.message || 'unknown error'));
    }
  };

  if (loading) return <div style={{ color: 'white' }}>Loading Approvals...</div>;
  if (error) return <div style={{ color: 'white' }}>{error}</div>;

  return (
    <div style={{ background: '#111318', color: 'white', minHeight: '100vh', padding: 16 }}>
      <h2>Approvals Inbox</h2>
      <p style={{ opacity: 0.7 }}>Opportunities awaiting your decision</p>
      {status && <p style={{ color: '#4caf50' }}>{status}</p>}
      {items.length === 0 && <p>No pending opportunities</p>}
      {items.map((o) => (
        <div key={o.id} style={cardStyle}>
          <div style={{ fontWeight: 600 }}>{o.title}</div>
          <div>Type: {o.opportunityType}</div>
          <div>Stage: {o.stage}</div>
          {o.overallScore !== undefined && <div>Score: {o.overallScore}</div>}
          {o.estimatedRevenue !== undefined && <div>Revenue: {fmtCurrency(o.estimatedRevenue)}</div>}
          <div>Created: {new Date(o.createdAt).toLocaleString()}</div>
          <div style={{ marginTop: 8 }}>
            <button style={btnStyle} onClick={() => approve(o.id)}>Approve</button>
            <button style={btnStyle} onClick={() => reject(o.id)}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}
