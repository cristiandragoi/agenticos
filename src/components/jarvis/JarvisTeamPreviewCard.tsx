import React, { useState, useEffect } from 'react';
import { Users, Play, X, Activity, MapPin, Target } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';
import { apiClient } from '../../api/client';

interface JarvisTeamPreviewCardProps {
  conversationId: string;
  teamId: string;
  teamSheet: any;
  onRunStarted?: (runId: string) => void;
}

export const JarvisTeamPreviewCard: React.FC<JarvisTeamPreviewCardProps> = ({ 
  conversationId, 
  teamId, 
  teamSheet,
  onRunStarted
}) => {
  const [isStarting, setIsStarting] = useState(false);
  const [teamStatus, setTeamStatus] = useState<string>('awaiting_approval');

  useEffect(() => {
    // Fetch real status on mount
    apiClient.get(`/api/teams/${teamId}`).then(res => {
      if (res && res.status) {
        setTeamStatus(res.status);
      }
    }).catch(console.error);
  }, [teamId]);

  const handleApproveAndRun = async () => {
    if (isStarting || teamStatus !== 'awaiting_approval') return;
    setIsStarting(true);
    try {
      const res = await apiClient.post(`/api/jarvis/conversations/${conversationId}/approve_team`, { teamId });
      setTeamStatus('approved');
      if (res.runId && onRunStarted) {
        onRunStarted(res.runId);
      }
    } catch (err) {
      console.error('Failed to start team:', err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancel = async () => {
    if (teamStatus !== 'awaiting_approval') return;
    try {
      await apiClient.post(`/api/jarvis/conversations/${conversationId}/cancel_team`, { teamId });
      setTeamStatus('cancelled');
    } catch (err) {
      console.error('Failed to cancel team:', err);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.02)',
      marginTop: '12px',
      marginBottom: '12px',
      overflow: 'hidden',
      width: '100%'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'rgba(56, 189, 248, 0.05)'
      }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--color-jarvis)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Users size={16} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{teamSheet?.teamName || 'Agent Team'}</h3>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Proposed Architecture</p>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Objective & Workspace */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <Target size={14} style={{ color: 'var(--color-jarvis)', marginTop: '2px' }} />
            <div style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
              <strong>Objective:</strong> {teamSheet?.objective}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MapPin size={14} style={{ color: 'var(--text-tertiary)' }} />
            <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {teamSheet?.workspaceRoot}
            </div>
          </div>
        </div>

        {/* Agents Breakdown */}
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Team Members</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {teamSheet?.agents?.map((agent: any) => (
              <div key={agent.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Activity size={14} style={{ color: agent.role === 'Planner' ? 'var(--color-purple)' : agent.role === 'Verifier' ? 'var(--color-success)' : 'var(--color-jarvis)' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>{agent.name}</span>
                </div>
                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
                  {agent.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Acceptance Criteria */}
        <div>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>Acceptance Criteria</h4>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {teamSheet?.acceptanceCriteria?.map((crit: string, i: number) => (
              <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{crit}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
        {teamStatus === 'cancelled' && <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginRight: 'auto' }}>Cancelled</span>}
        {teamStatus === 'approved' && <span style={{ color: 'var(--color-success)', fontSize: '0.875rem', marginRight: 'auto' }}>Execution Started</span>}
        
        <button 
          className={styles.actionBtn} 
          onClick={handleCancel}
          disabled={teamStatus !== 'awaiting_approval' || isStarting}
          style={{ opacity: (teamStatus !== 'awaiting_approval' || isStarting) ? 0.5 : 1 }}
        >
          <X size={14} />
          Cancel
        </button>
        <button 
          className={`${styles.actionBtn} ${styles.primary}`} 
          onClick={handleApproveAndRun}
          disabled={teamStatus !== 'awaiting_approval' || isStarting}
          style={{ 
            opacity: (teamStatus !== 'awaiting_approval' || isStarting) ? 0.5 : 1,
            background: 'var(--color-jarvis)', 
            borderColor: 'var(--color-jarvis)',
            color: '#000'
          }}
        >
          {isStarting ? (
            'Starting...'
          ) : (
            <>
              <Play size={14} />
              Approve and Run
            </>
          )}
        </button>
      </div>
    </div>
  );
};
