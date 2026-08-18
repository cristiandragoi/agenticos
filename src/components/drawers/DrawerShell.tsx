import React from 'react';
import { X, Pin, ExternalLink } from 'lucide-react';

interface DrawerShellProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  children: React.ReactNode;
  accentColor?: string;
}

const DrawerShell: React.FC<DrawerShellProps> = ({ title, subtitle, icon, onClose, onPin, isPinned, children, accentColor }) => {
  return (
    <>
      <div className="drawer-header" style={{ borderLeft: accentColor ? `4px solid ${accentColor}` : undefined }}>
        <div className="flex-row gap-3">
          {icon && <div style={{ color: accentColor || 'var(--text-secondary)' }}>{icon}</div>}
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>{title}</div>
            {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
          </div>
        </div>
        <div className="drawer-header__controls">
          <button onClick={onPin} title={isPinned ? 'Unpin' : 'Pin'} style={{ color: isPinned ? 'var(--text-primary)' : undefined, position: 'relative', zIndex: 10 }}>
            <Pin size={16} />
          </button>
          <button title="Open Full" style={{ position: 'relative', zIndex: 10 }}>
            <ExternalLink size={16} />
          </button>
          <button onClick={onClose} title="Close" style={{ position: 'relative', zIndex: 10, cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="drawer-body">
        {children}
      </div>
    </>
  );
};

export default DrawerShell;

