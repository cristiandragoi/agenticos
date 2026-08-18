import { logger } from '../utils/logger.js';
import * as cheerio from 'cheerio';

export type ScrapedCompanyContact = {
  companyName: string;
  websiteUrl: string;
  jobUrl?: string;
  role?: string;
  country?: string;
  phone?: string;
  address?: string;
  emails: { address: string; type: 'hr' | 'general'; sourceUrl: string }[];
  error?: string;
};

const LINK_KEYWORDS = ['contact', 'kontakt', 'jobs', 'karriere', 'career', 'impressum', 'about'];
const HR_KEYWORDS = ['career', 'job', 'hr', 'bewerbung', 'recruiting', 'personal', 'info', 'kontakt'];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+49|\+31|0049|0031|0[1-9][0-9]{2,})[\s\-\/\d]{6,}/;
const ADDRESS_REGEX_DE = /\b[0-9]{5}\s+[A-ZÄÖÜ][a-zA-Zäöüß]+/;
const ADDRESS_REGEX_NL = /\b[1-9][0-9]{3}\s?[A-Z]{2}\s+[A-Z][a-zA-Z]+/;

async function fetchHtml(url: string, body?: any): Promise<string> {
  const options: any = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } };
  if (body) {
    options.method = 'POST';
    options.body = new URLSearchParams(body);
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function resolveUrl(base: string, href: string): string {
  try { return new URL(href, base).href; } catch { return href; }
}

async function discoverJobsApify(): Promise<{ title: string; url: string }[]> {
  const token = process.env.APIFY_API_KEY;
  if (!token) throw new Error("APIFY_API_KEY is not configured.");
  
  logger.info('[Scraper] Triggering Apify apify/google-search-scraper...');
  const runRes = await fetch(`https://api.apify.com/v2/acts/apify~google-search-scraper/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      queries: "site:de.indeed.com/cmp (schweißer OR schlosser OR electrician) hiring\nsite:nl.indeed.com/cmp (welder OR electrician) hiring",
      resultsPerPage: 10,
      maxPagesPerQuery: 1,
      csvFriendlyOutput: false
    })
  });
  
  if (!runRes.ok) throw new Error(`Apify start failed: ${runRes.status}`);
  const runData = await runRes.json();
  const runId = runData.data.id;
  logger.info(`[Scraper] Apify run started: ${runId}. Polling for completion...`);
  
  let runInfo;
  while(true) {
    const infoRes = await fetch(`https://api.apify.com/v2/acts/apify~google-search-scraper/runs/${runId}?token=${token}`);
    runInfo = await infoRes.json();
    const status = runInfo.data.status;
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') break;
    await new Promise(r => setTimeout(r, 4000));
  }
  
  if (runInfo.data.status !== 'SUCCEEDED') throw new Error(`Apify run ended with status: ${runInfo.data.status}`);
  
  const defaultDatasetId = runInfo.data.defaultDatasetId;
  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}`);
  const items = await itemsRes.json();
  
  const results: { title: string; url: string }[] = [];
  for (const item of items) {
    if (item.organicResults && Array.isArray(item.organicResults)) {
      for (const res of item.organicResults) {
        if (res.url) {
          results.push({ title: res.title || '', url: res.url });
        }
      }
    }
  }
  return results;
}

export async function runJobDiscovery(): Promise<{ apifyActor: string, totalFound: number, rawJobs: any[] }> {
  const apifyActor = "apify/google-search-scraper";
  logger.info('[Scraper] Searching for job postings via Apify...');
  let rawResults: { title: string; url: string }[] = [];
  try {
    rawResults = await discoverJobsApify();
  } catch (err: any) {
    logger.error('[Scraper] Apify Job Discovery failed:', err);
    throw new Error(`Apify Actor Error: ${err.message}`);
  }

  const companyMap = new Map<string, any>();
  for (const r of rawResults) {
    try {
      const u = new URL(r.url);
      let companyName = u.host;
      if (u.host.includes('indeed.com') && u.pathname.startsWith('/cmp/')) {
        companyName = decodeURIComponent(u.pathname.split('/')[2]);
      } else if (u.host.includes('stepstone.')) {
        companyName = decodeURIComponent(u.pathname.split('/')[2] || u.host);
      }
      companyName = companyName.replace(/^www\./, '').split('.')[0];
      const finalName = companyName.charAt(0).toUpperCase() + companyName.slice(1);

      if (!companyMap.has(finalName) && finalName.length > 2) {
         companyMap.set(finalName, {
           companyName: finalName,
           websiteUrl: r.url,
           jobUrl: r.url,
           role: r.title.substring(0, 50),
           country: r.url.includes('.nl') ? 'NL' : 'DE',
           source: u.host
         });
      }
    } catch {}
  }

  if (companyMap.size === 0) {
     logger.info('[Scraper] Fallback to default companies due to no search results.');
     companyMap.set('Meyer Werft GmbH', { companyName: 'Meyer Werft GmbH', websiteUrl: 'https://www.meyerwerft.de', role: 'Schweißer', country: 'DE', jobUrl: 'https://www.meyerwerft.de/jobs', source: 'meyerwerft.de' });
     companyMap.set('Damen Shipyards', { companyName: 'Damen Shipyards', websiteUrl: 'https://www.damen.com', role: 'Welder', country: 'NL', jobUrl: 'https://www.damen.com/jobs', source: 'damen.com' });
  }

  const companiesToScrape = Array.from(companyMap.values()).slice(0, 100);
  logger.info(`[Scraper] Found ${companiesToScrape.length} companies from Apify.`);

  return {
    apifyActor,
    totalFound: companiesToScrape.length,
    rawJobs: companiesToScrape
  };
}

export async function enrichLeads(companiesToScrape: any[]): Promise<ScrapedCompanyContact[]> {
  const results: ScrapedCompanyContact[] = [];
  logger.info(`[Scraper] Enriching ${companiesToScrape.length} leads...`);

  for (const comp of companiesToScrape) {
    const scraped: ScrapedCompanyContact = {
      companyName: comp.companyName,
      websiteUrl: comp.websiteUrl,
      jobUrl: comp.jobUrl,
      role: comp.role,
      country: comp.country,
      emails: []
    };

    try {
      logger.info(`[Scraper] Scraping ${comp.companyName}...`);
      
      const extractInfo = (html: string) => {
        const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
        if (!scraped.phone) {
          const p = text.match(PHONE_REGEX);
          if (p) scraped.phone = p[0].trim();
        }
        if (!scraped.address) {
          const aDe = text.match(ADDRESS_REGEX_DE);
          const aNl = text.match(ADDRESS_REGEX_NL);
          if (aDe) scraped.address = aDe[0].trim();
          else if (aNl) scraped.address = aNl[0].trim();
        }
      };

      const html = await fetchHtml(comp.websiteUrl);
      extractInfo(html);
      
      const mainEmails = html.match(EMAIL_REGEX) || [];
      const seenEmails = new Set<string>();

      const addEmail = (address: string, source: string) => {
        const lower = address.toLowerCase();
        if (seenEmails.has(lower) || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.includes('sentry')) return;
        seenEmails.add(lower);
        
        const isHr = HR_KEYWORDS.some(kw => lower.includes(kw) || source.toLowerCase().includes(kw));
        scraped.emails.push({ address: lower, type: isHr ? 'hr' : 'general', sourceUrl: source });
      };

      mainEmails.forEach(e => addEmail(e, comp.websiteUrl));

      const hrefRegex = /href=["']([^"']+)["']/gi;
      let match;
      const subPagesToVisit = new Set<string>();

      while ((match = hrefRegex.exec(html)) !== null) {
        const href = match[1];
        const lowerHref = href.toLowerCase();
        if (LINK_KEYWORDS.some(kw => lowerHref.includes(kw))) {
          const absoluteUrl = resolveUrl(comp.websiteUrl, href);
          if (absoluteUrl.startsWith(comp.websiteUrl)) {
            subPagesToVisit.add(absoluteUrl);
          }
        }
      }

      let visitedCount = 0;
      for (const pageUrl of subPagesToVisit) {
        if (visitedCount >= 3) break;
        if (pageUrl === comp.websiteUrl) continue;
        visitedCount++;

        logger.info(`[Scraper]   -> Fetching subpage ${pageUrl}`);
        try {
          const subHtml = await fetchHtml(pageUrl);
          extractInfo(subHtml);
          const subEmails = subHtml.match(EMAIL_REGEX) || [];
          subEmails.forEach(e => addEmail(e, pageUrl));
        } catch { /* ignore subpage failures */ }
      }
    } catch (err: any) {
      scraped.error = err.message;
    }

    results.push(scraped);
  }

  return results;
}
