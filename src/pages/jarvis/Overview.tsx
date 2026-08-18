// @ts-nocheck
import React from 'react';
import { useData } from '../../store/dataStore';
import { useDrawer } from '../../store/appStore';
import { Eye, Cpu, Activity, Users, Shield, Zap } from 'lucide-react';
import AgentFleetCard from '../../components/ui/AgentFleetCard';

const Overview: React.FC = () => {
  const { agents, runs, providers } = useData();
  const drawer = useDrawer();

  const fleet = agents || [];
  const activeAgents = fleet.filter((a: any) => a.status === 'active');
  const sleepingAgents = fleet.filter((a: any) => a.status === 'inactive');
  const totalRuns = (runs || []).length;
  const connectedProviders = (providers || []).filter((p: any) => p.status === 'connected').length;

  return (
    <div className="jarvis-overview">
      {/* Orbital Hero Section */}
      <div className="jarvis-overview__hero">
        <div className="jarvis-overview__orbital">
          <div className="orbital-ring orbital-ring--outer" />
          <div className="orbital-ring orbital-ring--mid" />
          <div className="orbital-ring orbital-ring--inner" />
          <div className="orbital-core">
            <Eye size={32} />
          </div>
          <div className="orbital-label">NORMALIZED MISSION CONTROL AGENT METADATA</div>
        </div>
        <div className="jarvis-overview__title-block">
          <div className="jarvis-overview__badge">JARVIS - MISSION CONTROL</div>
          <h1 className="jarvis-overview__title">Jarvis Mission Control</h1>
          <p className="jarvis-overview__subtitle">
            Jarvis Mission Control: voice + command center for my Agentic OS.
          </p>
        </div>
        <div className="jarvis-overview__quick-stats">
          <div className="jarvis-quick-stat">
            <Cpu size={18} />
            <span className="jarvis-quick-stat__value">{activeAgents.length}</span>
            <span className="jarvis-quick-stat__label">Active Agents</span>
          </div>
          <div className="jarvis-quick-stat">
            <Activity size={18} />
            <span className="jarvis-quick-stat__value">{totalRuns}</span>
            <span className="jarvis-quick-stat__label">Total Runs</span>
          </div>
          <div className="jarvis-quick-stat">
            <Shield size={18} />
            <span className="jarvis-quick-stat__value">{connectedProviders}</span>
            <span className="jarvis-quick-stat__label">Providers</span>
          </div>
          <div className="jarvis-quick-stat">
            <Users size={18} />
            <span className="jarvis-quick-stat__value">{fleet.length}</span>
            <span className="jarvis-quick-stat__label">Fleet Size</span>
          </div>
        </div>
      </div>

      {/* Agent Fleet Grid */}
      <div className="jarvis-overview__section">
        <div className="jarvis-overview__section-header">
          <h2>Agent Fleet</h2>
          <div className="segmented-tabs">
            <button className="segmented-tab active">ALL</button>
            <button className="segmented-tab">ACTIVE</button>
            <button className="segmented-tab">SLEEPING</button>
          </div>
        </div>
        <div className="jarvis-fleet-grid">
          {fleet.map((agent: any) => (
            <AgentFleetCard
              key={agent.id}
              agent={agent}
              onClick={() => drawer.open('agent', agent.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Overview;
