import React, { useState } from 'react';
import { useAgentCommand } from '../utils/agentCommands';

interface Agent {
  id: string;
  name: string;
}

const agentList: Agent[] = [
  { id: 'agent-qwythos', name: 'Qwythos' },
  { id: 'agent-jarvis', name: 'Jarvis Voice' },
  { id: 'agent-video', name: 'Video Welders' }
];

const QwythosDashboard: React.FC = () => {
  const { runAgentCommand } = useAgentCommand();
  const [input, setInput] = useState('');
  const [targetAgent, setTargetAgent] = useState<Agent | null>(null);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [taskStatus, setTaskStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');

  const logActivity = (message: string) => {
    setActivityLog((prev) => [...prev, message]);
  };

  const handleQwythosSubmit = async () => {
    if (!targetAgent || !input.trim()) return;
    logActivity(`Qwythos command: "${input}" → ${targetAgent.name}`);
    setTaskStatus('running');
    try {
      await runAgentCommand(targetAgent.id, targetAgent.name, input.trim(), logActivity);
      logActivity(`Command completed for ${targetAgent.name}`);
      setTaskStatus('completed');
    } catch (err: any) {
      logActivity(`Command failed for ${targetAgent.name}: ${err?.message || err}`);
      setTaskStatus('failed');
    }
    setInput('');
  };

  const statusColor = {
    idle: '#64748b',
    running: '#ef4444',
    completed: '#22c55e',
    failed: '#eab308',
  }[taskStatus];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, width: '100%', overflow: 'hidden', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: 2,
          background: statusColor,
          boxShadow: taskStatus === 'running' ? `0 0 8px ${statusColor}` : 'none',
          transition: 'background 0.3s',
        }} />
        <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
          QWYTHOS WORKSPACE
        </span>
        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
          · Qwythos 9B Abliterated · Agentic Tools
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Target:</label>
          <select
            value={targetAgent?.id || ''}
            onChange={(e) => {
              const agent = agentList.find((a) => a.id === e.target.value);
              setTargetAgent(agent || null);
            }}
            style={{
              padding: '4px 8px',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
            }}
          >
            <option value="">Select Agent</option>
            {agentList.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Activity Log */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 20px',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '0.82rem',
        background: 'var(--bg-base)',
        lineHeight: 1.6,
      }}>
        {activityLog.length === 0 && (
          <span style={{ color: 'var(--text-muted, #555)' }}>
            Select an agent, type a command below, and click Send to begin...
          </span>
        )}
        {activityLog.map((log, index) => (
          <div key={index} style={{
            marginBottom: 4,
            color: log.includes('failed') || log.includes('Error')
              ? '#ef4444'
              : log.includes('completed') || log.includes('status: 200')
              ? '#22c55e'
              : 'var(--color-info, #60a5fa)',
          }}>
            {log}
          </div>
        ))}
      </div>

      {/* Command Input */}
      <div style={{
        display: 'flex', gap: 8,
        padding: '12px 20px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}>
        <input
          placeholder="Ask Qwythos to inspect or control Agentic OS..."
          style={{
            flex: 1, padding: '8px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
          }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQwythosSubmit()}
        />
        <button
          onClick={handleQwythosSubmit}
          disabled={!targetAgent || !input.trim()}
          style={{
            padding: '8px 16px',
            background: '#8b5cf6',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.875rem',
            opacity: (!targetAgent || !input.trim()) ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default QwythosDashboard;
