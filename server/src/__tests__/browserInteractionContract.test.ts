/**
 * browserInteractionContract.test.ts — Real-DOM half of defect D22.
 *
 * These tests drive an ACTUAL Chromium page (headless) against a deterministic
 * YouTube-like consent fixture, so the DOM/accessibility path is exercised for
 * real rather than mocked: the button is found by its accessible name, the click
 * is genuinely dispatched, and the dialog must actually disappear before the
 * action counts as verified.
 *
 * No network access is used.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  clickControl,
  snapshotPage,
  waitForUnblocked,
} from '../services/browser/browserPageInspection.js';
import {
  matchControlByAccessibleName,
  resolveIndexedElement,
  serializeInteractiveSnapshot,
} from '../services/browser/browserActionContract.js';

const CONSENT_FIXTURE = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>YouTube</title></head>
<body style="margin:0">
  <div id="content" style="height:80vh">Video grid</div>
  <div id="consent" role="dialog" aria-modal="true"
       style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;background:#fff">
    <h2>Bevor du zu YouTube gehst</h2>
    <p>Wir verwenden Cookies und Daten, um Inhalte bereitzustellen.</p>
    <button>Alle ablehnen</button>
    <button>Alle akzeptieren</button>
    <button>Weitere Optionen</button>
  </div>
  <script>
    document.querySelectorAll('#consent button').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = document.getElementById('consent');
        if (d) d.remove();
      });
    });
  </script>
</body>
</html>`;

/** The same consent UI, but rendered inside an iframe (very common in the wild). */
const IFRAME_OUTER = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>YouTube</title></head>
<body style="margin:0">
  <div id="content">Video grid</div>
  <iframe id="consent-frame"
    style="position:fixed;top:0;left:0;width:100vw;height:100vh;border:0;z-index:9999"></iframe>
</body>
</html>`;

/** Inner document for the iframe; the buttons really remove the dialog. */
const IFRAME_INNER = `<!DOCTYPE html><html><body style="margin:0">
  <div role="dialog" aria-modal="true" id="consent" style="width:100vw;height:100vh;background:#fff">
    <p>Wir verwenden Cookies.</p>
    <button onclick="document.getElementById('consent').remove()">Alle ablehnen</button>
    <button onclick="document.getElementById('consent').remove()">Alle akzeptieren</button>
  </div>
</body></html>`;

async function loadIframeConsentFixture(page: Page): Promise<void> {
  await page.setContent(IFRAME_OUTER);
  await page.evaluate((inner) => {
    const frame = document.getElementById('consent-frame') as HTMLIFrameElement | null;
    if (frame) frame.srcdoc = inner;
  }, IFRAME_INNER);
  await page.waitForTimeout(400);
}

/** A page where the consent button does nothing — verification must fail. */
const STUCK_CONSENT_FIXTURE = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><title>YouTube</title></head>
<body>
  <div id="consent" role="dialog" aria-modal="true"
       style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff">
    <p>Wir verwenden Cookies.</p>
    <button>Alle ablehnen</button>
    <button>Alle akzeptieren</button>
  </div>
</body>
</html>`;

const LOGIN_FIXTURE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Sign in</title></head>
<body>
  <form>
    <label for="email">E-Mail</label><input id="email" type="text">
    <label for="pw">Passwort</label><input id="pw" type="password">
    <button type="submit">Anmelden</button>
  </form>
</body></html>`;

describe('D22 — real DOM interaction on a consent-blocked page', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
  }, 120_000);

  afterAll(async () => {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }, 60_000);

  it('inspects the page and sees the consent dialog as a blocker', async () => {
    await page.setContent(CONSENT_FIXTURE);
    const snapshot = await snapshotPage(page);

    expect(snapshot.title).toBe('YouTube');
    expect(snapshot.contentUsable).toBe(false);
    expect(snapshot.consentDialog?.found).toBe(true);
    expect(snapshot.blockers.some((b) => b.isConsentDialog)).toBe(true);
  }, 60_000);

  it('reads the German buttons by their accessible names', async () => {
    await page.setContent(CONSENT_FIXTURE);
    const snapshot = await snapshotPage(page);
    const names = snapshot.controls.map((c) => c.name);

    expect(names).toContain('Alle ablehnen');
    expect(names).toContain('Alle akzeptieren');
    expect(names).toContain('Weitere Optionen');
  }, 60_000);

  it('clicks "Alle akzeptieren" by accessible name and the dialog really disappears', async () => {
    await page.setContent(CONSENT_FIXTURE);
    const before = await snapshotPage(page);
    expect(before.contentUsable).toBe(false);

    const match = matchControlByAccessibleName(before.controls, 'Alle akzeptieren');
    expect(match.control?.name).toBe('Alle akzeptieren');
    expect(match.control?.marker).toBeTruthy();

    const click = await clickControl(page, match.control!);
    expect(click.dispatched).toBe(true);
    // DOM identity was used, not blind coordinates.
    expect(click.method).toBe('dom_identity');

    const wait = await waitForUnblocked(page, { timeoutMs: 6000 });
    expect(wait.blockedCleared).toBe(true);
    expect(wait.snapshot.contentUsable).toBe(true);
    expect(wait.snapshot.consentDialog).toBeNull();

    const dialogStillThere = await page.$('#consent');
    expect(dialogStillThere).toBeNull();
  }, 60_000);

  it('resolves the ENGLISH instruction "accept all" against the German UI', async () => {
    await page.setContent(CONSENT_FIXTURE);
    const before = await snapshotPage(page);

    const match = matchControlByAccessibleName(before.controls, 'accept all');
    expect(match.control?.name).toBe('Alle akzeptieren');

    const click = await clickControl(page, match.control!);
    expect(click.dispatched).toBe(true);

    const wait = await waitForUnblocked(page, { timeoutMs: 6000 });
    expect(wait.snapshot.contentUsable).toBe(true);
  }, 60_000);

  it('does not confuse "reject all" with the accept button', async () => {
    await page.setContent(CONSENT_FIXTURE);
    const before = await snapshotPage(page);

    const match = matchControlByAccessibleName(before.controls, 'reject all');
    expect(match.control?.name).toBe('Alle ablehnen');
  }, 60_000);

  it('finds a consent dialog rendered inside an iframe', async () => {
    await loadIframeConsentFixture(page);
    const snapshot = await snapshotPage(page);

    expect(snapshot.controls.map((c) => c.name)).toContain('Alle akzeptieren');
    expect(snapshot.contentUsable).toBe(false);

    const match = matchControlByAccessibleName(snapshot.controls, 'Alle akzeptieren');
    expect(match.control).not.toBeNull();
    // The click must be delivered into the correct frame.
    expect(match.control?.frameIndex).toBeGreaterThan(0);

    const click = await clickControl(page, match.control!);
    expect(click.dispatched).toBe(true);

    const wait = await waitForUnblocked(page, { timeoutMs: 6000 });
    expect(wait.snapshot.contentUsable).toBe(true);
  }, 60_000);

  it('reports an UNVERIFIED click when the dialog does not actually clear', async () => {
    await page.setContent(STUCK_CONSENT_FIXTURE);
    const before = await snapshotPage(page);
    expect(before.contentUsable).toBe(false);

    const match = matchControlByAccessibleName(before.controls, 'Alle akzeptieren');
    const click = await clickControl(page, match.control!);
    expect(click.dispatched).toBe(true);

    const wait = await waitForUnblocked(page, { timeoutMs: 2500, pollMs: 200 });
    // The click landed but nothing changed — this must NOT read as success.
    expect(wait.blockedCleared).toBe(false);
    expect(wait.snapshot.contentUsable).toBe(false);
    expect(wait.snapshot.consentDialog?.found).toBe(true);
  }, 60_000);

  it('detects a login screen and does not call it a consent dialog', async () => {
    await page.setContent(LOGIN_FIXTURE);
    const snapshot = await snapshotPage(page);

    expect(snapshot.loginScreen).toBe(true);
    expect(snapshot.consentDialog).toBeNull();
  }, 60_000);

  it('does not report a blocker-free page as blocked', async () => {
    await page.setContent('<html><head><title>Plain</title></head><body><h1>Hello</h1><button>Go</button></body></html>');
    const snapshot = await snapshotPage(page);
    expect(snapshot.contentUsable).toBe(true);
    expect(snapshot.blockers).toHaveLength(0);
  }, 60_000);

  it('drives the whole indexed path: index → DOM identity → real click', async () => {
    await page.setContent(CONSENT_FIXTURE);
    const snapshot = await snapshotPage(page);
    const indexed = serializeInteractiveSnapshot(snapshot);

    // The dialog leads the list, so "accept all" is addressable by INDEX.
    const acceptIndex = indexed.elements.find((e) => e.name === 'Alle akzeptieren')?.index;
    expect(acceptIndex).toBeDefined();
    expect(indexed.blocker?.optionIndices).toContain(acceptIndex);

    // Resolve the index exactly as the operator does.
    const resolution = resolveIndexedElement({
      index: acceptIndex!,
      state: { lastIndexedElements: indexed.elements, indexedUrl: snapshot.url },
      currentUrl: snapshot.url,
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;

    // The index carries real DOM identity, so no coordinates are involved.
    const control = snapshot.controls.find((c) => c.marker === resolution.element.marker);
    expect(control).toBeTruthy();

    const click = await clickControl(page, control!);
    expect(click.dispatched).toBe(true);
    expect(click.method).toBe('dom_identity');

    const wait = await waitForUnblocked(page, { timeoutMs: 6000 });
    expect(wait.snapshot.contentUsable).toBe(true);
    expect(wait.snapshot.consentDialog).toBeNull();
  }, 60_000);
});
