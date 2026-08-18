import React, { useState, useEffect } from 'react';
import { FolderCode, FileDiff, GitCommit } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  activeGoalId: string | null;
}

export const StudioFiles: React.FC<Props> = ({ activeGoalId }) => {
  const [diffs, setDiffs] = useState<any[]>([]);

  useEffect(() => {
    if (!activeGoalId) return;
    const fetchDiffs = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}/diff`);
        const data = await res.json();
        setDiffs(data || []);
      } catch (e) {}
    };
    fetchDiffs();
    const interval = setInterval(fetchDiffs, 5000);
    return () => clearInterval(interval);
  }, [activeGoalId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0D1117', padding: '24px', overflowY: 'auto' }}>
      <div style={{ maxWidth: '896px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <FolderCode style={{ color: '#34d399' }} /> Files & Changes
        </h2>
        
        {diffs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontFamily: '"JetBrains Mono", monospace', fontSize: '14px', border: '1px dashed #1e293b', borderRadius: '12px' }}>
            No files changed in this goal yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {diffs.map((diff, idx) => (
              <div key={idx} style={{ backgroundColor: '#111823', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                <div style={{ backgroundColor: '#090C10', padding: '12px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <GitCommit size={14} style={{ color: '#818cf8' }} />
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#cbd5e1' }}>Checkpoint #{diff.sequenceId}</span>
                  </div>
                  <span style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', color: '#64748b' }}>{diff.hash}</span>
                </div>
                
                <div style={{ padding: '16px' }}>
                  {diff.files && diff.files.length > 0 ? (
                    <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', listStyle: 'none', padding: 0 }}>
                      {diff.files.map((file: string, fidx: number) => (
                        <li key={fidx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontFamily: '"JetBrains Mono", monospace', color: '#cbd5e1', backgroundColor: '#090C10', padding: '8px', borderRadius: '8px', border: '1px solid rgba(30, 41, 59, 0.5)' }}>
                          <FileDiff size={14} style={{ color: '#fbbf24' }} /> {file}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#64748b', fontFamily: '"JetBrains Mono", monospace', fontStyle: 'italic', marginBottom: '16px' }}>No file modifications captured in this checkpoint.</div>
                  )}

                  {diff.diff && (
                    <div style={{ backgroundColor: '#090C10', border: '1px solid #1e293b', borderRadius: '8px', overflowX: 'auto', padding: '16px' }}>
                      <pre style={{ fontSize: '10px', fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.625, whiteSpace: 'pre', color: '#cbd5e1', margin: 0 }}>
                        {diff.diff.split('\n').map((line: string, i: number) => {
                          let lineStyle: React.CSSProperties = { color: '#cbd5e1' };
                          if (line.startsWith('+') && !line.startsWith('+++')) lineStyle = { color: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.1)', display: 'block', padding: '0 4px', margin: '0 -4px' };
                          else if (line.startsWith('-') && !line.startsWith('---')) lineStyle = { color: '#fb7185', backgroundColor: 'rgba(244, 63, 94, 0.1)', display: 'block', padding: '0 4px', margin: '0 -4px' };
                          else if (line.startsWith('@@')) lineStyle = { color: '#818cf8', fontWeight: 'bold', display: 'block', marginTop: '8px' };
                          return <span key={i} style={lineStyle}>{line}{'\n'}</span>;
                        })}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
