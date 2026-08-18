import React from 'react';

interface ContextChipProps {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  color?: string;
}

const ContextChip: React.FC<ContextChipProps> = ({ label, icon, onClick, color }) => {
  return (
    <span 
      className="context-chip" 
      onClick={onClick}
      style={color ? { borderColor: `${color}40`, color } : undefined}
    >
      {icon}
      {label}
    </span>
  );
};

export default ContextChip;

