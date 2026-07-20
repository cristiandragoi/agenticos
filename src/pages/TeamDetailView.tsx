import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pause, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';
import { apiClient } from '../api/client';
import TeamSheetMap from '../components/teams/TeamSheetMap';
import TeamTimeline from '../components/teams/TeamTimeline';
import TeamArtifactsPanel from '../components/teams/TeamArtifactsPanel';

const TeamDetailView: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState<any>(null);
  const [run, setRun] = useState<any>(null);
  const [handoffs, setHandoffs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchTeamData = async () => {
    try {
      const teamData = await apiClient.get(`/api/teams/${id}`);
      setTeam(teamData);

      const runsData = await apiClient.get(`/api/teams/${id}/runs`);
      if (runsData && runsData.length > 0) {
        setRun(runsData[runsData.length - 1]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeamData();
  }, [id]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const res = await apiClient.post(`/api/teams/${id}/start`);
      // Update team status or fetch run
      fetchTeamData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  // Basic polling if status is running
  useEffect(() => {
    let interval: any;
    if (team?.status === 'running' || team?.status === 'paused') {
      interval = setInterval(() => {
        fetchTeamData();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [team?.status]);

  if (loading) {
    return <div className="p-8 text-gray-500">Loading team details...</div>;
  }

  if (!team) {
    return <div className="p-8 text-red-500">Team not found</div>;
  }

  return (
    <div className="flex flex-col h-full bg-[#0A0A0C]">
      {/* Header */}
      <div className="border-b border-gray-800 p-4 flex items-center justify-between bg-[#121214] shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/teams')} className="text-gray-500 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-white">{team.name}</h1>
            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
              <span className={`px-2 py-0.5 rounded uppercase tracking-wider ${
                team.status === 'awaiting_approval' ? 'bg-amber-500/20 text-amber-500' :
                team.status === 'running' ? 'bg-emerald-500/20 text-emerald-500' :
                team.status === 'paused' ? 'bg-blue-500/20 text-blue-500' :
                team.status === 'completed' ? 'bg-purple-500/20 text-purple-500' :
                'bg-red-500/20 text-red-500'
              }`}>
                {team.status.replace('_', ' ')}
              </span>
              <span>ID: {team.id}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {team.status === 'awaiting_approval' && (
            <button 
              onClick={handleStart}
              disabled={actionLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <Play size={16} /> Approve & Launch
            </button>
          )}
          {team.status === 'paused' && (
            <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              <Play size={16} /> Resume
            </button>
          )}
          {team.status === 'running' && (
            <button className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              <Pause size={16} /> Pause
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        
        {/* Left Column: Details & Timeline */}
        <div className="flex-1 border-r border-gray-800 flex flex-col overflow-y-auto p-6 bg-[#0E0E10] gap-8">
          
          <section>
            <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Original Goal</h3>
            <div className="bg-[#1A1A1E] border border-gray-800 rounded-lg p-4 text-sm text-gray-300">
              {team.originalPrompt}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Team Architecture</h3>
            <div className="bg-[#121214] border border-gray-800 rounded-lg p-4">
               <TeamSheetMap teamSheet={team.teamSheet} />
            </div>
          </section>

          {(team.status === 'running' || team.status === 'paused' || team.status === 'completed' || team.status === 'failed') && (
            <section>
              <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Execution Timeline</h3>
              <div className="bg-[#121214] border border-gray-800 rounded-lg p-4">
                <TeamTimeline team={team} run={run} />
              </div>
            </section>
          )}

        </div>

        {/* Right Column: Artifacts */}
        <div className="w-full lg:w-96 flex flex-col bg-[#121214] overflow-y-auto">
          <TeamArtifactsPanel team={team} runId={run?.id} />
        </div>
      </div>
    </div>
  );
};

export default TeamDetailView;
