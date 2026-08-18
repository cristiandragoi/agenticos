import React, { useState } from 'react';
import { apiClient } from '../../api/client';
import { useData } from '../../store/dataStore';
import { Briefcase, Send } from 'lucide-react';

interface ClientIntakeFormProps {
  onSuccess: (runId: string) => void;
  onCancel: () => void;
}

const ClientIntakeForm: React.FC<ClientIntakeFormProps> = ({ onSuccess, onCancel }) => {
  const { refresh } = useData();
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [company, setCompany] = useState('');
  const [requestType, setRequestType] = useState('competitor');
  const [budget, setBudget] = useState('');
  const [goal, setGoal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const data = { customerName, customerEmail, company, requestType, budget, goal };
      const res = await apiClient.createLead(data);
      if (res.success) {
        refresh();
        onSuccess(res.runId);
      }
    } catch (err) {
      console.error('Failed to submit lead:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-panel p-6" style={{ width: '100%', maxWidth: '600px', margin: '0 auto', background: 'var(--bg-base)' }}>
      <div className="flex-row items-center gap-3 mb-6">
        <div className="avatar-box" style={{ background: 'var(--color-hermes)', color: '#000' }}>
          <Briefcase size={20} />
        </div>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Simulate Client Intake</h2>
          <p className="text-muted text-sm">Creates a new service lead in the pipeline</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-col gap-4">
        
        <div className="flex-row gap-4">
          <div className="flex-col gap-1" style={{ flex: 1 }}>
            <label className="text-sm font-medium">Customer Name</label>
            <input type="text" required value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. Jane Doe" className="input-field" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
          </div>
          <div className="flex-col gap-1" style={{ flex: 1 }}>
            <label className="text-sm font-medium">Customer Email</label>
            <input type="email" required value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="e.g. jane@example.com" className="input-field" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
          </div>
        </div>

        <div className="flex-row gap-4">
          <div className="flex-col gap-1" style={{ flex: 1 }}>
            <label className="text-sm font-medium">Company</label>
            <input type="text" required value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Acme Corp" className="input-field" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
          </div>
          <div className="flex-col gap-1" style={{ flex: 1 }}>
            <label className="text-sm font-medium">Service Type</label>
            <select value={requestType} onChange={e => setRequestType(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
              <option value="competitor">Competitor Research</option>
              <option value="company">Company Deep Dive</option>
              <option value="market">Market Analysis</option>
            </select>
          </div>
        </div>

        <div className="flex-col gap-1">
          <label className="text-sm font-medium">Estimated Budget</label>
          <input type="text" required value={budget} onChange={e => setBudget(e.target.value)} placeholder="e.g. $2,000" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
          <span className="text-xs text-muted">Hermes will reject leads below $500.</span>
        </div>

        <div className="flex-col gap-1">
          <label className="text-sm font-medium">Research Goal</label>
          <textarea required value={goal} onChange={e => setGoal(e.target.value)} placeholder="What do you need us to find?" rows={3} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', resize: 'vertical' }} />
        </div>

        <div className="flex-row gap-3 mt-4" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-row gap-2" style={{ background: 'var(--color-hermes)' }}>
            <Send size={16} />
            {isSubmitting ? 'Submitting...' : 'Submit Lead'}
          </button>
        </div>

      </form>
    </div>
  );
};

export default ClientIntakeForm;
