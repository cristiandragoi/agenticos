import React, { useState } from 'react';
import { useData } from '../../store/dataStore';
import { Briefcase, CreditCard, Download, FileText, CheckCircle } from 'lucide-react';
import { apiClient } from '../../api/client';

const LeadReviewDrawer: React.FC<{ entityId: string }> = ({ entityId }) => {
  const { leads, artifacts, refresh } = useData();
  const [isProcessing, setIsProcessing] = useState(false);

  const lead = leads.find(l => l.id === entityId);
  if (!lead) return <div className="p-6 text-muted">Lead not found.</div>;

  const proposal = lead.proposalArtifactId ? artifacts.find(a => a.id === lead.proposalArtifactId) : null;

  const handleSimulatePayment = async () => {
    setIsProcessing(true);
    try {
      await apiClient.payLead(lead.id);
      refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-col h-full bg-base">
      <div className="p-4 border-b border-subtle flex-row gap-3 items-center">
        <div className="avatar-box" style={{ background: 'var(--color-hermes)', color: '#000' }}>
          <Briefcase size={20} />
        </div>
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{lead.company}</h2>
          <div className="flex-row gap-2 items-center text-xs text-muted">
            <span className="badge" style={{ background: 'var(--bg-elevated)' }}>{lead.status.toUpperCase()}</span>
            <span>{lead.customerName}</span>
          </div>
        </div>
      </div>

      <div className="p-4 flex-col gap-6 overflow-y-auto" style={{ flex: 1 }}>
        <div className="flex-col gap-2">
          <h3 className="text-sm font-semibold">Lead Details</h3>
          <div className="bg-elevated p-3 rounded text-sm" style={{ border: '1px solid var(--border-subtle)' }}>
            <p><strong>Customer:</strong> {lead.customerName} ({lead.customerEmail})</p>
            <p><strong>Service:</strong> {lead.requestType}</p>
            <p><strong>Budget:</strong> {lead.budget}</p>
            <p><strong>Goal:</strong> {lead.goal}</p>
          </div>
        </div>

        {proposal && (
          <div className="flex-col gap-2">
            <h3 className="text-sm font-semibold">Proposal Artifact</h3>
            <pre className="bg-elevated p-4 rounded text-sm" style={{ border: '1px solid var(--border-subtle)', background: '#111', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {proposal.content || ''}
            </pre>
            <div className="flex-row gap-2 mt-2">
              <button className="btn btn-secondary flex-row gap-2 text-xs" onClick={() => handleExport(proposal.content || '', `Proposal_${lead.company}.md`)}>
                <Download size={14} /> Download Proposal
              </button>
            </div>
          </div>
        )}

        {lead.status === 'offered' && (
          <div className="flex-col gap-2 p-4 rounded" style={{ background: 'rgba(76, 175, 80, 0.1)', border: '1px solid rgba(76, 175, 80, 0.3)' }}>
            <h3 className="text-sm font-semibold flex-row gap-2 items-center text-success">
              <CreditCard size={16} /> Payment Pending
            </h3>
            <p className="text-xs text-muted mb-2">The proposal has been sent to the client. Waiting for invoice to be paid.</p>
            <button 
              className="btn flex-row gap-2 justify-center" 
              style={{ background: 'var(--color-success)', color: '#000', width: '100%' }}
              onClick={handleSimulatePayment}
              disabled={isProcessing}
            >
              <CheckCircle size={16} /> {isProcessing ? 'Processing...' : 'Simulate Client Payment'}
            </button>
          </div>
        )}

        {lead.status === 'in_progress' && (
          <div className="flex-col gap-2 p-4 rounded" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="text-sm font-semibold flex-row gap-2 items-center">
              <FileText size={16} /> Research In Progress
            </h3>
            <p className="text-xs text-muted">Hermes is currently executing the research workflow. You can monitor the progress on the Runs board.</p>
          </div>
        )}

        {/* If there is a final brief delivered or completed we could show it here */}
      </div>
    </div>
  );
};

export default LeadReviewDrawer;
