import React, { useState } from 'react';
import { apiClient } from '../../api/client';
import { useData } from '../../store/dataStore';
import { FileText, Send } from 'lucide-react';

interface ResearchBriefFormProps {
  onSuccess: (runId: string) => void;
  onCancel: () => void;
}

const ResearchBriefForm: React.FC<ResearchBriefFormProps> = ({ onSuccess, onCancel }) => {
  const { refresh } = useData();
  const [title, setTitle] = useState('');
  const [requestType, setRequestType] = useState('competitor');
  const [target, setTarget] = useState('');
  const [goal, setGoal] = useState('');
  const [competitors, setCompetitors] = useState('');
  const [priority, setPriority] = useState('medium');
  const [outputFormat] = useState('markdown');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const data = {
        title,
        requestType,
        target,
        goal,
        competitors: competitors.split(',').map(s => s.trim()).filter(Boolean),
        priority,
        outputFormat
      };
      
      const res = await apiClient.createResearchBrief(data);
      if (res.success) {
        refresh();
        onSuccess(res.brief.id);
      }
    } catch (err) {
      console.error('Failed to submit research brief:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-panel p-6" style={{ width: '100%', maxWidth: '600px', margin: '0 auto', background: 'var(--bg-base)' }}>
      <div className="flex-row items-center gap-3 mb-6">
        <div className="avatar-box" style={{ background: 'var(--color-hermes)', color: '#000' }}>
          <FileText size={20} />
        </div>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>New Research Brief</h2>
          <p className="text-muted text-sm">Powered by Hermes Execution</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-col gap-4">
        
        <div className="flex-col gap-1">
          <label className="text-sm font-medium">Brief Title</label>
          <input 
            type="text" 
            required 
            value={title} 
            onChange={e => setTitle(e.target.value)} 
            placeholder="e.g. Q3 AI Market Analysis"
            className="input-field"
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="flex-row gap-4">
          <div className="flex-col gap-1" style={{ flex: 1 }}>
            <label className="text-sm font-medium">Request Type</label>
            <select 
              value={requestType} 
              onChange={e => setRequestType(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            >
              <option value="competitor">Competitor Research</option>
              <option value="company">Company Snapshot</option>
              <option value="market">Market Landscape</option>
              <option value="prospect">Prospect Intelligence</option>
            </select>
          </div>
          
          <div className="flex-col gap-1" style={{ flex: 1 }}>
            <label className="text-sm font-medium">Priority</label>
            <select 
              value={priority} 
              onChange={e => setPriority(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="flex-col gap-1">
          <label className="text-sm font-medium">Target Company/Topic</label>
          <input 
            type="text" 
            required 
            value={target} 
            onChange={e => setTarget(e.target.value)} 
            placeholder="e.g. Acme Corp or Enterprise AI Agents"
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="flex-col gap-1">
          <label className="text-sm font-medium">Goal / Core Question</label>
          <textarea 
            required 
            value={goal} 
            onChange={e => setGoal(e.target.value)} 
            placeholder="What specific information are you trying to find?"
            rows={3}
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', resize: 'vertical' }}
          />
        </div>

        <div className="flex-col gap-1">
          <label className="text-sm font-medium">Competitors (Comma separated, optional)</label>
          <input 
            type="text" 
            value={competitors} 
            onChange={e => setCompetitors(e.target.value)} 
            placeholder="e.g. Globex, Initech"
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="flex-row gap-3 mt-4" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary flex-row gap-2" style={{ background: 'var(--color-hermes)' }}>
            <Send size={16} />
            {isSubmitting ? 'Submitting...' : 'Run Hermes Workflow'}
          </button>
        </div>

      </form>
    </div>
  );
};

export default ResearchBriefForm;
