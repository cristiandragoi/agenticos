import React, { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

interface AgentTileProps {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  colorVar: string; // e.g. 'var(--color-jarvis)'
  status?: 'active' | 'idle' | 'syncing' | 'error';
  tags?: string[];
  onClick?: () => void;
}

const AgentTile: React.FC<AgentTileProps> = ({ name, description, icon: Icon, colorVar, status = 'idle', tags = [], onClick }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div
      ref={cardRef}
      className="agent-tile"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        '--agent-color': colorVar,
        '--mouse-x': `${mousePos.x}px`,
        '--mouse-y': `${mousePos.y}px`,
      } as React.CSSProperties}
    >
      <div className="agent-tile__glow" />
      <div className="agent-tile__content">
        <div className="agent-tile__header">
          <div className="agent-tile__icon-wrapper" style={{ borderColor: isHovered ? colorVar : 'var(--border-subtle)' }}>
            <Icon size={20} color={colorVar} />
            {status !== 'idle' && (
              <span className={`agent-tile__status-dot status-${status}`} />
            )}
          </div>
          <div className="agent-tile__title">{name}</div>
        </div>
        <div className="agent-tile__description">{description}</div>
        {tags.length > 0 && (
          <div className="agent-tile__tags">
            {tags.map(t => (
              <span key={t} className="agent-tile__tag">{t}</span>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .agent-tile {
          position: relative;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 20px;
          cursor: pointer;
          overflow: hidden;
          transition: transform var(--transition-fast), border-color var(--transition-normal);
          display: flex;
          flex-direction: column;
          gap: 12px;
          transform: perspective(1000px) rotateX(0) rotateY(0);
        }
        .agent-tile:hover {
          transform: translateY(-2px) scale(1.01);
          border-color: rgba(255, 255, 255, 0.2);
          box-shadow: var(--shadow-lg);
        }
        
        /* The magical mouse-following glow */
        .agent-tile__glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            400px circle at var(--mouse-x) var(--mouse-y),
            var(--agent-color),
            transparent 40%
          );
          opacity: 0; /* start invisible */
          transition: opacity 0.3s;
          pointer-events: none;
          z-index: 0;
          mix-blend-mode: screen;
        }
        .agent-tile:hover .agent-tile__glow {
          opacity: 0.15; /* visible on hover */
        }

        /* Inner border glow */
        .agent-tile::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: radial-gradient(
            300px circle at var(--mouse-x) var(--mouse-y),
            var(--agent-color),
            transparent 40%
          );
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          opacity: 0;
          transition: opacity 0.3s;
          pointer-events: none;
        }
        .agent-tile:hover::before {
          opacity: 1;
        }

        .agent-tile__content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .agent-tile__header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .agent-tile__icon-wrapper {
          position: relative;
          width: 42px;
          height: 42px;
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: border-color var(--transition-normal);
        }

        .agent-tile__status-dot {
          position: absolute;
          bottom: -2px;
          right: -2px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid var(--bg-elevated);
        }
        .status-active { background-color: var(--color-success); }
        .status-syncing { background-color: var(--color-warning); animation: pulse 2s infinite; }
        .status-error { background-color: var(--color-error); }

        .agent-tile__title {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }

        .agent-tile__description {
          font-size: 0.8125rem;
          color: var(--text-secondary);
          line-height: 1.5;
          flex: 1;
        }

        .agent-tile__tags {
          display: flex;
          gap: 6px;
          margin-top: 16px;
          flex-wrap: wrap;
        }

        .agent-tile__tag {
          font-size: 0.6875rem;
          padding: 3px 8px;
          border-radius: var(--radius-xs);
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-tertiary);
          border: 1px solid var(--border-subtle);
        }

        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default AgentTile;
