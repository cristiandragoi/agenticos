import React, { useEffect, useState, useRef } from 'react';
import { Cpu, Cloud, WifiOff, ChevronDown, Check } from 'lucide-react';
import { apiFetch, apiUrl } from '../../api/client';

export interface RuntimeStatusWidgetProps {
  agent: 'CodeX' | 'Jarvis' | 'Ornith';
  onModelSelect?: (provider: string, model?: string) => void;
}

export const RuntimeStatusWidget: React.FC<RuntimeStatusWidgetProps> = ({ agent, onModelSelect }) => {
  const [status, setStatus] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Determine defaults based on agent
    if (agent === 'CodeX') {
      setSelectedProvider('ollama');
      setSelectedModel('qwen2.5-coder:14b');
    } else if (agent === 'Ornith') {
      setSelectedProvider('ollama');
      setSelectedModel('qwythos:9b');
    } else {
      setSelectedProvider('omniRoute');
      setSelectedModel(undefined);
    }
  }, [agent]);

  useEffect(() => {
    apiFetch('/api/providers/runtime-status')
      .then(res => res.json())
      .then(data => setStatus(data))
      .catch(console.error);

    const interval = setInterval(() => {
      apiFetch('/api/providers/runtime-status')
        .then(res => res.json())
        .then(data => setStatus(data))
        .catch(console.error);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Close dropdown on click outside
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Notify parent of selection changes
  useEffect(() => {
    if (selectedProvider) {
      onModelSelect?.(selectedProvider, selectedModel);
    }
  }, [selectedProvider, selectedModel]);

  const handleSelect = (prov: string, mod?: string) => {
    setSelectedProvider(prov);
    setSelectedModel(mod);
    setIsOpen(false);
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-md border bg-slate-800/30 border-slate-700/50 text-slate-400 text-xs">
        <Cpu size={14} className="animate-pulse" /> Connecting Runtime...
      </div>
    );
  }

  const isOllamaActive = selectedProvider === 'ollama';
  const isOmniActive = selectedProvider === 'omniRoute';
  
  const omniHealthy = status.omniRoute?.reachable;
  const ollamaHealthy = status.ollama?.reachable;

  let activeIcon = <Cloud size={14} />;
  let activeText = 'OmniRoute Active';
  let pillStyle = 'bg-blue-500/10 text-blue-400 border-blue-500/20';

  if (isOllamaActive) {
    activeIcon = <Cpu size={14} />;
    activeText = `Ollama: ${selectedModel}`;
    pillStyle = ollamaHealthy ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    if (!ollamaHealthy) activeText = 'Ollama Offline';
  } else if (isOmniActive) {
    if (!omniHealthy) {
      activeIcon = <WifiOff size={14} />;
      activeText = 'OmniRoute Offline';
      pillStyle = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-medium transition-colors hover:brightness-110 ${pillStyle}`}
      >
        {activeIcon}
        {activeText}
        <ChevronDown size={14} className={`opacity-50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 right-0 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase tracking-wider">
            Select Runtime
          </div>
          
          <div className="p-1">
            {/* OmniRoute Option */}
            <button
              onClick={() => handleSelect('omniRoute')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm text-left transition-colors ${selectedProvider === 'omniRoute' ? 'bg-blue-500/10 text-blue-400' : 'text-slate-300 hover:bg-slate-700/50'}`}
            >
              <div className="flex items-center gap-2">
                <Cloud size={16} />
                <span>Auto (OmniRoute)</span>
              </div>
              <div className="flex items-center gap-2">
                {!omniHealthy && <span className="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded">Offline</span>}
                {selectedProvider === 'omniRoute' && <Check size={14} />}
              </div>
            </button>

            <div className="my-1 border-t border-slate-700/50" />
            
            {/* Ollama Options */}
            <div className="px-3 py-1 text-[10px] text-slate-500 font-bold uppercase">Local Models (Ollama)</div>
            {!ollamaHealthy && (
              <div className="px-3 py-2 text-xs text-rose-400">Ollama is unreachable. Ensure it is running.</div>
            )}
            {ollamaHealthy && status.ollama?.models?.map((model: any) => (
              <button
                key={model.id}
                onClick={() => handleSelect('ollama', model.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded text-sm text-left transition-colors ${selectedProvider === 'ollama' && selectedModel === model.id ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-300 hover:bg-slate-700/50'}`}
              >
                <div className="flex items-center gap-2">
                  <Cpu size={16} />
                  <span className="truncate max-w-[150px]">{model.displayName}</span>
                </div>
                {selectedProvider === 'ollama' && selectedModel === model.id && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
