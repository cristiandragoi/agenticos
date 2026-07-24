import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Cpu, Server, User } from 'lucide-react';
import { JarvisComposer } from './JarvisComposer';
import { JarvisTeamPreviewCard } from './JarvisTeamPreviewCard';
import { JarvisTeamExecutionCard } from './JarvisTeamExecutionCard';
import { JarvisGoalCard } from './JarvisGoalCard';
import { useCodexStore } from '../../store/codexStore';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisChatProps {
  conversationId: string;
  onStatusChange?: (status: JarvisRuntimeStatus) => void;
}

export type JarvisRuntimeState = 'idle' | 'understanding' | 'planning' | 'delegating' | 'executing' | 'reviewing' | 'thinking' | 'streaming' | 'approval_required' | 'paused' | 'completed' | 'error' | 'cancelled';

export interface JarvisRuntimeStatus {
  state: JarvisRuntimeState;
  elapsedMs: number;
  firstTokenMs?: number | null;
  provider?: string | null;
  model?: string | null;
  error?: string | null;
}

interface SendErrorState {
  message: string;
  operationId: string;
}

const FIRST_TOKEN_TIMEOUT_MS = 20_000;
const TOTAL_RESPONSE_TIMEOUT_MS = 120_000;

const getMessageOperationId = (message: any): string | undefined => {
  const operationId = message?.metadata?.operationId;
  return typeof operationId === 'string' && operationId.length > 0 ? operationId : undefined;
};

const visibleMessagesForOperations = (messages: any[]) => {
  const seenUserOperations = new Set<string>();
  const seenAgentOperations = new Set<string>();
  const seenErrorOperations = new Set<string>();
  return messages.filter(message => {
    const operationId = getMessageOperationId(message);
    if (message.role === 'user' && operationId) {
      if (seenUserOperations.has(operationId)) return false;
      seenUserOperations.add(operationId);
      return true;
    }
    if (message.role === 'agent' && operationId) {
      if (seenAgentOperations.has(operationId)) return false;
      seenAgentOperations.add(operationId);
      return true;
    }
    if (message.messageType !== 'error') return true;
    if (!operationId) return true;
    if (seenErrorOperations.has(operationId)) return false;
    seenErrorOperations.add(operationId);
    return true;
  });
};

function parseSseFrames(buffer: string) {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() || '';
  return {
    rest,
    events: frames.map(frame => {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      return { event, data };
    })
  };
}

const idleStatus: JarvisRuntimeStatus = {
  state: 'idle',
  elapsedMs: 0,
  firstTokenMs: null,
  provider: null,
  model: null,
  error: null
};

const runtimeStateForDelegatedStatus = (status?: string): JarvisRuntimeState => {
  if (status === 'waiting_for_approval' || status === 'awaiting_approval') return 'approval_required';
  if (status === 'planning' || status === 'queued') return 'executing';
  if (status === 'running' || status === 'executing') return 'executing';
  if (status === 'paused') return 'paused';
  if (status === 'failed') return 'error';
  if (status === 'completed') return 'completed';
  return 'executing';
};

export const JarvisChat: React.FC<JarvisChatProps> = ({ conversationId, onStatusChange }) => {
  const { runSettings } = useCodexStore();
  const [messages, setMessages] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sendError, setSendError] = useState<SendErrorState | null>(null);
  const [createdGoalId, setCreatedGoalId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const firstTokenTimerRef = useRef<number | null>(null);
  const totalResponseTimerRef = useRef<number | null>(null);
  const responseTimedOutRef = useRef(false);
  const requestStartedAtRef = useRef<number | null>(null);
  const statusIntervalRef = useRef<number | null>(null);
  const runtimeStateRef = useRef<JarvisRuntimeState>('idle');
  const firstTokenMsRef = useRef<number | null>(null);

  const emitStatus = (patch: Partial<JarvisRuntimeStatus>) => {
    const elapsedMs = requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : 0;
    if (patch.state) runtimeStateRef.current = patch.state;
    if (patch.firstTokenMs !== undefined) firstTokenMsRef.current = patch.firstTokenMs ?? null;
    onStatusChange?.({
      state: 'idle',
      elapsedMs,
      firstTokenMs: firstTokenMsRef.current,
      provider: null,
      model: null,
      error: null,
      ...patch
    });
  };

  const fetchMessages = async (merge = false) => {
    try {
      const res = await fetch(`/api/jarvis/conversations/${conversationId}/messages`);
      const data = await res.json();
      if (Array.isArray(data)) {
        if (merge) {
          setMessages(prev => {
            const existingIds = new Set(prev.map(message => message.id));
            return [...prev, ...data.filter((message: any) => !existingIds.has(message.id))];
          });
        } else {
          setMessages(data);
        }
      } else {
        console.error('Expected array of messages, got:', data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchMessages();
    setCreatedGoalId(null);
    setSendError(null);
    requestStartedAtRef.current = null;
    emitStatus(idleStatus);
  }, [conversationId]);

  useEffect(() => {
    const convEs = new EventSource(`/api/jarvis/stream/${conversationId}`);
    convEs.addEventListener('message', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setMessages(prev => {
          if (prev.find(p => p.id === data.id)) return prev;
          return [...prev, data];
        });
      } catch {}
    });

    return () => {
      convEs.close();
    };
  }, [conversationId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearResponseTimers();
      if (statusIntervalRef.current !== null) window.clearInterval(statusIntervalRef.current);
    };
  }, []);

  const activeGoalId = useMemo(() => {
    if (createdGoalId) return createdGoalId;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].goalId) return messages[i].goalId as string;
    }
    return null;
  }, [createdGoalId, messages]);

  const latestTeamExecutionMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].messageType === 'team_execution' && messages[i].runId) return messages[i].id;
    }
    return null;
  }, [messages]);

  const visibleMessages = useMemo(() => visibleMessagesForOperations(messages), [messages]);
  const sendErrorHiddenByMessage = useMemo(() => {
    if (!sendError) return false;
    return messages.some(message => (
      message.messageType === 'error'
      && getMessageOperationId(message) === sendError.operationId
    ));
  }, [messages, sendError]);

  function clearResponseTimers() {
    if (firstTokenTimerRef.current !== null) {
      window.clearTimeout(firstTokenTimerRef.current);
      firstTokenTimerRef.current = null;
    }
    if (totalResponseTimerRef.current !== null) {
      window.clearTimeout(totalResponseTimerRef.current);
      totalResponseTimerRef.current = null;
    }
  }

  const startStatusClock = (state: JarvisRuntimeState) => {
    if (statusIntervalRef.current !== null) window.clearInterval(statusIntervalRef.current);
    emitStatus({ state });
    statusIntervalRef.current = window.setInterval(() => emitStatus({ state: runtimeStateRef.current }), 250);
  };

  const stopStatusClock = () => {
    if (statusIntervalRef.current !== null) {
      window.clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
  };

  const appendStreamingAssistantText = (operationId: string, delta: string, final = false) => {
    setMessages(prev => {
      const existingIndex = prev.findIndex(p => p.id === `assistant-${operationId}`);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          content: `${next[existingIndex].content}${delta}`,
          status: final ? 'completed' : 'streaming',
          updatedAt: new Date().toISOString()
        };
        return next;
      }
      if (!delta) return prev;
      return [...prev, {
        id: `assistant-${operationId}`,
        role: 'agent',
        content: delta,
        status: final ? 'completed' : 'streaming',
        routedAgent: 'jarvis',
        createdAt: new Date().toISOString(),
        metadata: { operationId }
      }];
    });
  };

  const appendOperationalEvent = (operationId: string, eventName: string, content: string, metadata: Record<string, any> = {}) => {
    const id = `op-${operationId}-${eventName}`;
    setMessages(prev => {
      const nextMessage = {
        id,
        role: 'system',
        messageType: eventName === 'plan' ? 'plan' : eventName === 'approval_required' ? 'approval_request' : 'system_status',
        content,
        createdAt: new Date().toISOString(),
        metadata: { operationId, eventName, ...metadata }
      };
      const existingIndex = prev.findIndex(p => p.id === id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextMessage;
        return next;
      }
      return [...prev, nextMessage];
    });
  };

  const cancelResponse = () => {
    responseTimedOutRef.current = false;
    abortControllerRef.current?.abort();
    clearResponseTimers();
    stopStatusClock();
    emitStatus({ state: 'cancelled' });
    window.setTimeout(() => {
      if (!abortControllerRef.current) emitStatus(idleStatus);
    }, 1200);
    setIsProcessing(false);
  };

  const buildMessageRequestBody = (text: string, operationId: string) => {
    const body: {
      prompt: string;
      operationId: string;
      workspacePath?: string;
      repositoryPath?: string;
      approvalPolicy?: string;
    } = { prompt: text, operationId };

    if (runSettings.workspacePath) {
      body.workspacePath = runSettings.workspacePath;
      body.repositoryPath = runSettings.workspacePath;
      body.approvalPolicy = runSettings.approvalPolicy;
    }

    return body;
  };

  const handleSendMessage = async (text: string) => {
    const operationId = `jarvis-${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    responseTimedOutRef.current = false;
    requestStartedAtRef.current = Date.now();
    firstTokenMsRef.current = null;
    setIsProcessing(true);
    setSendError(null);
    clearResponseTimers();
    startStatusClock('thinking');
    firstTokenTimerRef.current = window.setTimeout(() => {
      responseTimedOutRef.current = true;
      controller.abort();
      setSendError({ message: 'Jarvis provider timed out before first token.', operationId });
      stopStatusClock();
      emitStatus({ state: 'error', error: 'Jarvis provider timed out before first token.' });
      setIsProcessing(false);
    }, FIRST_TOKEN_TIMEOUT_MS);
    totalResponseTimerRef.current = window.setTimeout(() => {
      responseTimedOutRef.current = true;
      controller.abort();
      setSendError({ message: 'Jarvis response timed out before completion.', operationId });
      stopStatusClock();
      emitStatus({ state: 'error', error: 'Jarvis response timed out before completion.' });
      setIsProcessing(false);
    }, TOTAL_RESPONSE_TIMEOUT_MS);

    setMessages(prev => [...prev, {
      id: operationId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      metadata: { operationId }
    }]);

    try {
      const res = await fetch(`/api/jarvis/conversations/${conversationId}/message/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(buildMessageRequestBody(text, operationId))
      });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      if (!res.body) {
        await sendLegacyMessage(text, operationId, controller);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawTextChunk = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        sawTextChunk = await handleStreamEvents(parsed.events, operationId, sawTextChunk);
      }

      buffer += decoder.decode();
      const parsed = parseSseFrames(`${buffer}\n\n`);
      await handleStreamEvents(parsed.events, operationId, sawTextChunk);
    } catch (e: any) {
      if (controller.signal.aborted && !responseTimedOutRef.current) {
        appendStreamingAssistantText(operationId, '\n\n[Response cancelled]', true);
        emitStatus({ state: 'cancelled' });
      } else if (!sendError) {
        const message = `Could not reach the backend: ${e.message || e}`;
        setSendError({ message, operationId });
        emitStatus({ state: 'error', error: message });
      }
    } finally {
      clearResponseTimers();
      stopStatusClock();
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsProcessing(false);
    }
  };

  const sendLegacyMessage = async (text: string, operationId: string, controller: AbortController) => {
    const fallbackRes = await fetch(`/api/jarvis/conversations/${conversationId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(buildMessageRequestBody(text, operationId))
    });
    const result = await fallbackRes.json().catch(() => ({}));

    if (!fallbackRes.ok || result?.error) {
      if (result?.route) {
        await fetchMessages();
      } else {
        setSendError({ message: result?.error || `Request failed (${fallbackRes.status})`, operationId });
      }
    } else if (result?.route === 'codex' && result?.goalId) {
      setCreatedGoalId(result.goalId);
    }
  };

  const handleStreamEvents = async (events: Array<{ event: string; data: string }>, operationId: string, sawTextChunk: boolean) => {
    let nextSawTextChunk = sawTextChunk;
    for (const event of events) {
      const data = event.data ? JSON.parse(event.data) : {};
      if (event.event === 'intent') {
        emitStatus({ state: data.mode === 'operational_execution' ? 'understanding' : 'thinking' });
        appendOperationalEvent(
          operationId,
          'intent',
          `Intent: ${data.type}${data.route ? ` (${data.route})` : ''}${data.reason ? ` - ${data.reason}` : ''}`,
          data
        );
      } else if (event.event === 'plan') {
        emitStatus({ state: 'planning' });
        const steps = Array.isArray(data.steps) ? data.steps : [];
        appendOperationalEvent(
          operationId,
          'plan',
          `Plan:\n${steps.map((step: string, index: number) => `${index + 1}. ${step}`).join('\n')}`,
          data
        );
      } else if (event.event === 'agent_selected') {
        emitStatus({ state: 'delegating' });
        appendOperationalEvent(operationId, 'agent_selected', `Selected agent: ${data.agent}${data.reason ? ` - ${data.reason}` : ''}`, data);
      } else if (event.event === 'approval_required') {
        emitStatus({ state: 'approval_required' });
        appendOperationalEvent(
          operationId,
          'approval_required',
          `Approval required: ${data.reason}\nAction: ${data.proposedAction}${data.workspace ? `\nWorkspace: ${data.workspace}` : ''}`,
          data
        );
      } else if (event.event === 'execution_started') {
        emitStatus({ state: 'executing' });
        appendOperationalEvent(operationId, 'execution_started', `Execution started: ${data.agent || data.route}`, data);
      } else if (event.event === 'execution_progress') {
        emitStatus({ state: runtimeStateForDelegatedStatus(data.status || data.state) });
        appendOperationalEvent(operationId, 'execution_progress', `Execution status: ${data.state || data.status || 'running'}`, data);
      } else if (event.event === 'execution_completed') {
        emitStatus({ state: 'completed' });
        appendOperationalEvent(
          operationId,
          'execution_completed',
          `Execution completed${data.goalId ? `\nCodeX goal: ${data.goalId}` : ''}${data.teamId ? `\nTeam: ${data.teamId}` : ''}${data.status ? `\nStatus: ${data.status}` : ''}`,
          data
        );
      } else if (event.event === 'execution_failed') {
        emitStatus({ state: 'error', error: data.error || 'Execution failed.' });
        appendOperationalEvent(operationId, 'execution_failed', `Execution failed: ${data.error || 'Unknown error'}`, data);
      } else if (event.event === 'paused') {
        emitStatus({ state: 'paused' });
        appendOperationalEvent(operationId, 'paused', `Execution paused${data.reason ? `: ${data.reason}` : ''}`, data);
      } else if (event.event === 'timing' && data.marker === 'first_token') {
        if (typeof data.elapsedMs === 'number') firstTokenMsRef.current = data.elapsedMs;
        if (firstTokenTimerRef.current !== null) {
          window.clearTimeout(firstTokenTimerRef.current);
          firstTokenTimerRef.current = null;
        }
      } else if (event.event === 'chunk') {
        nextSawTextChunk = true;
        if (firstTokenTimerRef.current !== null) {
          window.clearTimeout(firstTokenTimerRef.current);
          firstTokenTimerRef.current = null;
        }
        emitStatus({
          state: 'streaming',
          firstTokenMs: firstTokenMsRef.current,
          provider: data.provider ?? null,
          model: data.model ?? null
        });
        appendStreamingAssistantText(operationId, data.delta || '');
      } else if (event.event === 'error') {
        const message = data.error || 'Jarvis response failed.';
        setSendError({ message, operationId });
        emitStatus({ state: 'error', error: message });
        await fetchMessages();
      } else if (event.event === 'done') {
        appendStreamingAssistantText(operationId, '', true);
        if (data.goalId) setCreatedGoalId(data.goalId);
        const nextState = data.route && data.route !== 'direct'
          ? runtimeStateForDelegatedStatus(data.status)
          : 'completed';
        emitStatus({
          state: nextState,
          firstTokenMs: typeof data.firstTokenMs === 'number' ? data.firstTokenMs : firstTokenMsRef.current,
          provider: data.provider ?? null,
          model: data.model ?? null
        });
        if (nextState === 'completed') {
          window.setTimeout(() => {
            if (!abortControllerRef.current) emitStatus(idleStatus);
          }, 1200);
        }
        if (data.route !== 'direct' || !nextSawTextChunk) await fetchMessages(true);
        if (data.route === 'codex' && data.goalId) setCreatedGoalId(data.goalId);
      }
    }
    return nextSawTextChunk;
  };

  const renderMessageContent = (content: string) => {
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

                {isSystem && msg.messageType === 'plan' && (
                  <div data-testid="jarvis-operational-plan" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {renderMessageContent(msg.content)}
                  </div>
                )}

                {isSystem && msg.messageType === 'approval_request' && (
                  <div data-testid="jarvis-approval-card" style={{ display: 'grid', gap: 10, color: 'var(--text-primary)' }}>
                    <div style={{ color: 'var(--color-warning)', fontWeight: 700 }}>Approval Required</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{renderMessageContent(msg.content)}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" disabled title="Approval is handled by the generated execution card">Approve</button>
                      <button type="button" disabled title="Approval is handled by the generated execution card">Reject</button>
                    </div>
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

                {isSystem && !['routing_event', 'error', 'system_status', 'plan', 'approval_request', 'team_preview', 'team_execution'].includes(msg.messageType || '') && (
                  <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
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

        {activeGoalId && (
          <div className={`${styles.messageRow} ${styles.system}`}>
            <div className={styles.messageContent} style={{ background: 'transparent', border: 'none', width: '100%', padding: 0 }}>
              <JarvisGoalCard goalId={activeGoalId} />
            </div>
          </div>
        )}

        {sendError && !sendErrorHiddenByMessage && (
          <div data-testid="jarvis-send-error" className={`${styles.messageRow} ${styles.system}`}>
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
        onCancelResponse={cancelResponse}
      />
    </>
  );
};
