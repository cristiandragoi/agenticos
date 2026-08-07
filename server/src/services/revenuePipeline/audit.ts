/**
 * Stage 3 — Structured website audit.
 *
 * Inspects only publicly available pages (homepage + robots/sitemap signals).
 * Every finding carries an evidence label: `verified` (observed in the
 * fetched/snapshot document), `inferred` (reasoned from absence/patterns),
 * or `unavailable` (could not be inspected). No visual-only scoring, no
 * invented metrics.
 */
import type { AuditFinding, EvidenceLabel, ProspectRecord } from './types.js';
import type { PublicContactInfo } from './types.js';

export interface AuditInput {
  html: string;
  fixture: boolean;
  sitemapUrl?: string | null;
  fetchFailedReason?: string | null;
}

const CTA_RE = /\b(call|contact|quote|get started|book|request|anfrage|termin|ruf\s*(mich)?\s*an|kontakt|angebot|jetzt|free estimate|kostenlose)\b/i;
const CONTACT_RE = /\b(kontakt|contact|impressum|anfahrt|telefon|phone|address|adresse)\b/i;
const TRUST_RE = /\b(reviews?|testimonials?|referenzen|bewertungen|about|über uns|partner|zertifiziert|geprüft|garantie|warranty|experience|erfahrung)\b/i;
const PLACEHOLDER_RE = /\b(lorem ipsum|under construction|coming soon|im aufbau|placeholder|demnächst|todo|tbd|soon)\b/i;
const SERVICE_PAGE_RE = /\b(leistungen|services|service|dachdeckerei|roofing|repair|wartung|maintenance|sanierung|renovation)\b/i;

/** Asset URLs are never contact pages (contact-quality milestone). */
const ASSET_EXT_RE = /\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|json|xml|pdf|zip|map)(\?|#|$)/i;
const ASSET_PATH_RE = /\/(wp-content|wp-includes|wp-json|plugins?|themes?|static|assets?|uploads?|cache|min|build|dist|node_modules|fonts?|images?|img|media|files)\//i;
/** Contact signals in hrefs/paths that are NOT business contact pages. */
const NON_BUSINESS_LINK_RE = /\b(impressum|imprint|privacy|datenschutz|legal|terms|agb|odr|ec\.europa|handwerkskammer|chamber|analytics|gtag|clarity|hotjar|facebook\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com)\b/i;
/** Business-domain / official-directory email domains (identity sanity check). */
const COMMON_MAIL_DOMAINS = /@(gmail|googlemail|web\.de|gmx\.de|gmx\.net|t-online\.de|freenet\.de|yahoo\.de?|outlook\.de?|hotmail\.de?|icloud\.com|me\.com|aol\.com)\b/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function canonicalDomain(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return h || null;
  } catch {
    return null;
  }
}

/**
 * Extract publicly accessible contact methods from a public website document.
 * Values are OBSERVED (tel:/mailto: links, contact-page links, address text) —
 * never guessed or invented. A lead qualifies when at least one method exists.
 *
 * Contact-quality rules (contact-quality milestone):
 *  - contact-page URLs must be real HTML/navigation pages: asset extensions
 *    (.css/.js/.png/…) and asset/plugin paths (/wp-content/, /static/, …) are
 *    rejected;
 *  - emails must actually look like emails (the EU ODR mailto: pattern is
 *    rejected by format validation);
 *  - external/legal/chamber links (ODR, privacy, impressum, social widgets)
 *    are never business contact methods.
 */
export function extractPublicContactInfo(html: string, baseUrl: string | null): PublicContactInfo | null {
  if (!html) return null;
  const hrefs = [...html.matchAll(/href=["']([^"']*)["']/gi)].map((m) => m[1]).filter(Boolean);
  const phones = [...new Set(
    hrefs
      .filter((h) => /^tel:/i.test(h))
      .map((h) => h.replace(/^tel:/i, '').trim())
      .filter((v) => v && /^[+\d][\d\s\-()/]{4,}$/.test(v))
  )];
  const emails = [...new Set(
    hrefs
      .filter((h) => /^mailto:/i.test(h))
      .map((h) => h.replace(/^mailto:/i, '').split('?')[0].trim())
      .filter((v) => EMAIL_RE.test(v))
  )];
  const contactHref = hrefs.find((h) => CONTACT_RE.test(h) && !/^tel:|^mailto:/i.test(h) && !NON_BUSINESS_LINK_RE.test(h));
  let contactPageUrl: string | null = null;
  if (contactHref) {
    let resolved: string | null = null;
    try {
      resolved = new URL(contactHref, baseUrl || 'https://example.invalid').href;
    } catch {
      resolved = contactHref;
    }
    // Asset extensions and asset/plugin paths are NOT contact pages.
    if (resolved && !ASSET_EXT_RE.test(resolved) && !ASSET_PATH_RE.test(resolved)) {
      contactPageUrl = resolved;
    }
  }
  const addressMatch = html.match(/\d{2,5}\s+[A-Za-zäöüß\- ]+(?:straße|str\.|weg|platz|allee)\b/i);
  const address = addressMatch ? addressMatch[0].replace(/</g, '&lt;').slice(0, 120) : null;
  if (!phones.length && !emails.length && !contactPageUrl && !address) return null;
  return { phone: phones, email: emails, contactPageUrl, address };
}

/**
 * Identity sanity: does the contact plausibly belong to the business?
 * Same-domain methods are always accepted; common free-mail providers are
 * accepted (small businesses commonly use them); external chamber/legal/
 * government domains are rejected as business contact channels.
 */
export function contactBelongsToBusiness(contact: PublicContactInfo | null | undefined, businessDomain: string | null): boolean {
  if (!contact) return false;
  const domain = businessDomain ? businessDomain.replace(/^www\./, '').toLowerCase() : null;
  const sameDomain = (d: string | null) => Boolean(domain && d && (d === domain || d.endsWith(`.${domain}`)));
  if (contact.phone.length > 0) return true;
  if (contact.contactPageUrl && sameDomain(canonicalDomain(contact.contactPageUrl))) return true;
  if (contact.address) return true;
  for (const e of contact.email) {
    const d = e.split('@')[1]?.toLowerCase() ?? '';
    if (sameDomain(d)) return true;
    if (COMMON_MAIL_DOMAINS.test(`@${d}`)) return true;
  }
  return false;
}

/** A lead qualifies when at least one real public contact method is observed. */
export function hasPublicContact(contact: PublicContactInfo | null | undefined): boolean {
  return Boolean(contact && (contact.phone.length > 0 || contact.email.length > 0 || contact.contactPageUrl || contact.address));
}

function esc(s: string): string {
  return s.replace(/</g, '&lt;').slice(0, 400);
}

function find(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? esc(m[0]) : null;
}

function count(html: string, re: RegExp): number {
  return (html.match(re) || []).length;
}

function hasMeta(html: string, name: string): { present: boolean; content: string } {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i')) ||
            html.match(new RegExp(`<meta[^>]+content=["'][^"']*["'][^>]*name=["']${name}["']`, 'i'));
  if (!m) return { present: false, content: '' };
  const content = m[0].match(/content=["']([^"']*)["']/i)?.[1] || '';
  return { present: true, content: content.trim() };
}

/** All hrefs (internal vs external). */
function links(html: string): { hrefs: string[]; internalCount: number; externalCount: number } {
  const hrefs = [...html.matchAll(/href=["']([^"']*)["']/gi)].map((m) => m[1]).filter((h) => h && h !== '#');
  let internalCount = 0;
  let externalCount = 0;
  for (const h of hrefs) {
    if (/^(https?:)?\/\//.test(h) && !/^https?:\/\/(www\.)?/.test(h.replace(/^https?:/, ''))) externalCount++;
    else if (/^(https?:)?\/\//.test(h)) externalCount++;
    else internalCount++;
  }
  return { hrefs, internalCount, externalCount };
}

function copyrightYear(html: string): number | null {
  const m = html.match(/copyright\s*(?:&copy;|©)?\s*(\d{4})/i) || html.match(/(?:©|&copy;)\s*(\d{4})/i);
  return m ? parseInt(m[1], 10) : null;
}

export function auditWebsite(input: AuditInput): AuditFinding[] {
  const { html, fixture, sitemapUrl, fetchFailedReason } = input;
  const findings: AuditFinding[] = [];
  const prefix = fixture ? 'FIXTURE SAMPLE: ' : '';
  const P = (s: string) => `${prefix}${s}`;

  const unavailable = (category: string, summary: string, severity: AuditFinding['severity'] = 'neutral'): void => {
    findings.push({ category, label: 'unavailable', summary: P(summary), severity });
  };

  if (fetchFailedReason) {
    for (const category of ['homepage_clarity', 'mobile_presentation', 'navigation', 'service_page_depth', 'location_page_depth', 'cta_visibility', 'contact_visibility', 'trust_proof', 'title_meta', 'internal_linking', 'accessibility'] as const) {
      unavailable(category, `Website could not be inspected — ${fetchFailedReason}.`);
    }
    unavailable('broken_placeholder', `Website could not be inspected — ${fetchFailedReason}.`);
    unavailable('performance', `Website could not be inspected — ${fetchFailedReason}.`);
    unavailable('sitemap_availability', 'Sitemap availability unknown — page unreachable.');
    return findings;
  }

  // ── title & meta ──────────────────────────────────────────────────────────
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  const metaDesc = hasMeta(html, 'description');
  if (title) {
    findings.push({ category: 'title_meta', label: 'verified', summary: P(`Title present: "${esc(title)}"`), evidence: esc(title), severity: 'positive' });
  } else {
    findings.push({ category: 'title_meta', label: 'verified', summary: P('No <title> element found on homepage.'), severity: 'weakness' });
  }
  if (metaDesc.present && metaDesc.content) {
    findings.push({ category: 'title_meta', label: 'verified', summary: P(`Meta description present (${metaDesc.content.length} chars).`), severity: 'positive' });
  } else if (metaDesc.present && !metaDesc.content) {
    findings.push({ category: 'title_meta', label: 'verified', summary: P('Meta description tag is present but empty.'), severity: 'weakness' });
  } else {
    findings.push({ category: 'title_meta', label: 'verified', summary: P('No meta description tag on homepage.'), severity: 'weakness' });
  }

  // ── mobile presentation ───────────────────────────────────────────────────
  const viewport = hasMeta(html, 'viewport');
  if (viewport.present) {
    findings.push({ category: 'mobile_presentation', label: 'verified', summary: P('Viewport meta present — mobile presentation declared.'), severity: 'positive' });
  } else {
    findings.push({ category: 'mobile_presentation', label: 'inferred', summary: P('No viewport meta — page is likely not mobile-optimized.'), severity: 'weakness' });
  }

  // ── homepage clarity ──────────────────────────────────────────────────────
  const h1s = count(html, /<h1[\s>]/i);
  if (h1s === 1) {
    const h1Text = html.match(/<h1[^>]*>([^<]*)<\/h1>/i)?.[1]?.trim() || '';
    findings.push({ category: 'homepage_clarity', label: 'verified', summary: P(`One H1 present: "${esc(h1Text || 'empty')}"`), severity: h1Text ? 'positive' : 'weakness' });
  } else if (h1s === 0) {
    findings.push({ category: 'homepage_clarity', label: 'verified', summary: P('No H1 heading found — homepage hierarchy unclear.'), severity: 'weakness' });
  } else {
    findings.push({ category: 'homepage_clarity', label: 'verified', summary: P(`${h1s} H1 headings found (should be exactly one).`), severity: 'weakness' });
  }
  const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (bodyText.length < 120) {
    findings.push({ category: 'homepage_clarity', label: 'verified', summary: P(`Homepage body text is very short (${bodyText.length} chars) — little value communicated.`), severity: 'weakness' });
  } else {
    findings.push({ category: 'homepage_clarity', label: 'verified', summary: P(`Homepage body text length: ${bodyText.length} chars.`), severity: 'positive' });
  }

  // ── navigation ────────────────────────────────────────────────────────────
  const navLinks = count(html, /<nav[\s>]/i) + count(html, /href=["'][^"']*["']/gi);
  const { hrefs, internalCount, externalCount } = links(html);
  const navCount = navLinks;
  if (navCount >= 3) {
    findings.push({ category: 'navigation', label: 'verified', summary: P(`${hrefs.length} links found (${internalCount} internal, ${externalCount} external).`), severity: 'positive' });
  } else {
    findings.push({ category: 'navigation', label: 'verified', summary: P(`Very few links (${hrefs.length}) — navigation is thin.`), severity: 'weakness' });
  }

  // ── service page depth ────────────────────────────────────────────────────
  const serviceMentions = find(html, SERVICE_PAGE_RE);
  const serviceLinks = hrefs.filter((h) => /(leistungen|services|service|roofing|repair|wartung|sanierung)/i.test(h));
  if (serviceLinks.length >= 2) {
    findings.push({ category: 'service_page_depth', label: 'verified', summary: P(`${serviceLinks.length} service-related links found.`), severity: 'positive' });
  } else if (serviceLinks.length === 1) {
    findings.push({ category: 'service_page_depth', label: 'verified', summary: P(`Only 1 service-related link found — service depth is shallow.`), severity: 'neutral' });
  } else {
    findings.push({
      category: 'service_page_depth',
      label: serviceMentions ? 'verified' : 'inferred',
      summary: serviceMentions
        ? P('Service keywords mentioned but no dedicated service pages linked.')
        : P('No service-page links detected on homepage.'),
      severity: 'weakness',
    });
  }

  // ── location page depth ───────────────────────────────────────────────────
  const locationLinks = hrefs.filter((h) => /(bezirk|district|standort|location|gebiet|region|berlin-)/i.test(h));
  if (locationLinks.length >= 2) {
    findings.push({ category: 'location_page_depth', label: 'verified', summary: P(`${locationLinks.length} location/district links found.`), severity: 'positive' });
  } else if (locationLinks.length === 1) {
    findings.push({ category: 'location_page_depth', label: 'verified', summary: P('Only 1 location/district link found.'), severity: 'neutral' });
  } else {
    findings.push({ category: 'location_page_depth', label: 'inferred', summary: P('No location/district landing pages detected — local SEO opportunity.'), severity: 'weakness' });
  }

  // ── CTA visibility ────────────────────────────────────────────────────────
  const ctaLinks = hrefs.filter((h) => CTA_RE.test(h));
  const ctaText = [...html.matchAll(/<(?:a|button)[^>]*>([^<]{2,60})<\/?(?:a|button)>/gi)].map((m) => m[1].trim()).filter((t) => CTA_RE.test(t));
  if (ctaLinks.length + ctaText.length >= 2) {
    findings.push({ category: 'cta_visibility', label: 'verified', summary: P(`${ctaLinks.length + ctaText.length} call-to-action links/buttons detected.`), severity: 'positive' });
  } else if (ctaLinks.length + ctaText.length === 1) {
    findings.push({ category: 'cta_visibility', label: 'verified', summary: P('Only 1 call-to-action detected.'), severity: 'neutral' });
  } else {
    findings.push({ category: 'cta_visibility', label: 'inferred', summary: P('No clear call-to-action detected on homepage.'), severity: 'weakness' });
  }

  // ── contact visibility ────────────────────────────────────────────────────
  const telLinks = hrefs.filter((h) => /^tel:/i.test(h));
  const mailLinks = hrefs.filter((h) => /^mailto:/i.test(h));
  const contactLinks = hrefs.filter((h) => CONTACT_RE.test(h));
  const addressMatch = find(html, /\d{2,5}\s+[A-Za-zäöüß\- ]+(?:straße|str\.|weg|platz|allee)\b/i);
  if (telLinks.length || mailLinks.length || contactLinks.length || addressMatch) {
    findings.push({
      category: 'contact_visibility',
      label: 'verified',
      summary: P(`Contact signals: ${telLinks.length ? telLinks.length + ' phone link(s)' : 'no phone'} · ${mailLinks.length ? mailLinks.length + ' email link(s)' : 'no email'} · ${contactLinks.length ? 'contact page linked' : 'no contact page'}${addressMatch ? ' · address text' : ''}.`),
      severity: 'positive',
    });
  } else {
    findings.push({ category: 'contact_visibility', label: 'verified', summary: P('No phone, email, address, or contact-page link found on homepage.'), severity: 'weakness' });
  }

  // ── trust / proof ─────────────────────────────────────────────────────────
  const trustMatch = find(html, TRUST_RE);
  if (trustMatch) {
    findings.push({ category: 'trust_proof', label: 'verified', summary: P(`Trust/proof signal found: "${trustMatch}"`), severity: 'positive' });
  } else {
    findings.push({ category: 'trust_proof', label: 'inferred', summary: P('No reviews, testimonials, references, or about content detected.'), severity: 'weakness' });
  }

  // ── sitemap availability ──────────────────────────────────────────────────
  if (sitemapUrl) {
    findings.push({ category: 'sitemap_availability', label: 'verified', summary: P(`Sitemap referenced at ${sitemapUrl}.`), severity: 'positive' });
  } else {
    findings.push({ category: 'sitemap_availability', label: 'unavailable', summary: P('Sitemap could not be confirmed (robots.txt did not declare one and /sitemap.xml was not fetched in V1).'), severity: 'neutral' });
  }

  // ── internal linking ──────────────────────────────────────────────────────
  if (internalCount >= 5) {
    findings.push({ category: 'internal_linking', label: 'verified', summary: P(`${internalCount} internal links — reasonable internal linking.`), severity: 'positive' });
  } else {
    findings.push({ category: 'internal_linking', label: 'verified', summary: P(`Only ${internalCount} internal links — internal linking is thin.`), severity: 'weakness' });
  }

  // ── broken / placeholder ──────────────────────────────────────────────────
  const placeholder = find(html, PLACEHOLDER_RE);
  const emptyHrefs = count(html, /href=["']#["']/gi) + count(html, /href=["'"]\s*["'"]/gi);
  const emptyImgs = count(html, /<img[^>]*src=["'"]\s*["'"]/gi);
  if (placeholder || emptyHrefs > 0 || emptyImgs > 0) {
    findings.push({
      category: 'broken_placeholder',
      label: 'verified',
      summary: P(`${placeholder ? `Placeholder text ("${placeholder}")` : 'No placeholder text'} · ${emptyHrefs} empty "#" link(s) · ${emptyImgs} image(s) with empty src.`),
      severity: 'weakness',
    });
  } else {
    findings.push({ category: 'broken_placeholder', label: 'verified', summary: P('No placeholder text, empty links, or empty image src detected.'), severity: 'positive' });
  }

  // ── stale / unrelated ─────────────────────────────────────────────────────
  const year = copyrightYear(html);
  const currentYear = new Date().getFullYear();
  if (year && year < currentYear - 1) {
    findings.push({ category: 'stale_unrelated', label: 'verified', summary: P(`Copyright year ${year} is stale (current ${currentYear}).`), evidence: String(year), severity: 'weakness' });
  } else if (year) {
    findings.push({ category: 'stale_unrelated', label: 'verified', summary: P(`Copyright year ${year} is current.`), severity: 'positive' });
  } else {
    findings.push({ category: 'stale_unrelated', label: 'unavailable', summary: P('No copyright/date signal found — staleness not assessed.'), severity: 'neutral' });
  }

  // ── accessibility basics ──────────────────────────────────────────────────
  const hasLang = /<html[^>]*\blang=/i.test(html);
  const imgs = count(html, /<img[\s>]/gi);
  const imgsWithAlt = count(html, /<img[^>]*\balt=/gi);
  if (hasLang && imgsWithAlt >= imgs) {
    findings.push({ category: 'accessibility', label: 'verified', summary: P(`lang attribute present; all ${imgs} image(s) have alt text.`), severity: 'positive' });
  } else {
    findings.push({
      category: 'accessibility',
      label: 'verified',
      summary: P(`${hasLang ? 'lang present' : 'No lang attribute on <html>'} · ${imgsWithAlt}/${imgs} images have alt text.`),
      severity: imgs === 0 && !hasLang ? 'weakness' : 'neutral',
    });
  }

  // ── performance indicators (safe, measurable) ─────────────────────────────
  const imgCount = count(html, /<img[\s>]/gi);
  const scriptCount = count(html, /<script[\s>]/gi);
  const htmlSizeKb = Math.round(html.length / 1024);
  findings.push({
    category: 'performance',
    label: 'verified',
    summary: P(`Document size ${htmlSizeKb} KB · ${imgCount} image(s) · ${scriptCount} script tag(s) (rough static indicators only).`),
    severity: htmlSizeKb > 200 || imgCount > 25 ? 'weakness' : 'positive',
  });

  return findings;
}

/** Convert audit findings into the prospect's verifiedFacts / unverifiedObservations. */
export function findingsToFacts(prospect: ProspectRecord, findings: AuditFinding[]): void {
  prospect.auditFindings = findings;
  const verified = findings.filter((f) => f.label === 'verified' && f.severity !== 'positive');
  const inferred = findings.filter((f) => f.label === 'inferred');
  for (const f of verified) {
    if (!prospect.verifiedFacts.includes(f.summary)) prospect.verifiedFacts.push(f.summary);
  }
  for (const f of inferred) {
    if (!prospect.unverifiedObservations.includes(f.summary)) prospect.unverifiedObservations.push(f.summary);
  }
}

/** Transparent 0–100 audit score: lower = weaker website (better opportunity). */
export function computeAuditScore(findings: AuditFinding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.label === 'unavailable') continue;
    if (f.severity === 'weakness') score -= 8;
    if (f.severity === 'positive') score += 4;
  }
  return Math.max(0, Math.min(100, score));
}
