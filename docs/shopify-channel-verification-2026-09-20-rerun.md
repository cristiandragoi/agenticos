# Shopify Channel Verification, Storefront Inspection, Product Inventory Sync — RE-RUN

Run date: 2026-09-20T19:28Z–19:30Z · Repository: D:\AgenticOS · Branch: hermes-rescue-20260908
Runtime DB: C:\Users\cd-pr\AppData\Roaming\agenticos\data\agentic-os.db (104 tables)
Sandbox DB: D:\AgenticOS\.tmp\shopify-verify-r2\agentic-os.db (byte copy; live DB not mutated)
Machine evidence: docs/shopify-channel-verification-2026-09-20-rerun.json · raw outputs in .tmp/shopify-verify-r2/

## Verdicts

| Sub-task | Verdict | Hard blocker |
|---|---|---|
| Shopify channel verification | FAILED at authentication | No SHOPIFY row in the live channel registry; no store domain; no credentials; no Admin API client |
| Storefront inspection | BLOCKED — no target, and tooling broken | `proj-shopify.workspace_path = null`; no store domain; browser-use spawn defect (reproduced 2/2) |
| Product inventory sync | BLOCKED — not implemented | No Shopify Admin REST/GraphQL client exists in the repository |

Nothing in the live DB was modified by this run.

## 1. Channel verification (production dist code paths, sandbox DB)

| Step | Observed |
|---|---|
| `getDistributionStatus()` on live copy | `[]` — 0 channel rows |
| `getChannel('SHOPIFY')` | `null` |
| `seedChannels()` | 10 channels registered |
| SHOPIFY after seed | `status=auth_required`, `humanGateRequired=true`, `automationAllowed=true`, capabilities include `inventory`, `catalog`, `product`, `publish`, `orders` |
| `publishExperiment('expt-e0a307e6-','SHOPIFY')` | `published=false`, `blocked=true`, `reason=SHOPIFY_AUTH_REQUIRED`, gate `gate-36dd9849-` open, `branchPaused=true` (written to sandbox only) |
| Ledger after blocked publish | 0 entries, €0 verified revenue |
| Contract test `src/__tests__/distributionService.test.ts` | 1 file / 2 tests passed, 1.09s (vitest 4.1.10) |

Credentials and connectivity:

- No `@shopify/*` dependency and no `node_modules/@shopify`; no `X-Shopify` / Admin API call site in `server/src`. The only `SHOPIFY*` strings are gate-type names plus `SHOPIFY_PUBLISH_NOT_IMPLEMENTED` (`actionResolver.ts:103,114`).
- No `SHOPIFY_*` env key. `provider_credentials` (2 rows) and `system_secrets` (2 rows) contain 0 Shopify entries.
- `myshopify` appears exactly once in the live DB — inside agent planning prose in `execution_results.exr-1142be46-c` ("utilize Shopify's default .myshopify.com"). It is not a configured store. (Correction of the earlier report, which said "no myshopify host in either runtime DB".)
- Egress this run: `www.shopify.com` 200 (0.196s); `admin.shopify.com` 200 (0.346s) but body is a 295-byte JS stub redirecting to `admin.shopify.com/login?errorHint=no_cookie_session`; `admin.shopify.com/oauth/authorize` 200 with the same redirect; `accounts.shopify.com` 403. Stable signal: `PATH_OK_NO_SESSION`. (The earlier run recorded 403 for admin/oauth — status codes are not stable, so 403 was the wrong thing to hang the conclusion on.)

## 2. Storefront inspection (no target, tooling defective)

- `proj-shopify` is `active`, `workspace_path = null`, vertical `shopify`.
- The only Shopify web surface wired into code is browser target `shopify_web` → `https://www.shopify.com` (`server/src/services/browser/browserOperator.ts:101-106`) — platform marketing site, not a merchant storefront.
- Live inspection attempted twice this run: both failed with `uv trampoline failed to spawn Python child process (os error 4551)`.
- Diagnosis: the Hermes venv interpreter runs (`Python 3.11.9`, exit 0) and its base interpreter is present; `uv` is 0.12.15. So this is an internal browser-use spawn defect, not a missing interpreter — and it reproduces identically to the earlier run, i.e. deterministic.

## 3. Product inventory sync (not performed)

- No Admin API client anywhere → no inventory, catalog or listing operation can be issued.
- Local catalog: 48 `revenue_experiments` in the live DB, all `APPROVED`, 0 with sales, €0 verified revenue (was 47 at 19:28:58Z, 48 at 19:30:11Z — the runtime keeps appending approved experiments that no channel consumes).
- Disk artifacts: 17 entries under `digital_products/` (7 xlsx, 6 md, 1 `products/` subdir + summary docs). Nothing listed, updated or pushed.

## Runtime integrity findings

| ID | Severity | Status | Finding |
|---|---|---|---|
| SHOPIFY-CHAN-001 | high | reproduced | Live `revenue_distribution_channels` still empty; `seedChannels()` runs only on `POST /channels/seed` or in tests, so SHOPIFY is unregistered at runtime |
| SHOPIFY-CHAN-002 | medium | reproduced, quantified | Divergent DBs — live: 0 channels / 0 gates / 48 experiments / 0 ledger / €0; repo legacy `server/data/agentic-os.db`: 10 channels, 16 SHOPIFY gates (12 resolved), 68 experiments, 11 ledger entries, 5 with sales, €38 verified. Shopify history is invisible to the running app |
| SHOPIFY-CHAN-003 | medium | updated | Five Shopify-related task rows now: 3 × channel-verification `blocked`/`failed` (blocker now `SHOPIFY_AUTH_REQUIRED`), 1 blocked on backend restart, 1 `completed`/`passed` read-only market research |
| SHOPIFY-CHAN-004 | high | unchanged | Acceptance criterion 1 is unachievable as configured — no domain, no credentials, no client |
| SHOPIFY-CHAN-005 | medium | new | Browser automation tooling deterministically broken (os error 4551) while Python/uv are healthy; blocks all storefront/admin inspection independently of credentials |

## Acceptance criteria

1. "Shopify store configuration and channel connectivity verified." — NOT MET. Nothing to verify; reachability ≠ connectivity.
2. "Execution leaves evidence in project task registry." — MET. Fresh evidence event appended to each Shopify verification task in the live runtime DB (pre-write backup kept in `.tmp/shopify-verify-r2/`).

## Required next action (human gate)

Supply a Shopify store domain plus Admin API access (custom-app token or OAuth app); seed the registry (`POST /channels/seed`) and set SHOPIFY to `active`. Storefront inspection additionally needs the browser-use spawn defect fixed.
