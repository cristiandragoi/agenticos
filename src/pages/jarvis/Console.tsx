// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { useData } from '../../store/dataStore';
import { Terminal as TerminalIcon, Trash2, Send } from 'lucide-react';

const Console: React.FC = () => {
  const { runs } = useData();
  const [command, setCommand] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | 'info' | 'error' | 'success'>('all');

  // Seed logs from runs data
  useEffect(() => {
    const runLogs = (runs || []).flatMap((r: any) =>
      (r.logs || []).map((l: string) => {
        const level = l.includes('Error') || l.includes('Failed') ? 'error'
          : l.includes('Completed') || l.includes('passed') ? 'success'
          : 'info';
        return `[${new Date(r.updatedAt).toLocaleTimeString()}] [${r.id.slice(0, 8)}] ${l}`;
      })
    );
    setLogs(prev => {
      const merged = [...runLogs, ...prev];
      return merged.slice(0, 200);
    });
  }, [runs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    setLogs(prev => [
      `[${new Date().toLocaleTimeString()}] [CONSOLE] > ${command}`,
      ...prev,
    ]);
    // Simulate response
    setTimeout(() => {
      setLogs(prev => [
        `[${new Date().toLocaleTimeString()}] [CONSOLE] Command received: ${command}`,
        ...prev,
      ]);
    }, 300);
    setCommand('');
  };

  const clearLogs = () => setLogs([]);

  const filteredLogs = filter === 'all'
    ? logs
    : logs.filter(l => {
        if (filter === 'error') return l.includes('[Error]') || l.includes('Error');
        if (filter === 'success') return l.includes('Completed') || l.includes('passed') || l.includes('Deployed');
        return true;
      });

  return (
    <div className="jarvis-console">
      <div className="jarvis-console__toolbar">
        <div className="jarvis-console__toolbar-left">
          <TerminalIcon size={16} />
          <h2>Agent Console</h2>
        </div>
        <div className="jarvis-console__toolbar-right">
          <div className="segmented-tabs">
            <button
              className={`segmented-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >ALL</button>
            <button
              className={`segmented-tab ${filter === 'info' ? 'active' : ''}`}
              onClick={() => setFilter('info')}
            >INFO</button>
            <button
              className={`segmented-tab ${filter === 'error' ? 'active' : ''}`}
              onClick={() => setFilter('error')}
            >ERRORS</button>
            <button
              className={`segmented-tab ${filter === 'success' ? 'active' : ''}`}
              onClick={() => setFilter('success')}
            >SUCCESS</button>
          </div>
          <button className="btn btn-sm" onClick={clearLogs} title="Clear">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="jarvis-console__log-area">
        {filteredLogs.map((line, i) => {
          let cls = 'jarvis-console__line';
          if (line.includes('Error') || line.includes('Failed') || line.includes('error')) cls += ' line--error';
          else if (line.includes('Completed') || line.includes('passed') || line.includes('Deployed')) cls += ' line--success';
          return (
            <div key={i} className={cls}>
              {line}
            </div>
          );
        })}
        {(runs || []).length === 0 && (
          <div className="jarvis-empty">No log data — runs will appear here</div>
        )}
        <div ref={logEndRef} />
      </div>
      <form className="jarvis-console__input-bar" onSubmit={handleSubmit}>
        <span className="jarvis-console__prompt">❯</span>
        <input
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="Enter command for agent fleet..."
          className="jarvis-console__input"
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={!command.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
};

export default Console;