import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Play, Pause, Activity } from 'lucide-react';
import { apiClient } from '../api/client';
import TeamCreationForm from '../components/teams/TeamCreationForm';

const AgentTeamsDashboard: React.FC = () => {
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  const fetchTeams = async () => {
    try {
      const data = await apiClient.get('/api/teams');
      setTeams(data || []);
    } catch (err) {
      console.error('Failed to load teams', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  return (
    <div className="flex-col h-full" style={{ 
      backgroundImage: "linear-gradient(to bottom, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.95)), url('/bg/bg_agents.png')", 
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed'
    }}>
      <div className="page-header">
        <div className="page-header__title">
          <h1>Agent Teams</h1>
          <p>Orchestrate and monitor multi-agent collaborative workflows.</p>
        </div>
        <div className="page-header__actions">
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--color-purple)', color: '#fff',
              border: 'none', padding: '8px 16px', borderRadius: '8px',
              fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer'
            }}
          >
            <Plus size={14} /> New Team
          </button>
        </div>
      </div>

      <div className="page-content" style={{ padding: '0 24px' }}>
        {loading ? (
          <div className="flex justify-center items-center h-64 text-dim">Loading teams...</div>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border border-dashed border-gray-700/50 rounded-xl bg-gray-900/20">
            <Users size={32} className="text-gray-500 mb-4" />
            <h3 className="text-gray-400 font-medium mb-1">No teams configured</h3>
            <p className="text-gray-500 text-sm mb-4">Create your first multi-agent team to automate complex workflows.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center gap-2"
            >
              <Plus size={14} /> Create Team
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map(team => (
              <div 
                key={team.id} 
                className="card"
                onClick={() => navigate(`/teams/${team.id}`)}
                style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', padding: '16px', gap: '12px' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-purple-500/20 border border-purple-500/30">
                      <Users size={14} className="text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-200">{team.name}</h3>
                      <p className="text-xs text-gray-500 capitalize">{team.status.replace('_', ' ')}</p>
                    </div>
                  </div>
                  {team.status === 'running' && (
                    <Activity size={14} className="text-emerald-400 animate-pulse" />
                  )}
                </div>
                
                <p className="text-sm text-gray-400 line-clamp-2 mt-2">
                  {team.originalPrompt}
                </p>

                <div className="mt-auto pt-4 border-t border-gray-800 flex justify-between items-center text-xs text-gray-500">
                  <span>{new Date(parseInt(team.createdAt)).toLocaleDateString()}</span>
                  <span className="text-purple-400/80 font-medium">View Details &rarr;</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <TeamCreationForm onClose={() => { setShowCreate(false); fetchTeams(); }} />
      )}
    </div>
  );
};

export default AgentTeamsDashboard;
