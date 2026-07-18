// @ts-nocheck
import { useData } from '../store/dataStore';
import React, { useState } from 'react';
import { useDrawer } from '../store/appStore';
import BoardColumn from '../components/ui/BoardColumn';
import EntityCard from '../components/ui/EntityCard';
import ResearchBriefForm from '../components/forms/ResearchBriefForm';
import RevenueOpportunityDraftModal from '../components/revenue/RevenueOpportunityDraftModal';
import { Plus } from 'lucide-react';

const ResearchBoard: React.FC = () => {
  const { researchBriefs, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, isLoading } = useData();
  const drawer = useDrawer();
  const [isCreatingBrief, setIsCreatingBrief] = useState(false);
  const [draftingFinding, setDraftingFinding] = useState<any | null>(null);

  if (isLoading) return null;

  const entries = mockMemoryEntries.filter(m => m.scopeId === 'mem-research-board');
  const drafts = mockArtifacts.filter(a => a.linkedBoardId === 'board-research');
  
  return (
    <div className="flex-col h-full" style={{ 
      position: 'relative',
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_research.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="page-header__title">
          <h1>Research</h1>
          <p>Structured deep-work board for findings and decisions.</p>
        </div>
        {!isCreatingBrief && (
          <button 
            className="btn btn-primary flex-row gap-2" 
            style={{ background: 'var(--color-hermes)' }}
            onClick={() => setIsCreatingBrief(true)}
          >
            <Plus size={16} /> New Research Brief
          </button>
        )}
      </div>

      {isCreatingBrief ? (
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          <ResearchBriefForm 
            onSuccess={(runId) => {
              setIsCreatingBrief(false);
            }}
            onCancel={() => setIsCreatingBrief(false)}
          />
        </div>
      ) : (
        <div className="board-layout">
          <BoardColumn title="Brief Requests" count={researchBriefs.length}>
            {researchBriefs.map(b => (
              <EntityCard
                key={b.id}
                title={b.title}
                preview={`Target: ${b.target}\nGoal: ${b.goal}`}
                tags={[b.requestType, b.status]}
                onClick={() => drawer.open('brief', b.id)}
              />
            ))}
          </BoardColumn>
          
          <BoardColumn title="Findings" count={entries.length}>
            {entries.map(e => (
              <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <EntityCard
                  title={e.title}
                  preview={e.content}
                  tags={[e.kind]}
                  onClick={() => {}}
                />
                <button 
                  className="btn" 
                  style={{ fontSize: '11px', padding: '4px 8px', borderColor: '#4caf50', color: '#4caf50' }}
                  onClick={() => setDraftingFinding(e)}
                >
                  Create Revenue Opportunity
                </button>
              </div>
            ))}
          </BoardColumn>
          
          <BoardColumn title="Drafts" count={drafts.length}>
            {drafts.map(art => (
              <EntityCard
                key={art.id}
                title={art.title}
                preview={art.preview}
                tags={[art.type]}
                onClick={() => drawer.open('artifact', art.id)}
              />
            ))}
          </BoardColumn>
        </div>
      )}

      {draftingFinding && (
        <RevenueOpportunityDraftModal 
          sourceFinding={draftingFinding}
          onClose={() => setDraftingFinding(null)}
          onSuccess={(opp) => {
            setDraftingFinding(null);
            alert(`Successfully saved: ${opp.title}. You can view it in the Boards > Revenue Engine tab.`);
          }}
        />
      )}
    </div>
  );
};

export default ResearchBoard;
