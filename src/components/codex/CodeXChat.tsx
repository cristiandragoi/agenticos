import React, { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, Terminal, FileCode, ShieldCheck, AlertTriangle, Play, Loader2, Zap, Cog, Copy, Check } from 'lucide-react';
import { useCodexStore } from '../../store/codexStore';
import { apiFetch, apiUrl } from '../../api/client';
import ReactMarkdown from 'react-markdown';

const CopyButton = ({ text, label }: { text: string, label: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Copy failed:', err);
    });
  };

  return (
    <button 
      onClick={handleCopy} 
      className="codex-chat__btn" 
      style={{ padding: '4px 8px', fontSize: '10px', display: 'flex', gap: '4px', alignItems: 'center', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: copied ? '#34d399' : '#8b949e' }}
      aria-label={label}
      title={label}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : ''}
    </button>
  );
};

const MarkdownComponents = {
  pre({ children, ...props }: any) {
    const codeElement = children as React.ReactElement<any>;
    const codeText = codeElement?.props?.children || '';
    return (
      <div style={{ position: 'relative', marginTop: '8px', marginBottom: '8px' }}>
        <div style={{ position: 'absolute', top: '4px', right: '4px', zIndex: 10 }}>
          <CopyButton text={String(codeText).replace(/\n$/, '')} label="Copy code" />
        </div>
        <pre style={{ backgroundColor: '#090C10', padding: '24px 16px 16px', borderRadius: '8px', overflowX: 'auto', margin: 0, border: '1px solid #30363d' }} {...props}>
          {children}
        </pre>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    return <code className={className} {...props} style={{ backgroundColor: '#090C10', padding: '2px 4px', borderRadius: '4px', fontFamily: '"JetBrains Mono", monospace' }}>{children}</code>;
  }
};

interface Props {
  activeGoalId: string | null;
  onGoalCreated: (id: string) => void;
}

export const CodeXChat: React.FC<Props> = ({ activeGoalId, onGoalCreated }) => {
  const {
    events, setEvents,
    localChat, setLocalChat,
    input, setInput,
    workspacePath, setWorkspacePath,
    runSettings,
    showSettings, setShowSettings,
    isPlanning, setIsPlanning,
    isStarting, setIsStarting,
    goalStatus
  } = useCodexStore();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [copiedPlanId, setCopiedPlanId] = useState<number | null>(null);

  useEffect(() => {
    if (!activeGoalId) {
      setEvents([]);
      return;
    }

    const fetchHistory = async () => {
      try {
        const res = await apiFetch(`/api/chat/agents/goal/${activeGoalId}`);
        const data = await res.json();
        if (data.history) {
          setEvents(data.history);
        }
        if (data.status) {
          // fallback to standard setter if zustand setState is strict
        }
      } catch (e) {}
    };
    fetchHistory();
    
    const es = new EventSource(apiUrl(`/api/chat/agents/goal/stream/${activeGoalId}`));
    es.addEventListener('goal_event', (e: any) => {
      try {
        const data = JSON.parse(e.data);
        setEvents(prev => {
          if (prev.find(p => p.sequenceId === data.sequenceId)) return prev;
          return [...prev, data].sort((a, b) => a.sequenceId - b.sequenceId);
        });
        if (data.state) {
          // fallback
        }
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      } catch (err) {}
    });

    return () => es.close();
  }, [activeGoalId]);

  const handleSend = async () => {
    console.log('handleSend started. input:', input);
    if (!input.trim()) return;
    const userPrompt = input;
    setInput('');
    setLocalChat(prev => [...prev, { role: 'user', content: userPrompt, timestamp: new Date().toISOString() }]);
    setIsPlanning(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

    if (!activeGoalId) {
      console.log('creating new goal...');
      try {
        const payload = { 
          goal: userPrompt,
          executionProvider: 'ollama',
          validationProvider: 'omniRoute',
          workspacePath: runSettings.workspacePath || workspacePath,
          approvalPolicy: 'manual'
        };
        console.log('Sending fetch with payload:', JSON.stringify(payload));
        const res = await apiFetch('/api/chat/agents/goal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        console.log('handleSend fetch response:', JSON.stringify(data));
        if (data.goalId) {
          onGoalCreated(data.goalId);
        }
      } catch (e) {
        console.error('handleSend error:', e);
        setLocalChat(prev => [...prev, { 
          role: 'codex', 
          content: "Error creating goal.",
          timestamp: new Date().toISOString()
        }]);
      } finally {
        console.log('handleSend ending, setting isPlanning false');
        setIsPlanning(false);
      }
    } else {
      try {
        await apiFetch(`/api/chat/agents/goal/${activeGoalId}/revise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: userPrompt, executionProvider: 'ollama' })
        });
      } catch (e) {
        setLocalChat(prev => [...prev, { 
          role: 'codex', 
          content: "Error revising plan.",
          timestamp: new Date().toISOString()
        }]);
      }
    }
    
    console.log('handleSend ending, setting isPlanning false');
    setIsPlanning(false);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleStart = async () => {
    setIsStarting(true);
    if (activeGoalId) {
      try {
        await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resume' })
        });
      } catch (e) {}
    }
    setIsStarting(false);
  };

  const handleCancel = async () => {
    if (activeGoalId) {
      try {
        await apiFetch(`/api/chat/agents/goal/${activeGoalId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'abort' })
        });
      } catch (e) {}
    } else {
      // Fallback local cleanup if no active goal
      setLocalChat(prev => prev.filter(m => m.showStartAction !== true));
    }
  };

  const renderMessage = (evt: any, idx: number) => {
    const time = new Date(evt.timestamp || evt.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (evt.type === 'user_message' || evt.role === 'user') {
      return (
        <div key={idx} className="codex-msg user">
          <div className="codex-msg__bubble">{evt.message || evt.content}</div>
          <span className="codex-msg__time" style={{marginTop: '4px'}}>{time}</span>
        </div>
      );
    }
    
    const isAssistant = evt.type === 'assistant_message' || evt.role === 'assistant' || evt.role === 'codex' || evt.tool === 'plan';
    
    if (isAssistant) {
      const msgContent = evt.message || evt.content || '';
      return (
        <div key={idx} className="codex-msg codex" style={{ position: 'relative' }}>
          <div className="codex-msg__header" style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="codex-msg__icon codex"><Zap size={14} /></div>
              <span style={{fontSize: '12px', fontWeight: 'bold', color: '#c9d1d9'}}>CodeX</span>
              <span className="codex-msg__time">{time}</span>
            </div>
            {msgContent && (
              <CopyButton text={msgContent} label="Copy response" />
            )}
          </div>
          <div className="codex-msg__bubble" style={{width: '100%', maxWidth: '100%'}}>
            <ReactMarkdown components={MarkdownComponents}>
              {msgContent}
            </ReactMarkdown>
          </div>
          
          {/* Render Plan Actions for the latest plan if awaiting approval */}
          {(evt.tool === 'plan' || evt.showStartAction) && activeGoalId && (goalStatus === 'interrupted_requires_review' || goalStatus === 'planning') && idx === lastActionableIdx && (
            <div style={{display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap'}}>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(msgContent);
                  setCopiedPlanId(idx);
                  setTimeout(() => setCopiedPlanId(null), 2000);
                }} 
                className="codex-chat__btn" 
                style={{border: '1px solid #30363d'}}
                aria-label="Copy Plan"
              >
                {copiedPlanId === idx ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copiedPlanId === idx ? 'Copied' : 'Copy Plan'}
              </button>
              
              <button onClick={() => handleStart()} disabled={isStarting} className="codex-start-btn">
                {isStarting ? <Loader2 size={12} className="icon-spin" /> : <Play size={12} />}
                Approve and Start
              </button>

              <button onClick={() => {
                setInput('Please change the plan: ');
                inputRef.current?.focus();
              }} className="codex-chat__btn" style={{border: '1px solid #30363d'}}>
                Request Changes
              </button>

              <button onClick={handleCancel} className="codex-chat__btn" style={{border: '1px solid #30363d'}}>
                Cancel
              </button>
            </div>
          )}

          {/* Show Cancelled state if aborted */}
          {(evt.tool === 'plan' || evt.showStartAction) && activeGoalId && goalStatus === 'cancelled' && idx === lastActionableIdx && (
            <div style={{marginTop: '12px', color: '#f85149', fontSize: '12px', fontWeight: 'bold'}}>
              Plan Cancelled.
            </div>
          )}
        </div>
      );
    }

    let title = "Execution Event";
    let color = "#58a6ff";

    if (evt.state === 'planning') {
      title = "Plan Created";
      color = "#a371f7";
    } else if (evt.state === 'validating' || evt.type === 'validation') {
      title = "Validation";
      color = "#3fb950";
    } else if (evt.state === 'failed' || evt.type === 'error') {
      title = "Execution Failed";
      color = "#f85149";
    }

    return (
      <div key={idx} className="codex-msg codex" style={{paddingLeft: '32px'}}>
        <div style={{border: `1px solid ${color}`, borderRadius: '6px', padding: '12px', width: '100%', maxWidth: '80%', backgroundColor: 'rgba(22, 27, 34, 0.5)'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
            <span style={{fontSize: '10px', textTransform: 'uppercase', color, fontWeight: 'bold'}}>{title}</span>
            <span className="codex-msg__time">{time}</span>
          </div>
          <div style={{fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', color: '#c9d1d9'}}>{evt.message || evt.content}</div>
        </div>
      </div>
    );
  };

  const allItems = [...localChat, ...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const lastActionableIdx = allItems.reduce((acc, item, i) => (item.tool === 'plan' || item.showStartAction) ? i : acc, -1);

  return (
    <div className="codex-chat">
      <div className="codex-chat__messages">
        {allItems.length === 0 ? (
          <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', gap: '16px'}}>
            <Zap size={32} style={{color: '#2ea043', opacity: 0.8}} />
            <h2 style={{fontSize: '20px', fontWeight: 'bold', color: '#c9d1d9'}}>What do you want to build?</h2>
            <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '16px'}}>
              {['Build a shared World Brain', 'Migrate auth to NextAuth v5', 'Optimize database queries'].map((ex, i) => (
                <button key={i} onClick={() => setInput(ex)} style={{padding: '6px 12px', fontSize: '12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '16px', color: '#8b949e', cursor: 'pointer'}}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          allItems.map((evt, idx) => renderMessage(evt, idx))
        )}
        
        {isPlanning && (
          <div className="codex-msg codex">
            <div className="codex-msg__header">
              <div className="codex-msg__icon codex"><Loader2 size={12} className="icon-spin" /></div>
              <span style={{fontSize: '12px', fontWeight: 'bold', color: '#8b949e'}}>CodeX is thinking...</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="codex-chat__footer">
        <div className="codex-chat__input-wrapper">
          {showSettings && (
            <div style={{display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #30363d'}}>
              <span style={{fontSize: '10px', textTransform: 'uppercase', color: '#8b949e', fontWeight: 'bold'}}>Workspace</span>
              <input 
                type="text" 
                value={workspacePath} 
                onChange={e => setWorkspacePath(e.target.value)} 
                style={{flex: 1, background: 'transparent', border: 'none', color: '#c9d1d9', outline: 'none', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace'}} 
              />
            </div>
          )}
          
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Message CodeX..."
            className="codex-chat__textarea"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="codex-chat__toolbar">
            <div style={{display: 'flex', gap: '4px'}}>
              <button className="codex-chat__btn" title="Attach Context"><Paperclip size={16} /></button>
              <button onClick={() => setShowSettings(!showSettings)} className="codex-chat__btn" style={{color: showSettings ? '#58a6ff' : ''}} title="Execution Settings"><Cog size={16} /></button>
            </div>
            <button 
              disabled={!input.trim() || isPlanning}
              onClick={handleSend}
              className="codex-chat__send"
              title="Send message"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
        <div style={{textAlign: 'center', marginTop: '8px'}}>
          <span style={{fontSize: '10px', color: '#8b949e'}}>CodeX may generate inaccurate code or modify files unexpectedly. Review plans carefully.</span>
        </div>
      </div>
    </div>
  );
};
