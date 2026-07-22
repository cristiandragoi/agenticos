import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Server, User, Cpu, AlertCircle } from 'lucide-react';
import { JarvisComposer } from './JarvisComposer';
import { JarvisTeamPreviewCard } from './JarvisTeamPreviewCard';
import { JarvisTeamExecutionCard } from './JarvisTeamExecutionCard';
import { JarvisGoalCard } from './JarvisGoalCard';
import { useCodexStore } from '../../store/codexStore';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisChatProps {
  conversationId: string;
}

interface SendErrorState {
  message: string;
  operationId: string;
}

const getMessageOperationId = (message: any): string | undefined => {
  const operationId = message?.metadata?.operationId;
  return typeof operationId === 'string' && operationId.length > 0 ? operationId : undefined;
};

const visibleMessagesForOperations = (messages: any[]) => {
  const seenErrorOperations = new Set<string>();
  return messages.filter(message => {
    if (message.messageType !== 'error') return true;
    const operationId = getMessageOperationId(message);
    if (!operationId) return true;
    if (seenErrorOperations.has(operationId)) return false;
    seenErrorOperations.add(operationId);
    return true;
  });
};

export const JarvisChat: React.FC<JarvisChatProps> = ({ conversationId }) => {
  const { runSettings } = useCodexStore();
  const [messages, setMessages] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sendError, setSendError] = useState<SendErrorState | null>(null);
  // The CodeX goal created from THIS chat session. Persisted in component
  // state and re-derived from the message history, so re-renders, stream
  // reconnects, and remounts never lose it.
  const [createdGoalId, setCreatedGoalId] = useState<string | null>(null);
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
    setCreatedGoalId(null); // reset session goal on conversation change
    setSendError(null);
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
  }, [messages, isProcessing]);

  // The active CodeX goal: prefer the id returned by this session's POST,
  // otherwise recover it from the persisted message history (goalId column).
  const activeGoalId = useMemo(() => {
    if (createdGoalId) return createdGoalId;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].goalId) return messages[i].goalId as string;
    }
    return null;
  }, [createdGoalId, messages]);

  // Only the LATEST team execution gets the full execution card — older
  // executions stay as compact history notes so nothing is duplicated.
  const latestTeamExecutionMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].messageType === 'team_execution' && messages[i].runId) return messages[i].id;
    }
    return null;
  }, [messages]);

  const workspaceReady = !!runSettings.workspacePath;

  const visibleMessages = useMemo(() => visibleMessagesForOperations(messages), [messages]);
  const sendErrorHiddenByMessage = useMemo(() => {
    if (!sendError) return false;
    return messages.some(message => (
      message.messageType === 'error'
      && getMessageOperationId(message) === sendError.operationId
    ));
  }, [messages, sendError]);

  const handleSendMessage = async (text: string) => {
    const operationId = `jarvis-${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setIsProcessing(true);
    setSendError(null);
    // Optimistically add user message
    setMessages(prev => [...prev, {
      id: operationId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      metadata: { operationId }
    }]);

    try {
      const res = await fetch(`/api/jarvis/conversations/${conversationId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          workspacePath: runSettings.workspacePath || undefined,
          approvalPolicy: runSettings.approvalPolicy,
          operationId
        })
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok || result?.error) {
        // Orchestrator-level failures are persisted as conversation messages.
        // Refresh once so the error is visible even if the stream is late.
        if (result?.route) {
          await fetchMessages();
        } else {
          setSendError({ message: result?.error || `Request failed (${res.status})`, operationId });
        }
      } else if (result?.route === 'codex' && result?.goalId) {
        // Preserve the real goalId so the execution card subscribes to the
        // correct stream — never the team activeRunId.
        setCreatedGoalId(result.goalId);
      }
      // The conversation stream adds the agent/system messages.
    } catch (e: any) {
      setSendError({ message: `Could not reach the backend: ${e.message || e}`, operationId });
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
      <div className={styles.chatContainer} data-testid="jarvis-chat-scroll">
        {visibleMessages.map(msg => {
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

                {isSystem && msg.messageType === 'team_preview' && msg.metadata?.teamSheet && (
                  <JarvisTeamPreviewCard 
                    conversationId={conversationId}
                    teamId={msg.metadata.teamId}
                    teamSheet={msg.metadata.teamSheet}
                  />
                )}

                {isSystem && msg.messageType === 'team_execution' && msg.runId && msg.id === latestTeamExecutionMessageId && (
                  <div data-testid="jarvis-team-execution">
                    <JarvisTeamExecutionCard 
                      runId={msg.runId}
                      teamId={msg.metadata?.teamId}
                    />
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

        {/* Active CodeX goal: live status, approval controls, real event stream */}
        {activeGoalId && (
          <div className={`${styles.messageRow} ${styles.system}`}>
            <div className={styles.messageContent} style={{ background: 'transparent', border: 'none', width: '100%', padding: 0 }}>
              <JarvisGoalCard goalId={activeGoalId} />
            </div>
          </div>
        )}

        {sendError && !sendErrorHiddenByMessage && (
          <div
            data-testid="jarvis-send-error"
            className={`${styles.messageRow} ${styles.system}`}
          >
            <div className={styles.messageContent} style={{ borderColor: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-error)' }}>
              <AlertCircle size={14} />
              {sendError.message}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <JarvisComposer
        onSendMessage={handleSendMessage}
        isProcessing={isProcessing}
        workspaceReady={workspaceReady}
      />
    </>
  );
};
