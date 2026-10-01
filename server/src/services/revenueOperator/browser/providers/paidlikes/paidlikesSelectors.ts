/**
 * Centralized selectors and semantic locators for PaidLikes.
 * Uses role-based and accessible attribute patterns where available,
 * with resilient fallback selectors for real PaidLikes DOM elements.
 */

export const PAIDLIKES_SELECTORS = {
  // Navigation & Authentication
  auth: {
    loginUrl: 'https://www.paidlikes.de/login',
    homeUrl: 'https://www.paidlikes.de/',
    emailInput: 'input[name="email"], input[type="email"]',
    passwordInput: 'input[name="password"], #password',
    loginSubmitButton: 'button:has-text("Jetzt anmelden"), form button[type="submit"], button.button:has(span.icon-chevron-right)',
    errorMessage: '.alert-box.alert, .error, .error-message, div:has-text("E-Mail oder Passwort falsch")',
    logoutLink: 'a[href*="logout"], a[href*="abmelden"]',
    registerLink: 'a[href*="/registrieren"]',
  },

  // Session & User Status
  session: {
    userNav: '.top_header .login, .user-nav, .user-info',
    pointsDisplay: '#points, .points, .user-points, .user_points, [data-testid="user-points"]',
    usernameDisplay: '.user-name, .username, #username',
    payoutLink: 'a[href*="auszahlung"], a[href*="payout"]',
  },

  // Task Discovery & Listing
  tasks: {
    tasksPageUrl: 'https://www.paidlikes.de/memberarea',
    youtubeTasksLink: 'a[href*="youtube"], a[href*="like_youtube"]',
    taskContainer: '#task-list, .task-list, .aktionen-liste, .memberarea, .maincontent, .row.maincontent',
    taskCard: '.task-item, .task-card, .aktion-item, .like-item, tr[data-task-id], .campaign-item, .like_box',
    taskTitle: '.task-title, .title, h4, h5',
    taskReward: '.points-badge, .reward-points, .punkte, [data-points], .badge-points, .label-success',
    actionButton: 'button.like-btn, a.btn-like, .action-button, button:has-text("Liken"), a:has-text("Liken"), button:has-text("Abonnieren"), button:has-text("Öffnen"), a:has-text("Öffnen")',
    confirmButton: 'button:has-text("Bestätigen"), button:has-text("Gutschrift"), .btn-verify, button.confirm-like, a:has-text("Gutschrift erhalten")',
    emptyTasksMessage: ':text("Keine Kampagnen vorhanden"), :text("Derzeit keine Aktionen verfügbar"), :text("Keine Aufgaben")',
    hourlyLimitNotice: ':text("maximal 15 Likes"), :text("Stundenlimit erreicht"), :text("Tageslimit erreicht")',
  },

  // Anomalies, Security Challenges, and Human Gates
  anomalies: {
    recaptcha: 'iframe[src*="recaptcha"], .g-recaptcha',
    hcaptcha: 'iframe[src*="hcaptcha"], .h-captcha',
    cloudflareTurnstile: 'iframe[src*="turnstile"], .cf-turnstile',
    cloudflareChallenge: '#challenge-running, #cf-challenge, #challenge-stage, .ray_id',
    accountBlocked: ':text("Account gesperrt"), :text("Konto deaktiviert"), :text("gesperrt")',
    kycRequired: ':text("Identitätsprüfung"), :text("Verifizierung erforderlich")',
  },
} as const;
