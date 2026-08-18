// @ts-nocheck
import { useData } from '../store/dataStore';
import React from 'react';
import { useDrawer } from '../store/appStore';
import BoardColumn from '../components/ui/BoardColumn';
import EntityCard from '../components/ui/EntityCard';
import { Database, FolderTree, User, LayoutGrid } from 'lucide-react';

const MemoryBoard: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  if (isLoading) return null;
  const drawer = useDrawer();

  const types = ['global', 'board', 'agent', 'session', 'task'] as const;
  
  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_memory.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Memory Scopes</h1>
          <p>Context stores shared across runtimes and entities.</p>
        </div>
      </div>

      <div className="board-layout">
        {types.map(type => {
          const scopes = mockMemoryScopes.filter(s => s.type === type);
          return (
            <BoardColumn key={type} title={type.charAt(0).toUpperCase() + type.slice(1)} count={scopes.length}>
              {scopes.map(scope => (
                <EntityCard
                  key={scope.id}
                  title={scope.name || scope.id}
                  preview={scope.systemPrompt}
                  accent="var(--color-hermes)"
                  onClick={() => drawer.open('memory-scope', scope.id)}
                  meta={[
                    { icon: type === 'global' ? <Database size={14} /> : type === 'agent' ? <User size={14} /> : type === 'board' ? <LayoutGrid size={14} /> : <FolderTree size={14} />, label: `${mockMemoryEntries.filter(e => e.scopeId === scope.id).length} entries` }
                  ]}
                />
              ))}
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
};
export default MemoryBoard;
