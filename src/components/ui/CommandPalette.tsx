import React from 'react';
import { useCommandPalette } from '../../store/appStore';

const CommandPalette: React.FC = () => {
  const { isOpen, toggle } = useCommandPalette();
  if (!isOpen) return null;
  return (
    <div className="command-palette-overlay" onClick={toggle}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <input className="command-palette__input" placeholder="Search..." autoFocus />
      </div>
    </div>
  );
};
export default CommandPalette;

