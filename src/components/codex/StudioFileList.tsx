import React, { useState, useEffect } from 'react';
import { FolderCode, FileText, GitCommit } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

interface Props {
  activeGoalId: string | null;
}

export const StudioFileList: React.FC<Props> = ({ activeGoalId }) => {
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

  // Aggregate all unique files modified across all checkpoints
  const allFiles = Array.from(new Set(diffs.flatMap(d => d.files || [])));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#0D1117', padding: '24px', overflowY: 'auto' }}>
      <div style={{ maxWidth: '896px', margin: '0 auto', width: '100%' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <FolderCode style={{ color: '#34d399' }} /> Modified Files
        </h2>
        
        {allFiles.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontFamily: '"JetBrains Mono", monospace', fontSize: '14px', border: '1px dashed #1e293b', borderRadius: '12px' }}>
            No files changed in this goal yet.
          </div>
        ) : (
          <div style={{ backgroundColor: '#111823', border: '1px solid #1e293b', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
            <ul style={{ display: 'flex', flexDirection: 'column', listStyle: 'none', padding: 0, margin: 0 }}>
              {allFiles.map((file: string, idx: number) => (
                <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontFamily: '"JetBrains Mono", monospace', color: '#cbd5e1', padding: '12px 16px', borderBottom: idx < allFiles.length - 1 ? '1px solid #1e293b' : 'none' }}>
                  <FileText size={16} style={{ color: '#58a6ff' }} /> {file}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
