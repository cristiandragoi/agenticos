import { describe, it, expect } from 'vitest';
import { sanitizeMarkdownForSpeech } from '../utils/speechSanitizer.js';

describe('sanitizeMarkdownForSpeech', () => {
  it('strips bold markdown syntax', () => {
    expect(sanitizeMarkdownForSpeech('**Access System Logs**')).toBe('Access System Logs');
    expect(sanitizeMarkdownForSpeech('__Access System Logs__')).toBe('Access System Logs');
  });

  it('strips headers', () => {
    expect(sanitizeMarkdownForSpeech('### Step 1')).toBe('Step 1');
    expect(sanitizeMarkdownForSpeech('# Title\n## Subtitle')).toBe('Title\nSubtitle');
  });

  it('strips list bullets', () => {
    expect(sanitizeMarkdownForSpeech('- Run tests')).toBe('Run tests');
    expect(sanitizeMarkdownForSpeech('* Check logs')).toBe('Check logs');
    expect(sanitizeMarkdownForSpeech('1. Confirm selected repository')).toBe('Confirm selected repository');
  });

  it('strips markdown links and keeps anchor text', () => {
    expect(sanitizeMarkdownForSpeech('[Open CodeX](#/codex)')).toBe('Open CodeX');
  });

  it('strips inline code ticks', () => {
    expect(sanitizeMarkdownForSpeech('Run `npm test` now')).toBe('Run npm test now');
  });

  it('preserves model identifiers and file paths', () => {
    expect(sanitizeMarkdownForSpeech('Using gpt-oss:20b with qwen3.5:cloud')).toBe('Using gpt-oss:20b with qwen3.5:cloud');
    expect(sanitizeMarkdownForSpeech('Workspace is B:\\AgenticOS\\.tmp')).toBe('Workspace is B:\\AgenticOS\\.tmp');
  });
});
