import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import KanbanContainer from '../components/kanban/KanbanContainer';
import RevenueKanbanContainer from '../components/revenue/RevenueKanbanContainer';

export default function KanbanBoardPage() {
  const { boardId } = useParams();
  const [mode, setMode] = useState<'system' | 'revenue'>('revenue'); // default to revenue for the milestone

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            CRM Pipeline
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Board ID: {boardId || 'default'}
          </p>
        </div>
        
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', padding: 4, borderRadius: 8 }}>
          <button 
            onClick={() => setMode('system')}
            style={{ 
              padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: mode === 'system' ? 'var(--color-info)' : 'transparent',
              color: mode === 'system' ? 'white' : 'var(--text-secondary)'
            }}
          >
            System Tasks
          </button>
          <button 
            onClick={() => setMode('revenue')}
            style={{ 
              padding: '6px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: mode === 'revenue' ? '#10b981' : 'transparent',
              color: mode === 'revenue' ? 'white' : 'var(--text-secondary)'
            }}
          >
            Revenue Engine
          </button>
        </div>
      </div>

      <div style={{ height: 'calc(100vh - 150px)' }}>
        {mode === 'system' ? (
          <KanbanContainer boardId={boardId} />
        ) : (
          <RevenueKanbanContainer />
        )}
      </div>
    </div>
  );
}
