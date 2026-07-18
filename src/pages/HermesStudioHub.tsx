import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HermesApolloView from './HermesApolloView';
import HermesKanbanView from './HermesKanbanView';

const HermesStudioHub: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(location.search);
  const view = searchParams.get('view') || 'kanban';

  const handleTabClick = (nextView: 'kanban' | 'apollo') => {
    const params = new URLSearchParams(location.search);
    params.set('view', nextView);
    navigate({
      pathname: '/hermes-studio',
      search: `?${params.toString()}`,
    });
  };

  return (
    <div className="p-4 bg-[#020617] h-full overflow-hidden flex flex-col">
      {/* Header / Title */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-200">
            Hermes Studio
          </h1>
          <p className="text-xs text-slate-500">
            Unified cockpit for Hermes Automation and Voice.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-slate-800">
        <button
          type="button"
          onClick={() => handleTabClick('kanban')}
          className={`px-4 py-2 text-xs font-medium rounded-t-md ${
            view === 'kanban'
              ? 'bg-slate-800 text-slate-100 border border-b-transparent border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Kanban
        </button>
        <button
          type="button"
          onClick={() => handleTabClick('apollo')}
          className={`px-4 py-2 text-xs font-medium rounded-t-md ${
            view === 'apollo'
              ? 'bg-slate-800 text-slate-100 border border-b-transparent border-slate-700'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Apollo
        </button>
      </div>

      {/* Active View */}
      <div className="flex-1 min-h-0">
        {view === 'apollo' && <HermesApolloView />}
        {view === 'kanban' && <HermesKanbanView />}
      </div>
    </div>
  );
};

export default HermesStudioHub;
