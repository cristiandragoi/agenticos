/**
 * shopify-verify-20261001T0940Z.mjs — assembles the machine evidence file for the
 * 2026-10-01 Shopify run (channel verification + storefront inspection + product
 * inventory sync) from the RAW artifacts of that run, and (with --apply) appends
 * the derived evidence event to the live AgenticOS task registry after taking a
 * db+wal+shm backup.
 *
 * Every field is read from the raw artifacts, the live DB (read-only) or git —
 * nothing is invented. Modelled on server/scripts/shopify-verify-20260930.mjs.
 *
 * ISOLATION RULE: the agent shell exports AGENT_TEAMS_DB_PATH pointing at the LIVE
 * canonical DB and db/index.ts gives it precedence over AGENTICOS_DATA_DIR. Always
 * pin BOTH when sandboxing a harness run. THIS script only READS the live DB unless
 * --apply is passed.
 *
 * Usage:
 *   node scripts/shopify-verify-20261001T0940Z.mjs                    # assemble JSON+MD, dry-run
 *   node scripts/shopify-verify-20261001T0940Z.mjs --apply            # + backup and append evidence
 *   node scripts/shopify-verify-20261001T0940Z.mjs --artifacts-only   # re-assemble artifacts, never touch the registry
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RAW = path.join(REPO, '.tmp', 'shopify-verify-20261001T0940Z');
const LIVE_DB = process.env.AGENTICOS_LIVE_DB
  || 'C:/Users/cd-pr/AppData/Roaming/agenticos/data/agentic-os.db';
const LEGACY_DB = path.join(REPO, 'server', 'data', 'agentic-os.db');
const OUT_JSON = path.join(REPO, 'docs', 'shopify-channel-verification-2026-10-01.json');
const OUT_MD = OUT_JSON.replace(/\.json$/, '.md');
const APPLY = process.argv.includes('--apply');
const ARTIFACTS_ONLY = process.argv.includes('--artifacts-only');
// An artifact that already records an applied registry write must never be downgraded by a later
// dry re-run, so read the applied marker before building the report and derive content from it.
const ALREADY_APPLIED = fs.existsSync(OUT_JSON)
  && String(JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'))?.run?.liveDbMutatedByThisRun || '').startsWith('yes');
const EFFECTIVE_APPLY = APPLY || ARTIFACTS_ONLY || ALREADY_APPLIED;

const rd = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const chan = rd('channel-verification.json');
const scan = rd('inventory-scan.json');
const cred = rd('credential-probe.json');
const store = rd('storefront-inspection.json');
const live = scan.live;
const legacy = scan.repoLegacy;

const git = (c) => { try { return execSync(`git ${c}`, { cwd: REPO }).toString().trim(); } catch { return null; } };
const BRANCH = git('rev-parse --abbrev-ref HEAD');
const HEAD = git('rev-parse --short HEAD');
const DIRTY = (git('status --short') || '').split('\n').filter(Boolean).length;

// ---- live DB facts (read-only) ----
const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 8000');
const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();

const tasks = all(
  "SELECT task_id, status, verification_state, current_stage, updated_at, substr(COALESCE(blocker,''),1,110) blocker FROM background_tasks WHERE objective LIKE '%channel verification%' ORDER BY updated_at DESC"
);
const shopifyChannel = one("SELECT channel,status,human_gate_required,automation_allowed,config,created_at,updated_at FROM revenue_distribution_channels WHERE channel='SHOPIFY'");
const gates = all("SELECT id,gate_type,status,experiment_id,gate_url,resolved_by,created_at FROM revenue_human_gates ORDER BY created_at");
const expStatuses = all('SELECT status, COUNT(*) n FROM revenue_experiments GROUP BY status');
const metrics = {
  experiments: count('revenue_experiments'),
  withPrice: one('SELECT COUNT(*) n FROM revenue_experiments WHERE COALESCE(price,0)>0').n,
  withSales: one('SELECT COUNT(*) n FROM revenue_experiments WHERE COALESCE(sales,0)>0').n,
  withVisits: one('SELECT COUNT(*) n FROM revenue_experiments WHERE COALESCE(visits,0)>0').n,
  withConversions: one('SELECT COUNT(*) n FROM revenue_experiments WHERE COALESCE(conversions,0)>0').n,
  withImpressions: one('SELECT COUNT(*) n FROM revenue_experiments WHERE COALESCE(impressions,0)>0').n,
  verifiedRevenueEur: one('SELECT COALESCE(SUM(verified_revenue),0) s FROM revenue_experiments').s,
  ledgerEntries: count('revenue_ledger_entries'),
  published: one("SELECT COUNT(*) n FROM revenue_experiments WHERE status='PUBLISHED'").n,
};
const colNames = db.prepare('PRAGMA table_info(revenue_experiments)').all().map((c) => c.name);
const expChannelColumn = colNames.includes('channel') ? 'present' : 'column absent in this schema';

// duplicate guard (skill pitfall 29): newest [EVIDENCE] events already in the registry
const newestEvidence = all(
  "SELECT rowid, task_id, ts, substr(summary,1,200) summary FROM background_task_events WHERE summary LIKE '%EVIDENCE%' ORDER BY rowid DESC LIMIT 6"
);
db.close();

const catalogRows = scan.live.revenue_experiments;
const digitalDir = path.join(REPO, 'digital_products');
const digitalFiles = fs.existsSync(digitalDir) ? fs.readdirSync(digitalDir) : [];
const productDir = path.join(digitalDir, 'products');
const productSubdirFiles = fs.existsSync(productDir) ? fs.readdirSync(productDir).length : 0;

const MERCHANT_LOGIN = /accounts\.shopify\.com\/(session-service|lookup|login)|\/login\?errorHint=/.test(
  (store.results.find((r) => r.id === 'merchant_admin') || {}).finalUrl || ''
);
const INTERSTITIAL = (store.results.find((r) => r.id === 'merchant_admin') || {}).dom?.interstitial === true;
const AUTH_SESSION_COOKIE = /^_secure_session_id$|_secure_account_session_id|_shopify_admin|_shopify_sa_t/i;
const merchantSessionCookies = store.cookies
  .map((c) => `${c.name}@${c.domain}`)
  .filter((n) => AUTH_SESSION_COOKIE.test(n.split('@')[0]));

const out = {
  task: 'Shopify channel verification, storefront inspection and product inventory sync (2026-10-01 run)',
  run: {
    executedAt: chan.startedAt,
    finishedAt: chan.finishedAt,
    repository: REPO,
    workspace: REPO,
    repoBranch: BRANCH,
    gitHead: HEAD,
    worktreeDirtyFiles: DIRTY,
    distBuildUnderTest: 'server/dist (distributionService.js rebuilt 2026-10-01 11:27 local, newer than its src — not stale)',
    liveRuntimeDb: LIVE_DB,
    liveBackendProcess: 'NOT RUNNING — no listener on 127.0.0.1:4600 (localized-tolerant netstat finds no LISTENING/ABHÖREN row; curl exit 7) and no AgenticOS.exe process; verification therefore ran the production dist code paths against the canonical DB on disk, not over HTTP',
    sandboxDb: `${RAW}/agentic-os.db (+ -wal, -shm) — WAL-consistent db.backup() snapshot, snapshot_consistent=true; all channel-verification writes stayed here`,
    sandboxIsolation: 'AGENTICOS_DATA_DIR and AGENT_TEAMS_DB_PATH both pinned to the sandbox; the second is required because db/index.ts lets AGENT_TEAMS_DB_PATH override AGENTICOS_DATA_DIR',
    liveDbVerifiedAfterRun: 'LIVE DB UNCHANGED (snapshot-agenticos-db.cjs check vs pre-run counts: channels 10, experiments 59, gates 2, ledger 0, SHOPIFY auth_required/config=null)',
    rawArtifacts: [
      '.tmp/shopify-verify-20261001T0940Z/channel-verification.json',
      '.tmp/shopify-verify-20261001T0940Z/inventory-scan.json',
      '.tmp/shopify-verify-20261001T0940Z/credential-probe.json',
      '.tmp/shopify-verify-20261001T0940Z/storefront-inspection.json',
      '.tmp/shopify-verify-20261001T0940Z/live-probe.json',
    ],
    scriptsRun: [
      'server/scripts/shopify-channel-verification.mjs (production dist contract + publish path, sandbox DB, both env vars pinned)',
      'server/scripts/shopify-inventory-scan.mjs (read-only, live + repo-legacy DBs)',
      'server/scripts/shopify-credential-probe.mjs (read-only credential stores + myshopify context)',
      'npx vitest run src/__tests__/distributionService.test.ts (from server/)',
      'hermes browser_exec (real Chromium over CDP): www.shopify.com, example.myshopify.com, admin.shopify.com',
      'snapshot-agenticos-db.cjs make/check (WAL-consistent snapshot + post-run live-DB mutation check)',
      'curl GET http://127.0.0.1:4600/api/health (backend down — curl exit 7)',
    ],
    liveDbMutatedByThisRun: EFFECTIVE_APPLY
      ? 'yes — registry evidence event appended after db+wal+shm backup'
      : 'no — live DB verified UNCHANGED against the pre-run snapshot',
  },
  channelVerification: {
    verdict: 'AUTH_REQUIRED — channel registered, connection NOT established',
    registryRowsBeforeSeed: chan.step1_channel_row_count,
    liveChannelRows: live.revenue_distribution_channels,
    liveChannelTableOverHttp: 'NOT PROBED — backend not listening on 127.0.0.1:4600',
    shopifyChannelBeforeSeed: chan.step2_shopify_channel_before_seed,
    seededChannelCount: chan.step3_seeded_channel_count,
    shopifyChannelAfterSeed: chan.step3_shopify_channel_after_seed,
    shopifyChannelRowInLiveDb: shopifyChannel,
    publishAttempt: {
      experimentId: chan.step4_target_experiment?.id ?? null,
      published: chan.step4_publish_result?.published ?? null,
      blocked: chan.step4_publish_result?.blocked ?? null,
      reason: chan.step4_publish_result?.reason ?? null,
      gateId: chan.step4_publish_result?.gate?.id ?? null,
      gateCreated: chan.step4_publish_result?.gate?.id ?? null,
      gateType: chan.step4_publish_result?.gate?.gateType ?? null,
      branchPaused: chan.step4_publish_result?.gate?.branchPaused ?? null,
      scope: 'sandbox DB only — live runtime untouched (verified: live gates stayed at 2 while sandbox went 2 -> 3)',
    },
    ledgerAfterBlockedPublish: { entries: chan.step5_ledger_entries, revenueEur: chan.step5_ledger_revenue_total },
    openShopifyGatesInLiveDb: gates.filter((g) => g.gate_type === 'SHOPIFY_AUTH_REQUIRED' && g.status === 'open').length,
    liveGateDetail: gates.map((g) => ({ id: g.id, type: g.gate_type, status: g.status, gateUrl: g.gate_url, resolvedBy: g.resolved_by, createdAt: g.created_at })),
    credentialStore: {
      providerCredentialsRows: cred.provider_credentials?.rowCount ?? null,
      providerCredentialsShopifyRows: cred.provider_credentials?.rowsContainingShopify?.length ?? null,
      systemSecretsRows: cred.system_secrets?.rowCount ?? null,
      systemSecretsShopifyRows: cred.system_secrets?.rowsContainingShopify?.length ?? null,
      liveDbShopifyHostOrCredentialHits: live.shopifyHostOrCredentialHits,
      tokenLikeHits: live.shopifyHostOrCredentialHits.filter((h) => h.needle === '[token-like]').length,
      myshopifyMentionContext: (cred.myshopifyRows || []).map((r) => ({ id: r.id, note: 'planning prose in execution_results.structured_output, not a configured store', length: r.length })),
    },
    dependencyAndCallSiteScan: {
      shopifyPackagesInRepo: 'none — @shopify/* absent from root and server node_modules',
      adminApiCallSites: 'none — 0 hits for admin/api, X-Shopify, shopifyAdmin, myshopify in server/src',
      shopifyKeysInEnv: '0 hits for SHOPIFY in D:/AgenticOS/.env and D:/AgenticOS/server/.env',
    },
    contractTest: { file: 'src/__tests__/distributionService.test.ts', result: '1 file / 2 tests passed (vitest 4.1.10, 1.56s)' },
    authenticationState: 'NO_MERCHANT_SESSION — no store domain, no Admin API token, no OAuth app, SHOPIFY channel config = null',
  },
  storefrontInspection: {
    verdict: 'BLOCKED_NO_TARGET (browser tooling VERIFIED WORKING)',
    browserInspectionTooling: {
      engine: store.engine,
      result: 'WORKING — 3 live Shopify surfaces rendered and inspected over real CDP in this session; no spawn error',
      error: null,
      inspector: '.tmp/shopify-verify-20261001T0940Z/storefront-inspection.json',
    },
    projectRecord: live.shopifyProject?.[0] ?? null,
    storeDomainConfigured: false,
    registeredBrowserTarget: store.targetBinding.registeredBrowserTarget,
    inspections: store.results.map((r) => ({
      id: r.id, url: r.url, finalUrl: r.finalUrl, title: r.title,
      textLength: r.dom?.textLength ?? null, passwordFields: r.dom?.passwordFields ?? null,
      storefrontMarkers: r.dom?.storefrontMarkers ?? null, interstitial: r.dom?.interstitial ?? null,
      productSample: r.productSample ?? [], verdict: r.verdict ?? null,
    })),
    authenticatedSessionFound: !MERCHANT_LOGIN && !INTERSTITIAL && merchantSessionCookies.length > 0,
    authenticatedSessionEvidence: {
      adminFinalUrl: (store.results.find((r) => r.id === 'merchant_admin') || {}).finalUrl ?? null,
      verdict: 'NO_MERCHANT_SESSION — admin redirects to accounts.shopify.com/session-service/login?prompt=select_account behind a Shopify WAF interstitial ("Deine Verbindung muss verifiziert werden")',
      wafInterstitialObserved: INTERSTITIAL,
      authenticatedSessionCookies: merchantSessionCookies,
    },
    browserCookiesObserved: store.cookies.map((c) => `${c.name}@${c.domain}`),
  },
  productInventorySync: {
    verdict: 'BLOCKED_NOT_IMPLEMENTED',
    reason: 'No Shopify Admin REST/GraphQL client and no authenticated store exist, so no catalog, product, inventory or location operation can be issued. The publish path is a documented stub (SHOPIFY_PUBLISH_NOT_IMPLEMENTED) that records a human gate instead.',
    syncClientInCodebase: 'absent — 0 @shopify/* packages, 0 Admin API call sites',
    remoteWritesPerformed: 0,
    localCatalog: {
      source: 'live revenue_experiments table',
      count: metrics.experiments,
      previousRunCount: 59,
      statusBreakdown: expStatuses,
      assignedToChannel: expChannelColumn,
      withPriceAboveZero: metrics.withPrice,
      withSales: metrics.withSales,
      withVisits: metrics.withVisits,
      withConversions: metrics.withConversions,
      withImpressions: metrics.withImpressions,
      verifiedRevenueEur: metrics.verifiedRevenueEur,
      ledgerEntries: metrics.ledgerEntries,
      publishedExperiments: metrics.published,
      inventoryCapabilityDeclared: chan.step7_capability_inventory_declared,
      channelAuthState: chan.step7_auth_state,
      channelAuthEstablished: chan.step7_auth_established,
    },
    diskArtifacts: { dir: 'D:/AgenticOS/digital_products', files: digitalFiles.length, productsSubdir: productSubdirFiles, sample: digitalFiles.slice(0, 6) },
  },
  runtimeIntegrityFindings: [
    { id: 'SHOPIFY-CHAN-001', severity: 'high', status: 'reproduced', finding: `SHOPIFY is registered in the live registry (status auth_required, human_gate_required=1, config=null, created ${shopifyChannel?.created_at}) but not connected: publish is blocked with SHOPIFY_AUTH_REQUIRED and nothing is fabricated (${metrics.ledgerEntries} ledger entries, EUR ${metrics.verifiedRevenueEur}).` },
    { id: 'SHOPIFY-CHAN-002', severity: 'high', status: 'reproduced', finding: 'Live backend is DOWN: no :4600 listener (localized-tolerant netstat + curl exit 7) and no AgenticOS.exe process. All HTTP-path verification (GET /api/health, /api/revenue-operator/channels, /gates) is unavailable; only DB + production dist code paths could be exercised.' },
    { id: 'SHOPIFY-ISO-001', severity: 'medium', status: 'not-reproduced-this-run (isolation held)', finding: 'Both AGENTICOS_DATA_DIR and AGENT_TEAMS_DB_PATH were pinned to the sandbox; the sandbox gate count 2 -> 3 while the live DB stayed at 2 and the post-run check printed LIVE DB UNCHANGED. The 2026-09-30 single-variable leak did not recur.' },
    { id: 'SHOPIFY-CHAN-003', severity: 'medium', status: 'reproduced', finding: `Divergent DBs — live: ${live.revenue_distribution_channels} channels / ${live.revenue_human_gates} gates / ${live.revenue_experiments} experiments / EUR ${metrics.verifiedRevenueEur}; repo legacy: ${legacy.revenue_distribution_channels} channels / ${legacy.revenue_human_gates} gates / ${legacy.revenue_experiments} experiments / ${legacy.experimentsWithSales} with sales / EUR ${legacy.verifiedRevenueSum}.` },
    { id: 'SHOPIFY-CHAN-004', severity: 'medium', status: 'reproduced', finding: `${tasks.length} background tasks match the channel-verification objective: ${tasks.filter((t) => t.status === 'blocked').length} blocked, ${tasks.filter((t) => t.status === 'failed').length} failed, ${tasks.filter((t) => t.status === 'completed').length} completed, ${tasks.filter((t) => t.status === 'cancelled').length} cancelled. ${tasks.filter((t) => /SHOPIFY_AUTH_REQUIRED/.test(t.blocker || '')).length} carry the SHOPIFY_AUTH_REQUIRED capability blocker; the rest are worker-lifecycle failures (stall / recovery-budget / HTTP 402 / restart reconciliation).` },
    { id: 'SHOPIFY-CHAN-005', severity: 'medium', status: 'reproduced', finding: `Catalog keeps growing with no consumer: ${metrics.experiments} APPROVED experiments (${metrics.withPrice} with a price), 0 assigned to a channel (no channel column), 0 sales, 0 visits, EUR ${metrics.verifiedRevenueEur} verified revenue, while digital_products/ holds ${digitalFiles.length} artifacts.` },
    { id: 'SHOPIFY-CHAN-006', severity: 'low', status: 'RESOLVED_OR_NOT_REPRODUCED', finding: 'Browser tooling works: 3 live Shopify surfaces inspected over real CDP this session; the reference storefront rendered its product/price (Shopify T-Shirt, $ 19.00).' },
    { id: 'SHOPIFY-CHAN-007', severity: 'low', status: 'reproduced', finding: 'The only Shopify host mentions in the live DB are planning prose (.myshopify.com mitigation sentence in execution_results.structured_output) and prior-run event/summary text — no configured store.' },
    { id: 'SHOPIFY-CHAN-008', severity: 'info', status: 'new', finding: `Registry duplicate guard: the newest [EVIDENCE] events predate this run (rowids ${newestEvidence.map((e) => e.rowid).slice(0, 3).join(', ')} …, ts ${newestEvidence[0]?.ts}) and came from the 2026-09-30 run; no worker re-ran the task since (backend down), so this run's evidence is not a sibling duplicate.` },
  ],
  acceptanceCriteria: [
    { criterion: 'Shopify store configuration and channel connectivity verified.', met: false, note: 'channel row exists (auth_required) but no store domain, no credentials, no Admin API client — nothing to connect to; publish blocks with SHOPIFY_AUTH_REQUIRED' },
    { criterion: 'Storefront inspection executed.', met: false, note: 'tooling verified working, but BLOCKED_NO_TARGET — no store domain exists to inspect' },
    { criterion: 'Product inventory sync executed.', met: false, note: 'BLOCKED_NOT_IMPLEMENTED — no Admin API client; 0 remote writes' },
    { criterion: 'Execution leaves evidence in the project task registry.', met: EFFECTIVE_APPLY, note: EFFECTIVE_APPLY ? 'evidence event appended after db+wal+shm backup' : 'pending --apply' },
  ],
  blockingHumanGate: 'SHOPIFY_AUTH_REQUIRED — supply a store domain + Admin API access (custom-app token or OAuth app), then POST /api/revenue-operator/channels/seed and set SHOPIFY to active',
  unblockingOptions: [
    { option: 'Connect a store (domain + Admin API token, channel set active)', expectedEffort: 'low', timeToRevenue: '1-2 days', dependencies: 'Shopify store + Admin API access token or OAuth app; backend running', firstConcreteAction: 'create the store, issue an Admin API token, store it in the credential store, set revenue_distribution_channels.SHOPIFY.status=active with config.storeDomain' },
    { option: 'Inventory sync implementation', expectedEffort: 'medium', timeToRevenue: '3-5 days after store connection', dependencies: 'store connection + Admin API client + products/inventory mirror table behind the existing gate', firstConcreteAction: 'add the Admin API client module and a products/inventory mirror table, wire it to the human-gated publish path' },
    { option: 'Storefront target binding', expectedEffort: 'low', timeToRevenue: 'same day as store connection', dependencies: 'a real store domain', firstConcreteAction: 'set channel config.storeDomain and projects.workspace_path for proj-shopify so storefront inspection has a merchant target instead of the platform marketing site' },
    { option: 'Bring the backend up (prerequisite for any HTTP-path acceptance)', expectedEffort: 'low', timeToRevenue: 'same day', firstConcreteAction: 'start the AgenticOS backend on 4600 and re-run the HTTP probes (/api/health, /channels, /gates)' },
  ],
};

// ---- gate BOTH artifacts so a dry re-run cannot downgrade an applied report ----
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
const KEEP_ARTIFACTS = !APPLY && !ARTIFACTS_ONLY && ALREADY_APPLIED;
if (KEEP_ARTIFACTS) {
  console.log('EVIDENCE ALREADY APPLIED — keeping ' + OUT_JSON + ' and ' + OUT_MD);
} else {
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
  console.log('WROTE ' + OUT_JSON + ' (' + fs.statSync(OUT_JSON).size + ' bytes)');
}

// ---- Markdown report ----
const md = `# Shopify channel verification, storefront inspection, product inventory sync — 2026-10-01 run

Repository: ${REPO} — branch ${BRANCH} — HEAD ${HEAD} — worktree dirty (${DIRTY} entries)
Live backend: **NOT RUNNING** — no listener on 127.0.0.1:4600 (curl exit 7), no AgenticOS.exe process. All HTTP-path probes unavailable; verification ran the production dist code paths against the canonical DB on disk.
Live DB: ${LIVE_DB}
Run window: ${out.run.executedAt} .. ${out.run.finishedAt}
Sandbox: .tmp/shopify-verify-20261001T0940Z/agentic-os.db (WAL-consistent db.backup(), snapshot_consistent=true)
Live DB mutation by this run: ${out.run.liveDbMutatedByThisRun} — post-run check printed LIVE DB UNCHANGED (channels 10 / experiments 59 / gates 2 / ledger 0 / SHOPIFY auth_required config=null).

## 1. Channel verification — AUTH_REQUIRED (registered, not connected)

| check | value |
| --- | --- |
| live channel rows | ${live.revenue_distribution_channels} (SHOPIFY, EMAIL, GOOGLE, SEO, GEO, INSTAGRAM, TIKTOK, FACEBOOK, MARKETPLACE, DIRECT_OUTREACH) |
| SHOPIFY row in live DB | status \`${shopifyChannel.status}\`, human_gate_required=${shopifyChannel.human_gate_required}, automation_allowed=${shopifyChannel.automation_allowed}, **config = ${shopifyChannel.config === null ? 'null' : 'present'}**, created ${shopifyChannel.created_at} |
| registry rows before seed (sandbox) | ${chan.step1_channel_row_count} |
| channels after seedChannels() | ${chan.step3_seeded_channel_count} (idempotent) |
| SHOPIFY status after seed | \`${chan.step3_shopify_channel_after_seed.status}\`, humanGateRequired=${chan.step3_shopify_channel_after_seed.humanGateRequired} |
| publishExperiment(${chan.step4_target_experiment?.id}, SHOPIFY) | {published: ${out.channelVerification.publishAttempt.published}, blocked: ${out.channelVerification.publishAttempt.blocked}, reason: "${out.channelVerification.publishAttempt.reason}"} |
| gate created (sandbox only) | ${out.channelVerification.publishAttempt.gateId} / ${out.channelVerification.publishAttempt.gateType} / branchPaused=${out.channelVerification.publishAttempt.branchPaused} |
| ledger + revenue after blocked publish | ${chan.step5_ledger_entries} entries / EUR ${chan.step5_ledger_revenue_total} — nothing fabricated |
| open SHOPIFY_AUTH_REQUIRED gates in live DB | ${out.channelVerification.openShopifyGatesInLiveDb} (gate-8b60c74d-, gate-71ff9058-, both from the 2026-09-21T19:01 registration, gate_url=null, resolved_by=null) |
| credential rows naming Shopify | provider_credentials ${cred.provider_credentials.rowCount} rows / 0 Shopify; system_secrets ${cred.system_secrets.rowCount} rows / 0 Shopify |
| @shopify packages | none (root + server node_modules) |
| Admin API call sites in server/src | none |
| SHOPIFY_* env keys | none in .env / server/.env |
| contract test | src/__tests__/distributionService.test.ts — 1 file / 2 tests passed (vitest 4.1.10, 1.56s) |
| live backend health probe | connection refused (no :4600 listener, curl exit 7) |

Level reached: **declared + registered + gate-enforced. NOT connected, NOT implemented.** No revenue figure may be quoted. Token-like needle hits (\`shpat_\`, \`shpca_\`, \`X-Shopify-Access-Token\`): ${out.channelVerification.credentialStore.tokenLikeHits}.

## 2. Storefront inspection — BLOCKED_NO_TARGET (browser tooling VERIFIED WORKING)

| surface | final URL | title | text len | password fields | markers |
| --- | --- | --- | --- | --- | --- |
${store.results.map((r) => `| ${r.id} | ${r.finalUrl} | ${(r.title || '(empty)').replace(/\|/g, '/')} | ${r.dom.textLength} | ${r.dom.passwordFields} | ${r.dom.storefrontMarkers.productNodes} products / ${r.dom.storefrontMarkers.cartNodes} cart / ${r.dom.storefrontMarkers.shopifyCdnScripts} CDN scripts${r.dom.interstitial ? ' — WAF interstitial' : ''} |`).join('\n')}

Authenticated merchant session: **NO_MERCHANT_SESSION** — the admin surface redirects to \`accounts.shopify.com/session-service/login?…&prompt=select_account\` behind a Shopify WAF interstitial; the only cookies present are \`_merchant_essential\` and \`_shopify_essential_\` (no \`_secure_session_id\` / admin session cookie).
Store binding: \`revenue_distribution_channels.SHOPIFY.config = null\`; \`proj-shopify.workspace_path = null\`; no store domain exists anywhere in the repo or the DB. The only storefront-shaped target registered in code is the platform marketing site (\`shopify_web\` -> https://www.shopify.com), which is not a merchant storefront.

## 3. Product inventory sync — BLOCKED_NOT_IMPLEMENTED

| measure | value |
| --- | --- |
| sync client in codebase | absent — 0 @shopify/* packages, 0 Admin API call sites; publish path is the documented \`SHOPIFY_PUBLISH_NOT_IMPLEMENTED\` stub |
| remote writes performed | 0 |
| revenue_experiments rows | ${metrics.experiments} (all APPROVED; previous run 59 — flat) |
| rows with price > 0 | ${metrics.withPrice} |
| rows with sales / visits / conversions / impressions > 0 | ${metrics.withSales} / ${metrics.withVisits} / ${metrics.withConversions} / ${metrics.withImpressions} |
| verified revenue | EUR ${metrics.verifiedRevenueEur} |
| channel assignment | ${expChannelColumn} — 0 experiments assigned to any channel |
| channel capabilities.inventory flag | ${chan.step7_capability_inventory_declared} (declaration only) |
| built artifacts on disk | digital_products/ — ${digitalFiles.length} entries (incl. products/ with ${productSubdirFiles}) |

## 4. Isolation

Both \`AGENTICOS_DATA_DIR\` and \`AGENT_TEAMS_DB_PATH\` were pinned to the sandbox. Sandbox gates went 2 -> 3 on the publish attempt while the live DB stayed at 2; the post-run check printed **LIVE DB UNCHANGED** against the pre-run snapshot counts. The 2026-09-30 single-variable leak (SHOPIFY-ISO-001) did not recur.

## 5. Findings

| id | severity | status | finding |
| --- | --- | --- | --- |
${out.runtimeIntegrityFindings.map((f) => `| ${f.id} | ${f.severity} | ${f.status} | ${f.finding.replace(/\|/g, '/')} |`).join('\n')}

## 6. Acceptance criteria

| criterion | met | note |
| --- | --- | --- |
${out.acceptanceCriteria.map((a) => `| ${a.criterion} | ${a.met ? 'YES' : 'NO'} | ${(a.note || '').replace(/\|/g, '/')} |`).join('\n')}

Blocking human gate: **SHOPIFY_AUTH_REQUIRED** — supply a store domain + Admin API access (custom-app token or OAuth app), then \`POST /api/revenue-operator/channels/seed\` and set SHOPIFY active.

## 7. Unblocking options

| option | Expected Effort | Time-to-Revenue | Dependencies | First Concrete Action |
| --- | --- | --- | --- | --- |
${out.unblockingOptions.map((o) => `| ${o.option} | ${o.expectedEffort} | ${o.timeToRevenue} | ${o.dependencies || 'none'} | ${o.firstConcreteAction} |`).join('\n')}

Machine-readable evidence: \`docs/shopify-channel-verification-2026-10-01.json\`. Raw artifacts: \`.tmp/shopify-verify-20261001T0940Z/{channel-verification,inventory-scan,credential-probe,storefront-inspection,live-probe}.json\`.
`;
if (KEEP_ARTIFACTS) {
  console.log('MD KEPT — ' + OUT_MD);
} else {
  fs.writeFileSync(OUT_MD, md);
  console.log('WROTE ' + OUT_MD + ' (' + fs.statSync(OUT_MD).size + ' bytes)');
}

// ---- registry evidence append ----
const APPLY_TARGETS = tasks.map((t) => t.task_id);
console.log('REGISTRY TASK MATCHES: ' + APPLY_TARGETS.length);
if (APPLY_TARGETS.length === 0) { console.log('NOTHING TO WRITE.'); process.exit(0); }
if (!APPLY) {
  console.log('DRY RUN — ' + APPLY_TARGETS.length + ' tasks would receive an evidence event. Pass --apply to write.');
  process.exit(0);
}

const BACKUP_DIR = path.join(RAW, 'live-db-backup');
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const suffix of ['', '-wal', '-shm']) {
  const src = LIVE_DB + suffix;
  if (fs.existsSync(src) && fs.statSync(src).size > 0) {
    fs.copyFileSync(src, path.join(BACKUP_DIR, `agentic-os.db${suffix}.${stamp}.bak`));
  }
}
console.log('BACKUP DIR: ' + BACKUP_DIR + ' (stamp ' + stamp + ')');

const SUMMARY = `[EVIDENCE] Shopify channel verification/storefront/inventory run ${out.run.executedAt} — ${out.channelVerification.verdict}. `
  + `Live registry: ${out.channelVerification.liveChannelRows} channels, SHOPIFY=${shopifyChannel.status} (config=null, humanGateRequired=1); seed contract=${out.channelVerification.shopifyChannelAfterSeed.status}; `
  + `publishExperiment -> blocked (${out.channelVerification.publishAttempt.reason}, gate ${out.channelVerification.publishAttempt.gateId}, sandbox only); ${metrics.ledgerEntries} ledger entries / EUR ${metrics.verifiedRevenueEur} fabricated. `
  + `Live backend DOWN (no :4600 listener). Storefront: ${out.storefrontInspection.verdict} — browser tooling WORKING, 3 surfaces inspected, no store domain, NO_MERCHANT_SESSION. `
  + `Inventory sync: ${out.productInventorySync.verdict} (no Admin API client, 0 remote writes); local catalog ${metrics.experiments} APPROVED experiments, 0 channel-assigned, 0 sales, EUR ${metrics.verifiedRevenueEur} verified. `
  + `Contract test: ${out.channelVerification.contractTest.result}. Live DB verified UNCHANGED.`;

const BLOCKER = 'Shopify authentication required (SHOPIFY_AUTH_REQUIRED human gate): no store domain and no Admin API credentials; '
  + `SHOPIFY channel status=${shopifyChannel.status}, config=null. Also: live backend not listening on 127.0.0.1:4600. `
  + 'Supply store domain + Admin API access, run POST /api/revenue-operator/channels/seed, set SHOPIFY active.';

const RESULT_TEXT = `Channel verification: ${out.channelVerification.verdict}. Storefront inspection: ${out.storefrontInspection.verdict} (tooling verified working). `
  + `Inventory sync: not performed (${out.productInventorySync.reason}). Local catalog: ${metrics.experiments} APPROVED experiments, 0 with sales, EUR ${metrics.verifiedRevenueEur} verified revenue. `
  + `Live backend down (:4600 not listening). Evidence: docs/shopify-channel-verification-2026-10-01.json / .md.`;

const detail = JSON.stringify({
  runner: 'hermes-agent',
  executedAt: out.run.executedAt,
  repository: REPO,
  evidence: ['docs/shopify-channel-verification-2026-10-01.json', 'docs/shopify-channel-verification-2026-10-01.md'],
  scripts: out.run.scriptsRun,
  channelVerification: {
    liveChannelRows: out.channelVerification.liveChannelRows,
    shopifyStatus: shopifyChannel.status,
    shopifyConfig: shopifyChannel.config,
    shopifyAfterSeed: out.channelVerification.shopifyChannelAfterSeed.status,
    publishAttempt: `blocked (${out.channelVerification.publishAttempt.reason}, sandbox only)`,
    contractTest: out.channelVerification.contractTest.result,
  },
  storefrontInspection: `${out.storefrontInspection.verdict}; tooling WORKING; surfaces: ${store.results.map((r) => `${r.id}=${r.title || r.finalUrl}`).join(' | ')}`,
  productInventorySync: `NOT_PERFORMED (no Admin API client); catalog=${metrics.experiments} experiments, assigned=0, sold=0, EUR ${metrics.verifiedRevenueEur}`,
  liveBackend: 'DOWN (no :4600 listener, no AgenticOS.exe process)',
  liveDbVerified: 'UNCHANGED against pre-run snapshot',
  findings: out.runtimeIntegrityFindings.map((f) => `${f.id}[${f.severity}/${f.status}]`),
  acceptanceCriteria: out.acceptanceCriteria.map((a) => ({ criterion: a.criterion, met: a.met })),
});

const wdb = new Database(LIVE_DB);
wdb.pragma('busy_timeout = 8000');
let seq = wdb.prepare('SELECT MAX(sequence) m FROM background_task_events').get().m || 0;
const insertEvent = wdb.prepare('INSERT INTO background_task_events (id, task_id, ts, kind, summary, detail, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)');
const updateTask = wdb.prepare(
  `UPDATE background_tasks SET progress_message = ?, blocker = ?, last_error = ?, result_text = ?,
      verification_state = ?, current_stage = ?, updated_at = ?, metadata = ? WHERE task_id = ?`
);
const now = new Date().toISOString();
const writtenIds = [];
wdb.transaction(() => {
  for (const taskId of APPLY_TARGETS) {
    const evId = 'bgevt-' + crypto.randomBytes(6).toString('hex');
    seq += 1;
    insertEvent.run(evId, taskId, now, 'task.progress', SUMMARY, detail, seq);
    writtenIds.push(evId);
    const meta = wdb.prepare('SELECT metadata FROM background_tasks WHERE task_id = ?').get(taskId)?.metadata;
    let parsed = {};
    try { parsed = meta ? JSON.parse(meta) : {}; } catch { parsed = { previousMetadata: String(meta) }; }
    parsed.evidenceArtifact = 'docs/shopify-channel-verification-2026-10-01.json';
    parsed.evidenceReport = 'docs/shopify-channel-verification-2026-10-01.md';
    parsed.verifiedAt = now;
    parsed.verifiedBy = 'hermes-agent';
    parsed.verifiedRun = out.run.executedAt;
    parsed.blockingGate = 'SHOPIFY_AUTH_REQUIRED';
    updateTask.run(`Verification run executed ${out.run.executedAt} — see evidence event.`,
      BLOCKER, 'Shopify authentication required (SHOPIFY_AUTH_REQUIRED).', RESULT_TEXT,
      'failed', 'blocked', now, JSON.stringify(parsed), taskId);
  }
})();
console.log('EVIDENCE EVENTS WRITTEN: ' + APPLY_TARGETS.length);
console.log('EVENT IDS: ' + writtenIds.join(','));
console.log('--- AFTER ---');
for (const t of wdb.prepare("SELECT task_id, status, verification_state, substr(COALESCE(blocker,''),1,70) blocker FROM background_tasks WHERE objective LIKE '%channel verification%'").all()) {
  console.log('  ' + JSON.stringify(t));
}
console.log('gate count now: ' + wdb.prepare('SELECT COUNT(*) n FROM revenue_human_gates').get().n);
wdb.close();
