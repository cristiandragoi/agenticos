import React from 'react';
import ContextChip from './ContextChip';
import StatusBadge from './StatusBadge';

interface EntityCardProps {
  accent?: string;
  title: string;
  subtitle?: string;
  preview?: string;
  status?: string;
  meta?: { icon?: React.ReactNode, label: string }[];
  tags?: string[];
  onClick?: () => void;
  children?: React.ReactNode;
}

const EntityCard: React.FC<EntityCardProps> = ({ accent, title, subtitle, preview, status, meta, tags, onClick, children }) => {
  return (
    <div 
      className="entity-card" 
      style={{ '--card-accent': accent || 'var(--border-subtle)' } as React.CSSProperties}
      onClick={onClick}
    >
      <div className="entity-card__header">
        <div className="entity-card__identity">
          {children}
          <div style={{ minWidth: 0 }}>
            <div className="entity-card__title">{title}</div>
            {subtitle && <div className="entity-card__subtitle">{subtitle}</div>}
          </div>
        </div>
        {status && <StatusBadge status={status} />}
      </div>
      {preview && <div className="entity-card__body">{preview}</div>}
      {meta && meta.length > 0 && (
        <div className="entity-card__meta">
          {meta.map((m, i) => <span key={i} className="flex-row gap-1" style={{ alignItems: 'center' }}>{m.icon}{m.label}</span>)}
        </div>
      )}
      {tags && tags.length > 0 && (
        <div className="entity-card__tags">
          {tags.map((t, i) => <ContextChip key={i} label={t} />)}
        </div>
      )}
    </div>
  );
};

export default EntityCard;

