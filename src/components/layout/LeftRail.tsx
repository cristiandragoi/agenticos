// @ts-nocheck
import { useData } from '../../store/dataStore';
import { useDrawer } from '../../store/appStore';
import React from 'react';

import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Activity, HardDrive, Database,
  Package, Radio, BookOpen, Settings, Cpu, Layers, Box,
  GitBranch, Clapperboard, Mic, Terminal, Wrench,
  Eye, MonitorPlay, Folder
} from 'lucide-react';

const LeftRail: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  const drawer = useDrawer();
  const location = useLocation();

  if (isLoading) return null;

  const runningCount = mockRuns.filter(r => r.status === 'running').length;
  const queuedCount = mockRuns.filter(r => r.status === 'queued').length;
  
  const isHermes = location.pathname === '/hermes-studio';
  const hermesView = new URLSearchParams(location.search).get('view') || 'apollo';

  return (
    <div className="left-rail">
      {/* Header / Brand */}
      <div className="left-rail__header">
        <div className="flex-row gap-2" style={{ alignItems: 'center' }}>
          <img src="./logo.png" alt="Agentic OS Logo" style={{ width: '42px', height: '42px', objectFit: 'contain' }} />
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginLeft: '4px' }}>Agentic OS</h2>
        </div>
        <div className="text-xxs text-dim" style={{ marginTop: '4px', paddingLeft: '30px' }}>
          Workspace: Main
        </div>
      </div>

      {/* Navigation */}
      <div className="left-rail__nav">
        <NavLink to="/agents" className={({ isActive }) => `nav-section-label ${isActive ? 'active' : ''}`}>
          AI AGENTS
        </NavLink>
        <NavLink to="/jarvis" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-indigo-500/30 bg-indigo-500/20">
            <Eye size={12} className="text-indigo-400" />
          </div>
          <span className="font-medium tracking-wide">JARVIS</span>
        </NavLink>
        <NavLink to="/hermes-studio" className={() => `nav-link ${isHermes ? 'active' : ''}`}>
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-amber-500/30 bg-amber-500/20">
            <MonitorPlay size={12} className="text-amber-400" />
          </div>
          <span className="font-medium text-amber-500/90 tracking-wide">HERMES</span>
        </NavLink>
        <NavLink to="/codex" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-emerald-500/30 bg-emerald-500/20">
            <Terminal size={12} className="text-emerald-400" />
          </div>
          <span className="font-medium text-emerald-500/90 tracking-wide">CODEX</span>
        </NavLink>
        <NavLink to="/teams" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-purple-500/30 bg-purple-500/20">
            <Users size={12} className="text-purple-400" />
          </div>
          <span className="font-medium text-purple-500/90 tracking-wide">AGENT TEAMS</span>
        </NavLink>

        <div className="nav-section-label">WORKSPACE</div>
        <NavLink to="/mission-control" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={16} /> MISSION CONTROL
        </NavLink>
        <NavLink to="/boards" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Layers size={16} /> BOARDS
        </NavLink>
        <NavLink to="/research" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <BookOpen size={16} /> RESEARCH
        </NavLink>
        <NavLink to="/files" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Folder size={16} /> FILES
        </NavLink>

        <div className="nav-section-label">SYSTEM</div>
        <NavLink to="/memory" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Database size={16} /> MEMORY
        </NavLink>
        <NavLink to="/models" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Cpu size={16} /> MODELS & PROVIDERS
        </NavLink>
        <NavLink to="/automations" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <GitBranch size={16} /> AUTOMATIONS
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Settings size={16} /> SETTINGS
        </NavLink>
      </div>

      {/* Footer */}
      <div className="left-rail__footer">
        <span className="text-xxs text-dim">Live registry navigation</span>
      </div>
    </div>
  );
};

export default LeftRail;
