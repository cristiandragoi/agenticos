import React, { useState, useEffect } from 'react';
import { JarvisSidebar } from '../components/jarvis/JarvisSidebar';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisInspector } from '../components/jarvis/JarvisInspector';
import styles from './JarvisStudio.module.css';

export default function JarvisStudio() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const fetchConversations = async () => {
    try {
      const res = await fetch('/api/jarvis/conversations');
      const data = await res.json();
      if (Array.isArray(data)) {
        setConversations(data);
        if (data.length > 0 && !activeConversationId) {
          setActiveConversationId(data[data.length - 1].id);
        }
      } else {
        console.error('Failed to fetch conversations:', data);
        setConversations([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const handleCreateConversation = async () => {
    try {
      const res = await fetch('/api/jarvis/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' })
      });
      const data = await res.json();
      await fetchConversations();
      setActiveConversationId(data.id);
    } catch (e) {
      console.error(e);
    }
  };

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <div className={styles.jarvisViewport}>
      {/* LEFT: Conversation History */}
      <JarvisSidebar 
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={setActiveConversationId}
        onCreate={handleCreateConversation}
      />
      
      {/* CENTER: Main Chat and Composer */}
      <div className={`${styles.mainColumn} ${styles.mainColumnWithInspector}`}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <div className={styles.headerTitle}>
              <h1>Jarvis Operational Workspace</h1>
            </div>
          </div>
        </div>

        {activeConversationId ? (
          <JarvisChat 
            conversationId={activeConversationId} 
            activeGoalId={activeConversation?.activeRunId}
          />
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <h2 className={styles.emptyStateTitle}>Jarvis Ordnance</h2>
            <p className={styles.emptyStateDesc}>Create a new conversation to coordinate Agentic OS.</p>
            <button className={`${styles.actionBtn} ${styles.primary}`} style={{ marginTop: '20px', padding: '10px 20px' }} onClick={handleCreateConversation}>
              Start Conversation
            </button>
          </div>
        )}
      </div>
      
      {/* RIGHT: Inspector */}
      <JarvisInspector 
        activeConversation={activeConversation}
      />
    </div>
  );
}
