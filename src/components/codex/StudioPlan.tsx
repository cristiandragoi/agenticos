import React, { useState, useEffect } from 'react';
import { LayoutList, PlayCircle, CheckCircle, Clock } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  activeGoalId: string | null;
}

export const StudioPlan: React.FC<Props> = ({ activeGoalId }) => {
  const [steps, setSteps] = useState<any[]>([]);

  useEffect(() => {
    if (!activeGoalId) return;
    const fetchSteps = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}/steps`);
        const data = await res.json();
        setSteps(data || []);
      } catch (e) {}
    };
    fetchSteps();
    const interval = setInterval(fetchSteps, 3000);
    return () => clearInterval(interval);
  }, [activeGoalId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0D1117', padding: '24px', overflowY: 'auto' }}>
      <div style={{ maxWidth: '896px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <LayoutList style={{ color: '#34d399' }} /> Execution Plan
        </h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {steps.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontFamily: '"JetBrains Mono", monospace', fontSize: '14px', border: '1px dashed #1e293b', borderRadius: '12px' }}>
              No steps generated yet.
            </div>
          ) : (
            steps.map((step, idx) => (
              <div key={step.id} style={{ display: 'flex', gap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#111823', border: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', color: '#94a3b8', zIndex: 10 }}>
                    {idx + 1}
                  </div>
                  {idx !== steps.length - 1 && (
                    <div style={{ width: '1px', height: '100%', backgroundColor: '#1e293b', margin: '8px 0' }}></div>
                  )}
                </div>
                
                <div style={{ flex: 1, backgroundColor: '#111823', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', transition: 'border-color 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#e2e8f0' }}>
                      {step.toolCall ? JSON.parse(step.toolCall).toolAction || 'Unknown Action' : 'Pending Step'}
                    </span>
                    <span style={{
                      padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', textTransform: 'uppercase', letterSpacing: '1px',
                      ...(step.status === 'completed' ? { backgroundColor: 'rgba(52, 211, 153, 0.1)', color: '#34d399' } :
                         step.status === 'started' ? { backgroundColor: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24' } :
                         { backgroundColor: '#1e293b', color: '#94a3b8' })
                    }}>
                      {step.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', fontFamily: '"JetBrains Mono", monospace', backgroundColor: '#090C10', padding: '12px', borderRadius: '8px', border: '1px solid rgba(30, 41, 59, 0.5)', wordBreak: 'break-all' }}>
                    {step.toolCall ? JSON.stringify(JSON.parse(step.toolCall).Arguments || {}) : '...'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
