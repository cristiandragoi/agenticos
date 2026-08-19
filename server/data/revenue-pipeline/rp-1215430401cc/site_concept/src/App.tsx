import type { ReactNode } from 'react';
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
        <a className="cta cta--phone" href="tel:">
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
            Phone: <a href="tel:">{SITE.phone}</a> ·{' '}
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
