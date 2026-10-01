/**
 * browserPageInspection.ts — Playwright/DOM layer for the Browser Action Contract.
 *
 * Responsibility split:
 *   - this file  : READ the real page (DOM + accessibility) and deliver actions by
 *                  real DOM identity.
 *   - contract   : DECIDE what the observation means (pure, unit-tested).
 *
 * Clicking is delivered through a stable `data-hermes-control` marker set during
 * inspection, so the click targets the element the user named by its accessible
 * name. Coordinates are only used when no DOM/accessibility identity exists.
 */

import type { Frame, Page } from 'playwright';
import { logger } from '../../utils/logger.js';
import {
  classifyBlockingDialog,
  consentChoiceForLabel,
  detectLoginScreen,
  errMsg,
  normaliseLabel,
  type BlockingDialog,
  type ObservedDialogContainer,
  type PageStateSnapshot,
  type VisibleControl,
} from './browserActionContract.js';

const CONTROL_ATTR = 'data-hermes-control';

/** Raw, serialisable result of one in-page inspection pass. */
interface RawFrameInspection {
  url: string;
  title: string;
  bodyText: string;
  controls: VisibleControl[];
  containers: ObservedDialogContainer[];
}

/**
 * In-page collector. MUST be fully self-contained (it is serialised into the
 * page). Assigns `data-hermes-control` markers to visible interactive elements
 * and gathers candidate overlay containers.
 */
function collectInPage(): RawFrameInspection {
  // NOTE: this function is serialised into the page — it must not reference any
  // module-scope identifier. The marker attribute is therefore inlined.
  const ATTR = 'data-hermes-control';
  const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (parseFloat(cs.opacity || '1') < 0.05) return false;
    return true;
  };

  const accessibleName = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && norm(aria)) return norm(aria);

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => {
          const t = document.getElementById(id);
          return t ? norm(t.textContent) : '';
        })
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      const id = el.getAttribute('id');
      if (id && typeof CSS !== 'undefined' && CSS.escape) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab && norm(lab.textContent)) return norm(lab.textContent);
      }
      const wrap = el.closest('label');
      if (wrap && norm(wrap.textContent)) return norm(wrap.textContent);
      const ph = el.getAttribute('placeholder');
      if (ph && norm(ph)) return norm(ph);
      const ti = el.getAttribute('title');
      if (ti && norm(ti)) return norm(ti);
      const val = (el as HTMLInputElement).value;
      if (val && norm(val) && (el as HTMLInputElement).type !== 'password') return norm(val);
      const nm = el.getAttribute('name');
      if (nm && norm(nm)) return norm(nm);
      return '';
    }

    const own = norm(el.textContent);
    if (own) return own;
    const title = el.getAttribute('title');
    if (title && norm(title)) return norm(title);
    const img = el.querySelector('img[alt]');
    if (img) {
      const alt = norm(img.getAttribute('alt'));
      if (alt) return alt;
    }
    return '';
  };

  const kindOf = (el: Element): VisibleControl['kind'] => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'button' || role === 'menuitem' || role === 'tab') return 'button';
    if (role === 'link') return 'link';
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return 'textbox';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A') return 'link';
    if (tag === 'INPUT') {
      const t = (el as HTMLInputElement).type;
      if (t === 'submit' || t === 'button') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'SELECT') return 'other';
    return 'other';
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A') return 'link';
    if (tag === 'INPUT') {
      const t = (el as HTMLInputElement).type;
      if (t === 'submit' || t === 'button') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'TEXTAREA') return 'textbox';
    return tag.toLowerCase();
  };

  // Clear markers from a previous pass so identities stay stable and unique.
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));

  const SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[onclick]',
  ].join(',');

  const controls: VisibleControl[] = [];
  let markerSeq = 0;

  document.querySelectorAll(SELECTOR).forEach((el) => {
    if (!isVisible(el)) return;
    const name = accessibleName(el);
    const r = el.getBoundingClientRect();
    const marker = `hc${markerSeq++}`;
    el.setAttribute(ATTR, marker);
    controls.push({
      role: roleOf(el),
      name,
      tagName: el.tagName.toLowerCase(),
      kind: kindOf(el),
      visible: true,
      disabled:
        (el as HTMLButtonElement).disabled === true ||
        el.getAttribute('aria-disabled') === 'true',
      marker,
      href: el.tagName === 'A' ? (el as HTMLAnchorElement).href || undefined : undefined,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    });
  });

  const CONTAINER_SELECTOR = [
    '[role="dialog"]',
    '[aria-modal="true"]',
    'dialog[open]',
    '[class*="consent" i]',
    '[id*="consent" i]',
    '[class*="cookie" i]',
    '[id*="cookie" i]',
    '[class*="modal" i][class*="overlay" i]',
    'div[style*="position: fixed"]',
  ].join(',');

  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;

  const containers: ObservedDialogContainer[] = [];
  document.querySelectorAll(CONTAINER_SELECTOR).forEach((el) => {
    if (!isVisible(el)) return;
    const r = el.getBoundingClientRect();
    const cover = Math.min(1, (r.width * r.height) / (vw * vh));
    // Ignore containers that clearly are not overlays.
    if (cover < 0.05 && el.getAttribute('role') !== 'dialog' && el.getAttribute('aria-modal') !== 'true') {
      return;
    }
    const inner = controls.filter((c) => {
      if (!c.marker) return false;
      const target = el.querySelector(`[${ATTR}="${c.marker}"]`);
      return Boolean(target) && c.name;
    });
    containers.push({
      text: norm(el.textContent).slice(0, 1200),
      coversViewportRatio: cover,
      ariaModal: el.getAttribute('aria-modal') === 'true',
      roleDialog: el.getAttribute('role') === 'dialog' || el.tagName.toLowerCase() === 'dialog',
      controls: inner,
    });
  });

  return {
    url: location.href,
    title: document.title || '',
    bodyText: norm(document.body ? document.body.innerText : '').slice(0, 4000),
    controls,
    containers,
  };
}

/** Inspect every frame and merge into one page-state snapshot. */
export async function snapshotPage(page: Page): Promise<PageStateSnapshot> {
  const frames: Frame[] = page.frames();
  const allControls: VisibleControl[] = [];
  const allContainers: ObservedDialogContainer[] = [];
  let primary: RawFrameInspection | null = null;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    try {
      // Toolchain guard: tsx/esbuild wraps nested function declarations with its
      // `__name` keepNames helper, and that helper does NOT exist in the page
      // context, so a serialized collector throws "ReferenceError: __name is not
      // defined" and the frame yields ZERO controls. Evaluated as a raw STRING so
      // no transform can rewrite it. Harmless where __name is never referenced.
      await frame
        .evaluate('globalThis.__name = globalThis.__name || function (f) { return f; }')
        .catch(() => {});
      const raw = (await frame.evaluate(collectInPage)) as RawFrameInspection;
      if (i === 0) primary = raw;
      for (const c of raw.controls ?? []) {
        allControls.push({ ...c, frameIndex: i });
      }
      for (const container of raw.containers ?? []) {
        allContainers.push({
          ...container,
          controls: (container.controls ?? []).map((c) => ({ ...c, frameIndex: i })),
        });
      }
    } catch (err: unknown) {
      // Detached / navigated-away frame: not fatal, but never silent — a page
      // that yields ZERO controls because inspection failed must not be reported
      // as a usable-but-empty page.
      logger.warn('[BrowserPageInspection] frame inspection FAILED', {
        frameIndex: i,
        url: (() => {
          try {
            return frame.url();
          } catch {
            return 'unknown';
          }
        })(),
        error: errMsg(err),
      });
    }
  }

  const url = page.url();
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  })();

  const blockers: BlockingDialog[] = [];
  for (const container of allContainers) {
    const classified = classifyBlockingDialog({
      text: container.text,
      controls: container.controls,
      containerIsDialog: container.roleDialog || container.ariaModal,
    });
    if (!classified) continue;
    const overlayLike =
      container.roleDialog || container.ariaModal || container.coversViewportRatio >= 0.2;
    if (!overlayLike && !classified.isConsentDialog && classified.kind !== 'captcha') continue;
    if (blockers.some((b) => b.kind === classified.kind)) continue;
    blockers.push(classified);
  }

  // Fallback: consent controls present on the page without a detected container.
  // YouTube/Google render the consent UI in ways that do not always expose a
  // clean dialog container, but the buttons themselves are unambiguous.
  if (!blockers.some((b) => b.isConsentDialog)) {
    const consentControls = allControls.filter(
      (c) => c.visible && consentChoiceForLabel(c.name) !== null,
    );
    const pageText = primary?.bodyText ?? '';
    const textHintsConsent = /cookie|consent|datenschutz|privacy|einwilligung/i.test(pageText);
    if (consentControls.length >= 2 && textHintsConsent) {
      blockers.unshift({
        kind: 'cookie_consent',
        text: pageText.slice(0, 1200),
        controls: consentControls,
        isConsentDialog: true,
      });
    }
  }

  const consentDialog = blockers.find((b) => b.isConsentDialog) ?? null;
  const captcha = blockers.find((b) => b.kind === 'captcha') ?? null;
  const fullOverlayModal =
    blockers.find(
      (b) =>
        b.kind === 'modal' &&
        allContainers.some(
          (c) => c.coversViewportRatio >= 0.35 && classifyBlockingDialog({
            text: c.text,
            controls: c.controls,
            containerIsDialog: true,
          })?.kind === 'modal',
        ),
    ) ?? null;

  const contentUsable = !consentDialog && !captcha && !fullOverlayModal;

  return {
    url,
    title: primary?.title ?? (await page.title().catch(() => '')),
    host,
    readyState: await page
      .evaluate(() => document.readyState)
      .catch(() => 'unknown'),
    controls: allControls,
    blockers,
    loginScreen: detectLoginScreen(allControls, primary?.bodyText ?? ''),
    consentDialog: consentDialog
      ? {
          found: true,
          kind: consentDialog.kind,
          text: consentDialog.text,
          controls: consentDialog.controls,
        }
      : null,
    contentUsable,
    capturedAt: Date.now(),
  };
}

export interface ClickOutcome {
  dispatched: boolean;
  method: 'dom_identity' | 'in_page_click' | 'coordinates' | 'none';
  error?: string;
}

/**
 * Click a control that was identified during inspection.
 * Preference order: real DOM identity (Playwright handle) → in-page .click()
 * → coordinates, only when no DOM identity exists.
 */
export async function clickControl(
  page: Page,
  control: VisibleControl,
): Promise<ClickOutcome> {
  const frames = page.frames();
  const frame = frames[control.frameIndex ?? 0] ?? page.mainFrame();

  if (control.marker) {
    try {
      const selector = `[${CONTROL_ATTR}="${control.marker}"]`;
      const handle = await frame.$(selector);
      if (handle) {
        await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await handle.click({ timeout: 7000 });
        return { dispatched: true, method: 'dom_identity' };
      }
    } catch (err: unknown) {
      logger.warn('[BrowserPageInspection] handle click failed, trying in-page click', {
        error: errMsg(err),
        name: control.name,
      });
      try {
        const handle = await frame.$(`[${CONTROL_ATTR}="${control.marker}"]`);
        if (handle) {
          await frame.evaluate((el) => (el as HTMLElement).click(), handle);
          return { dispatched: true, method: 'in_page_click' };
        }
      } catch (innerErr: unknown) {
        logger.warn('[BrowserPageInspection] in-page click failed', {
          error: errMsg(innerErr),
        });
      }
    }
  }

  if (control.rect && frame === page.mainFrame()) {
    try {
      await page.mouse.click(
        control.rect.x + control.rect.width / 2,
        control.rect.y + control.rect.height / 2,
      );
      return { dispatched: true, method: 'coordinates' };
    } catch (err: unknown) {
      return { dispatched: false, method: 'none', error: errMsg(err) };
    }
  }

  return {
    dispatched: false,
    method: 'none',
    error: `No DOM identity available for control "${control.name}"`,
  };
}

export async function typeIntoControl(
  page: Page,
  control: VisibleControl,
  text: string,
): Promise<{ typed: boolean; error?: string }> {
  const frames = page.frames();
  const frame = frames[control.frameIndex ?? 0] ?? page.mainFrame();
  try {
    if (control.marker) {
      const handle = await frame.$(`[${CONTROL_ATTR}="${control.marker}"]`);
      if (handle) {
        await handle.click({ timeout: 5000 }).catch(() => {});
        await handle.fill(text, { timeout: 5000 });
        return { typed: true };
      }
    }
    return { typed: false, error: `No DOM identity for field "${control.name}"` };
  } catch (err: unknown) {
    return { typed: false, error: errMsg(err) };
  }
}

export async function pressEnter(page: Page): Promise<void> {
  await page.keyboard.press('Enter').catch(() => {});
}

export async function scrollPage(
  page: Page,
  direction: 'up' | 'down' = 'down',
  amount = 600,
): Promise<void> {
  const delta = direction === 'down' ? amount : -amount;
  await page.mouse.wheel(0, delta).catch(() => {});
}

/**
 * Wait until the page stops being blocked, or the timeout elapses.
 * Returns the last snapshot so the caller can verify honestly.
 */
export async function waitForUnblocked(
  page: Page,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ snapshot: PageStateSnapshot; blockedCleared: boolean }> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const pollMs = opts.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  let snapshot = await snapshotPage(page);
  while (Date.now() < deadline) {
    if (snapshot.contentUsable && !snapshot.blockers.some((b) => b.isConsentDialog)) {
      return { snapshot, blockedCleared: true };
    }
    await page.waitForTimeout(pollMs).catch(() => {});
    snapshot = await snapshotPage(page);
  }
  return { snapshot, blockedCleared: false };
}

/**
 * Wait until the page actually exposes interactive content.
 *
 * WHY THIS EXISTS: `waitUntil: 'commit'` resolves when the navigation is
 * committed — for a heavy SPA (YouTube) that is BEFORE the app has rendered.
 * Inspecting at that instant yields ZERO controls and a false
 * `contentUsable: true` verdict, which is the same class of error as reporting
 * navigation as task success: the system claims the page is ready when it has
 * not actually looked at anything yet.
 */
export async function waitForInteractiveContent(
  page: Page,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<PageStateSnapshot> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const pollMs = opts.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let snapshot = await snapshotPage(page);
  while (Date.now() < deadline) {
    if (snapshot.controls.some((c) => c.visible && c.name)) return snapshot;
    await page.waitForTimeout(pollMs).catch(() => {});
    snapshot = await snapshotPage(page);
  }
  return snapshot;
}

/** Navigate back in the page history ("go back"). */
export async function goBack(
  page: Page,
  timeoutMs = 10000,
): Promise<{ moved: boolean; url: string; title: string }> {
  try {
    await page.goBack({ waitUntil: 'commit', timeout: timeoutMs });
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    return {
      moved: true,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  } catch {
    return {
      moved: false,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  }
}

/** Navigate forward in the page history ("go forward"). */
export async function goForward(
  page: Page,
  timeoutMs = 10000,
): Promise<{ moved: boolean; url: string; title: string }> {
  try {
    await page.goForward({ waitUntil: 'commit', timeout: timeoutMs });
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    return {
      moved: true,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  } catch {
    return {
      moved: false,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  }
}

/** Wait for the page URL/host to reach an expected domain. */
export async function waitForHost(
  page: Page,
  expectedHost: string,
  timeoutMs = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const want = normaliseLabel(expectedHost);
  while (Date.now() < deadline) {
    try {
      const host = new URL(page.url()).hostname.replace(/^www\./, '').toLowerCase();
      if (host.includes(want)) return true;
    } catch {
      /* not navigated yet */
    }
    await page.waitForTimeout(200).catch(() => {});
  }
  return false;
}

export { CONTROL_ATTR };
