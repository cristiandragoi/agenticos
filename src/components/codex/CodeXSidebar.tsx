import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Activity, Database, Terminal, MonitorPlay, Eye, Settings } from 'lucide-react';

export const CodeXSidebar: React.FC = () => {
  return (
    <div className="codex-sidebar">
      <div className="codex-sidebar__nav">
        <div className="codex-nav-label">Navigation</div>
        
        <NavLink to="/mission-control" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={16} className="icon" />
          <span>Mission Control</span>
        </NavLink>
        
        <NavLink to="/jarvis" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <Eye size={16} className="icon" />
          <span>Jarvis</span>
        </NavLink>
        
        <NavLink to="/hermes-studio" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <MonitorPlay size={16} className="icon" />
          <span>Hermes</span>
        </NavLink>
        
        <NavLink to="/codex" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <Terminal size={16} className="icon" style={{color: '#58a6ff'}} />
          <span style={{color: '#58a6ff'}}>CodeX</span>
        </NavLink>

        <div className="codex-nav-label" style={{marginTop: '24px'}}>System</div>

        <NavLink to="/pipeline" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <Activity size={16} className="icon" />
          <span>Pipeline</span>
        </NavLink>
        
        <NavLink to="/memory" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <Database size={16} className="icon" />
          <span>Memory</span>
        </NavLink>

        <NavLink to="/runs" className={({ isActive }) => `codex-nav-link ${isActive ? 'active' : ''}`}>
          <Activity size={16} className="icon" />
          <span>Runs</span>
        </NavLink>
      </div>
      
      <div className="codex-sidebar__footer">
        <NavLink to="/settings" className="codex-nav-link">
          <Settings size={16} className="icon" />
          <span>Settings</span>
        </NavLink>
      </div>
    </div>
  );
};
