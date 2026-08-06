/**
 * Safe public-page inspection for the revenue pipeline.
 *
 * Only publicly available pages. Respects robots.txt, sends a descriptive
 * User-Agent, enforces timeouts and a global rate limit (one request at a
 * time, min 500 ms gap). Anything unreadable is reported as `unavailable` —
 * never fabricated.
 */
import { logger } from '../../utils/logger.js';

const USER_AGENT = 'AgenticOS-RevenueAudit/1.0 (public-pages research; respects robots.txt)';
const PAGE_TIMEOUT_MS = 12000;
const ROBOTS_TIMEOUT_MS = 5000;
const MIN_GAP_MS = 500;

let lastRequestAt = 0;
let activeRequests = 0;

async function rateLimit(): Promise<void> {
  while (activeRequests >= 1) {
    await new Promise((r) => setTimeout(r, 250));
  }
  const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en,de;q=0.8',
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export interface PublicPageResult {
  ok: boolean;
  url: string;
  html?: string;
  fetchedAt?: string;
  statusCode?: number;
  reason?: string;
  sitemapUrl?: string | null;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function extractSitemapFromRobots(robotsText: string, origin: string): string | null {
  const m = robotsText.match(/^sitemap:\s*(\S+)/im);
  if (m) return m[1];
  const u = `${origin}/sitemap.xml`;
  return u;
}

/** Fetch a robots.txt + page for a public URL. Never throws — returns a result. */
export async function fetchPublicPage(url: string): Promise<PublicPageResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, url, reason: 'Unsupported URL scheme.' };
    }
  } catch {
    return { ok: false, url, reason: 'Invalid URL.' };
  }

  const origin = parsed.origin;
  let robotsAllowed = true;
  let robotsReason: string | null = null;
  let sitemapUrl: string | null = null;

  try {
    await rateLimit();
    activeRequests++;
    const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`, ROBOTS_TIMEOUT_MS);
    if (robotsRes.ok) {
      const robotsText = await robotsRes.text();
      sitemapUrl = extractSitemapFromRobots(robotsText, origin);
      // Parse User-agent: * Disallow: rules (simple public-robots check).
      const lines = robotsText.split(/\r?\n/);
      const rules: string[] = [];
      let inStarGroup = false;
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        if (/^user-agent:/i.test(t)) {
          inStarGroup = /^\s*user-agent:\s*\*\s*$/i.test(t);
          continue;
        }
        if (/^disallow:/i.test(t) && inStarGroup) {
          const path = t.replace(/^disallow:\s*/i, '').trim();
          if (path) rules.push(path);
        }
      }
      if (rules.length) {
        for (const rule of rules) {
          const pattern = rule === '/' ? '/' : rule.replace(/\/$/, '');
          if (parsed.pathname.startsWith(pattern)) {
            robotsAllowed = false;
            robotsReason = `robots.txt disallows ${parsed.pathname} (Disallow: ${rule})`;
            break;
          }
        }
      }
    }
  } catch (err: any) {
    // No robots.txt or robots fetch failed → default allow (public pages).
    logger.debug(`[revenue-pipeline] robots check skipped for ${origin}: ${err?.message}`);
  } finally {
    activeRequests--;
    lastRequestAt = Date.now();
  }

  if (!robotsAllowed) {
    return { ok: false, url, reason: robotsReason || 'Blocked by robots.txt.', sitemapUrl };
  }

  try {
    await rateLimit();
    activeRequests++;
    const res = await fetchWithTimeout(url, PAGE_TIMEOUT_MS);
    if (!res.ok) {
      return { ok: false, url, reason: `HTTP ${res.status}`, statusCode: res.status, sitemapUrl };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { ok: false, url, reason: `Not an HTML page (${contentType})`, statusCode: res.status, sitemapUrl };
    }
    const html = await res.text();
    const finalUrl = res.url || url;
    return {
      ok: true,
      url: finalUrl,
      html,
      fetchedAt: new Date().toISOString(),
      statusCode: res.status,
      sitemapUrl: sitemapUrl || (sameOrigin(finalUrl, url) ? `${origin}/sitemap.xml` : null),
    };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? `Request timed out after ${PAGE_TIMEOUT_MS} ms` : `Fetch failed: ${err?.message}`;
    return { ok: false, url, reason, sitemapUrl };
  } finally {
    activeRequests--;
    lastRequestAt = Date.now();
  }
}
