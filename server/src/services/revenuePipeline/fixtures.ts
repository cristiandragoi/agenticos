/**
 * Clearly-labelled SAMPLE FIXTURES for dry-run discovery.
 *
 * These are NOT real businesses. Domains use the reserved `.example` TLD
 * (RFC 2606 — cannot resolve, cannot be contacted). Every fact is prefixed
 * "FIXTURE SAMPLE:" so it can never be mistaken for a verified real-world
 * claim. The demo acceptance explicitly allows a clearly labelled sample
 * fixture source.
 */

export interface FixtureProspect {
  businessName: string;
  niche: string;
  city: string;
  websiteUrl: string;
  publicContactUrl: string | null;
  verifiedFacts: string[];
  unverifiedObservations: string[];
  /** Snapshot HTML the audit module inspects (the "public page" in fixture mode). */
  snapshotHtml: string;
}

export const FIXTURE_PREFIX = 'FIXTURE SAMPLE:';

const base = (body: string, title: string, head = '') =>
  `<!DOCTYPE html>
<html>
<head>
${head}
<title>${title}</title>
</head>
<body>
${body}
</body>
</html>`;

/**
 * Dachfix Berlin — weak homepage: no meta description, no viewport, no CTA,
 * stale copyright, placeholder copy, no service/location pages, no sitemap,
 * missing alt attributes. Strong rebuild candidate.
 */
const dachfixHtml = base(
  `
<h1>Willkommen</h1>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Wir sind ein Dachdeckerbetrieb.</p>
<img src="dach.jpg" />
<a href="/">Start</a>
<a href="#">Leistungen</a>
<a href="#">Kontakt</a>
<a href="mailto:info@dachfix-berlin.example">info@dachfix-berlin.example</a>
<p>Copyright 2019 Dachfix Berlin</p>
`,
  'Dachfix Berlin',
  `<meta name="description" content="">
<meta name="robots" content="noindex">`
);

/**
 * Berliner Dachdeckerei Müller — mid-tier: has contact page + phone, some CTA,
 * but no service pages, no trust section, no location pages.
 */
const muellerHtml = base(
  `
<h1>Berliner Dachdeckerei Müller</h1>
<p>Wir reparieren und sanieren Dächer in Berlin. Rufen Sie uns an: 030 1234567</p>
<a href="/">Start</a>
<a href="/leistungen">Leistungen</a>
<a href="/kontakt">Kontakt</a>
<a href="tel:+49301234567">Jetzt anrufen</a>
<a href="/kontakt">Angebot anfordern</a>
<img src="/img/dach1.jpg" alt="Dachsanierung in Berlin" />
<p>Copyright 2023</p>
`,
  'Berliner Dachdeckerei Müller | Dachreparatur Berlin',
  `<meta name="description" content="Dachdeckerei Müller — Dachreparatur und Dämmung in Berlin.">
<meta name="viewport" content="width=device-width, initial-scale=1.0">`
);

/**
 * Meisterbetrieb Weber Dach & Fassade — weak: placeholder "coming soon"
 * sections, no contact info at all, empty links, no accessibility basics.
 */
const weberHtml = base(
  `
<h1>Weber Dach &amp; Fassade</h1>
<p>Coming soon – unsere neue Website befindet sich im Aufbau.</p>
<a href="#">Home</a>
<a href="#">Leistungen</a>
<a href="#">Kontakt</a>
<img src="" />
<p>© 2020</p>
`,
  'Weber Dach & Fassade',
  ``
);

const nordHtml = `<!DOCTYPE html><html><head><title>Dachservice Nord — Dachdecker Berlin</title><meta name="description" content="Dachreparatur in Berlin-Nord"></head><body><nav><a href="/kontakt">Kontakt</a><a href="/leistungen">Leistungen</a></nav><h1>Dachservice Nord</h1><p>Dachreparatur, Dämmung, Neueindeckung in Berlin.</p><a href="tel:+493012345679">+49 30 12345679</a></body></html>`;

const teamHtml = `<!DOCTYPE html><html><head><title>Berliner Dächer Team</title></head><body><nav><a href="/kontakt">Kontakt</a><a href="/leistungen">Leistungen</a></nav><h1>Berliner Dächer Team</h1><p>Dachdecker für Berlin.</p><a href="mailto:info@berliner-daecher-team.example">info@berliner-daecher-team.example</a><p>12345 Musterstraße, Berlin</p></body></html>`;

const mitteHtml = `<!DOCTYPE html><html><head><title>Dachprofi Mitte — Dachdecker in Berlin</title></head><body><nav><a href="/kontakt">Kontakt</a><a href="/leistungen">Leistungen</a></nav><h1>Dachprofi Mitte</h1><p>Lorem ipsum dolor sit amet.</p><a href="tel:+493012345680">+49 30 12345680</a><a href="mailto:info@dachprofi-mitte.example">info@dachprofi-mitte.example</a></body></html>`;

export const SAMPLE_FIXTURES: FixtureProspect[] = [
  {
    businessName: 'Dachfix Berlin GmbH',
    niche: 'roofing',
    city: 'Berlin',
    websiteUrl: 'https://www.dachfix-berlin.example',
    publicContactUrl: 'https://www.dachfix-berlin.example/kontakt',
    verifiedFacts: [
      `${FIXTURE_PREFIX} Homepage title is "Dachfix Berlin"`,
      `${FIXTURE_PREFIX} Homepage contains no meta description`,
      `${FIXTURE_PREFIX} No viewport meta tag (mobile presentation unverified on sample)`,
      `${FIXTURE_PREFIX} Copyright year on homepage is 2019 (stale content marker)`,
      `${FIXTURE_PREFIX} Placeholder copy "Lorem ipsum" present on homepage`,
      `${FIXTURE_PREFIX} No sitemap.xml and no Sitemap directive in robots.txt on sample`,
    ],
    unverifiedObservations: [
      `${FIXTURE_PREFIX} Business appears to target Berlin residential roofs (sample inference)`,
      `${FIXTURE_PREFIX} Contact page exists at /kontakt but is not linked from the homepage nav (sample)`,
    ],
    snapshotHtml: dachfixHtml,
  },
  {
    businessName: 'Berliner Dachdeckerei Müller',
    niche: 'roofing',
    city: 'Berlin',
    websiteUrl: 'https://www.dachdeckerei-mueller.example',
    publicContactUrl: 'https://www.dachdeckerei-mueller.example/kontakt',
    verifiedFacts: [
      `${FIXTURE_PREFIX} Meta description present ("Dachreparatur und Dämmung in Berlin")`,
      `${FIXTURE_PREFIX} Viewport meta tag present (mobile presentation declared)`,
      `${FIXTURE_PREFIX} Phone link (tel:) present on homepage — CTA verified`,
      `${FIXTURE_PREFIX} Contact page linked from navigation`,
      `${FIXTURE_PREFIX} Only one service page ("Leistungen") linked from navigation`,
      `${FIXTURE_PREFIX} No trust/review section on homepage`,
    ],
    unverifiedObservations: [
      `${FIXTURE_PREFIX} No location/district landing pages (sample inference from nav)`,
      `${FIXTURE_PREFIX} Recurring-service potential typical for roofing (repairs/emergency) — sample assumption`,
    ],
    snapshotHtml: muellerHtml,
  },
  {
    businessName: 'Dachservice Nord Berlin',
    niche: 'roofing',
    city: 'Berlin',
    websiteUrl: 'https://www.dachservice-nord.example',
    publicContactUrl: 'https://www.dachservice-nord.example/kontakt',
    verifiedFacts: [
      `${FIXTURE_PREFIX} Homepage title is "Dachservice Nord — Dachdecker Berlin"`,
      `${FIXTURE_PREFIX} Phone link (tel:) present on homepage — CTA verified`,
      `${FIXTURE_PREFIX} Contact page linked from navigation`,
      `${FIXTURE_PREFIX} Meta description present`,
    ],
    unverifiedObservations: [
      `${FIXTURE_PREFIX} No trust/review section on homepage (sample inference)`,
    ],
    snapshotHtml: nordHtml,
  },
  {
    businessName: 'Berliner Dächer Team',
    niche: 'roofing',
    city: 'Berlin',
    websiteUrl: 'https://www.berliner-daecher-team.example',
    publicContactUrl: 'https://www.berliner-daecher-team.example/kontakt',
    verifiedFacts: [
      `${FIXTURE_PREFIX} Homepage contains an email link (mailto:) — CTA verified`,
      `${FIXTURE_PREFIX} Address text with street present on homepage`,
      `${FIXTURE_PREFIX} Contact page linked from navigation`,
    ],
    unverifiedObservations: [
      `${FIXTURE_PREFIX} Only one service page linked from navigation (sample)`,
    ],
    snapshotHtml: teamHtml,
  },
  {
    businessName: 'Dachprofi Mitte GmbH',
    niche: 'roofing',
    city: 'Berlin',
    websiteUrl: 'https://www.dachprofi-mitte.example',
    publicContactUrl: 'https://www.dachprofi-mitte.example/kontakt',
    verifiedFacts: [
      `${FIXTURE_PREFIX} Homepage title is "Dachprofi Mitte — Dachdecker in Berlin"`,
      `${FIXTURE_PREFIX} Phone link (tel:) and email link (mailto:) present on homepage`,
      `${FIXTURE_PREFIX} Contact page linked from navigation`,
      `${FIXTURE_PREFIX} Placeholder copy "Lorem ipsum" present on homepage`,
    ],
    unverifiedObservations: [
      `${FIXTURE_PREFIX} Rebuild upside likely from placeholder content (sample assumption)`,
    ],
    snapshotHtml: mitteHtml,
  },
  {
    businessName: 'Meisterbetrieb Weber Dach & Fassade',
    niche: 'roofing',
    city: 'Berlin',
    websiteUrl: 'https://www.weber-dach-fassade.example',
    publicContactUrl: null,
    verifiedFacts: [
      `${FIXTURE_PREFIX} Homepage contains "Coming soon – unsere neue Website befindet sich im Aufbau"`,
      `${FIXTURE_PREFIX} No contact information (phone, email, address) visible on homepage`,
      `${FIXTURE_PREFIX} All navigation links are empty "#" placeholders`,
      `${FIXTURE_PREFIX} An image with an empty src attribute is present`,
      `${FIXTURE_PREFIX} No lang attribute on <html> (accessibility gap)`,
    ],
    unverifiedObservations: [
      `${FIXTURE_PREFIX} Likely no dedicated service or location pages (sample inference from nav)`,
      `${FIXTURE_PREFIX} Rebuild upside is high because the current site communicates almost nothing — sample assumption`,
    ],
    snapshotHtml: weberHtml,
  },
];

/** Fixtures matching a niche + city (case-insensitive substring match). */
export function fixturesFor(niche: string, city: string): FixtureProspect[] {
  const n = niche.toLowerCase();
  const c = city.toLowerCase();
  return SAMPLE_FIXTURES.filter(
    (f) => (!n || n === 'local business' || f.niche.toLowerCase().includes(n) || n.includes(f.niche.toLowerCase())) &&
           (!c || f.city.toLowerCase().includes(c) || c.includes(f.city.toLowerCase()))
  );
}
