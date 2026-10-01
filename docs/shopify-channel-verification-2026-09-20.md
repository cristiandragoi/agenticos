# Shopify Channel Verification, Storefront Inspection, Product Inventory Sync

Run date: 2026-09-20T19:10Z · Repository: D:\AgenticOS · Branch: hermes-rescue-20260908
Runtime DB: C:\Users\cd-pr\AppData\Roaming\agenticos\data\agentic-os.db
Machine evidence: docs/shopify-channel-verification-2026-09-20.json
Verification script: server/scripts/shopify-channel-verification.mjs (sandbox DB copy)

## Verdicts

| Sub-task | Verdict | Hard blocker |
|---|---|---|
| Shopify channel verification | FAILED at authentication | No channel row in the live registry; no Shopify credentials |
| Storefront inspection | BLOCKED — no target | No store domain configured; no merchant session |
| Product inventory sync | BLOCKED — not implemented | No Shopify Admin API client in the codebase, no authenticated store |

## 1. Channel verification (executed)

Real production code path executed against a sandbox copy of the live DB
(`server/dist/services/revenueOperator/{distributionService,operatorService}.js`):

| Step | Observed |
|---|---|
| `getDistributionStatus()` on live DB | `[]` — 0 channel rows |
| `getChannel('SHOPIFY')` on live DB | `null` |
| `seedChannels()` (canonical seeding path) | 10 channels registered |
| SHOPIFY after seed | `status=auth_required`, `humanGateRequired=true`, capabilities incl. `inventory`, `catalog`, `product`, `listing`, `publish`, `checkout`, `orders` |
| `publishExperiment('expt-e0a307e6-','SHOPIFY')` | `published=false`, `blocked=true`, `reason=SHOPIFY_AUTH_REQUIRED`, gate `gate-ec1ed787-` open, `branchPaused=true` |
| Ledger after blocked publish | 0 entries, 0 verified revenue — nothing fabricated |
| Contract test `src/__tests__/distributionService.test.ts` | 1 file / 2 tests passed (1.16s) |

Credentials and connectivity:

- No `@shopify/*` dependency, no Admin API / `X-Shopify` / access-token call site anywhere in `server/src`.
- No `SHOPIFY_*` key in `.env` or `server/.env`; no `myshopify` host in either runtime DB.
- Egress: `https://www.shopify.com/` → 200; `admin.shopify.com`, `accounts.shopify.com`, `admin.shopify.com/oauth/authorize` → 403 (edge rejection of unauthenticated non-browser client). Network path exists; merchant session does not.

## 2. Storefront inspection (no target exists)

- `proj-shopify` is `active` but `workspace_path = null`; description: "Shopify storefront and e-commerce channel operations".
- Exhaustive text scan over every table/column of the live DB: no storefront domain, no Shopify connector/credential record.
- The only Shopify web surface wired into code is the browser target `shopify_web` → `https://www.shopify.com` (`server/src/services/browser/browserOperator.ts:103`) — the platform marketing site, not a merchant storefront.
- Live browser inspection was not possible: the browser tooling failed twice with `uv trampoline failed to spawn Python child process (os error 4551)`.

## 3. Product inventory sync (not performed, not implementable as-is)

- No sync client: the channel contract declares `inventory: true`, but there is no Shopify Admin/GraphQL API client to perform a sync.
- Local catalog that would be synced: 47 `revenue_experiments` in the live DB, all `APPROVED`, 0 with a channel assigned, 0 sales, €0 verified revenue (`revenue_ledger_entries` = 0).
- Disk product artifacts: 17 files under `digital_products/` (7 xlsx, 6 md, 1 pdf + supporting docs). Nothing was listed, updated or pushed to a store.

## Runtime integrity findings

| ID | Severity | Finding |
|---|---|---|
| SHOPIFY-CHAN-001 | high | `revenue_distribution_channels` is empty in the live runtime DB. `seedChannels()` is reachable only via `POST /channels/seed` and from tests, so SHOPIFY is unregistered at runtime — verification starts from "no such channel". |
| SHOPIFY-CHAN-002 | medium | Two divergent DBs: the 50.8 MB repo copy `server/data/agentic-os.db` (10 channels, 16 SHOPIFY gates, 32 `revenue_action_executions`) is legacy; the packaged app uses the 16.8 MB APPDATA DB that matches current schema (104 tables / 24 migrations). Shopify history in the repo DB is invisible to the running app. |
| SHOPIFY-CHAN-003 | medium | All three Shopify task records are `blocked` with "Worker state was interrupted by backend restart" and no `result_text` — the blocked state is a worker-lifecycle artifact, not a Shopify precondition. |
| SHOPIFY-CHAN-004 | high | Acceptance criterion 1 cannot be met as configured: no store domain, no credentials, no Admin API client exist anywhere. |

## Acceptance criteria

1. "Shopify store configuration and channel connectivity verified." — NOT MET. No store configuration exists; network reachability is not channel connectivity.
2. "Execution leaves evidence in project task registry." — MET. Evidence events appended to the three Shopify task records in the live runtime DB (pre-write backup retained).

## Required next action (human gate)

Supply a Shopify store domain plus Admin API access (custom app token or OAuth app). Then seed the channel registry (`POST /channels/seed`) and flip the SHOPIFY channel to `active`; only after that can publish and inventory operations be exercised against a real store.
