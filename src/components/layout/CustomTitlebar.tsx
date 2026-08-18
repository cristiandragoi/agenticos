import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import GatewayStatusChip from '../GatewayStatusChip';
import BackendStatusIndicator from './BackendStatusIndicator';

const CustomTitlebar: React.FC = () => {
  const handleMinimize = () => {
    // @ts-ignore
    window.ipcRenderer?.send('window-minimize');
  };

  const handleMaximize = () => {
    // @ts-ignore
    window.ipcRenderer?.send('window-maximize');
  };

  const handleClose = () => {
    console.log("Close clicked, ipcRenderer is:", (window as any).ipcRenderer);
    // @ts-ignore
    window.ipcRenderer?.send('window-close');
  };

  return (
    <div
      style={{
        height: '48px',
        backgroundColor: 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '12px',
        WebkitAppRegion: 'drag', // Makes the titlebar draggable
        userSelect: 'none',
        zIndex: 9999,
        flexShrink: 0
      } as React.CSSProperties}
    >
      {/* Brand / Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <img src="./logo.png" alt="Agentic OS Logo" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
          AGENTIC OS
        </span>
      </div>

      {/* Backend lifecycle + Gateway Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <BackendStatusIndicator />
        <GatewayStatusChip />
      </div>

      {/* Window Controls (§stabilization: regression-protected — these
          three buttons MUST render at every supported resolution. The
          data-app-region marker is the jsdom-testable contract that this
          island stays clickable (no-drag) inside the draggable titlebar. */}
      <div
        data-testid="titlebar-window-controls"
        data-app-region="no-drag"
        style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          data-testid="titlebar-minimize"
          onClick={handleMinimize}
          className="titlebar-btn"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          data-testid="titlebar-maximize"
          onClick={handleMaximize}
          className="titlebar-btn"
          title="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          data-testid="titlebar-close"
          onClick={handleClose}
          className="titlebar-btn close-btn"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      <style>{`
        .titlebar-btn {
          height: 100%;
          width: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          transition: background-color 0.15s, color 0.15s;
          -webkit-app-region: no-drag;
        }
        .titlebar-btn:hover {
          background-color: rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
        }
        .titlebar-btn.close-btn:hover {
          background-color: #e81123;
          color: white;
        }
      `}</style>
    </div>
  );
};

export default CustomTitlebar;
