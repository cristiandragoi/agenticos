/**
 * Web extract tool — extract readable content from a URL (web pages, PDFs).
 */
import { readFile, access } from 'node:fs/promises';

export const webExtractTool = {
  name: 'web_extract',
  description: 'Extract readable content from a web page URL. Returns content in markdown format. Good for reading documentation, articles, and API docs.',
  parameters: [
    { name: 'url', type: 'string', description: 'The URL to extract content from', required: true },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const url = args.url as string;
    if (!url) return JSON.stringify({ error: 'No URL provided' });

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/json,*/*',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return JSON.stringify({ error: `HTTP ${res.status}: ${res.statusText}` });
      }

      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();

      // Simple content extraction for HTML pages
      if (contentType.includes('text/html')) {
        // Strip scripts, styles, and tags
        let cleaned = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Truncate if too long
        const maxLen = 50000;
        if (cleaned.length > maxLen) {
          cleaned = cleaned.slice(0, maxLen) + '\n\n... [content truncated]';
        }

        return JSON.stringify({
          title: text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '',
          content: cleaned,
          url,
        });
      }

      // Plain text or JSON
      return JSON.stringify({
        content: text.slice(0, 50000),
        url,
      });
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  },
};
