import { logger } from '../../../utils/logger.js';
/**
 * Web search tool — searches the web using the configured search provider.
 * Uses a simple fetch-based approach with Google Programmable Search or similar.
 * Falls back to Brave Search if the API key is available.
 */
export const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for information. Returns up to 5 results with titles, URLs, and descriptions. Use this to find current information, documentation, or any web content.',
  parameters: [
    { name: 'query', type: 'string', description: 'The search query', required: true },
    { name: 'limit', type: 'number', description: 'Max results (default: 5, max: 10)', required: false },
  ],
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const query = args.query as string;
    const limit = Math.min((args.limit as number) || 5, 10);

    if (!query) return JSON.stringify({ error: 'No query provided' });

    // Try Brave Search first
    const braveKey = process.env.BRAVE_API_KEY;
    if (braveKey) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
        const res = await fetch(url, {
          headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'x-subscription-token': braveKey },
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data: any = await res.json();
          const results = (data.web?.results || []).slice(0, limit).map((r: any) => ({
            title: r.title,
            url: r.url,
            description: r.description,
          }));
          return JSON.stringify({ data: { web: results }, provider: 'Brave' });
        }
      } catch (err: any) {
        logger.warn('[WebSearch] Brave failed:', err.message);
      }
    }

    // Fallback: use Google or a direct fetch
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${limit}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const html = await res.text();
        // Simple regex extraction of search results
        const results: Array<{ title: string; url: string; description: string }> = [];
        const linkRegex = /<a[^>]*href="\/url\?q=([^"&]+)[^"]*"[^>]*>(.*?)<\/a>/g;
        let match;
        let count = 0;

        while ((match = linkRegex.exec(html)) !== null && count < limit) {
          const url = decodeURIComponent(match[1]);
          const title = match[2].replace(/<[^>]*>/g, '').trim();
          if (title && url && !url.includes('google.com')) {
            results.push({ title, url, description: '' });
            count++;
          }
        }

        if (results.length > 0) {
          return JSON.stringify({ data: { web: results }, provider: 'Google scrape' });
        }
      }
    } catch (err: any) {
      logger.warn('[WebSearch] Google fallback failed:', err.message);
    }

    return JSON.stringify({ error: 'No search provider available', data: { web: [] } });
  },
};
