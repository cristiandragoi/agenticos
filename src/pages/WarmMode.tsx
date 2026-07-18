import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, FileText, Activity } from 'lucide-react';
import { apiClient } from '../api/client';
import './WarmMode.css';

export default function WarmMode() {
  const [isListening, setIsListening] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [history, setHistory] = useState<{ role: string, text: string }[]>([]);
  const [health, setHealth] = useState<{ status: string, stt_available: boolean, execution_available: boolean } | null>(null);
  const [selectedAgent, setSelectedAgent] = useState('agent-hermes');
  const [selectedVoice, setSelectedVoice] = useState('onyx');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    apiClient.vaultRead('logs/daily-briefings/today.md')
      .then(res => setBriefing(res.content))
      .catch(() => setBriefing("No daily briefing found for today."));
      
    apiClient.voiceHealth()
      .then(res => setHealth(res))
      .catch(err => console.error("Health check failed", err));
  }, []);

  const playAudio = (base64Audio: string) => {
    if (audioRef.current) {
      audioRef.current.src = `data:audio/mp3;base64,${base64Audio}`;
      audioRef.current.play().catch(e => console.error("Audio play failed:", e));
    }
  };

  const toggleListening = async () => {
    if (isListening) {
      setIsListening(false);
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsListening(true);
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const { text } = await apiClient.voiceTranscribe(audioBlob);
          if (text) {
            setHistory(h => [...h, { role: 'user', text }]);
            const response = await apiClient.voiceExecute(text, selectedAgent, selectedVoice);
            setHistory(h => [...h, { role: 'hermes', text: response.text }]);
            if (response.audioData) playAudio(response.audioData);
          }
        } catch (err) {
          console.error("Voice execution failed:", err);
          setHistory(h => [...h, { role: 'hermes', text: 'Error connecting to voice backend.' }]);
        }
      };

      mediaRecorder.start();
    } catch (err) {
      console.warn("Microphone access denied or unavailable on HTTP localhost.", err);
      setIsListening(false);
      setHistory(h => [...h, { role: 'hermes', text: 'Microphone access denied or unavailable (requires HTTPS). Please use the text input below.' }]);
    }
  };

  return (
    <div className="warm-mode-container">
      <div className="warm-mode-content">
        <audio ref={audioRef} style={{ display: 'none' }} />
        
        <header className="wm-header">
          <h1 className="wm-title">
            <img src="/logo.png" alt="Agentic OS Logo" style={{ width: '36px', height: '36px', objectFit: 'contain' }} /> Agentic OS
          </h1>
          
          <div className="wm-controls">
            {health && (
              <div className={`wm-health ${health.stt_available ? 'online' : 'offline'}`}>
                <Activity size={18} />
                {health.stt_available ? 'Voice Online' : 'Local Fallback'}
              </div>
            )}

            <select 
              value={selectedVoice} 
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="wm-select"
            >
              <option value="alloy">Voice: Alloy (Neutral)</option>
              <option value="echo">Voice: Echo (Male)</option>
              <option value="fable">Voice: Fable (British)</option>
              <option value="onyx">Voice: Onyx (Deep Male)</option>
              <option value="nova">Voice: Nova (Female)</option>
              <option value="shimmer">Voice: Shimmer (Soft Female)</option>
            </select>

            <select 
              value={selectedAgent} 
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="wm-select"
            >
              <option value="agent-hermes">Hermes</option>
              <option value="agent-jarvis">Jarvis</option>
              <option value="agent-fugu">Fugu Ultra</option>
            </select>

            <button
              onClick={toggleListening}
              className={`wm-mic-btn ${isListening ? 'listening' : ''}`}
            >
              {isListening ? <Mic className="pulse-anim" size={20} /> : <MicOff size={20} />}
              {isListening ? "Listening..." : "Always Listening: OFF"}
            </button>
          </div>
        </header>

        <div className="wm-grid">
          
          {/* Daily Briefing Panel */}
          <section className="wm-panel">
            <h2 className="wm-panel-title">
              <FileText color="var(--color-jarvis)" size={24} /> Daily Briefing
            </h2>
            <div className="wm-briefing-text">
              {briefing || "Loading briefing..."}
            </div>
          </section>

          {/* Conversation Log */}
          <section className="wm-panel">
            <h2 className="wm-panel-title">
              <Activity color="var(--color-hermes)" size={24} /> Neural Link
            </h2>
            
            <div className="wm-chat-log" style={{ flex: 1, paddingBottom: '20px' }}>
              {history.length === 0 ? (
                <div className="wm-chat-empty">
                  <Mic size={48} opacity={0.5} />
                  <span>Awaiting voice command or typed message...</span>
                </div>
              ) : (
                history.map((msg, i) => (
                  <div key={i} className={`wm-chat-msg ${msg.role === 'user' ? 'wm-msg-user' : 'wm-msg-hermes'}`}>
                    {msg.text}
                  </div>
                ))
              )}
            </div>

            {/* Text Input */}
            <div style={{ marginTop: 'auto', display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                placeholder={`Message ${selectedAgent}...`} 
                className="wm-text-input"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    const text = e.currentTarget.value.trim();
                    e.currentTarget.value = '';
                    setHistory(h => [...h, { role: 'user', text }]);
                    try {
                      const response = await apiClient.voiceExecute(text, selectedAgent);
                      setHistory(h => [...h, { role: 'hermes', text: response.text }]);
                    } catch (err) {
                      console.error("Execution failed:", err);
                      setHistory(h => [...h, { role: 'hermes', text: 'Error connecting to backend.' }]);
                    }
                  }
                }}
              />
            </div>
          </section>

        </div>

      </div>
    </div>
  );
}
