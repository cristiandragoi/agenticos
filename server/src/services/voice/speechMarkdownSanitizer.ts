/**
 * speechMarkdownSanitizer.ts — Semantic Speech Sanitizer for TTS
 *
 * Implements Section 21:
 * Pre-processes Markdown-formatted text into natural spoken language for TTS engines
 * (Deepgram Aura, VoiceStudio, Piper), preventing TTS from reciting:
 * - "star star" or "asterisk" from bold/italic markers (**bold**, *italic*)
 * - "hash" or "pound" from headers (# Header, ## Subheader)
 * - "backtick" or "grave accent" from code blocks (```code```, `code`)
 * - Bullet list punctuation (- bullet, * bullet, • bullet)
 * - Blockquote indicators (> quote)
 * - Markdown links ([text](url) -> "text")
 *
 * Preserves written Markdown intact in the UI database; only sanitizes the
 * spoken audio string fed into synthesis engines.
 */

export function sanitizeMarkdownForSpeech(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let s = input;

  // 1. Remove fenced code blocks completely or summarize
  s = s.replace(/```(?:[a-zA-Z0-9_\-]+)?\s*[\r\n]+([\s\S]*?)```/g, (match, code) => {
    // If code is brief (single line), read code cleanly; if multi-line, describe or read lines
    const trimmed = code.trim();
    if (trimmed.split('\n').length <= 2) {
      return ` ${trimmed} `;
    }
    return ' Code block omitted for brevity. ';
  });

  // 2. Remove inline backticks `code` -> code
  s = s.replace(/`([^`]+)`/g, '$1');

  // 3. Remove header hashes (# Title, ## Subtitle, etc.)
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '$1.');

  // 4. Remove bold & italic markdown without reciting asterisks or underscores
  // Bold: **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  // Italic: *text* or _text_ (ensure not isolated math like 2 * 3)
  s = s.replace(/(?<=\s|^)\*([^*]+)\*(?=\s|$|[.,!?])/g, '$1');
  s = s.replace(/(?<=\s|^)_([^_]+)_(?=\s|$|[.,!?])/g, '$1');

  // 5. Remove markdown links: [link text](http://...) -> link text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 6. Convert bullet lists to natural conversational flow
  // e.g. "• item" or "- item" or "* item"
  s = s.replace(/^[\s]*[-*•]\s+/gm, '');

  // 7. Remove blockquote markers
  s = s.replace(/^[\s]*>\s*/gm, '');

  // 8. Remove horizontal rules
  s = s.replace(/^[\s]*[-*_]{3,}\s*$/gm, '');

  // 9. Remove image tags: ![alt](url) -> alt
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // 10. Clean up multiple spaces, consecutive linebreaks, and dangling punctuation
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n\s*\n/g, '. ');
  s = s.replace(/\n/g, ' ');
  s = s.replace(/\s+([.,!?:;])/g, '$1');
  s = s.replace(/\.{2,}/g, '.');

  return s.trim();
}
