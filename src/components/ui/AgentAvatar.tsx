import React from 'react';

interface AgentAvatarProps {
  avatar: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
  status?: 'active' | 'inactive' | 'error';
}

const AgentAvatar: React.FC<AgentAvatarProps> = ({ avatar, color, size = 'md', status }) => {
  let statusColor = 'transparent';
  if (status === 'active') statusColor = 'var(--color-success)';
  else if (status === 'inactive') statusColor = 'var(--text-tertiary)';
  else if (status === 'error') statusColor = 'var(--color-error)';

  return (
    <div className={`agent-avatar agent-avatar--${size}`} style={{ color, borderColor: `${color}40` }}>
      {avatar}
      {status && (
        <span 
          className="agent-avatar__status" 
          style={{ backgroundColor: statusColor }} 
        />
      )}
    </div>
  );
};

export default AgentAvatar;

