/**
 * Voice/composer ownership decision.
 *
 * A composer text change should mark MANUAL voice ownership only when it
 * contains real content — the only thing worth protecting from a stale STT
 * write. Programmatic clears (NOTABLY the post-send composer clear at
 * JarvisComposer's handleSend/handleKeyDown → setText('')) and empty text
 * must NOT mark ownership: they ran immediately after every typed send,
 * leaving the flag stuck true and silently dropping every subsequent voice
 * auto-submit at the onAutoSubmit guard — the 'Transcribing → Ready → no
 * visible response' regression in the real desktop app.
 */
export function shouldMarkManualVoiceOwnership(text: string): boolean {
  return text.trim().length > 0;
}
