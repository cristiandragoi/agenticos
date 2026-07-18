import React, { useState, useEffect, useRef } from 'react';
import { Server, User, Cpu, FileText, AlertCircle } from 'lucide-react';
import { JarvisComposer } from './JarvisComposer';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisChatProps {
  conversationId: string;
  activeGoalId?: string | null;
}

export const JarvisChat: React.FC<JarvisChatProps> = ({ conversationId, activeGoalId }) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [goalEvents, setGoalEvents] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/jarvis/conversations/${conversationId}/messages`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
      } else {
        console.error('Expected array of messages, got:', data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchMessages();
    setGoalEvents([]); // reset goal events on conv change
  }, [conversationId]);

  useEffect(() => {
    // Connect to conversation stream
    const convEs = new EventSource(`/api/jarvis/stream/${conversationId}`);
    convEs.addEventListener('message', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setMessages(prev => {
          if (prev.find(p => p.id === data.id)) return prev;
          return [...prev, data];
        });
      } catch (err) {}
    });

    return () => {
      convEs.close();
    };
  }, [conversationId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, goalEvents, isProcessing]);

  useEffect(() => {
    if (!activeGoalId) return;

    // Connect to CodeX streaming
    const es = new EventSource(`/api/chat/agents/goal/stream/${activeGoalId}`);
    
    es.addEventListener('goal_event', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setGoalEvents(prev => {
          if (prev.find(p => p.sequenceId === data.sequenceId)) return prev;
          return [...prev, data].sort((a, b) => a.sequenceId - b.sequenceId);
        });
      } catch (err) {}
    });

    return () => {
      es.close();
    };
  }, [activeGoalId]);

  const handleSendMessage = async (text: string) => {
    setIsProcessing(true);
    // Optimistically add user message
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    }]);

    try {
      await fetch(`/api/jarvis/conversations/${conversationId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text })
      });
      // The stream will add the agent messages
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderMessageContent = (content: string) => {
    // Simple markdown rendering
    const parts = content.split('```');
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const firstLineBreak = part.indexOf('\n');
        const code = firstLineBreak > -1 ? part.substring(firstLineBreak + 1) : part;
        return <pre key={i} style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '6px', overflowX: 'auto', marginTop: '8px', marginBottom: '8px' }}><code>{code}</code></pre>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <>
      <div className={styles.chatContainer}>
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          const isSystem = msg.role === 'system';
          const isError = msg.messageType === 'error';

          return (
            <div key={msg.id} className={`${styles.messageRow} ${isUser ? styles.user : isSystem ? styles.system : styles.agent}`}>
              {!isSystem && (
                <div className={`${styles.messageAvatar} ${isUser ? styles.user : styles.agent}`}>
                  {isUser ? <User size={16} /> : <Cpu size={16} />}
                </div>
              )}
              
              <div className={styles.messageContent} style={isError ? { borderColor: 'var(--color-error)' } : {}}>
                {!isSystem && (
                  <div className={styles.messageMeta}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {isUser ? 'You' : 'Jarvis'}
                      {msg.routedAgent && msg.routedAgent !== 'jarvis' && ` (via ${msg.routedAgent})`}
                    </span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
                
                {isSystem && msg.messageType === 'routing_event' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-tertiary)' }}>
                    <Server size={14} />
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && isError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-error)' }}>
                    <AlertCircle size={14} />
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && msg.messageType === 'system_status' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-jarvis)' }}>
                    <Cpu size={14} />
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {!isSystem && (
                  <div style={{ color: isError ? 'var(--color-error)' : 'inherit' }}>
                    {renderMessageContent(msg.content)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        
        {/* Render active CodeX Goal Events if any */}
        {goalEvents.length > 0 && (
          <div className={`${styles.messageRow} ${styles.system}`}>
            <div className={styles.messageContent} style={{ border: '1px solid var(--color-jarvis)', background: 'rgba(56, 189, 248, 0.05)', textAlign: 'left', width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontWeight: 600, color: 'var(--color-jarvis)' }}>
                <FileText size={16} />
                CodeX Execution Stream
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {goalEvents.map(evt => (
                  <div key={evt.sequenceId} style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-primary)', marginRight: '8px' }}>[{evt.state}]</span>
                    {evt.tool ? <span style={{ color: 'var(--color-jarvis)', marginRight: '8px' }}>Tool: {evt.tool}</span> : ''} 
                    {evt.message}
                    {evt.state === 'interrupted_requires_review' && (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                        <button className={`${styles.actionBtn} ${styles.primary}`} style={{ padding: '4px 12px' }} onClick={() => fetch(`/api/chat/agents/goal/${activeGoalId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' })})}>Approve</button>
                        <button className={styles.actionBtn} style={{ padding: '4px 12px', color: 'var(--color-error)' }} onClick={() => fetch(`/api/chat/agents/goal/${activeGoalId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'abort' })})}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <JarvisComposer onSendMessage={handleSendMessage} isProcessing={isProcessing} />
    </>
  );
};
