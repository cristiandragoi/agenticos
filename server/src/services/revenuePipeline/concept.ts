/**
 * Stage 7 — Staged static-friendly site concept (existing preferred stack:
 * React + Vite + TypeScript, static-friendly output).
 *
 * Writes a REAL, buildable site into <proposalDir>/site_concept/:
 *   npm install && npm run build && node tests/verify.mjs
 * All business-specific values are `[PLACEHOLDER: …]` or fixture-labelled.
 * No WordPress. No publishing.
 */
import fs from 'fs';
import path from 'path';
import type { PipelineConfig, ProspectRecord } from './types.js';
import { FIXTURE_PREFIX } from './fixtures.js';

export interface ConceptResult {
  path: string;
  files: string[];
  buildCommand: string;
  verifyCommand: string;
}

export function generateSiteConcept(prospect: ProspectRecord, config: PipelineConfig, proposalDir: string): ConceptResult {
  const conceptDir = path.join(proposalDir, 'site_concept');
  fs.mkdirSync(conceptDir, { recursive: true });
  fs.mkdirSync(path.join(conceptDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(conceptDir, 'tests'), { recursive: true });

  const name = prospect.businessName || '[BUSINESS NAME]';
  const niche = prospect.niche || 'local business';
  const city = prospect.city || config.city || '[CITY]';
  const phone = '[PHONE NUMBER]';
  const disclaimer = prospect.fixture
    ? `${FIXTURE_PREFIX} This concept is built from clearly-labelled sample data. Replace every placeholder with verified customer data before any use.`
    : 'Concept built from a user-provided URL audit. Replace every placeholder with verified customer data before any use.';

  const files: Record<string, string> = {
    'package.json': JSON.stringify(
      {
        name: 'agenticos-site-concept',
        private: true,
        version: '0.1.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
          verify: 'node tests/verify.mjs',
        },
        dependencies: { react: '^19.2.6', 'react-dom': '^19.2.6' },
        devDependencies: {
          '@types/react': '^19.2.14',
          '@types/react-dom': '^19.2.4',
          '@vitejs/plugin-react': '^4.3.4',
          typescript: '~5.8.3',
          vite: '^6.0.0',
        },
      },
      null,
      2
    ),
    'tsconfig.json': `{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
`,
    'tsconfig.app.json': `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`,
    'tsconfig.node.json': `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
`,
    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
});
`,
    'index.html': `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="[PLACEHOLDER: meta description — confirm with customer]" />
    <title>[PLACEHOLDER: Business name] — ${capitalize(niche)} in ${city}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    'src/main.tsx': `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    'src/content.ts': `// Site content — every value is a [PLACEHOLDER] or fixture-labelled sample data.
// ${disclaimer}
export const SITE = {
  businessName: '${name.replace(/'/g, "\\'")}',
  niche: '${niche.replace(/'/g, "\\'")}',
  city: '${city.replace(/'/g, "\\'")}',
  phone: '${phone}',
  valueProposition: '[PLACEHOLDER: value proposition — e.g. Fast, reliable ' + '${niche.replace(/'/g, "\\'")}' + ' in ${city.replace(/'/g, "\\'")}]',
  services: [
    '[PLACEHOLDER: Service 1 — confirm real offering]',
    '[PLACEHOLDER: Service 2 — confirm real offering]',
    '[PLACEHOLDER: Service 3 — confirm real offering]',
  ],
  districts: ['[PLACEHOLDER: District 1]', '[PLACEHOLDER: District 2]'],
  proof: ['[PLACEHOLDER: verified review or reference]'],
  cta: 'Get a free quote',
  phoneCta: 'Call now',
};
`,
    'src/App.tsx': `import type { ReactNode } from 'react';
import { SITE } from './content';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function App() {
  return (
    <div className="page">
      <header className="header" id="site-header">
        <div className="brand">{SITE.businessName}</div>
        <nav aria-label="Main">
          <a href="#services">Services</a>
          <a href="#locations">Areas</a>
          <a href="#contact">Contact</a>
        </nav>
        <a className="cta cta--phone" href="tel:${phone.replace(/[^0-9+]/g, '')}">
          {SITE.phoneCta}
        </a>
      </header>

      <main>
        <section id="hero" className="hero">
          <h1>{SITE.valueProposition}</h1>
          <p>
            {SITE.businessName} — {SITE.niche} in {SITE.city}.{' '}
            [PLACEHOLDER: one sentence of verified, customer-confirmed context]
          </p>
          <a className="cta" href="#contact">{SITE.cta}</a>
        </section>

        <Section id="services" title="Our services">
          <ul className="cards">
            {SITE.services.map((s, i) => (
              <li key={i} className="card">
                {s}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="locations" title="Areas we serve">
          <ul className="cards">
            {SITE.districts.map((d, i) => (
              <li key={i} className="card">{d}</li>
            ))}
          </ul>
        </Section>

        <Section id="trust" title="Why choose us">
          <ul className="cards">
            {SITE.proof.map((p, i) => (
              <li key={i} className="card">{p}</li>
            ))}
          </ul>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            Phone: <a href="tel:${phone.replace(/[^0-9+]/g, '')}">{SITE.phone}</a> ·{' '}
            [PLACEHOLDER: email] · [PLACEHOLDER: address] · [PLACEHOLDER: hours]
          </p>
          <p className="note">[PLACEHOLDER: Impressum / Datenschutz links — legal review required]</p>
        </Section>
      </main>

      <footer id="site-footer" className="footer">
        © {new Date().getFullYear()} {SITE.businessName} — staged concept, not published.
      </footer>
    </div>
  );
}
`,
    'src/styles.css': `/* Mobile-first styles for the staged concept. */
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: 1.5; color: #1c2430; background: #fff; }
.page { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
.header { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
.brand { font-weight: 700; }
.header nav { margin-left: auto; display: flex; gap: 12px; }
.header a { color: inherit; text-decoration: none; }
.cta { display: inline-block; background: #0b5fff; color: #fff; border-radius: 8px; padding: 10px 18px; text-decoration: none; font-weight: 600; }
.cta--phone { background: #0f9d58; }
.hero { padding: 48px 0 32px; }
.hero h1 { font-size: clamp(1.6rem, 4vw, 2.6rem); margin: 0 0 12px; }
.section { padding: 32px 0; }
.cards { list-style: none; padding: 0; display: grid; gap: 12px; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
.note { font-size: 0.85rem; color: #6b7280; }
.footer { border-top: 1px solid #e5e7eb; padding: 20px 0; margin-top: 32px; font-size: 0.85rem; color: #6b7280; }
@media (min-width: 720px) {
  .cards { grid-template-columns: repeat(3, 1fr); }
}
`,
    'tests/verify.mjs': `// Focused artifact verification for the staged concept (no framework needed).
// Run: node tests/verify.mjs   → prints PASS/FAIL, exit code 0/1.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return null; }
};

const requiredFiles = ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/content.ts', 'src/styles.css'];
for (const f of requiredFiles) checks.push([\`file exists: \${f}\`, read(f) !== null]);

const html = read('index.html') || '';
checks.push(['index.html has lang attribute', /<html[^>]*lang=/.test(html)]);
checks.push(['index.html has viewport meta', /name="viewport"/.test(html)]);
checks.push(['index.html has root div', /id="root"/.test(html)]);
checks.push(['index.html uses placeholder title marker', html.includes('[PLACEHOLDER')]);

const app = read('src/App.tsx') || '';
const requiredIds = ['hero', 'services', 'locations', 'trust', 'contact', 'site-footer'];
for (const id of requiredIds) checks.push([\`App.tsx has section id \${id}\`, new RegExp(\`id="\${id}"\`).test(app)]);

// No fabricated claims: no prices, rankings, revenue, or fake reviews in content.
const content = (read('src/content.ts') || '') + '\\n' + app;
const fabricated = [
  [/€\\s?\\d{2,}/g, 'price'],
  [/\\brank(ed)?\\s*#?\\d/gi, 'ranking'],
  [/\\brevenue\\b/gi, 'revenue'],
  [/\\b#1\\b/g, 'number-one claim'],
];
for (const [re, label] of fabricated) {
  const hits = (content.match(re) || []).filter((h) => !h.includes('PLACEHOLDER'));
  checks.push([\`no fabricated \${label} claims\`, hits.length === 0]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failed++;
}
console.log(failed === 0 ? \`VERIFY OK (\${checks.length} checks)\` : \`VERIFY FAILED (\${failed}/\${checks.length})\`);
process.exit(failed === 0 ? 0 : 1);
`,
    'README.md': `# Staged site concept — ${name}

${disclaimer}

## Build & verify (real commands, no publishing)

\`\`\`
npm install
npm run build     # tsc -b && vite build → dist/
node tests/verify.mjs
\`\`\`

## Staging notes

- Replace every \`[PLACEHOLDER: …]\` with verified customer data before ANY use.
- Add real photos, real reviews (with consent), Impressum/Datenschutz (legal review).
- Do NOT publish, deploy, or share this concept externally without customer approval.
`,
  };

  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(conceptDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
    written.push(p);
  }

  return {
    path: conceptDir,
    files: written,
    buildCommand: 'npm install && npm run build',
    verifyCommand: 'node tests/verify.mjs',
  };
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
