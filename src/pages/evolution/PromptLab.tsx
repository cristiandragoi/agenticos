import React, { useEffect, useState } from 'react';
import { evolutionClient } from '../../api/evolutionClient';
import type { PromptVersion } from '../../api/evolutionClient';
import { useData } from '../../store/dataStore';

export default function PromptLab() {
  const { agents } = useData();
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [versions, setVersions] = useState<PromptVersion[]>([]);

  useEffect(() => {
    if (selectedAgent) {
      evolutionClient.getAgentVersions(selectedAgent).then(setVersions).catch(console.error);
    }
  }, [selectedAgent]);

  const handleCreateChallenger = async () => {
    if (!selectedAgent) return;
    try {
      await evolutionClient.createChallenger(selectedAgent, 'Admin');
      const newVersions = await evolutionClient.getAgentVersions(selectedAgent);
      setVersions(newVersions);
    } catch(err) {
      console.error(err);
    }
  };

  const handlePromote = async (versionId: string) => {
    try {
      await evolutionClient.promoteVersion(versionId, 'Admin', 'Promoted from UI');
      const newVersions = await evolutionClient.getAgentVersions(selectedAgent);
      setVersions(newVersions);
    } catch(err) {
      console.error(err);
    }
  };

  const handleRollback = async (versionId: string) => {
    try {
      await evolutionClient.rollbackVersion(versionId, 'Admin', 'Rollback from UI');
      const newVersions = await evolutionClient.getAgentVersions(selectedAgent);
      setVersions(newVersions);
    } catch(err) {
      console.error(err);
    }
  };

  return (
    <div className="page-container p-6 overflow-y-auto w-full h-full text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Prompt Lab</h1>
        <p className="text-gray-400">A/B Testing & Agent Genome</p>
      </div>
      
      <div className="space-y-6">
        
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center space-x-4 mb-4">
            <label className="text-gray-400 font-medium">Select Agent:</label>
            <select 
              className="bg-gray-800 border border-gray-700 text-white rounded p-2 focus:ring-2 focus:ring-blue-500"
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option value="">-- Choose Agent --</option>
              {agents.map((a: any) => (
                <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>
              ))}
            </select>
            
            {selectedAgent && (
              <button onClick={handleCreateChallenger} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
                Create Challenger (Draft)
              </button>
            )}
          </div>
        </div>

        {selectedAgent && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {versions.map(v => (
              <div 
                key={v.id} 
                className={`bg-gray-900 border rounded-lg p-4 ${v.status === 'active' ? 'border-2 border-green-500/50' : v.status === 'draft' ? 'border-2 border-blue-500/50' : 'border-gray-800'}`}
              >
                <h3 className="text-lg font-medium mb-2">v{v.versionNumber} - {v.status.toUpperCase()}</h3>
                <div className="text-xs text-gray-400 mb-2">Author: {v.author} | {new Date(v.createdAt).toLocaleDateString()}</div>
                <div className="bg-gray-950 p-3 rounded text-sm text-gray-300 mb-4 h-40 overflow-y-auto font-mono whitespace-pre-wrap">
                  {v.prompt}
                </div>
                
                <div className="flex space-x-3 mt-4">
                  {v.status === 'draft' && (
                    <button onClick={() => handlePromote(v.id)} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-sm">
                      Promote to Active
                    </button>
                  )}
                  {v.status === 'retired' && (
                    <button onClick={() => handleRollback(v.id)} className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded text-sm">
                      Rollback to this
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
