# REVENUE OPERATOR PHASE 1 — ARGUS TASK CONTRACT

Contract version: 1.0
Created: 2026-08-19 (HERMES ONE orchestration)
Workspace: `B:\AgenticOS`
Baseline branch: `argus-deploy` @ `d2d6435` (VERIFIED — ARGUS PACKAGED VERIFIED — INDEPENDENT VERIFIER ACTIVE)
Builder: `agent-codex` = `prov-deepseek` / `deepseek-v4-flash`
Verifier: `agent-argus` = `prov-ollama` / `qwen3.5:cloud` (routing preferred)
Reference WIP (reuse selectively, never blind-merge): `revenue-wip-checkpoint` @ `db8304dd4c95ae655cb5097e62be522ee6dffd55`

## 0. ORIGINAL MISSION

Build Revenue Operator Phase 1 inside the existing Agentic OS architecture, executed
through the verified pipeline: TASK CONTRACT → CODEX → IMPLEMENTATION_READY → ARGUS
(→ defect packet → Codex correction → reverify) → CANONICAL VERIFIER → PROJECT MEMORY
→ VERIFIED_COMPLETE. No executor may certify its own work. No manual copy/paste between
Codex and ARGUS. Hermes owns orchestration.

## 1. BUSINESS OBJECTIVE

Revenue Operator is a first-class Agentic OS capability that autonomously progresses
legitimate revenue-generating experiments. Initial commercial target: €300 in 30 days,
€0 advertising budget. Initial engines: 1) Digital Products, 2) German SME AI
Automation. Commerce available: Shopify. Primary market: Germany/EU. Operating
principle: autonomous execution within existing approval, compliance and human-gate
policy. Phase 1 does NOT need to earn €300 — it must make the objective EXECUTABLE
rather than conversational.

## 2. CORE PRODUCT RULE

Jarvis must not merely tell the user what to do. No "Search Google for companies",
no "Copy this email into Gmail", no "Create this spreadsheet manually", no "Go to
Shopify and create the product". Desired behavior:
objective → Hermes strategy → experiment → task → executor → run → result →
verification → memory/state → next action. Human involvement reserved for genuine
human-only gates.

## 3. ARCHITECTURE RULES (absolute)

- REUSE the canonical Agentic OS architecture: project_goals → project_tasks →
  execution_runs → execution_results/events → ARGUS → canonical verifier → project
  memory. Reuse Jarvis, Hermes, Codex, Magnitude, task engine, execution runs, worker
  adapters, provider routing, approval/action classifier, human gates,
  verification_reports, GateRunner, runLedger, project memory, knowledge, scheduler,
  database, API conventions, frontend conventions.
- ABSOLUTE PROHIBITION: do NOT create another project system, scheduler, task queue,
  execution engine, provider registry, verifier, approval engine, or memory subsystem.
  Revenue Operator EXTENDS the existing Agentic OS.
- Do NOT redesign Agentic OS, do NOT modify Jarvis Nebula V2 / Jarvis visuals, do NOT
  touch the verified provider-routing recovery.
- No parallel scheduler/task system. No fake production metrics. No claiming queued
  work as actually running without runtime evidence.

## 4. RESPONSIBILITY BOUNDARIES

- JARVIS: command/control surface — receive revenue mission, show status, expose active
  work, surface human gates, report verified outcomes, allow intervention. Must not
  contain all Revenue Operator business logic.
- HERMES: strategy/orchestration — opportunity reasoning, decomposition, prioritization,
  experiment selection, next-best-action, resource allocation, replan after failures,
  iterate/scale/kill. Must use persisted evidence.
- CODEX: implementation/builder executor — builds spreadsheets, calculators, digital
  products, landing pages, prototypes, small automation demos, integration code,
  software assets. Codex ends at IMPLEMENTATION_READY. Codex cannot mark final
  verified completion.
- ARGUS: independent verification against the immutable Task Contract — inspect actual
  source/diff, evaluate acceptance criteria, require sufficient evidence, produce
  structured defect packets, automatically send failed implementation back to Codex,
  reverify corrections.
- CANONICAL VERIFIER: existing verifier remains authoritative for evidence/state commit.
  ARGUS does NOT replace it.
- MAGNITUDE: permitted browser/computer execution when no API-native route exists.
  Must NOT bypass CAPTCHA, KYC, auth security, anti-bot, platform restrictions. Use
  human gates when required.

## 5. REQUIRED DOMAINS

### Revenue Mission
first-class mission integrated with existing project infrastructure:
mission_id, project_id, target_amount, currency, start_date, deadline,
advertising_budget, actual_spend, enabled_engines[], available_channels[],
primary_market, status, realized_revenue, verified_revenue, pipeline_value,
actual_cost, net_revenue, created_at, updated_at. Do not duplicate existing project
fields unnecessarily.

### Revenue Experiment
first-class domain extension: experiment_id, mission_id, project_id, engine,
hypothesis, target_customer, problem, product, offer, price, evidence[],
evidence_sources[], confidence, competitors[], distribution_channels[],
estimated_cost, actual_cost, expected_revenue, actual_revenue, verified_revenue,
build_time, launch_date, impressions, visits, leads, responses, conversions, sales,
decision_reason, status, tasks[], runs[], artifacts[], created_at, updated_at.
Reuse canonical IDs/relations where possible.

### Experiment lifecycle
DISCOVERED → VALIDATING → APPROVED → BUILDING → QA → READY_TO_PUBLISH → PUBLISHING →
LIVE → ITERATING → SCALING → KILLED. Execution failure/blocking reuses canonical
task/run semantics (no conflicting duplicate execution states).

### Evidence model
Commercial evidence distinguishes FACT / ESTIMATE / INFERENCE / ASSUMPTION / UNKNOWN.
Record source, timestamp, confidence, provenance where practical. Do not convert
unsourced claims into facts.

### Opportunity scoring
Extensible: Demand × PurchaseIntent × ExpectedMargin × DistributionProbability ×
AutomationPotential × CompetitiveAdvantage ÷ (BuildTime × AcquisitionDifficulty ×
CapitalRequirement × Risk). Normalized components, confidence, explanation, unknown
values, evidence links. Hermes must explain why an opportunity was selected.

### Digital Product Factory (Engine 1)
Product classes: spreadsheet templates, business calculators, operational templates,
Notion-style systems, prompt/workflow packages, checklists, SOP packages, business
resource packs. Loop: DISCOVER → VALIDATE → SCORE → GO/NO-GO → BUILD → QA → PUBLISH →
MEASURE → ITERATE/SCALE/KILL. Every stage persists evidence/state. Discovery supports
demand/marketplace/pricing/competitors/reviews/search intent/community pain points/
workflow problems/underserved niches (niches not hard-coded as permanent limits).
Quality gate before publication: artifact exists, works, formulas/workflows function,
documentation exists, no placeholders, no copied protected content, promised
functionality matches actual product, commercially reasonable quality. Generated
software/tools verified by ARGUS at required evidence level.

### German SME AI Automation (Engine 2)
Phase 1 pipeline: DISCOVER COMPANY → INSPECT WEBSITE → UNDERSTAND BUSINESS → IDENTIFY
AUTOMATION PROBLEM → QUALIFY → FIND LEGITIMATE BUSINESS CONTACT → CREATE SPECIFIC
OFFER → APPROVAL IF REQUIRED → OUTREACH → TRACK → FOLLOW UP → OPPORTUNITY → PROPOSAL
→ WON/LOST. Offer principle: specific commercially relevant issue (repetitive inquiry
handling, quotation workflow, appointment friction, lead qualification, document
handling, repetitive customer support, manual intake, repetitive admin workflows) —
never generic "innovative AI company" spam. Demonstration-first where commercially
justified (Hermes opportunity → experiment approved → Codex build → artifact → ARGUS
verifies → prospect-linked demonstration → offer); do not build demos indiscriminately.

### Compliance (German/EU SME outreach)
Compliance-aware records: company/contact source, business relevance, purpose,
outreach history, opt-out, do-not-contact, suppression, retention/deletion state,
lawful-basis/legitimate-interest metadata where applicable, compliance review state.
No indiscriminate bulk-spam infrastructure. Do not bypass legal/platform protections.
Human/legal review gates where required.

### Shopify (available commerce channel — not the only channel)
Implement/reuse channel capabilities conceptually: authenticate, catalog, product,
listing, publish, checkout, orders, analytics, revenue, inventory. Use official
supported mechanisms. If OAuth required: HUMAN GATE → USER AUTHORIZES → VERIFY →
RESUME. Never fabricate a publication/order.

### Distribution channel abstraction
At least: SHOPIFY, EMAIL, GOOGLE, SEO, GEO, INSTAGRAM, TIKTOK, FACEBOOK, MARKETPLACE,
DIRECT_OUTREACH. Each channel exposes capability/constraint info: discover, publish,
sell, message, measure, authenticate, automationAllowed, humanGateRequired.

### Platform safety
No functionality to bypass CAPTCHA, evade Meta/TikTok anti-spam, circumvent KYC,
mass-post where prohibited, fake engagement, fake reviews, impersonate humans. Use
approved integrations or human gates.

### Revenue ledger
Distinguish PIPELINE_VALUE, PROPOSED_VALUE, ORDER_VALUE, REALIZED_REVENUE,
VERIFIED_REVENUE, REFUNDED_REVENUE, ACTUAL_COST, NET_REVENUE. Do NOT count proposals
as revenue, interested replies as revenue, generated listings as sales, hypothetical
value as realized cash.

### Revenue verification
Revenue becomes VERIFIED only with appropriate evidence: Shopify order/payment,
payment-provider evidence, other transaction record, properly verified manual entry.
Record provenance. External commercial results generally require L6 — EXTERNAL.

## 6. UI REQUIREMENTS

- Revenue Operator workspace/view inside existing Agentic OS (no redesign of all of
  Agentic OS, no Nebula V2 changes). Dashboard: REVENUE OPERATOR, 30-DAY TARGET,
  REALIZED REVENUE, VERIFIED REVENUE, PIPELINE VALUE, ACTUAL COST, NET REVENUE,
  ADVERTISING SPEND, DAYS REMAINING. All values from persistence. No fake metrics.
- Engine status: DIGITAL PRODUCTS (status, discovered, validated, building, published,
  sales, verified revenue); GERMAN SME AUTOMATION (status, companies discovered,
  qualified, contacted, replies, interested, proposals, won, pipeline, verified
  revenue). Future engines: INACTIVE/FUTURE.
- Live execution: task, executor, provider/model, status, run ID, start time, elapsed,
  verification state, ARGUS state, next action, human gate. Differentiate accurately:
  QUEUED / ACTUALLY_RUNNING / IMPLEMENTATION_READY / VERIFYING / CORRECTING / BLOCKED /
  FAILED / COMPLETED / VERIFIED_COMPLETE. A stale queued item must never appear as
  active execution without actual runtime evidence.
- Hermes decision stream: Experiment, Decision (GO/NO-GO/etc), Reason, Evidence,
  Confidence, Expected upside, Cost, Next action.
- Human Required panel: SHOPIFY AUTH REQUIRED, OAUTH REQUIRED, CAPTCHA, KYC, CONTRACT
  APPROVAL, PAYMENT APPROVAL, OUTBOUND APPROVAL, LEGAL REVIEW, PLATFORM RESTRICTION.
  Affected branch pauses; independent work continues.
- Prospect view: company, website, industry, identified problem, evidence,
  qualification, contact, contact source, compliance state, proposed offer, outreach
  history, replies, stage, tasks, runs, artifacts, next action, human gates.
- Experiment view: hypothesis, engine, target customer, problem, product/solution,
  offer, price, evidence, confidence, costs, tasks, runs, artifacts, distribution,
  metrics, revenue, Hermes decisions, ARGUS verification, next action.
- Observability must answer: what is running/queued/blocked, which executor owns it,
  which model/provider, why opportunity selected, what evidence, what action attempted,
  what happened, did ARGUS verify, did canonical verification commit, what next, is
  human action required, what verified revenue has been generated.

## 7. COMMERCIAL EVENTS

Reuse canonical events where appropriate; add Revenue-specific only where needed:
revenue_mission_started, experiment_discovered, experiment_validation_started,
evidence_added, experiment_approved, experiment_rejected, artifact_build_started,
artifact_created, artifact_verified, publication_started, publication_verified,
prospect_discovered, prospect_qualified, prospect_rejected, outreach_prepared,
outreach_approved, outreach_sent, outreach_verified, reply_received,
opportunity_created, proposal_created, sale_recorded, revenue_verified,
experiment_iterated, experiment_scaled, experiment_killed, human_gate_created,
human_gate_resolved. Do not duplicate task/run events unnecessarily.

## 8. HUMAN-GATE EXECUTION PRINCIPLE

AUTOMATE LEGITIMATELY PERMITTED WORK → GENUINE HUMAN-ONLY BARRIER → PAUSE AFFECTED
BRANCH → DISPLAY HUMAN ACTION → USER COMPLETES IT → VERIFY → RESUME AUTOMATICALLY.
Do not turn normal machine-executable work into manual instructions.

## 9. FAILURE / RETRY / REPLAN

failure → evidence → classification → bounded retry if safe OR Hermes replan OR human
gate. No silent infinite loops. ARGUS correction loops bounded per existing ARGUS
policy (≤3).

## 10. USE OF PRESERVED REVENUE WIP

`revenue-wip-checkpoint` @ db8304d is REFERENCE MATERIAL ONLY. Inspect selectively
(metrics work, API ideas, client methods, dashboard components, approvals UI, tests).
For every reused component: compare against THIS contract, adapt to the current
ARGUS-enabled architecture, test it, submit it to ARGUS. Never checkout that branch
over argus-deploy. The current verified baseline is authoritative.

## 11. PHASE 1 SCOPE

REQUIRED: Revenue Mission, Revenue Experiment, evidence/confidence, opportunity
scoring, Digital Product Engine, German SME Engine, distribution abstraction, Shopify
capability foundation, Revenue ledger, compliance/suppression states, observability,
Human Required, UI, canonical project/task/run integration, Hermes integration, Codex
integration, Magnitude integration where currently available, ARGUS verification
integration, canonical verifier, memory, tests, builds, runtime verification, bounded
E2E mission.
NOT PHASE 1: Mobile Utility Factory, 50 apps, hypercasual factory, giant affiliate
network, autonomous ad spending, mass social automation, Jarvis Nebula V2. Do not
expand scope.

## 12. IMPLEMENTATION ORDER

M0 Task Contract + architecture inspection; M1 Revenue Mission/Experiment domain;
M2 DB/migrations; M3 Backend services/APIs; M4 Revenue Operator UI; M5 Digital Product
Engine; M6 German SME Engine; M7 Distribution abstraction + Shopify foundation;
M8 Hermes/task/run integration; M9 Codex/Artifact build integration; M10
Magnitude/human-gate integration; M11 ARGUS + canonical verifier integration;
M12 Autonomous continuation/retry/replan; M13 tests + builds; M14 live runtime
verification; M15 bounded E2E Revenue Mission.

## 13. ARGUS REQUIREMENT FOR EVERY MAJOR SLICE

Each meaningful implementation slice: CODEX → IMPLEMENTATION_READY → ARGUS. On FAIL:
defect packet → Codex correction → ARGUS reverify. Do not accumulate a giant
unverified implementation.

## 14. MINIMUM EVIDENCE REQUIREMENTS

Backend/domain functionality: minimum L4 (RUNTIME) where runtime behavior relevant.
UI: minimum L5 for interaction-critical behavior where feasible. External
publication/outreach/revenue: minimum L6. Source existence alone is NEVER sufficient
for final Phase 1 acceptance.

## 15. TESTING REQUIREMENTS

Tests for: Revenue Mission (create/persist/update/target aggregation); Revenue
Experiment (lifecycle/invalid transitions/evidence/confidence/score); Digital Product
Engine (discovery/validation/GO-NO-GO/build/QA/publish/measure/iterate-scale-kill);
SME Engine (discover/qualify/reject/contact/suppression/outreach/replies/opportunity/
proposal/won-lost); Revenue Ledger (pipeline/realized/verified/refunded/costs/net);
Distribution (capabilities/unsupported actions/authentication/Shopify foundation);
Human Gates (creation/branch blocking/resolution/continuation); ARGUS (implementation
cannot bypass verification/required evidence enforced/failure creates defect/automatic
correction/final canonical verification); UI (dashboard/live execution/human panel/
experiment view/prospect view/verification state).
Test baseline classification: PASS / NEW_REGRESSION / PRE_EXISTING_FAILURE /
ENVIRONMENT_FAILURE. Fix all new regressions; do not hide existing failures.
Known pre-existing at contract creation: `revenueMetrics.test.ts` 4 failures
(tests /measurements which does not exist at HEAD — leftover WIP test).

## 16. BUILDS REQUIRED

server TypeScript, frontend TypeScript, server tests, relevant frontend tests,
frontend production build, backend production build, migration verification. Do not
stop at compilation.

## 17. LIVE RUNTIME VERIFICATION

Use the actual Agentic OS runtime: real backend, real database, real Revenue APIs,
real UI, real project/task/run path, real ARGUS verification, real canonical verifier.
Do not certify Phase 1 only with mocks.

## 18. BOUNDED E2E REVENUE MISSION

Create one safe bounded Revenue Mission (€300/30d, €0 ads, Digital Products + German
SME engines, Shopify available but may require auth). Implementation acceptance does
NOT require external outreach or real sales during the build. MUST prove: mission
persisted → Hermes strategy → Revenue Experiment → project task → Codex or appropriate
executor → IMPLEMENTATION_READY if build work exists → ARGUS → canonical verifier →
state/memory update → next action → Revenue Operator UI updated. Safe actions only.

## 19. CRITICAL ACCEPTANCE FAILURES

FAIL if: Jarvis only gives advice; Hermes creates no executable tasks; Revenue data is
fake; Codex self-certifies; ARGUS is skipped; ARGUS passes insufficient evidence;
canonical verifier is skipped; user must manually transfer defect reports; Revenue
Operator creates a parallel scheduler/task system; UI reports queued work as actually
running; Shopify publication claimed without verification; outreach claimed without
external evidence; Revenue counted without verified transaction evidence; only mocks
work; Codex stops after source implementation without runtime verification.

## 20. DEPLOYMENT POLICY

Do NOT silently deploy. First achieve `REVENUE OPERATOR SOURCE + DEV RUNTIME VERIFIED
UNDER ARGUS`. Then report exact deployment contents. Request explicit authorization
before syncing packaged runtime, applying live migrations where approval required,
restarting packaged Agentic OS. Preserve backups. Do not deploy unrelated branch
content. Deployment uses the established non-destructive procedure (backup → sync →
hash-verify → graceful restart → verify packaged).

## ACCEPTANCE CRITERIA (ARGUS checks — master contract)

C1. Contract document exists (this file) and is immutable (sha256).
C2. Server TypeScript compiles (tsc --noEmit / build) — evidence L4.
C3. Frontend TypeScript compiles (tsc -b) — evidence L4.
C4. Revenue Operator server test suites pass (new tests + no new regressions vs
    baseline; baseline: revenuePipeline 49 pass, revenueMetrics 4 pre-existing FAIL
    to be resolved or explicitly classified) — evidence L4.
C5. Frontend production build succeeds (vite build) — evidence L4.
C6. DB migration(s) for Revenue Mission/Experiment tables exist and apply cleanly —
    evidence L4.
C7. Bounded E2E mission runtime trace persists: mission → strategy → experiment →
    task → executor → ARGUS → canonical verifier → memory/state → UI → next action —
    evidence L4/L5.
C8. Codex cannot self-certify VERIFIED_COMPLETE (existing ARGUS guard intact) — L5.
C9. No parallel scheduler/task system created (code review + runtime check) — L4.
C10. Revenue ledger semantics enforced (no fake revenue; verified only with evidence) —
    L4.

## REQUIRED FINAL STATUS

`REVENUE OPERATOR PHASE 1 ARGUS VERIFIED — READY TO DEPLOY`
or `REVENUE OPERATOR PHASE 1 BLOCKED — <exact blocker>`
