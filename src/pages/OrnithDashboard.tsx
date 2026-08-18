import React, { useState, useRef } from 'react';
import { Cpu, Terminal, Play, Loader2, Mic, MicOff, Power, Volume2, VolumeX, Activity } from 'lucide-react';
import { runPipeline } from '../command/jarvisPipeline';
import { RuntimeStatusWidget } from '../components/ui/RuntimeStatusWidget';
import { apiFetch, apiUrl } from '../api/client';

const ORNITH_SERVER_URL = 'http://localhost:11434/api/chat';

const OrnithDashboard: React.FC = () => {
  const [ornithModel, setOrnithModel] = useState<string>('qwythos:9b');
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: 'system', content: 'You are Ornith 1.0, a self-scaffolding agent controlling Agentic OS. IMPORTANT: You DO have voice capabilities. Every word you type here is automatically converted to speech and spoken aloud to the user. Speak naturally and confidently as an AI that can hear and speak.' }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [activeProcess, setActiveProcess] = useState<string | null>(null);
  
  // Mic state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          stream.getTracks().forEach(track => track.stop());
          setIsTranscribing(true);
          
          try {
            const formData = new FormData();
            formData.append('audio', blob, 'audio.webm');
            
            const res = await apiFetch('/api/voice/transcribe', {
              method: 'POST',
              body: formData
            });
            
            if (res.ok) {
              const data = await res.json();
              if (data.text) {
                // Auto-send the transcribed voice directly to Ornith for true bidirectional chat
                sendMessage(data.text);
              }
            }
          } catch (e) {
            console.error('Transcription failed:', e);
            setError('Voice transcription failed.');
          } finally {
            setIsTranscribing(false);
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
        setError(null);
      } catch (err) {
        console.error('Mic access denied', err);
        setError('Could not access microphone. Check permissions.');
      }
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const textToSubmit = textOverride || input;
    if (!textToSubmit.trim()) return;

    const userMsg = { role: 'user', content: textToSubmit };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsTyping(true);
    setError(null);

    try {
      const res = await fetch(ORNITH_SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ornithModel,
          messages: newMessages,
          stream: true
        })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.error && data.error.includes('not found')) {
           throw new Error('MODEL_NOT_FOUND');
        }
        throw new Error(`Ornith API returned ${res.status}`);
      }

      setIsSimulationMode(false);
      
      // Handle streaming
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      
      // Add a placeholder message for the assistant
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      setIsTyping(false); // We are now streaming, so stop the compiling spinner
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\\n');
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.message?.content) {
                fullReply += parsed.message.content;
                
                // Intercept logic: If LLM decides to trigger pipeline
                if (fullReply.includes('[EXECUTE_PIPELINE]') || textToSubmit.toLowerCase().includes('takeover') || textToSubmit.toLowerCase().includes('initiate')) {
                   if (!activeProcess) {
                     setActiveProcess('Routing Pipeline...');
                     runPipeline(textToSubmit);
                   }
                }
                
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].content = fullReply;
                  return updated;
                });
              }
            } catch (e) {
              // Ignore parse errors on partial chunks
            }
          }
        }
      }
      
      speakResponse(fullReply || '(No response)');
    } catch (err: any) {
      if (err.message === 'MODEL_NOT_FOUND' || err.message.includes('Failed to fetch')) {
        setIsSimulationMode(true);
        // Simulate Ornith taking over
        setTimeout(() => {
          let simulatedReply = `[SIMULATION MODE] Connection to Ollama failed or model not found.\n\nExecuting fallback OS Takeover Protocol...\n\nI am Ornith 1.0. I have analyzed the input: "${textToSubmit}".\n\nI am overriding JARVIS routines and executing the pipeline sequence directly. Agentic OS is now under my orchestration.`;
          setMessages([...newMessages, { role: 'assistant', content: simulatedReply }]);
          setIsTyping(false);
          speakResponse(simulatedReply);
        }, 1500);
        return; // wait for setTimeout
      } else {
        setError(`Connection to Ornith failed: ${err.message}.`);
      }
    }
    
    setIsTyping(false);
  };

  const handleInitialize = () => {
    sendMessage("Initiate Agentic OS takeover sequence. Confirm your systems are online.");
  };

  const speakResponse = async (text: string) => {
    if (!isVoiceEnabled) return;
    
    // Clean markdown for speech
    const cleanText = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/#{1,6}\s/g, '').replace(/`{1,3}[^`]*`{1,3}/g, '');
    
    try {
      const res = await apiFetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, agentId: 'agent-jarvis' })
      });
      const data = await res.json();
      
      if (data.audioData) {
        const audio = new Audio(`data:audio/mp3;base64,${data.audioData}`);
        audio.play().catch(e => console.warn('Audio play blocked', e));
      } else {
        // Fallback to browser TTS if backend Deepgram is not configured
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.0;
        utterance.pitch = 0.9; // Slightly lower pitch for Ornith
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.warn('TTS fetch failed, falling back to browser synthesis', e);
      const utterance = new SpeechSynthesisUtterance(cleanText);
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="page-container flex-col h-full" style={{ background: 'var(--bg-base)' }}>
      {/* Header */}
      <div className="flex-row items-center justify-between p-4 border-b border-white/5" style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
        <div className="flex-row items-center">
          <div className="flex-center w-10 h-10 rounded-lg mr-4" style={{ background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', boxShadow: '0 0 15px rgba(59, 130, 246, 0.3)' }}>
            <Cpu size={24} color="#fff" />
          </div>
          <div className="flex-col">
            <h1 className="text-xl font-bold" style={{ color: '#e2e8f0', letterSpacing: '0.5px' }}>Ornith Workspace</h1>
            <span className="text-xs text-dim flex-row items-center gap-2 mt-1">
              <RuntimeStatusWidget 
                agent="Ornith" 
                onModelSelect={(prov, mod) => { if (mod) setOrnithModel(mod); }}
              />
            </span>
          </div>
        </div>
        
        <div className="flex-row items-center gap-2">
          <button 
            onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
            className="flex-center w-9 h-9 rounded-lg transition-all"
            style={{ background: isVoiceEnabled ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: isVoiceEnabled ? '#60a5fa' : '#94a3b8' }}
            title={isVoiceEnabled ? "Mute Ornith Voice" : "Enable Ornith Voice"}
          >
            {isVoiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          
          <button 
            onClick={handleInitialize}
            className="flex-row items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all hover:scale-105"
            style={{ background: 'rgba(139, 92, 246, 0.2)', border: '1px solid #8b5cf6', color: '#a78bfa' }}
          >
            <Power size={16} />
            Initialize Ornith OS Takeover
          </button>
        </div>
      </div>

      {/* Main Terminal Chat */}
      <div className="flex-col flex-1 p-6 overflow-hidden">
        <div className="flex-1 flex-col overflow-y-auto rounded-xl p-4 gap-4" style={{ background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.05)', boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.5)' }}>
          {messages.filter(m => m.role !== 'system').map((msg, i) => (
            <div key={i} className={`flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="text-xs mb-1 opacity-50" style={{ color: msg.role === 'user' ? '#93c5fd' : '#c4b5fd' }}>
                {msg.role === 'user' ? 'USER' : 'ORNITH-1.0'}
              </div>
              <div 
                className="px-4 py-2 rounded-lg text-sm"
                style={{
                  background: msg.role === 'user' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(139, 92, 246, 0.1)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(139, 92, 246, 0.2)'}`,
                  color: '#e2e8f0',
                  maxWidth: '80%',
                  whiteSpace: 'pre-wrap',
                  fontFamily: msg.role === 'assistant' ? "'JetBrains Mono', monospace" : "inherit"
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}
          
          {isTyping && (
            <div className="flex-row items-center gap-2 text-dim text-sm p-2" style={{ color: '#a78bfa' }}>
              <Loader2 className="animate-spin" size={14} /> Ornith is compiling OS orchestration routines...
            </div>
          )}
          {error && (
            <div className="p-3 mt-2 rounded border" style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#fca5a5', fontSize: '0.85rem' }}>
              <Terminal size={14} className="inline mr-2" />
              {error}
            </div>
          )}
          {activeProcess && (
            <div className="flex-row items-center gap-2 text-sm p-2 rounded" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <Activity className="animate-pulse" size={14} />
              <strong>SYSTEM OVERRIDE:</strong> {activeProcess}. Check the JARVIS ORB COMMAND tab to view live execution logs.
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="mt-4 flex-row gap-2 items-center">
          <button 
            onClick={toggleRecording}
            className={`p-3 rounded-lg flex-center cursor-pointer transition-all ${isRecording ? 'animate-pulse' : ''}`}
            style={{ 
              background: isRecording ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)', 
              border: `1px solid ${isRecording ? '#ef4444' : 'rgba(255, 255, 255, 0.1)'}`, 
              color: isRecording ? '#ef4444' : '#fff' 
            }}
            disabled={isTyping || isTranscribing}
            title={isRecording ? "Stop Recording" : "Use Microphone"}
          >
            {isTranscribing ? <Loader2 size={18} className="animate-spin" /> : isRecording ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          
          <input
            type="text"
            className="flex-1 p-3 rounded-lg text-sm"
            style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none' }}
            placeholder={isRecording ? "Listening..." : "Input OS Command..."}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            disabled={isTyping}
            autoFocus
          />
          <button 
            onClick={() => sendMessage()}
            className="p-3 rounded-lg flex-center cursor-pointer transition-all hover:brightness-110"
            style={{ background: '#3b82f6', border: 'none', color: '#fff' }}
            disabled={isTyping || (!input.trim() && !isRecording)}
          >
            <Play size={18} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrnithDashboard;
