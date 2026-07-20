import React, { useState } from 'react';
import { X, Loader2, Sparkles, Users } from 'lucide-react';
import { apiClient } from '../../api/client';
import TeamSheetMap from './TeamSheetMap';

interface Props {
  onClose: () => void;
}

const TeamCreationForm: React.FC<Props> = ({ onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [workspacePath, setWorkspacePath] = useState('B:\\AgenticOS'); // Defaulting for MVP
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      // Step 1: Preview the team sheet
      const data = await apiClient.post('/api/teams/preview', { prompt, workspacePath });
      setPreview(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate team');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#121214] border border-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" /> 
            Create Agent Team
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6">
          {/* Left Column: Input */}
          <div className="flex-1 flex flex-col gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Goal / Prompt</label>
              <textarea 
                className="w-full bg-[#1A1A1E] border border-gray-700 rounded-lg p-3 text-sm h-32 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none"
                placeholder="Describe the complex task you want the multi-agent team to accomplish..."
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Target Workspace Path</label>
              <input 
                type="text"
                id="workspacePathInput"
                className="w-full bg-[#1A1A1E] border border-gray-700 rounded-lg p-2.5 text-sm focus:border-purple-500 outline-none"
                value={workspacePath}
                onChange={e => setWorkspacePath(e.target.value)}
              />
            </div>
            
            <button
              onClick={handleGenerate}
              disabled={loading || !prompt}
              className="mt-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? 'Generating Strategy...' : 'Generate Team Strategy'}
            </button>

            {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
          </div>

          {/* Right Column: Preview */}
          <div className="flex-1 bg-[#0A0A0C] border border-gray-800 rounded-lg p-4 overflow-y-auto min-h-[300px]">
            {!preview && !loading && (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm text-center px-4">
                <Users size={32} className="mb-3 opacity-50" />
                <p>Describe your goal to generate a specialized team of agents.</p>
              </div>
            )}
            
            {loading && (
              <div className="h-full flex flex-col items-center justify-center text-purple-400 text-sm gap-3">
                <Loader2 size={24} className="animate-spin" />
                <p>Coordinator is designing the team...</p>
              </div>
            )}

            {preview && !loading && (
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-gray-200">Proposed Team Structure</h3>
                  <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded">
                    Draft
                  </span>
                </div>
                
                {/* Visual Map */}
                <TeamSheetMap teamSheet={preview.teamSheet} />

                <div className="text-xs text-gray-400 mt-4 border-t border-gray-800 pt-4">
                  <p>A new team record has been created (ID: {preview.teamId}). You can approve and launch this team from the dashboard.</p>
                </div>
                
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={onClose} className="bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
                    Save to Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamCreationForm;
