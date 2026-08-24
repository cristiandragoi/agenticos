/**
 * Sanitize Markdown text for Text-to-Speech (TTS) engines (Deepgram Aura / Web Speech API).
 *
 * Removes visual markup syntax (*, **, _, __, #, `, bullets, links, images)
 * without damaging normal punctuation, numbers, file paths (e.g. B:\AgenticOS),
 * or model identifiers (e.g. gpt-oss:20b, qwen3.5:cloud).
 */
export function sanitizeMarkdownForSpeech(text: string): string {
  if (!text || typeof text !== 'string') return '';

  return text
    // 1. Remove fenced code blocks completely or preserve code text without fence
    .replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '$1')
    .replace(/```([\s\S]*?)```/g, '$1')
    // 2. Remove inline code ticks: `code` -> code
    .replace(/`([^`\n]+)`/g, '$1')
    // 3. Remove bold and bold-italic markdown: ***text*** -> text, **text** -> text, __text__ -> text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // 4. Remove single asterisk/underscore italic without breaking snake_case_identifiers or math
    .replace(/(^|[^\w*])\*([^* \n][^*\n]*?[^* \n]|\S)\*([^\w*]|$)/g, '$1$2$3')
    .replace(/(^|[^\w_])_([^_ \n][^_\n]*?[^_ \n]|\S)_([^\w_]|$)/g, '$1$2$3')
    // 5. Remove markdown headers: # Header -> Header
    .replace(/^#{1,6}\s+/gm, '')
    // 6. Remove markdown image syntax: ![alt](url) -> alt
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // 7. Remove markdown links: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 8. Remove blockquotes: > quote -> quote
    .replace(/^>\s+/gm, '')
    // 9. Remove list bullets: - item, * item, + item -> item
    .replace(/^[\s]*[-*+]\s+/gm, '')
    // 10. Remove ordered list numbering: 1. item -> item
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // 11. Normalize remaining double asterisks that might be leftover
    .replace(/\*+/g, '')
    // 12. Clean up multiple spaces and empty lines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}
