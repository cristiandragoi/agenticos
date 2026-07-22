import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff, Loader2 } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisComposerProps {
  onSendMessage: (msg: string) => void;
  isProcessing: boolean;
  /** When false, sending is blocked (e.g. no repository selected). */
  workspaceReady?: boolean;
  workspaceBlockReason?: string;
}

export const JarvisComposer: React.FC<JarvisComposerProps> = ({ onSendMessage, isProcessing, workspaceReady = true, workspaceBlockReason }) => {
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendBlocked = !workspaceReady;
  const sendBlockedReason = workspaceBlockReason || 'Select a repository before starting execution work.';
  const canSend = !!text.trim() && !isProcessing && !isTranscribing && !sendBlocked;

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSendMessage(text);
        setText('');
      }
    }
  };

  const handleSend = () => {
    if (canSend) {
      onSendMessage(text);
      setText('');
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      
      mr.ondataavailable = e => { 
        if (e.data.size > 0) chunksRef.current.push(e.data); 
      };
      
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setIsTranscribing(true);
        try {
          const fd = new FormData();
          fd.append('audio', new Blob(chunksRef.current, { type: 'audio/webm' }), 'audio.webm');
          const res = await fetch('/api/voice/transcribe', { method: 'POST', body: fd });
          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              setText(prev => prev + (prev ? ' ' : '') + data.text);
            } else if (data.error) {
              // Explicit blocker for STT backend missing
              alert(`Transcription Service Unavailable: ${data.error}`);
            }
          } else {
             alert(`Transcription Service Unavailable: STT backend missing or errored.`);
          }
        } catch (e: any) {
          console.error('Transcription failed', e);
          alert(`Transcription Service Unavailable: Network error.`);
        } finally {
          setIsTranscribing(false);
        }
      };
      
      mr.start();
      setIsRecording(true);
    } catch (err: any) {
      alert('Microphone access denied or unavailable.');
    }
  };

  return (
    <div className={styles.composerContainer} data-testid="jarvis-composer">
      <div className={styles.composerBox}>
        <button 
          className={`${styles.actionBtn} ${isRecording ? styles.activeVoice : ''}`}
          onClick={toggleRecording}
          disabled={isProcessing || isTranscribing}
          title={isRecording ? "Stop Recording" : "Use Microphone"}
          aria-label={isRecording ? "Stop Recording" : "Use Microphone"}
        >
          {isTranscribing ? <Loader2 size={18} className="animate-spin" /> : isRecording ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <textarea
          ref={textareaRef}
          className={styles.composerInput}
          placeholder={sendBlocked ? sendBlockedReason : "Ask Jarvis to orchestrate your workspace... (Shift+Enter for new line)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          rows={1}
          aria-label="Message Input"
        />
        <div className={styles.composerActions}>
          <button 
            className={`${styles.actionBtn} ${styles.primary}`} 
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send Message"
            title={sendBlocked ? sendBlockedReason : 'Send message'}
            style={{ padding: '6px 14px', gap: '6px', fontWeight: 600 }}
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
};
