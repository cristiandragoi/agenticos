/**
 * Stage 6 — Rebuild blueprint.
 *
 * Deterministic structure driven by audit findings + config. Every piece of
 * content that needs a real asset, real fact, or customer confirmation is
 * marked `[PLACEHOLDER: ...]` — never invented. No WordPress, no publish.
 */
import type { PipelineConfig, ProspectRecord } from './types.js';

export interface RebuildBlueprint {
  title: string;
  markdown: string;
  structured: {
    homepageStructure: string[];
    serviceHub: string[];
    keyServicePages: string[];
    locationPages: string[];
    ctaStrategy: string[];
    trustSectionPlan: string[];
    assetRequirements: string[];
    internalLinkPlan: string[];
    seoMetadataScaffold: Record<string, string[]>;
    mobileFirstLayout: string[];
  };
}

export function buildRebuildBlueprint(prospect: ProspectRecord, config: PipelineConfig): RebuildBlueprint {
  const label = prospect.fixture ? 'FIXTURE SAMPLE — ' : '';
  const niche = prospect.niche || 'local business';
  const city = prospect.city || config.city || '[CITY]';
  const name = prospect.businessName || '[BUSINESS NAME]';
  const title = `${label}Rebuild Blueprint — ${name} (${niche} · ${city})`;

  const weaknesses = prospect.auditFindings.filter((f) => f.severity === 'weakness').map((f) => f.summary);

  const homepageStructure = [
    'Header: business name + phone number (tap-to-call on mobile) + primary CTA button',
    'Hero: one clear value proposition ("[VALUE PROPOSITION — e.g. Fast roof repair in ' + city + ']") + secondary CTA',
    'Trust strip: years in business, certifications, review count — only from verified facts, else [PLACEHOLDER: verify]',
    'Service overview: 3–6 service cards linking to the service hub',
    'Service-area section: districts served (links to location pages)',
    'Proof section: testimonials/references — only real, customer-confirmed items, else [PLACEHOLDER: collect]',
    'Process/how-it-works: 3 steps (contact → quote → work)',
    'FAQ (3–5 real questions — from customer calls, else [PLACEHOLDER])',
    'Final CTA band + contact block (phone, email, address, hours)',
    'Footer: nav, legal (Impressum/Datenschutz), copyright year auto-updates',
  ];

  const serviceHub = [
    `Service hub page (/services): index of all services for ${niche}`,
    'Each service gets: what it is, when it is needed, process, CTA, related services',
    `Suggested services (V1 ${label.trim() || 'template'}): [SERVICE 1], [SERVICE 2], [SERVICE 3] — confirm real services offered`,
  ];

  const keyServicePages = [
    `1–3 priority service pages (e.g. roof repair, roof replacement, emergency service)`,
    'Each page: problem → solution → process → proof → CTA → related services',
    'Service pages target the same keywords the business actually offers — confirmed with the owner',
  ];

  const locationPages = [
    `Location/district pages for served areas (${city} districts)`,
    'Each: "Roofing in [District]" intro, services, local relevance signals (real, verified only), CTA',
    'V1: structure only — real district list comes from the customer, else [PLACEHOLDER]',
  ];

  const ctaStrategy = [
    'Primary CTA everywhere: phone (tap-to-call) + "Get a free quote"',
    'CTAs above the fold on every page, repeated before the footer',
    'Emergency-service banner for urgent jobs ([PLACEHOLDER: confirm emergency offering])',
  ];

  const trustSectionPlan = [
    'Only verified, customer-confirmed items: real reviews, real references, certifications',
    'Placeholder cards clearly marked "[PLACEHOLDER: add verified review]" until real content exists',
    'Impressum + Datenschutz pages (required for DE businesses)',
  ];

  const assetRequirements = [
    'Logo — [PLACEHOLDER: obtain from business]',
    'Photos: building/roof/team — [PLACEHOLDER: collect real photos; no stock fakery]',
    'Copy: service descriptions — draft from verified facts + owner confirmation',
    'Contact data: phone, email, address, hours — verified before publish',
    'Legal texts (Impressum/Datenschutz) — [PLACEHOLDER: legal review]',
  ];

  const internalLinkPlan = [
    'Homepage → every top service + location page (header + content links)',
    'Service pages → related services + location pages',
    'Location pages → service pages + contact',
    'Every page → contact/CTA (max 2 clicks from any page)',
  ];

  const seoMetadataScaffold = {
    homepage: [
      `Title: "${name} — ${capitalize(niche)} in ${city} | ${phonePlaceholder()}"`,
      `Meta description: "[VALUE PROPOSITION] in ${city}. Call ${phonePlaceholder()}"`,
    ],
    servicePages: [
      `Title pattern: "${capitalize(niche)} [Service] in ${city} — ${name}"`,
      'H1 = service + city; unique copy per page',
    ],
    locationPages: [
      `Title pattern: "${capitalize(niche)} in [District], ${city} — ${name}"`,
      'Unique intro text per district (no doorway duplication)',
    ],
    technical: [
      'Semantic HTML5 landmarks (header/nav/main/footer)',
      'One H1 per page; descriptive alt text on real images',
      'XML sitemap + robots.txt (included in the staged concept)',
      'Schema.org LocalBusiness markup ([PLACEHOLDER: validate with customer])',
    ],
  };

  const mobileFirstLayout = [
    'Mobile-first CSS: single column, 320px+ support, tap targets ≥ 44px',
    'Sticky header with phone call button on mobile',
    'Hero text scales; images lazy-loaded with width/height to avoid CLS',
    'No horizontal scroll; test on real devices before publish',
  ];

  const markdown = `# ${title}

> Generated ${new Date().toISOString()} by the AgenticOS Revenue Pipeline (V1).
> ${prospect.fixture ? '**This prospect is a clearly labelled SAMPLE FIXTURE — not a real business.**' : 'Prospect discovered from user-provided URL.'}
> Audit score: ${prospect.auditScore ?? '—'}/100 · Opportunity score: ${prospect.opportunityScore ?? '—'}/100 · Confidence: ${prospect.confidence}

## 1. Homepage structure
${bullets(homepageStructure)}

## 2. Service hub
${bullets(serviceHub)}

## 3. Key service pages
${bullets(keyServicePages)}

## 4. Location-page structure
${bullets(locationPages)}

## 5. CTA strategy
${bullets(ctaStrategy)}

## 6. Trust-section plan
${bullets(trustSectionPlan)}

## 7. Asset requirements
${bullets(assetRequirements)}

## 8. Internal-link plan
${bullets(internalLinkPlan)}

## 9. SEO metadata scaffold
${seoMd(seoMetadataScaffold)}

## 10. Mobile-first layout plan
${bullets(mobileFirstLayout)}

## Evidence that drove this plan
${weaknesses.length ? bullets(weaknesses.map((w) => `Finding (${prospect.fixture ? 'fixture' : 'audit'}): ${w}`)) : 'No weaknesses recorded — review audit output.'}

## Placeholders & assumptions
- Every \`[PLACEHOLDER: …]\` above requires customer confirmation or a real asset before use.
- Pricing, reviews, rankings, traffic, and revenue are NOT stated anywhere in this blueprint.
- No WordPress. The staged concept is a static-friendly React/Vite site (see site_concept/).
`;

  return {
    title,
    markdown,
    structured: {
      homepageStructure,
      serviceHub,
      keyServicePages,
      locationPages,
      ctaStrategy,
      trustSectionPlan,
      assetRequirements,
      internalLinkPlan,
      seoMetadataScaffold,
      mobileFirstLayout,
    },
  };
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function phonePlaceholder(): string {
  return '[PHONE NUMBER — verify with customer]';
}

function bullets(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n');
}

function seoMd(scaffold: Record<string, string[]>): string {
  return Object.entries(scaffold)
    .map(([k, v]) => `### ${k}\n${bullets(v)}`)
    .join('\n');
}
