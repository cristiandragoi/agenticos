// @ts-nocheck
import { useData } from '../../store/dataStore';
import { useDrawer } from '../../store/appStore';
import { useProjects } from '../../store/projectStore';
import React, { useState, useCallback } from 'react';

import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Activity, HardDrive, Database,
  Package, Radio, BookOpen, Settings, Cpu, Layers, Box,
  GitBranch, Clapperboard, Mic, Terminal, Wrench,
  Eye, MonitorPlay, Folder, ChevronsLeft, ChevronsRight, Brain,
  FolderOpen, Plus, Circle, Compass
} from 'lucide-react';

/** Session persistence for the collapsed rail state (survives navigation,
 *  clears with the browser session — the required contract). */
const RAIL_COLLAPSED_KEY = 'agenticos-rail-collapsed';
function readCollapsed(): boolean {
  try { return sessionStorage.getItem(RAIL_COLLAPSED_KEY) === '1'; } catch { return false; }
}

const LeftRail: React.FC = () => {
  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();
  const drawer = useDrawer();
  const { projects, activeProject } = useProjects();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { sessionStorage.setItem(RAIL_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  if (isLoading) return null;

  const runningCount = mockRuns.filter(r => r.status === 'running').length;
  const queuedCount = mockRuns.filter(r => r.status === 'queued').length;

  const isHermes = location.pathname === '/hermes-studio';
  const hermesView = new URLSearchParams(location.search).get('view') || 'apollo';

  return (
    <div className={`left-rail${collapsed ? ' left-rail--collapsed' : ''}`} data-testid="nav-rail" data-collapsed={collapsed ? 'true' : 'false'}>
      {/* Header / Brand */}
      <div className="left-rail__header">
        <div className="flex-row gap-2" style={{ alignItems: 'center' }}>
          <img src="./logo.png" alt="Agentic OS Logo" style={{ width: collapsed ? '28px' : '42px', height: collapsed ? '28px' : '42px', objectFit: 'contain' }} />
          {!collapsed && <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginLeft: '4px' }}>Agentic OS</h2>}
        </div>
        {!collapsed && (
          <div className="text-xxs text-dim" style={{ marginTop: '4px', paddingLeft: '30px' }}>
            Workspace: Main
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="left-rail__nav">
        <NavLink to="/agents" data-testid="nav-section-agents" className={({ isActive }) => `nav-section-label ${isActive ? 'active' : ''}`} title="AI Agents">
          {collapsed ? <Users size={14} /> : 'AI AGENTS'}
        </NavLink>
        <NavLink to="/jarvis" data-testid="nav-jarvis" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Jarvis">
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-indigo-500/30 bg-indigo-500/20">
            <Eye size={12} className="text-indigo-400" />
          </div>
          {!collapsed && <span className="font-medium tracking-wide">JARVIS</span>}
        </NavLink>
        <NavLink to="/hermes-studio" data-testid="nav-hermes" className={() => `nav-link ${isHermes ? 'active' : ''}`} title="Hermes">
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-amber-500/30 bg-amber-500/20">
            <MonitorPlay size={12} className="text-amber-400" />
          </div>
          {!collapsed && <span className="font-medium text-amber-500/90 tracking-wide">HERMES</span>}
        </NavLink>
        <NavLink to="/codex" data-testid="nav-codex" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="CodeX">
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-emerald-500/30 bg-emerald-500/20">
            <Terminal size={12} className="text-emerald-400" />
          </div>
          {!collapsed && <span className="font-medium text-emerald-500/90 tracking-wide">CODEX</span>}
        </NavLink>
        <NavLink to="/magnitude" data-testid="nav-magnitude" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Magnitude">
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-amber-500/30 bg-amber-500/20">
            <Compass size={12} className="text-amber-400" />
          </div>
          {!collapsed && <span className="font-medium text-amber-500/90 tracking-wide">MAGNITUDE</span>}
        </NavLink>
        <NavLink to="/teams" data-testid="nav-teams" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Agent Teams">
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-purple-500/30 bg-purple-500/20">
            <Users size={12} className="text-purple-400" />
          </div>
          {!collapsed && <span className="font-medium text-purple-500/90 tracking-wide">AGENT TEAMS</span>}
        </NavLink>
        <NavLink to="/memory" data-testid="nav-memory-agents" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Memory">
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-cyan-500/30 bg-cyan-500/20">
            <Brain size={12} className="text-cyan-400" />
          </div>
          {!collapsed && <span className="font-medium text-cyan-500/90 tracking-wide">MEMORY</span>}
        </NavLink>

        {/* PROJECTS section */}
        <div className="nav-section-label" style={{ marginTop: 4 }}>
          {collapsed ? <FolderOpen size={14} /> : 'PROJECTS'}
        </div>
        <NavLink
          to="/projects"
          data-testid="nav-projects"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          title="Projects"
        >
          <div className="w-6 h-6 rounded flex items-center justify-center shrink-0 border border-sky-500/30 bg-sky-500/10">
            <FolderOpen size={12} className="text-sky-400" />
          </div>
          {!collapsed && (
            <span className="font-medium text-sky-400/90 tracking-wide" style={{ flex: 1 }}>
              {activeProject ? activeProject.name.toUpperCase().slice(0, 14) : 'ALL PROJECTS'}
            </span>
          )}
        </NavLink>
        {!collapsed && activeProject && (
          <div
            style={{
              fontSize: 10, color: '#0891b2', fontWeight: 700,
              letterSpacing: '0.08em', paddingLeft: 32, marginTop: -4, marginBottom: 2,
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <Circle size={6} fill="#0891b2" color="#0891b2" />
            ACTIVE: {activeProject.name.slice(0, 18)}
          </div>
        )}

        <div className="nav-section-label">{collapsed ? <LayoutDashboard size={14} /> : 'WORKSPACE'}</div>
        <NavLink to="/mission-control" data-testid="nav-mission-control" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Mission Control">
          <LayoutDashboard size={16} /> {!collapsed && 'MISSION CONTROL'}
        </NavLink>
        <NavLink to="/boards" data-testid="nav-boards" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Boards">
          <Layers size={16} /> {!collapsed && 'BOARDS'}
        </NavLink>
        <NavLink to="/research" data-testid="nav-research" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Research">
          <BookOpen size={16} /> {!collapsed && 'RESEARCH'}
        </NavLink>
        <NavLink to="/files" data-testid="nav-files" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Files">
          <Folder size={16} /> {!collapsed && 'FILES'}
        </NavLink>

        <div className="nav-section-label">{collapsed ? <Settings size={14} /> : 'SYSTEM'}</div>
        <NavLink to="/memory" data-testid="nav-memory" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Memory">
          <Database size={16} /> {!collapsed && 'MEMORY'}
        </NavLink>
        <NavLink to="/models" data-testid="nav-models" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Models & Providers">
          <Cpu size={16} /> {!collapsed && 'MODELS & PROVIDERS'}
        </NavLink>
        <NavLink to="/automations" data-testid="nav-automations" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Automations">
          <GitBranch size={16} /> {!collapsed && 'AUTOMATIONS'}
        </NavLink>
        <NavLink to="/settings" data-testid="nav-settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} title="Settings">
          <Settings size={16} /> {!collapsed && 'SETTINGS'}
        </NavLink>
      </div>

      {/* Footer — collapse toggle */}
      <div className="left-rail__footer">
        <button
          data-testid="nav-collapse-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: '0.7rem', cursor: 'pointer', padding: '4px 0' }}
        >
          {collapsed ? <ChevronsRight size={14} /> : <><ChevronsLeft size={14} /> <span className="text-xxs text-dim">Collapse</span></>}
        </button>
      </div>
    </div>
  );
};

export default LeftRail;
