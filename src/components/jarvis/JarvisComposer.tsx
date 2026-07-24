import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, Loader2, Square } from 'lucide-react';
import styles from '../../pages/JarvisStudio.module.css';

interface JarvisComposerProps {
  onSendMessage: (msg: string) => void;
  isProcessing: boolean;
  workspaceReady?: boolean;
  workspaceBlockReason?: string;
  onCancelResponse?: () => void;
}

export const JarvisComposer: React.FC<JarvisComposerProps> = ({ onSendMessage, isProcessing, onCancelResponse }) => {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !!text.trim() && !isProcessing;

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

  return (
    <div className={styles.composerContainer} data-testid="jarvis-composer">
      <div className={styles.composerBox}>
        <button 
          className={styles.actionBtn}
          disabled
          title="Voice input is experimental and disabled for typed chat reliability."
          aria-label="Voice input experimental"
        >
          <Mic size={18} />
        </button>
        <span
          title="Voice input is experimental and disabled for typed chat reliability."
          style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap', alignSelf: 'center' }}
        >
          Voice experimental
        </span>
        <textarea
          ref={textareaRef}
          className={styles.composerInput}
          placeholder="Ask Jarvis anything..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          rows={1}
          aria-label="Message Input"
        />
        <div className={styles.composerActions}>
          {isProcessing && onCancelResponse && (
            <button
              className={styles.actionBtn}
              onClick={onCancelResponse}
              aria-label="Cancel Response"
              title="Cancel response"
            >
              <Square size={16} />
              <span>Cancel</span>
            </button>
          )}
          <button 
            className={`${styles.actionBtn} ${styles.primary}`} 
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send Message"
            title="Send message"
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
