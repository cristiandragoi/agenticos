import React, { useEffect, useState } from 'react';
import { evolutionClient } from '../../api/evolutionClient';
import { revenueClient } from '../../api/revenueClient';
import { useData } from '../../store/dataStore';
import { ShieldAlert } from 'lucide-react';

export default function EvolutionDashboard() {
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [executions, setExecutions] = useState<any[]>([]);
  const [promptMetrics, setPromptMetrics] = useState<any[]>([]);
  const [agentMetrics, setAgentMetrics] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const { agents } = useData();

  useEffect(() => {
    evolutionClient.getLeaderboard().then(setLeaderboard).catch(console.error);
    evolutionClient.getExecutions().then(setExecutions).catch(console.error);
    revenueClient.getPromptIntelligence().then(setPromptMetrics).catch(console.error);
    revenueClient.getAgentIntelligence().then(setAgentMetrics).catch(console.error);
    revenueClient.getIntelligenceSummary().then(setSummary).catch(console.error);
  }, []);

  const getAgent = (id: string) => agents.find((a: any) => a.id === id);

  const mergedLeaderboard = leaderboard.map(row => {
    const revData = agentMetrics.find(m => m.agentId === row.agentId) || {};
    return { ...row, ...revData };
  });

  return (
    <div className="page-container p-6 overflow-y-auto w-full h-full text-white">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold">Evolution Lab</h1>
          <p className="text-gray-400">Continuous Agent Improvement & Evaluation</p>
        </div>
        {summary?.lowConfidenceAttributions > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg flex items-center gap-2">
            <ShieldAlert size={16} />
            <span className="text-sm font-medium">{summary.lowConfidenceAttributions} Low-Confidence Attributions Detected</span>
          </div>
        )}
      </div>
      
      <div className="space-y-6">
        
        {/* Leaderboard */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-medium mb-4">Agent Leaderboard</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className="p-3">Agent</th>
                  <th className="p-3 text-right">Avg Score</th>
                  <th className="p-3 text-right">Success Rate</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {mergedLeaderboard.map((row) => {
                  const agent = getAgent(row.agentId);
                  return (
                    <tr key={row.agentId} className="hover:bg-gray-800/50">
                      <td className="p-3 font-medium text-white flex items-center space-x-2">
                        <span>{agent?.avatar || '🤖'}</span>
                        <span>{agent?.name || row.agentId}</span>
                      </td>
                      <td className="p-3 text-right text-blue-400">{row.averageScore?.toFixed(1) || '-'}</td>
                      <td className="p-3 text-right">{row.successRate?.toFixed(1) || '0'}%</td>
                      <td className="p-3 text-right text-green-400">${row.totalRevenue?.toLocaleString() || '0'}</td>
                      <td className="p-3 text-right text-yellow-400">{row.avgRoi ? row.avgRoi.toFixed(2) + 'x' : '-'}</td>
                    </tr>
                  );
                })}
                {mergedLeaderboard.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-500">No data available yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Prompt ROI Leaderboard */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-medium m-0">Prompt Version ROI</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className="p-3">Prompt Version</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">Cost</th>
                  <th className="p-3 text-right">Conversions</th>
                  <th className="p-3 text-right">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {promptMetrics?.map((row: any) => (
                  <tr key={row.promptVersionId} className="hover:bg-gray-800/50">
                    <td className="p-3 font-medium text-white">{row.promptVersionId || 'Unknown'}</td>
                    <td className="p-3 text-right text-green-400">${row.totalRevenue?.toLocaleString() || '0'}</td>
                    <td className="p-3 text-right text-red-400">${row.totalCost?.toLocaleString() || '0'}</td>
                    <td className="p-3 text-right">{row.conversionsCount || 0}</td>
                    <td className="p-3 text-right text-yellow-400">{row.avgRoi ? row.avgRoi.toFixed(2) + 'x' : '0.00x'}</td>
                  </tr>
                ))}
                {(!promptMetrics || promptMetrics.length === 0) && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-gray-500">No prompt metrics available</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Run Registry */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-medium mb-4">Recent Executions</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className="p-3">Time</th>
                  <th className="p-3">Agent</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Score</th>
                  <th className="p-3">Failure Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {executions.slice(0, 10).map((row) => {
                  const agent = getAgent(row.execution.agentId);
                  return (
                    <tr key={row.execution.id} className="hover:bg-gray-800/50">
                      <td className="p-3 text-gray-400">
                        {new Date(row.execution.createdAt).toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-medium flex items-center space-x-2">
                        <span>{agent?.avatar || '🤖'}</span>
                        <span>{agent?.name || row.execution.agentId}</span>
                      </td>
                      <td className="p-3">
                        {row.execution.success ? (
                          <span className="text-green-400 bg-green-400/10 px-2 py-1 rounded text-xs">Success</span>
                        ) : (
                          <span className="text-red-400 bg-red-400/10 px-2 py-1 rounded text-xs">Failed</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-blue-400">
                        {row.evaluation?.overallScore ?? '-'}
                      </td>
                      <td className="p-3 text-gray-500">
                        {row.execution.primaryFailureCategory || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
