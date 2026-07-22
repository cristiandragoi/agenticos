import React, { useState, useEffect } from 'react';
import { PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { JarvisSidebar } from '../components/jarvis/JarvisSidebar';
import { JarvisChat } from '../components/jarvis/JarvisChat';
import { JarvisInspector } from '../components/jarvis/JarvisInspector';
import { JarvisWorkspaceBar } from '../components/jarvis/JarvisWorkspaceBar';
import styles from './JarvisStudio.module.css';

/** Below this width the right inspector collapses automatically so the center workspace stays usable. */
const INSPECTOR_AUTO_COLLAPSE_PX = 1400;

export default function JarvisStudio() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

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

  // Auto-collapse the inspector on narrower screens. Once the user toggles
  // it manually, stop overriding their choice.
  useEffect(() => {
    let userOverride = false;
    const onResize = () => {
      if (userOverride) return;
      setInspectorCollapsed(window.innerWidth < INSPECTOR_AUTO_COLLAPSE_PX);
    };
    onResize();
    window.addEventListener('resize', onResize);

    const markOverride = (e: any) => {
      if (e.detail === 'inspector-toggled') userOverride = true;
    };
    window.addEventListener('jarvis:inspector-toggled', markOverride);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('jarvis:inspector-toggled', markOverride);
    };
  }, []);

  const toggleInspector = () => {
    window.dispatchEvent(new CustomEvent('jarvis:inspector-toggled', { detail: 'inspector-toggled' }));
    setInspectorCollapsed(c => !c);
  };

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
      {/* LEFT: Conversation History (collapsible) */}
      {!sidebarCollapsed && (
        <JarvisSidebar 
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={setActiveConversationId}
          onCreate={handleCreateConversation}
        />
      )}
      
      {/* CENTER: Main conversation and execution area */}
      <div className={styles.mainColumn}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button
              className={styles.actionBtn}
              onClick={() => setSidebarCollapsed(c => !c)}
              title={sidebarCollapsed ? 'Show conversations' : 'Hide conversations'}
              aria-label="Toggle sidebar"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <div className={styles.headerTitle}>
              <h1>Jarvis Operational Workspace</h1>
            </div>
          </div>
          <div className={styles.topBarRight}>
            <button
              className={styles.actionBtn}
              onClick={toggleInspector}
              title={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
              aria-label="Toggle inspector"
            >
              {inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            </button>
          </div>
        </div>

        <JarvisWorkspaceBar />

        {activeConversationId ? (
          <JarvisChat 
            conversationId={activeConversationId} 
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
      
      {/* RIGHT: Contextual Inspector (collapsible, auto-collapses on narrow screens) */}
      {!inspectorCollapsed && (
        <JarvisInspector 
          activeConversation={activeConversation}
        />
      )}
    </div>
  );
}
