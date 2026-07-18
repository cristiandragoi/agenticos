import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Activity, X, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatManager } from '../hooks/useChatManager';
import { useChat } from '../store/appStore';

const ApolloWallMode: React.FC = () => {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [targetAgent, setTargetAgent] = useState('auto');
  
  const recognitionRef = useRef<any>(null);
  const navigate = useNavigate();

  const { sendMessage, isTyping } = useChatManager();
  const chatState = useChat();
  
  // Find the last user and agent message for display
  const messages = chatState?.messages || [];
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const lastAgentMsg = [...messages].reverse().find(m => m.role === 'agent');

  useEffect(() => {
    // Initialize Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        setStatus('listening');
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        
        if (transcript.trim()) {
          setStatus('processing');
          sendMessage(transcript.trim(), targetAgent);
        } else {
          setStatus('idle');
        }
      };

      recognition.onerror = (event: any) => {
        console.error('[Apollo Wall] Speech recognition error', event.error);
        setIsListening(false);
        setStatus('idle');
      };

      recognition.onend = () => {
        setIsListening(false);
        if (!isTyping) setStatus('idle');
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [sendMessage, targetAgent, isTyping]);

  useEffect(() => {
    if (isTyping && status !== 'processing') {
      setStatus('processing');
    } else if (!isTyping && !isListening && status !== 'idle') {
      setStatus('idle');
    }
  }, [isTyping, isListening, status]);

  const toggleListen = () => {
    if (!recognitionRef.current) {
      alert("Your browser does not support Speech Recognition. Please type your query in Mission Control instead.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  return (
    <div className="w-full min-h-[calc(100vh-120px)] bg-[#05050A] text-white flex flex-col items-center justify-center overflow-hidden font-sans rounded-2xl border border-slate-800/50 p-8 relative">
      <div className="flex flex-col items-center justify-center max-w-4xl w-full px-8 space-y-12">
        
        {/* Visualizer / Mic Button */}
        <div className="relative flex items-center justify-center h-48 w-48">
          {status === 'processing' && (
            <div className="absolute inset-0 rounded-full border-4 border-purple-500/30 animate-[spin_3s_linear_infinite] border-t-purple-500" />
          )}
          {status === 'listening' && (
            <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" />
          )}
          <button 
            onClick={toggleListen}
            className={`relative z-10 p-8 rounded-full shadow-2xl transition-all duration-300 ${
              isListening ? 'bg-blue-600 shadow-blue-500/50 scale-110' : 'bg-slate-800 hover:bg-slate-700 hover:scale-105'
            }`}
          >
            {isListening ? <Activity size={64} className="text-white" /> : <Mic size={64} className="text-slate-300" />}
          </button>
        </div>

        {/* Status Text */}
        <div className="text-center space-y-2 h-12">
          <h2 className="text-2xl font-light tracking-wide text-slate-300 uppercase">
            {status === 'idle' && 'Hermes Apollo'}
            {status === 'listening' && 'Listening...'}
            {status === 'processing' && 'Processing Intent...'}
          </h2>
          {lastAgentMsg?.agentId && status === 'idle' && (
            <p className="text-sm font-bold text-purple-400 uppercase tracking-widest">Routed via {lastAgentMsg.agentId}</p>
          )}
        </div>

        {/* Transcripts & Responses */}
        <div className="w-full space-y-8 flex flex-col items-center text-center max-h-64 overflow-y-auto scrollbar-hide">
          {lastUserMsg && (
            <div className="w-full">
              <p className="text-slate-400 text-lg uppercase tracking-widest mb-2 font-semibold">You said</p>
              <p className="text-4xl font-light leading-tight text-white/90">"{lastUserMsg.content}"</p>
            </div>
          )}
          
          {lastAgentMsg && (
            <div className="w-full mt-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <p className="text-purple-400/80 text-lg uppercase tracking-widest mb-2 font-semibold">Apollo ({lastAgentMsg.agentId})</p>
              <p className="text-2xl font-medium leading-relaxed text-purple-100 max-w-4xl mx-auto">{lastAgentMsg.content}</p>
            </div>
          )}
        </div>
      </div>

      {/* Auto Route Dropdown at the bottom */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center bg-[#111827]/80 backdrop-blur-md border border-slate-700 rounded-xl px-4 py-2">
        <Zap size={16} className="text-purple-500 mr-2" />
        <select
          value={targetAgent}
          onChange={(e) => setTargetAgent(e.target.value)}
          className="bg-transparent text-slate-300 text-sm font-medium outline-none cursor-pointer appearance-none pr-6"
        >
          <option value="auto">Auto-route</option>
          <option value="agent-hermes">Hermes</option>
          <option value="agent-jarvis">Jarvis Core</option>
          <option value="agent-qwythos">Qwythos 9B</option>
          <option value="agent-welders">Welders Pipeline</option>
        </select>
      </div>
    </div>
  );
};

export default ApolloWallMode;
