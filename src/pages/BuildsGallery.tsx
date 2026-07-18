// @ts-nocheck
import { useData } from '../store/dataStore';
import React from 'react';
import { useDrawer } from '../store/appStore';
import BoardColumn from '../components/ui/BoardColumn';
import EntityCard from '../components/ui/EntityCard';

const BuildsGallery: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;
  const drawer = useDrawer();

  const statuses = ['draft', 'active', 'review', 'done', 'archived'] as const;
  
  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_builds.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Builds & Artifacts</h1>
          <p>Generated applications, prototypes, and reports.</p>
        </div>
      </div>

      <div className="board-layout">
        {statuses.map(status => {
          const items = mockArtifacts.filter(a => a.status === status);
          return (
            <BoardColumn key={status} title={status.charAt(0).toUpperCase() + status.slice(1)} count={items.length}>
              {items.map(art => (
                <EntityCard
                  key={art.id}
                  title={art.title}
                  subtitle={`v${art.version}`}
                  preview={art.preview}
                  status={art.status}
                  onClick={() => drawer.open('artifact', art.id)}
                  tags={[art.type]}
                />
              ))}
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
};
export default BuildsGallery;
