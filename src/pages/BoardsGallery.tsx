// @ts-nocheck
import { useData } from '../store/dataStore';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { mockBoards } from '../mocks/data';
import MagicBento from '../components/ui/MagicBento';

/* Map board IDs to frontend route paths so clicking a tile navigates */
const BOARD_ROUTE_MAP: Record<string, string> = {
  'board-mission-control': '/mission-control',
  'board-agents': '/agents',
  'board-research': '/research',
  'board-builds': '/builds',
  'board-integrations': '/providers',
  'board-experiments': '/pipeline',
  'board-welders': '/kanban/b-welders',
  'board-sales': '/kanban/b-sales',
};

const BoardsGallery: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  const navigate = useNavigate();
  if (isLoading) return null;

  const formattedBoards = mockBoards.map(board => {
    const route = BOARD_ROUTE_MAP[board.id];
    return {
      title: board.name,
      description: board.purpose,
      label: `${board.layoutMode} view`,
      color: board.color || '#120F17',
      onClick: () => {
        if (route) {
          navigate(route);
        }
      },
    };
  });

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_boards.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Boards</h1>
          <p>All structured workspaces and gallery views.</p>
        </div>
      </div>

      <div style={{ padding: '24px' }}>
        <MagicBento cards={formattedBoards} />
      </div>
    </div>
  );
};
export default BoardsGallery;
