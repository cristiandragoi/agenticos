/**
 * browserActionContract.ts — The Browser Action Contract for JARVIS.
 *
 * ROOT CAUSE THIS MODULE EXISTS:
 *   Jarvis could NAVIGATE but could not INTERACT. `BrowserOperator.openTarget()`
 *   navigated, matched the host, and answered "I've opened YouTube." — even when a
 *   cookie/consent dialog was still covering the page and the user had asked for a
 *   CLICK. Navigation was being reported as task completion.
 *
 * The contract enforced here:
 *   UNDERSTAND GOAL → NAVIGATE → INSPECT ACTUAL PAGE STATE → IDENTIFY VISIBLE
 *   BLOCKERS/CONTROLS → PERFORM USER-AUTHORIZED ACTION → VERIFY DOM/PAGE STATE
 *   CHANGED → CONTINUE ORIGINAL GOAL → REPORT RESULT
 *
 * This file is deliberately FRAMEWORK-FREE (no Playwright import) so every rule
 * below — consent authorization, control matching, correction resolution, goal
 * continuation, metrics — is unit-testable without launching a browser.
 * Playwright/DOM access lives in `browserPageInspection.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Contract types
// ─────────────────────────────────────────────────────────────────────────────

export type BrowserActionKind =
  | 'navigate'
  | 'click'
  | 'type'
  | 'press'
  | 'scroll'
  | 'wait'
  | 'inspect'
  | 'search';

/**
 * A visible, interactive element as the user would perceive it.
 * Resolved from DOM + accessibility data — NOT from raw coordinates.
 */
export interface VisibleControl {
  /** ARIA role, or an inferred role when the element exposes none. */
  role: string;
  /** Accessible name: aria-label → aria-labelledby text → visible text → title/value. */
  name: string;
  tagName: string;
  kind: 'button' | 'link' | 'textbox' | 'checkbox' | 'radio' | 'menuitem' | 'other';
  visible: boolean;
  disabled: boolean;
  /**
   * Stable DOM identity assigned during inspection (`data-hermes-control`).
   * This is how the click is delivered — by real DOM identity, not coordinates.
   */
  marker?: string;
  /** Frame the control lives in (consent dialogs are frequently in an iframe). */
  frameIndex?: number;
  /** For links: the resolved href, used to tell a content result from a nav link. */
  href?: string;
  /** Only used as a last-resort fallback when no DOM/ARIA identity is available. */
  rect?: { x: number; y: number; width: number; height: number };
}

/** A candidate overlay container observed in the page. */
export interface ObservedDialogContainer {
  text: string;
  coversViewportRatio: number;
  ariaModal: boolean;
  roleDialog: boolean;
  controls: VisibleControl[];
}

export type BlockingDialogKind =
  | 'cookie_consent'
  | 'login'
  | 'modal'
  | 'captcha'
  | 'unknown';

export interface BlockingDialog {
  kind: BlockingDialogKind;
  /** Visible text of the dialog container, truncated. */
  text: string;
  /** Controls the user can actually see inside the dialog. */
  controls: VisibleControl[];
  /** True when the dialog is only offering consent choices. */
  isConsentDialog: boolean;
}

/**
 * A single observation of the page. Everything downstream decides from this,
 * never from "we navigated, so we are done".
 */
export interface PageStateSnapshot {
  url: string;
  title: string;
  host: string;
  readyState: string;
  /** Visible interactive controls on the page (dialog controls included). */
  controls: VisibleControl[];
  /** Detected blocking dialogs, most blocking first. */
  blockers: BlockingDialog[];
  /** A login/authentication wall is present. */
  loginScreen: boolean;
  /** A cookie/consent dialog is present. */
  consentDialog: PresentDialogSummary | null;
  /**
   * Whether the page's actual content is usable by the user.
   * FALSE while a blocking dialog covers it.
   */
  contentUsable: boolean;
  capturedAt: number;
}

export interface PresentDialogSummary {
  found: boolean;
  kind: BlockingDialogKind;
  text: string;
  controls: VisibleControl[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Metrics
// ─────────────────────────────────────────────────────────────────────────────

export const BROWSER_METRIC_NAMES = [
  'browser_goal_started',
  'browser_goal_resumed',
  'browser_action_requested',
  'browser_action_verified',
  'browser_action_failed',
  'browser_blocker_detected',
  'browser_blocker_resolved',
  'browser_context_lost',
  'browser_repeated_navigation',
  'browser_consent_retry',
  'browser_followup_routed',
  'browser_followup_resolved',
  'browser_followup_failed',
  'browser_context_reused',
  'browser_context_missing',
  'browser_preference_used',
  'browser_preference_overridden',
  'browser_preference_saved',
  'browser_target_mismatch',
] as const;

export type BrowserMetricName = (typeof BROWSER_METRIC_NAMES)[number];

export interface BrowserMetricEvent {
  name: BrowserMetricName;
  at: number;
  detail?: Record<string, unknown>;
}

/**
 * Append-only in-process metric ledger.
 * Deliberately simple and bounded; a stability regression can assert on counts.
 */
export class BrowserMetricsLedger {
  private events: BrowserMetricEvent[] = [];
  private counters = new Map<BrowserMetricName, number>();
  private readonly maxEvents: number;

  constructor(maxEvents = 500) {
    this.maxEvents = maxEvents;
    for (const n of BROWSER_METRIC_NAMES) this.counters.set(n, 0);
  }

  public record(name: BrowserMetricName, detail?: Record<string, unknown>): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    this.events.push({ name, at: Date.now(), detail });
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
  }

  public count(name: BrowserMetricName): number {
    return this.counters.get(name) ?? 0;
  }

  public snapshot(): Record<BrowserMetricName, number> {
    const out = {} as Record<BrowserMetricName, number>;
    for (const n of BROWSER_METRIC_NAMES) out[n] = this.count(n);
    return out;
  }

  public recent(limit = 50): BrowserMetricEvent[] {
    return this.events.slice(-limit);
  }

  public reset(): void {
    this.events = [];
    for (const n of BROWSER_METRIC_NAMES) this.counters.set(n, 0);
  }
}

export const browserMetrics = new BrowserMetricsLedger();

// ─────────────────────────────────────────────────────────────────────────────
// 3. Browser conversation state
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingBrowserAction {
  kind: BrowserActionKind;
  /** What the user asked for, in their words. */
  requested: string;
  /** The control the user pointed at, if any. */
  targetName?: string;
  query?: string;
  createdAt: number;
}

export interface ActiveOperationalGoal {
  originalGoal: string;
  target: string;
  action: string;
  query?: string;
  currentStep: string;
  browserState: {
    url?: string;
    title?: string;
    host?: string;
    contentUsable?: boolean;
  };
  blocker: string | null;
  recoveryAction: string | null;
  nextStep: string | null;
  startedAt: number;
  updatedAt: number;
}

export interface ActiveBrowserEntityContext {
  platform: 'YouTube' | string;
  currentUrl: string;
  pageTitle: string;
  entityType: 'channel' | 'video' | 'post' | 'page' | string;
  entityName: string;
  entityHandle?: string | null;
  entityUrl: string;
  contentTab?: string | null;
  lastSelectedVideo?: {
    title: string;
    url: string;
    videoId?: string;
    isShort?: boolean;
    channelName?: string;
  } | null;
  originatingTurnId?: string | null;
  verified: boolean;
}

export interface BrowserConversationState {
  lastBrowserGoal: string | null;
  lastBrowserUrl: string | null;
  lastBrowserTitle: string | null;
  lastBrowserAction: string | null;
  lastBrowserResult: string | null;
  blockingDialog: BlockingDialog | null;
  pendingBrowserAction: PendingBrowserAction | null;
  visibleTarget: string | null;
  verificationState: 'unverified' | 'verified' | 'failed' | 'blocked';
  /** When verificationState is 'blocked', why. */
  blockedReason: string | null;
  /**
   * The indexed element list from the last inspection.
   * Browser Use's central mechanism: the model acts on ELEMENT INDICES, not raw
   * selectors. Persisting the index map is what lets a LATER turn say
   * "click 2" and still resolve to the right element.
   */
  lastIndexedElements: IndexedElement[];
  /** The page URL the index map belongs to — a stale map must never be reused. */
  indexedUrl: string | null;
  activeOperationalGoal?: ActiveOperationalGoal | null;
  activeBrowserEntity?: ActiveBrowserEntityContext | null;
}

export function emptyBrowserState(): BrowserConversationState {
  return {
    lastBrowserGoal: null,
    lastBrowserUrl: null,
    lastBrowserTitle: null,
    lastBrowserAction: null,
    lastBrowserResult: null,
    blockingDialog: null,
    pendingBrowserAction: null,
    visibleTarget: null,
    verificationState: 'unverified',
    blockedReason: null,
    lastIndexedElements: [],
    indexedUrl: null,
    activeOperationalGoal: null,
    activeBrowserEntity: null,
  };
}

/**
 * Per-conversation browser state, keyed by conversationId.
 * The defect registry entry demands state survives across turns so that
 * "Accept it." and "Continue to YouTube." resolve against the CURRENT page.
 */
export class BrowserConversationStateStore {
  private byConversation = new Map<string, BrowserConversationState>();

  public get(conversationId: string): BrowserConversationState {
    const existing = this.byConversation.get(conversationId);
    if (existing) return existing;
    const fresh = emptyBrowserState();
    this.byConversation.set(conversationId, fresh);
    return fresh;
  }

  public update(
    conversationId: string,
    patch: Partial<BrowserConversationState>,
  ): BrowserConversationState {
    const next = { ...this.get(conversationId), ...patch };
    this.byConversation.set(conversationId, next);
    return next;
  }

  public clear(conversationId: string): void {
    this.byConversation.delete(conversationId);
  }
}

export const browserStateStore = new BrowserConversationStateStore();

// ─────────────────────────────────────────────────────────────────────────────
// 4. Consent preference model
// ─────────────────────────────────────────────────────────────────────────────

export type ConsentChoice = 'accept_all' | 'reject_optional';
export type ConsentPreference = ConsentChoice | 'ask' | 'automatic';

/**
 * Consent wording is localized and inconsistent; map visible button text to a
 * canonical choice. Matching is accent/case/whitespace-insensitive.
 */
const ACCEPT_ALL_PHRASES = [
  'alle akzeptieren',
  'akzeptieren',
  'alle cookies akzeptieren',
  'accept all',
  'accept all cookies',
  'accept all and continue',
  'allow all',
  'i agree',
  'agree',
  'zustimmen',
  'einverstanden',
  'tout accepter',
  'aceptar todo',
  // Romanian (Google serves hl=ro in this region). The button is a sentence
  // beginning with the verb: "Accept folosirea cookie-urilor ...".
  'accept folosirea',
  'accepta toate',
  'acceptati toate',
  'accept tot',
  'sunt de acord',
];

const REJECT_OPTIONAL_PHRASES = [
  'alle ablehnen',
  'ablehnen',
  'alle cookies ablehnen',
  'nur notwendige',
  'nur erforderliche',
  'reject all',
  'reject all cookies',
  'reject non-essential',
  'reject optional',
  'decline',
  'refuse',
  'tout refuser',
  'rechazar todo',
  // Romanian counterpart: "Resping folosirea cookie-urilor ...".
  'resping folosirea',
  'respinge toate',
  'resping toate',
  'refuz',
];

const MORE_OPTIONS_PHRASES = [
  'weitere optionen',
  'einstellungen',
  'optionen',
  'more options',
  'manage options',
  'customize',
  'customise',
  'settings',
  'plus d options',
  'mas opciones',
  'mai multe optiuni',
];

/** Extract a message from an unknown thrown value without using `any`. */
export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function normaliseLabel(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:'"()[\]]+/, '')
    .replace(/[\s.,!?;:'"()[\]]+$/, '')
    .trim()
    .toLowerCase();
}

/** Map a visible control label to a canonical consent choice, or null. */
export function consentChoiceForLabel(label: string): ConsentChoice | 'more_options' | null {
  const n = normaliseLabel(label);
  if (!n) return null;
  // Longest-first so "alle ablehnen" is not shadowed by "ablehnen".
  const byLongest = (phrases: string[]) =>
    phrases.some((p) => n === p || n.startsWith(p) || n.includes(p));

  if (ACCEPT_ALL_PHRASES.some((p) => n === p)) return 'accept_all';
  if (REJECT_OPTIONAL_PHRASES.some((p) => n === p)) return 'reject_optional';
  if (MORE_OPTIONS_PHRASES.some((p) => n === p)) return 'more_options';

  // Fall back to containment, longest phrases first so "alle X" beats bare "X".
  const accept = [...ACCEPT_ALL_PHRASES].sort((a, b) => b.length - a.length);
  const reject = [...REJECT_OPTIONAL_PHRASES].sort((a, b) => b.length - a.length);
  for (const p of reject) if (n.includes(p)) return 'reject_optional';
  for (const p of accept) if (n.includes(p)) return 'accept_all';
  for (const p of MORE_OPTIONS_PHRASES) if (n.includes(p)) return 'more_options';
  void byLongest;
  return null;
}

/** Reduce a URL/host to a preference key: the registrable domain. */
export function registrableDomainOf(urlOrHost: string): string {
  let host: string;
  try {
    host = new URL(urlOrHost.includes('://') ? urlOrHost : `https://${urlOrHost}`).hostname;
  } catch {
    host = (urlOrHost || '').split('/')[0];
  }
  host = host.toLowerCase().replace(/^www\./, '');
  return host;
}

/**
 * Domains the user has an explicit consent preference for.
 * The registry requirement: `cookieConsentPreference = accept_all | reject_optional | ask`.
 */
export interface DomainConsentRule {
  /** e.g. "youtube.com" */
  domain: string;
  /** Domains that also cover this one (e.g. google.com covers youtube.com). */
  aliases?: string[];
  preference: ConsentPreference;
  /** Who set it and when — auditable, never inferred from unrelated chats. */
  source: 'operator' | 'default';
  updatedAt: number;
}

export class ConsentPreferenceRegistry {
  private rules = new Map<string, DomainConsentRule>();

  public set(
    domain: string,
    preference: ConsentPreference,
    opts: { aliases?: string[]; source?: DomainConsentRule['source'] } = {},
  ): DomainConsentRule {
    const key = registrableDomainOf(domain);
    const rule: DomainConsentRule = {
      domain: key,
      aliases: (opts.aliases ?? []).map(registrableDomainOf),
      preference,
      source: opts.source ?? 'operator',
      updatedAt: Date.now(),
    };
    this.rules.set(key, rule);
    return rule;
  }

  public get(domain: string): DomainConsentRule | null {
    const key = registrableDomainOf(domain);
    const direct = this.rules.get(key);
    if (direct) return direct;
    for (const rule of this.rules.values()) {
      if (rule.aliases?.includes(key)) return rule;
    }
    return null;
  }

  public clear(): void {
    this.rules.clear();
  }

  public all(): DomainConsentRule[] {
    return [...this.rules.values()];
  }
}

export const consentPreferences = new ConsentPreferenceRegistry();

export interface ConsentAuthorizationInput {
  url: string;
  /** Explicit instruction from the user in THIS turn, if any. */
  explicitUserChoice?: ConsentChoice | null;
  registry?: ConsentPreferenceRegistry;
}

export interface ConsentAuthorizationResult {
  authorized: boolean;
  choice: ConsentChoice | null;
  source: 'user_explicit' | 'stored_preference' | 'none';
  /** Human-readable reason, used for the spoken response. */
  reason: string;
}

/**
 * Decide whether Jarvis may pick a consent option.
 *
 * RULE (non-negotiable): Jarvis must NOT silently choose Accept-all vs
 * Reject-all. It may only act when
 *   (a) the user explicitly said which one in this turn, or
 *   (b) a stored per-domain preference authorizes that choice.
 * Otherwise it must ASK. The preference is never inferred from other
 * conversations.
 */
export function authorizeConsentChoice(
  input: ConsentAuthorizationInput,
): ConsentAuthorizationResult {
  if (input.explicitUserChoice) {
    return {
      authorized: true,
      choice: input.explicitUserChoice,
      source: 'user_explicit',
      reason: `You told me to choose "${input.explicitUserChoice}" for this screen.`,
    };
  }

  const registry = input.registry ?? consentPreferences;
  const rule = registry.get(input.url);
  if (rule && rule.preference !== 'ask') {
    const choice: ConsentChoice = rule.preference === 'automatic' ? 'reject_optional' : rule.preference;
    return {
      authorized: true,
      choice,
      source: 'stored_preference',
      reason: `Your saved cookie preference for ${rule.domain} is "${rule.preference}".`,
    };
  }

  return {
    authorized: false,
    choice: null,
    source: 'none',
    reason:
      'This is a cookie/privacy choice, which is yours to make. Tell me which one to pick ' +
      '(accept all or reject optional) and I will continue.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Control matching (accessibility first, coordinates last)
// ─────────────────────────────────────────────────────────────────────────────

export interface ControlMatch {
  control: VisibleControl | null;
  strategy: 'exact_name' | 'normalised_name' | 'contains_name' | 'consent_synonym' | 'none';
  candidates: VisibleControl[];
}

/**
 * Find a visible control by the name the user said.
 * DOM/accessibility identity is preferred; callers must only fall back to
 * coordinates when `strategy === 'none'`.
 */
export function matchControlByAccessibleName(
  controls: VisibleControl[],
  requestedName: string,
): ControlMatch {
  const interactive = controls.filter((c) => c.visible && !c.disabled);
  const want = normaliseLabel(requestedName);
  if (!want) return { control: null, strategy: 'none', candidates: [] };

  const exact = interactive.find((c) => c.name === requestedName);
  if (exact) return { control: exact, strategy: 'exact_name', candidates: [exact] };

  const normalised = interactive.filter((c) => normaliseLabel(c.name) === want);
  if (normalised.length) {
    return { control: normalised[0], strategy: 'normalised_name', candidates: normalised };
  }

  const contained = interactive.filter((c) => {
    const n = normaliseLabel(c.name);
    // An EMPTY accessible name must never match: `want.includes('')` is always
    // true, which made any unnamed control (icon buttons, wrappers) match every
    // query — e.g. a consent click landed on "Sign in". Short names are only
    // allowed to match by containment when they are at least 3 chars.
    if (!n) return false;
    if (n.includes(want)) return true;
    return n.length >= 3 && want.includes(n);
  });
  if (contained.length) {
    return { control: contained[0], strategy: 'contains_name', candidates: contained };
  }

  // The user may name the group ("accept all") while the visible label is localised.
  const wantedChoice = consentChoiceForLabel(requestedName);
  if (wantedChoice) {
    const synonym = interactive.filter((c) => consentChoiceForLabel(c.name) === wantedChoice);
    if (synonym.length) {
      return { control: synonym[0], strategy: 'consent_synonym', candidates: synonym };
    }
  }

  return { control: null, strategy: 'none', candidates: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Blocker classification
// ─────────────────────────────────────────────────────────────────────────────

const CONSENT_TEXT_HINTS = [
  'cookie',
  'cookies',
  'consent',
  'einwilligung',
  'datenschutz',
  'privacy',
  'before you continue',
  'bevor du fortfährst',
  'bevor sie fortfahren',
];

const LOGIN_TEXT_HINTS = [
  'sign in',
  'log in',
  'login',
  'anmelden',
  'einloggen',
  'password',
  'passwort',
  'username',
  'benutzername',
  'create account',
];

const CAPTCHA_TEXT_HINTS = [
  'captcha',
  'recaptcha',
  'verify you are human',
  'unusual traffic',
  'not a robot',
];

export interface DialogClassificationInput {
  text: string;
  controls: VisibleControl[];
  /** True when the container looks like a modal/dialog (role=dialog, aria-modal). */
  containerIsDialog?: boolean;
}

export function classifyBlockingDialog(
  input: DialogClassificationInput,
): BlockingDialog | null {
  const text = (input.text || '').slice(0, 2000);
  const haystack = `${text} ${input.controls.map((c) => c.name).join(' ')}`.toLowerCase();

  const labelled = input.controls
    .map((c) => consentChoiceForLabel(c.name))
    .filter(Boolean) as Array<ConsentChoice | 'more_options'>;

  const hasAccept = labelled.includes('accept_all');
  const hasReject = labelled.includes('reject_optional');

  const consentByText = CONSENT_TEXT_HINTS.some((h) => haystack.includes(h));
  const consentByShape = hasAccept && (hasReject || labelled.includes('more_options'));

  if (consentByText || consentByShape) {
    return {
      kind: 'cookie_consent',
      text,
      controls: input.controls,
      isConsentDialog: true,
    };
  }

  if (CAPTCHA_TEXT_HINTS.some((h) => haystack.includes(h))) {
    return { kind: 'captcha', text, controls: input.controls, isConsentDialog: false };
  }

  if (LOGIN_TEXT_HINTS.some((h) => haystack.includes(h)) && input.controls.length > 0) {
    return { kind: 'login', text, controls: input.controls, isConsentDialog: false };
  }

  if (input.containerIsDialog && input.controls.length > 0) {
    return { kind: 'modal', text, controls: input.controls, isConsentDialog: false };
  }

  return null;
}

export function detectLoginScreen(
  controls: VisibleControl[],
  pageText: string,
): boolean {
  const hasPassword = controls.some(
    (c) => c.visible && (c.kind === 'textbox' || c.role === 'textbox') &&
      /password|passwort/i.test(c.name),
  );
  const hasUserField = controls.some(
    (c) => c.visible && /e-?mail|username|benutzername|phone|telefon/i.test(c.name),
  );
  const textHint = LOGIN_TEXT_HINTS.some((h) => (pageText || '').toLowerCase().includes(h));
  return (hasPassword && (hasUserField || textHint)) || (hasPassword && controls.length > 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Conversational correction resolution
// ─────────────────────────────────────────────────────────────────────────────

export type CorrectionKind =
  | 'accept_consent'
  | 'reject_consent'
  | 'wrong_target'
  | 'continue_goal'
  | 'go_back'
  | 'go_forward'
  | 'open_first_result'
  | 'open_ordinal_result'
  | 'redirect_destination'
  | 'correct_search_query'
  | 'open_channel'
  | 'open_it'
  | 'scroll'
  | 'stay_page'
  | 'not_a_correction';

export interface CorrectionResolution {
  kind: CorrectionKind;
  /** The user's words, echoed back for the confirmation. */
  utterance: string;
  /** Previous goal to continue, if the correction implies continuation. */
  continueGoal: string | null;
  reason: string;
  ordinalIndex?: number;
  newDestination?: string;
  newQuery?: string;
}

export function parseOrdinalIndex(text: string): number {
  const t = text.toLowerCase();
  if (/\b(first|1st|erste[ns]?)\b/i.test(t)) return 1;
  if (/\b(second|2nd|zweite[ns]?)\b/i.test(t)) return 2;
  if (/\b(third|3rd|dritte[ns]?)\b/i.test(t)) return 3;
  if (/\b(fourth|4th|vierte[ns]?)\b/i.test(t)) return 4;
  if (/\b(fifth|5th|fünfte[ns]?|fuenfte[ns]?)\b/i.test(t)) return 5;
  const m = /\b(\d+)(?:st|nd|rd|th|\.)?\b/i.exec(t);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 1;
}

const ACCEPT_UTTERANCE = /\b(accept all|accept it|accept\b|akzeptieren|annehmen|bestätigen|zustimmen|agree)\b/i;
const REJECT_UTTERANCE = /\b(reject all|reject it|reject\b|ablehnen|decline|refuse)\b/i;
const CORRECTION_UTTERANCE =
  /\b(no[,.]?|wrong|not what i wanted|that'?s not|das ist (falsch|nicht)|nein|falsch)\b/i;
const CONTINUE_UTTERANCE =
  /\b(continue|carry on|go on|keep going|weiter|fortfahren|proceed)\b/i;
/** "go back" must be explicit — a bare "back" would hijack "search for back pain". */
const GO_BACK_UTTERANCE = /\b(go back|back to the (previous|last)|previous page|zurück|zurueck)\b/i;
const GO_FORWARD_UTTERANCE = /\b(go forward|forward to the next|next page|vorwärts|vorwaerts)\b/i;
const ORDINAL_RESULT_UTTERANCE =
  /\b(?:open|click|take|nimm|öffne|select)\b[^.]*\b(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|\d+(?:st|nd|rd|th|\.)?|erste[ns]?|zweite[ns]?|dritte[ns]?)\b|\b(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|\d+(?:st|nd|rd|th|\.)?|erste[ns]?|zweite[ns]?|dritte[ns]?)\b[^.]*\b(?:result|one|video|treffer|ergebnis|channel|kanal|link)\b|\b(?:actually|no,?\s+)?(?:the\s+)?(?:first|second|third|1st|2nd|3rd)\s+(?:one|result|video)\b/i;
const FIRST_RESULT_UTTERANCE = ORDINAL_RESULT_UTTERANCE;
const SCROLL_UTTERANCE = /\b(scroll|scrolle|scrollen)\b/i;
/** "open the channel" — targets a channel, not a single video. */
const OPEN_CHANNEL_UTTERANCE =
  /\b(?:open|show|select|go to)\b[^.]*\b(?:channel|kanal|kanalı)\b|\b(?:channel|kanal)\b[^.]*\b(?:open|öffnen)\b/i;
/** "open it" / "click it" — act on the visible or pending target. */
const OPEN_IT_UTTERANCE =
  /\b(?:open|click|select|take)\s+(?:it|that|this|them)\b|\bclick it\b|\bopen it\b/i;
/** Conversational destination correction: "No, Google", "No, YouTube", "Google instead" */
const REDIRECTION_UTTERANCE =
  /^(?:(?:no|nein|actually|nicht)[,.]?\s+(?:open\s+|go\s+to\s+|visit\s+)?(google|youtube|linkedin|twitter|github)|(?:open\s+|go\s+to\s+|visit\s+)?(google|youtube|linkedin|twitter|github)\s+(?:instead|lieber|stattdessen))[.!]?$/i;
/** Conversational search query correction: "No, I meant AI coding agents", "Search for AI coding agents instead" */
const QUERY_CORRECTION_UTTERANCE =
  /^(?:(?:no|nein|actually)[,.]?\s+(?:i\s+meant|search\s+for|look\s+up)\s+(.+?)|(?:search\s+for|look\s+up)\s+(.+?)\s+(?:instead|lieber|stattdessen))[.!]?$/i;

export const STAY_PAGE_UTTERANCE =
  /\b(?:stay\s+(?:on\s+this\s+page|here|there|on\s+page)|don'?t\s+(?:move|do\s+anything(?:\s+else)?|navigate|change(?:\s+anything)?)|leave\s+(?:this|it)\s+(?:open|here|there)|keep\s+(?:.+?\s+)?open|leave\s+it\s+there|that'?s\s+good(?:\s+don'?t\s+do\s+anything(?:\s+else)?)?|good,?\s+leave\s+it\s+there)\b/i;

/**
 * Interpret a short follow-up against the CURRENT browser state and the
 * PREVIOUS browser goal — never as a brand-new unrelated command.
 */
export function resolveConversationalCorrection(
  utterance: string,
  state: BrowserConversationState,
): CorrectionResolution {
  const text = (utterance || '').trim();
  const hasConsentDialog = state.blockingDialog?.isConsentDialog === true;

  // General questions or conversational requests are never browser corrections
  if (/^(?:what|which|who|where|when|why|how|tell\s+me|switch|speak|good\s+morning|hello|hey|hi)\b/i.test(text)) {
    return {
      kind: 'not_a_correction',
      utterance: text,
      continueGoal: null,
      reason: 'Utterance is a general question or conversational request, not a browser follow-up.',
    };
  }

  if (STAY_PAGE_UTTERANCE.test(text)) {
    return {
      kind: 'stay_page',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'User instructed to stay on current page and not mutate browser state.',
    };
  }

  if (ACCEPT_UTTERANCE.test(text) && !REJECT_UTTERANCE.test(text)) {
    return {
      kind: 'accept_consent',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: hasConsentDialog
        ? 'You are answering the consent dialog that is currently on screen.'
        : 'You asked me to accept; I will look for the consent control on the current page.',
    };
  }

  if (REJECT_UTTERANCE.test(text) && !ACCEPT_UTTERANCE.test(text)) {
    return {
      kind: 'reject_consent',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You are answering the consent dialog that is currently on screen.',
    };
  }

  // Explicit navigation actions outrank generic correction phrases
  if (GO_BACK_UTTERANCE.test(text)) {
    return {
      kind: 'go_back',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You want to return to the previous page and continue from there.',
    };
  }

  if (GO_FORWARD_UTTERANCE.test(text)) {
    return {
      kind: 'go_forward',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You want to move forward in page history.',
    };
  }

  // Ordinal result selection outranks generic correction ("Actually the first one")
  if (ORDINAL_RESULT_UTTERANCE.test(text)) {
    const ordinal = parseOrdinalIndex(text);
    return {
      kind: 'open_first_result',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: `You want result #${ordinal} on the current results page opened.`,
      ordinalIndex: ordinal,
    };
  }

  // Destination correction outranks generic complaint ("No, Google")
  const redirMatch = text.match(REDIRECTION_UTTERANCE);
  const redirDest = redirMatch ? (redirMatch[1] || redirMatch[2]) : null;
  if (redirDest) {
    return {
      kind: 'redirect_destination',
      utterance: text,
      continueGoal: `open ${redirDest}`,
      newDestination: redirDest,
      reason: `Redirecting destination to ${redirDest}.`,
    };
  }

  // Query correction outranks generic complaint ("No, I meant AI coding agents")
  const queryMatch = text.match(QUERY_CORRECTION_UTTERANCE);
  const cleanQuery = queryMatch ? (queryMatch[1] || queryMatch[2] || '').replace(/[.!?]+$/, '').trim() : null;
  if (cleanQuery) {
    return {
      kind: 'correct_search_query',
      utterance: text,
      continueGoal: `search for ${cleanQuery}`,
      newQuery: cleanQuery,
      reason: `Updating search query to "${cleanQuery}".`,
    };
  }

  if (OPEN_CHANNEL_UTTERANCE.test(text)) {
    return {
      kind: 'open_channel',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You want the channel for the current search results opened.',
    };
  }

  if (OPEN_IT_UTTERANCE.test(text)) {
    return {
      kind: 'open_it',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You want the element I just identified opened.',
    };
  }

  if (SCROLL_UTTERANCE.test(text)) {
    return {
      kind: 'scroll',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You want the current page scrolled.',
    };
  }

  if (CONTINUE_UTTERANCE.test(text)) {
    return {
      kind: 'continue_goal',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You want me to resume the goal I was already working on.',
    };
  }

  if (CORRECTION_UTTERANCE.test(text)) {
    return {
      kind: 'wrong_target',
      utterance: text,
      continueGoal: state.lastBrowserGoal,
      reason: 'You are correcting the current browser state, not starting a new command.',
    };
  }

  return {
    kind: 'not_a_correction',
    utterance: text,
    continueGoal: null,
    reason: 'Not a browser-state correction.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Goal continuation
// ─────────────────────────────────────────────────────────────────────────────

export interface BrowserGoal {
  goalId: string;
  /** The user's original objective, verbatim where possible. */
  goalText: string;
  targetId: string | null;
  targetUrl: string | null;
  /** Steps still outstanding, in order. */
  remaining: BrowserGoalStep[];
  createdAt: number;
}

export interface BrowserGoalStep {
  kind: BrowserActionKind;
  description: string;
  targetName?: string;
  query?: string;
}

export interface GoalContinuationDecision {
  /** What to do next with the current page. */
  next: 'handle_blocker' | 'resume_step' | 'complete' | 'ask_user';
  step: BrowserGoalStep | null;
  reason: string;
}

/**
 * Decide what happens AFTER a blocker was cleared.
 * The registry entry is explicit: clearing the modal is not the goal.
 */
export function decideGoalContinuation(
  goal: BrowserGoal,
  snapshot: Pick<PageStateSnapshot, 'blockers' | 'contentUsable'>,
): GoalContinuationDecision {
  const consent = snapshot.blockers.find((b) => b.isConsentDialog);
  if (consent) {
    return {
      next: 'handle_blocker',
      step: null,
      reason: `A ${consent.kind} dialog is still blocking the page.`,
    };
  }

  const hardBlocker = snapshot.blockers.find((b) => b.kind === 'captcha');
  if (hardBlocker) {
    return {
      next: 'ask_user',
      step: null,
      reason: 'A captcha requires a human. I cannot solve it for you.',
    };
  }

  if (!snapshot.contentUsable) {
    return {
      next: 'ask_user',
      step: null,
      reason: 'The target page is not usable yet and no known control can unblock it.',
    };
  }

  const nextStep = goal.remaining[0];
  if (!nextStep) {
    return { next: 'complete', step: null, reason: 'All steps for the goal are done.' };
  }
  return {
    next: 'resume_step',
    step: nextStep,
    reason: `Blocker cleared; resuming the original goal step: ${nextStep.description}`,
  };
}

/**
 * Build a goal object from the user's request so it can survive a blocker.
 */
export function createBrowserGoal(input: {
  goalText: string;
  targetId?: string | null;
  targetUrl?: string | null;
  steps?: BrowserGoalStep[];
  now?: number;
}): BrowserGoal {
  const now = input.now ?? Date.now();
  return {
    goalId: `bg-${now}-${Math.random().toString(36).slice(2, 8)}`,
    goalText: input.goalText,
    targetId: input.targetId ?? null,
    targetUrl: input.targetUrl ?? null,
    remaining: input.steps ?? [],
    createdAt: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Verification
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificationEvidence {
  /** Buttons/links the user could see that matched the request. */
  found: boolean;
  foundStrategy: ControlMatch['strategy'];
  foundName: string | null;
  /** The click/press was actually dispatched. */
  dispatched: boolean;
  /** The observed state changed in the expected direction. */
  stateChanged: boolean;
  /** The specific thing that changed, for the spoken report. */
  changeDetail: string | null;
  /** After the action, is the target actually usable? */
  targetUsable: boolean;
  verified: boolean;
}

/**
 * Required evidence chain for a click:
 *   BUTTON FOUND → CLICK SENT → ELEMENT/DIALOG STATE CHANGED → TARGET PAGE USABLE
 * "I clicked it" without `verified` is forbidden.
 */
export function buildVerificationEvidence(input: {
  match: ControlMatch;
  dispatched: boolean;
  stateBefore: Pick<PageStateSnapshot, 'blockers' | 'contentUsable'> & { url?: string };
  stateAfter: Pick<PageStateSnapshot, 'blockers' | 'contentUsable'> & { url?: string };
  expected?: 'dialog_disappears' | 'target_loads' | 'any';
}): VerificationEvidence {
  const expected = input.expected ?? 'any';
  const beforeBlocked = input.stateBefore.blockers.length > 0;
  const afterBlocked = input.stateAfter.blockers.length > 0;

  let stateChanged = false;
  let changeDetail: string | null = null;

  if (beforeBlocked && !afterBlocked) {
    stateChanged = true;
    changeDetail = 'the blocking dialog is gone';
  } else if (!beforeBlocked && afterBlocked) {
    stateChanged = true;
    changeDetail = 'a new dialog appeared';
  } else if (!input.stateBefore.contentUsable && input.stateAfter.contentUsable) {
    stateChanged = true;
    changeDetail = 'the page content became usable';
  }

  // A click that NAVIGATED is unambiguously a state change. Without this, a
  // result/channel click that left the page (no dialog change, content already
  // usable) read as "nothing changed" and produced a report contradicting its
  // own evidence.
  if (!stateChanged && input.stateBefore.url && input.stateAfter.url &&
      input.stateBefore.url !== input.stateAfter.url) {
    stateChanged = true;
    changeDetail = `navigated to ${input.stateAfter.url}`;
  }

  const targetUsable = input.stateAfter.contentUsable;

  let verified = Boolean(input.match.control && input.dispatched);
  if (expected === 'dialog_disappears') verified = verified && beforeBlocked && !afterBlocked;
  if (expected === 'target_loads') verified = verified && targetUsable;
  if (expected === 'any') verified = verified && stateChanged;

  return {
    found: Boolean(input.match.control),
    foundStrategy: input.match.strategy,
    foundName: input.match.control?.name ?? null,
    dispatched: input.dispatched,
    stateChanged,
    changeDetail,
    targetUsable,
    verified,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Spoken-report guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The exact regression from the defect registry: after a user asked for a CLICK,
 * Jarvis must never answer "I've opened X." when a blocker is still present.
 */
export function assertNoNavigationAsCompletion(input: {
  requestedAction: BrowserActionKind;
  blockerPresent: boolean;
  message: string;
}): { ok: boolean; reason: string | null } {
  const navOnly = /\bI'?ve opened\b/i.test(input.message);
  if (input.requestedAction !== 'navigate' && navOnly) {
    return {
      ok: false,
      reason:
        'Reporting navigation success for a non-navigation request. The user asked for ' +
        `"${input.requestedAction}", not for the page to be opened.`,
    };
  }
  if (input.blockerPresent && navOnly) {
    return {
      ok: false,
      reason: 'A blocking dialog is still on screen, so the page is not usable yet.',
    };
  }
  return { ok: true, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Automatic stability regression
// ─────────────────────────────────────────────────────────────────────────────

export interface StabilityRegression {
  id: string;
  kind: 'navigation_substituted_for_click';
  detectedAt: number;
  detail: string;
  evidence: BrowserMetricEvent[];
}

/**
 * Required by the defect registry: "Repeated navigation when a click was
 * requested should open a stability regression automatically."
 *
 * Scans the metric ledger for a click request that was followed by a verified
 * NAVIGATION and no verified CLICK in between — i.e. the system opened a page
 * instead of doing what was asked.
 */
export function detectRepeatedNavigationInsteadOfClick(
  ledger: BrowserMetricsLedger,
  opts: { windowMs?: number; threshold?: number; now?: number } = {},
): StabilityRegression | null {
  const windowMs = opts.windowMs ?? 10 * 60 * 1000;
  const threshold = opts.threshold ?? 1;
  const now = opts.now ?? Date.now();

  const events = ledger.recent(500).filter((e) => now - e.at <= windowMs);
  const offenders: BrowserMetricEvent[] = [];

  events.forEach((event, index) => {
    if (event.name !== 'browser_action_requested') return;
    if (event.detail?.kind !== 'click') return;

    const isClickVerified = (e: BrowserMetricEvent) =>
      e.name === 'browser_action_verified' && e.detail?.kind === 'click';
    const isNavigationVerified = (e: BrowserMetricEvent) =>
      e.name === 'browser_action_verified' && e.detail?.kind === 'navigate';

    // Look ahead for the next terminal outcome for this request.
    for (let i = index + 1; i < events.length; i++) {
      const next = events[i];
      if (isClickVerified(next)) break;
      if (next.name === 'browser_action_requested') break;
      if (isNavigationVerified(next)) {
        offenders.push(event, next);
        break;
      }
    }
  });

  if (offenders.length < threshold) return null;

  return {
    id: `SR-NAV-FOR-CLICK-${now}`,
    kind: 'navigation_substituted_for_click',
    detectedAt: now,
    detail:
      `A click was requested but a navigation was verified instead, ` +
      `${offenders.length} time(s) within ${Math.round(windowMs / 1000)}s. ` +
      'This is defect D22: navigation is not task completion.',
    evidence: offenders,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Indexed accessibility snapshot (adapted from Browser Use)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One element in the indexed list the decision layer acts on.
 *
 * ADAPTED FROM Browser Use: its central mechanism is that the model chooses
 * from a NUMBERED list of interactive elements ("click 12") instead of inventing
 * CSS/XPath selectors. Indexed action vocabulary is what makes LLM-driven
 * browser control reliable. This is that mechanism, reusing the element identity
 * this codebase already extracts from the real DOM/accessibility tree.
 */
export interface IndexedElement {
  index: number;
  role: string;
  name: string;
  kind: VisibleControl['kind'];
  /** DOM identity used to deliver the action without coordinates. */
  marker?: string;
  frameIndex?: number;
  /** For links: resolved href. Lets "open the first result" skip nav chrome. */
  href?: string;
}

export interface InteractiveSnapshot {
  url: string;
  title: string;
  host: string;
  contentUsable: boolean;
  blocker: {
    kind: BlockingDialogKind;
    isConsentDialog: boolean;
    /** Indices of the choices offered by the blocking dialog. */
    optionIndices: number[];
  } | null;
  loginScreen: boolean;
  elements: IndexedElement[];
  /** Compact, LLM-readable rendering of the page state. */
  text: string;
}

/**
 * Build the indexed, accessibility-first view of a page.
 *
 * Blocking-dialog controls are listed FIRST and marked, because in the D22
 * scenario the dialog is the only thing the user can actually interact with.
 */
export function serializeInteractiveSnapshot(
  snapshot: Pick<
    PageStateSnapshot,
    'url' | 'title' | 'host' | 'controls' | 'blockers' | 'contentUsable' | 'loginScreen'
  >,
  opts: { maxElements?: number } = {},
): InteractiveSnapshot {
  const maxElements = opts.maxElements ?? 120;
  const blocker = snapshot.blockers[0] ?? null;

  // Dialog controls take precedence in the index order.
  const ordered: VisibleControl[] = [];
  // Dedupe by DOM identity when present, otherwise by what the user perceives.
  // (Container controls and the flat control list are different objects.)
  const identityOf = (c: VisibleControl): string =>
    c.marker ? `m:${c.marker}` : `n:${c.frameIndex ?? 0}|${c.role}|${c.kind}|${c.name}`;
  const seen = new Set<string>();
  const pushUnique = (control: VisibleControl) => {
    const key = identityOf(control);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(control);
  };
  for (const control of blocker?.controls ?? []) pushUnique(control);
  for (const control of snapshot.controls) {
    if (!control.visible || !control.name) continue;
    pushUnique(control);
    if (ordered.length >= maxElements) break;
  }

  const elements: IndexedElement[] = ordered.slice(0, maxElements).map((control, i) => ({
    index: i + 1,
    role: control.role,
    name: control.name,
    kind: control.kind,
    marker: control.marker,
    frameIndex: control.frameIndex,
    href: control.href,
  }));

  const indexOfMarker = (marker?: string): number | null => {
    if (!marker) return null;
    const found = elements.find((e) => e.marker === marker);
    return found ? found.index : null;
  };

  const lines: string[] = [
    `URL: ${snapshot.url}`,
    `TITLE: ${snapshot.title || '(none)'}`,
    `CONTENT_USABLE: ${snapshot.contentUsable ? 'yes' : 'no'}`,
  ];

  if (blocker) {
    lines.push(
      `BLOCKING_DIALOG: ${blocker.kind}` +
        (blocker.isConsentDialog ? ' (cookie/privacy consent — the USER decides)' : ''),
    );
    const optionIndices = (blocker.controls ?? [])
      .map((c) => indexOfMarker(c.marker))
      .filter((i): i is number => i !== null);
    if (optionIndices.length) lines.push(`DIALOG_OPTIONS: ${optionIndices.join(', ')}`);
  }

  if (snapshot.loginScreen) lines.push('LOGIN_SCREEN: yes');

  lines.push('INTERACTIVE_ELEMENTS:');
  if (elements.length === 0) {
    lines.push('  (none visible)');
  } else {
    for (const el of elements) {
      const isDialogOption = blocker?.controls?.some((c) => c.marker && c.marker === el.marker);
      lines.push(
        `  [${el.index}] ${el.kind} "${el.name}"${isDialogOption ? '   <- dialog option' : ''}`,
      );
    }
  }

  return {
    url: snapshot.url,
    title: snapshot.title,
    host: snapshot.host,
    contentUsable: snapshot.contentUsable,
    blocker: blocker
      ? {
          kind: blocker.kind,
          isConsentDialog: blocker.isConsentDialog,
          optionIndices: (blocker.controls ?? [])
            .map((c) => indexOfMarker(c.marker))
            .filter((i): i is number => i !== null),
        }
      : null,
    loginScreen: snapshot.loginScreen,
    elements,
    text: lines.join('\n'),
  };
}

export type IndexedActionResolution =
  | { ok: true; element: IndexedElement }
  | { ok: false; reason: string };

/**
 * Resolve an index the user (or the model) referred to against the LAST
 * inspection — and refuse if the index map belongs to a different page.
 * A stale index must never resolve to a control on a new page.
 */
export function resolveIndexedElement(input: {
  index: number;
  state: Pick<BrowserConversationState, 'lastIndexedElements' | 'indexedUrl'>;
  currentUrl: string;
}): IndexedActionResolution {
  if (!input.state.lastIndexedElements?.length) {
    return {
      ok: false,
      reason:
        'I do not have a current list of page elements. Ask me to inspect the page first.',
    };
  }
  if (input.state.indexedUrl && input.state.indexedUrl !== input.currentUrl) {
    return {
      ok: false,
      reason:
        `That element list belonged to ${input.state.indexedUrl}, but the page is now ` +
        `${input.currentUrl}. I will not act on a stale list.`,
    };
  }
  const element = input.state.lastIndexedElements.find((e) => e.index === input.index);
  if (!element) {
    const available = input.state.lastIndexedElements.map((e) => e.index).join(', ');
    return { ok: false, reason: `There is no element ${input.index}. Available: ${available}.` };
  }
  return { ok: true, element };
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Search-result selection (TEST 3: "open the channel")
// ─────────────────────────────────────────────────────────────────────────────

/** Header/nav/legal links that are never a search result. */
const NAV_HREF =
  /(accounts\.google\.com|policies\.google\.com|consent\.youtube\.com|support\.google\.com|\/feed\/|\/results\?|\/playlist\?list=|youtube\.com\/?$|\/premium|\/signin|\/logout)/i;
/** Links that carry actual content. */
const CONTENT_HREF = /\/(watch\?|channel\/|c\/|user\/|@|shorts\/|live\/|videos)/i;
/** Links that point at a channel rather than a single video. */
const CHANNEL_HREF = /(\/channel\/|\/c\/|\/user\/|\/@)/i;

/** Common YouTube/search category and filter chip names that are never individual content results. */
const CATEGORY_CHIP_NAMES = [
  'all', 'alle', 'musik', 'music', 'gaming', 'news', 'nachrichten',
  'podcasts', 'live', 'recently uploaded', 'zuletzt hochgeladen',
  'watched', 'angesehen', 'neu fur dich', 'new to you', 'filter', 'filters',
  'trending', 'shorts', 'subscriptions', 'abonnements', 'library', 'mediathek',
  'history', 'verlauf', 'playlists', 'share', 'teilen', 'download', 'herunterladen'
];

/** Detect if an indexed element is a category chip, navigation control, or menu button. */
export function isCategoryChipOrNav(e: IndexedElement): boolean {
  const n = normaliseLabel(e.name);
  if (CATEGORY_CHIP_NAMES.includes(n)) return true;
  if (e.href) {
    // YouTube topic channels (auto-generated genre channels)
    if (/UC-9-kyTW8ZkZNDHQJ6FgpwQ|UCOpNcN46UbXVtpKMrmU4Abg|UCYfdidRxbB8Qhf0Nx7ioOYw/i.test(e.href)) return true;
    if (NAV_HREF.test(e.href)) return true;
  }
  return false;
}

/**
 * Extract genuine content search results (videos, channel result cards, or main result items),
 * filtering out navigation chrome, genre/topic chips ("Musik", "Gaming"), and menu buttons.
 */
export function extractContentResults(elements: IndexedElement[], currentUrl?: string): IndexedElement[] {
  const isYouTube = !currentUrl || /youtube\.com/i.test(currentUrl);
  const seenKeys = new Set<string>();
  const results: IndexedElement[] = [];

  for (const el of elements) {
    const isLink = el.kind === 'link' || (el as any).role === 'link' || Boolean(el.href);
    if (!isLink || !el.href || !el.name) continue;
    if (isCategoryChipOrNav(el)) continue;

    const normName = normaliseLabel(el.name);
    if (normName.length < 3) continue;
    if (/^(watch later|add to queue|share|save|subscribe|abonnieren|spater ansehen|zu playlist hinzufügen)$/i.test(normName)) continue;

    // Deduplicate thumbnail and title links pointing to same video ID
    let canonicalKey = el.href;
    const watchMatch = el.href.match(/[?&]v=([A-Za-z0-9_-]+)/);
    if (watchMatch) {
      canonicalKey = watchMatch[1];
    } else {
      const shortsMatch = el.href.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch) {
        canonicalKey = shortsMatch[1];
      }
    }

    if (isYouTube) {
      const isVideo = /[?&]v=|\/shorts\//i.test(el.href);
      const isChannel = /\/@|\/channel\/|\/c\//i.test(el.href);
      if (isVideo || isChannel) {
        if (!seenKeys.has(canonicalKey)) {
          seenKeys.add(canonicalKey);
          results.push(el);
        }
      }
    } else {
      if (!NAV_HREF.test(el.href) && !seenKeys.has(canonicalKey)) {
        seenKeys.add(canonicalKey);
        results.push(el);
      }
    }
  }

  // If YouTube video results exist, prefer true video items over auxiliary links
  if (isYouTube) {
    const videoResults = results.filter((r) => /[?&]v=|\/shorts\//i.test(r.href || ''));
    if (videoResults.length > 0) return videoResults;
  }

  return results;
}

export interface ResultSelection {
  candidates: IndexedElement[];
  selected: IndexedElement | null;
  reason: string;
  /** Query tokens actually matched, for the evidence report. */
  matchedTokens: string[];
}

/**
 * Choose the element that actually matches a search request.
 *
 * Satisfies TEST 3: never take the first generic link, never use a hardcoded URL,
 * and distinguish navigation/header/home chrome from real search results.
 * Relevance is scored from the query against the accessible name and the href, so
 * "open the channel" prefers a channel over a video.
 */
export function selectSearchResult(
  elements: IndexedElement[],
  query: string,
  opts: { prefer?: 'result' | 'channel' } = {},
): ResultSelection {
  const prefer = opts.prefer ?? 'result';
  const tokens = normaliseLabel(query)
    .split(' ')
    .filter((t) => t.length >= 3);
  const normalisedQuery = normaliseLabel(query);

  const scored: Array<{ el: IndexedElement; score: number; matched: string[] }> = [];

  for (const el of elements) {
    if (el.kind !== 'link' || !el.href) continue;
    if (NAV_HREF.test(el.href)) continue;
    // Same-origin content only: a cross-site link is not a result here.
    if (!/youtube\.com/i.test(el.href)) continue;

    const hay = normaliseLabel(`${el.name} ${el.href}`);
    const matched = tokens.filter((t) => hay.includes(t));
    let score = 0;
    if (normalisedQuery && hay.includes(normalisedQuery)) score += 5;
    score += matched.length * 2;
    if (CONTENT_HREF.test(el.href)) score += 2;
    if (prefer === 'channel' && CHANNEL_HREF.test(el.href)) score += 4;
    if (prefer === 'result' && /\/watch\?/.test(el.href)) score += 1;
    if (score === 0) continue;
    scored.push({ el, score, matched });
  }

  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.map((s) => s.el);

  if (!scored.length) {
    return {
      candidates: [],
      selected: null,
      reason: `No result link on this page matched "${query}".`,
      matchedTokens: [],
    };
  }

  const best = scored[0];
  return {
    candidates,
    selected: best.el,
    reason:
      `Selected "${best.el.name}" (score ${best.score}) — ` +
      `${best.matched.length}/${tokens.length} query token(s) matched` +
      `${prefer === 'channel' ? ', channel-preferring' : ''}.`,
    matchedTokens: best.matched,
  };
}

/** Does the resulting page actually correspond to the element we clicked? */
export function verifyTargetMatchesSelection(input: {
  selectedHref: string;
  actualUrl: string;
  expectedName: string;
}): { matches: boolean; reason: string; marker: string | null } {
  const idFrom = (href: string): string | null => {
    const m = href.match(
      /(?:\/watch\?v=|\/channel\/|\/c\/|\/user\/|\/@|\/shorts\/)([A-Za-z0-9_\-%.]+)/,
    );
    return m ? decodeURIComponent(m[1]) : null;
  };
  const marker = idFrom(input.selectedHref);
  const decodedActual = decodeURIComponent(input.actualUrl);

  if (marker && decodedActual.includes(marker)) {
    return {
      matches: true,
      reason: `identifier "${marker}" is present in the resulting URL`,
      marker,
    };
  }
  if (marker) {
    return {
      matches: false,
      reason:
        `expected identifier "${marker}" from ${input.selectedHref} but landed on ` +
        `${input.actualUrl}`,
      marker,
    };
  }
  const host = (() => {
    try {
      return new URL(input.selectedHref).hostname;
    } catch {
      return '';
    }
  })();
  const sameHost = Boolean(host) && decodedActual.includes(host);
  return {
    matches: sameHost,
    reason: sameHost ? 'same host, no comparable identifier' : 'host changed',
    marker: null,
  };
}
