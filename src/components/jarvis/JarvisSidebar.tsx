import React from 'react';
import { MessageSquare, Plus } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisSidebarProps {
  conversations: any[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export const JarvisSidebar: React.FC<JarvisSidebarProps> = ({
  conversations, activeConversationId, onSelect, onCreate
}) => {
  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <h2 className={styles.sidebarTitle}>Conversations</h2>
        <button className={styles.actionBtn} onClick={onCreate} title="New Conversation" aria-label="New Conversation">
          <Plus size={16} />
        </button>
      </div>
      <div className={styles.sidebarList}>
        {conversations.map(conv => (
          <div 
            key={conv.id} 
            className={`${styles.sidebarItem} ${activeConversationId === conv.id ? styles.active : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <MessageSquare size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {conv.title}
            </span>
          </div>
        ))}
        {conversations.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>
            No recent conversations.
          </div>
        )}
      </div>
    </div>
  );
};
