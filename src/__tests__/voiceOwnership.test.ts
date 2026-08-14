// Regression: the post-send composer clear must not mark manual voice
// ownership. Before the fix, JarvisComposer.handleSend calls
// onSendMessage() then setText('') — the programmatic clear ran through
// the composer-change handler and set manualEditSinceVoiceRef = true,
// silently dropping every later voice auto-submit at the onAutoSubmit
// guard ('Transcribing → Ready → no response').
import { describe, expect, it } from 'vitest';
import { shouldMarkManualVoiceOwnership } from '../utils/voiceOwnership';

describe('shouldMarkManualVoiceOwnership', () => {
  it('marks a user edit with content as manual ownership', () => {
    expect(shouldMarkManualVoiceOwnership('Jarvis, what model are you using?')).toBe(true);
    expect(shouldMarkManualVoiceOwnership('h')).toBe(true);
  });

  it('does NOT mark the post-send programmatic clear as ownership (the regression)', () => {
    expect(shouldMarkManualVoiceOwnership('')).toBe(false);
    expect(shouldMarkManualVoiceOwnership('   ')).toBe(false);
  });
});
