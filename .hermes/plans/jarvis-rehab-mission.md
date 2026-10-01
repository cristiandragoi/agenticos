# Jarvis Rehabilitation — Mission State

Supervisor: Hermes · Implementation worker: Codex CLI 0.153.4 · Independent verifier: Argus (`server/src/domains/selfHeal/*`, `/api/argus/*`) · Self-heal: existing `SelfHealSupervisor` (bounded, 3 cycles).

**Objective:** Jarvis is a continuous operational assistant, not a per-utterance command parser.
Lifecycle: HEAR → UNDERSTAND → USE CONTEXT → RESOLVE ENTITY+GOAL → READ/ACT/DELEGATE → VERIFY → STORE → RESPOND NATURALLY → CONTINUE.

## Current state

| Field | Value |
|---|---|
| Phase | **A complete**, **B complete (navigation/browser/desktop paths + expression guard)**, **C complete (anti-parrot + interruption mechanism)**, D–L not started |
| Build | **`d14253df-dirty-20260918-191855` — built, hash-deployed, running healthy** |
| Rollback point | git worktree at `d14253df` (dirty) — pre-change artifacts under `resources/server/dist.bak-server-*` |
| Corpus | `.hermes/plans/jarvis-conversation-corpus.json` (12 chains) + deterministic runner `server/src/__tests__/jarvisConversationCorpus.test.ts` + **live runner `scripts/jarvis-corpus-live.py`** |
| Focused suites | 6 suites / **68 tests pass** (`conversationalState`, `conversationalRecovery`, `activeProjectTruth`, `jarvisTruthAndLanguageRegression`, `truthfulDelegationAndFreeCash`, `jarvisConversationCorpus`) |
| Live corpus | **PASS 7 / 0 failed / 5 skipped-live** on `191855` → `.hermes/plans/jarvis-corpus-live-results.json` |

## Defect registry

| ID | Defect | Phase | Status | Evidence |
|---|---|---|---|---|
| D1 | Low-confidence speech discarded an utterance that carried entity+action | A/F6 | **CLOSED** | `composeGoalFromPartialSpeech`; corpus chain11; live: `…start the free cash project` conf 0.39 → composed |
| D2 | A failed project operation destroyed the failure context and the referent | A/F2 | **CLOSED** | `applyTurnResultToFocus` retains referent, records `lastFailureReason`; live: `Why not?` → "…because there is currently no runnable task in that project." |
| D3 | Short follow-ups treated as new commands (no pronoun/ellipsis continuation) | A/F4 | **CLOSED** | corpus chain2; live: `Check its status.` → Free Cash read |
| D4 | Read/status follow-ups not understood | A/F7 | **CLOSED** | `actionVerbOf` read vocabulary; live: `What does it need?` → Free Cash read |
| D5 | Action not carried when only the entity changed | A/F4 | **CLOSED** | corpus chain4; live: `Now TikTok Shop.` → `open TikTok Shop` |
| D6 | Named browser target silently reduced to the platform root | A/F4 | **CLOSED** | target-preservation guard; corpus chain5 |
| D7 | A bare "Yes." guessed the action on a multi-choice question | A/F5 | **CLOSED** | `clarificationType`; corpus chains 6+7 |
| D8 | No retry path after a recorded failure | A/F3 | **CLOSED** | meta-retry; corpus chain8 |
| D9 | No honest answer when no failure reason was recorded | A/F3 | **CLOSED** | corpus chain9 |
| D10 | Interruption: stale/queued speech after "stop/shut up" | C | **CLOSED (mechanism) / mic pending** | `jarvisNextAgent.ts:667-671` STOP → `interruptAssistantPlayout()` bumps `currentAssistantPlayoutId` (invalidates queued chunks). Live: the typed stop turn ends the stream with a `thinking` status, **no router entry and no speech** — cancels rather than answering. TTS-cancel itself needs a mic session. |
| D11 | Unverified success wording (`X is open.`) on navigation/browser/desktop paths | B/E | **CLOSED** | `desktopExecutor` output gated on `res.success`; `turnRouter.finish()` fallbacks gated on `r.verified`; wording natural (`I've opened X.`) |
| D20 | OBSERVATION: typed `stop` turns terminate the stream before the router (no text at all) | C | **BY DESIGN (verify at mic)** | log: `stream request accepted → thinking → (end)`, no `TURN_ROUTER_ENTERED` |
| D21 | **Internal entity id leaked into speech** (`I could not start work on proj-free-cash`) | B | **CLOSED** | found by corpus hardening; fixed by `humaniseEntityName()` guard in the expression layer + `preferHumanName()` at the call site |
| D12 | Repeated identical clarification | C | **CLOSED** | narrowing on attempt 2; corpus chain12 |
| D13 | OBSERVATION: pending-clarification TTL is 3 min, so a long pause loses *question binding* (meta/pronoun paths still work from recorded state) | A | **OPEN (low)** | `PENDING_TTL_MS`; not user-visible in tests |
| D14 | OPEN: `open X` reports "the project view didn't open" — real UI-route gap behind navigation | E/J | **OPEN** | live: "I found Shopify and made it the active project, but the project view didn't open." |
| D15 | OPEN: no real delegation state wired to OperationalController/Codex | F | **NOT STARTED** | — |
| D16 | OPEN: project-intelligence synthesis (Phase I) | I | **NOT STARTED** | — |
| D17 | OPEN: internal AgenticOS browser (Phase J) | J | **NOT STARTED** | — |
| D18 | OPEN: alias/spelling learning (Phase K) | K | **NOT STARTED** | — |
| D19 | OPEN: durable memory (Phase L) | L | **NOT STARTED** | — |
| D22 | **BROWSER: navigation reported as task completion; no page interaction at all.** Jarvis opened YouTube, matched the host, and answered *"I've opened YouTube."* while a Google cookie-consent dialog still covered the page — after the user asked for a **click**. Second site of the same defect: `browserExecutor.executeWorkflow` advertised `'search' \| 'click' \| 'type'` but only implemented `search`; a requested click/type fell through to `return { success: true, output: navOutcome.spokenText }`, i.e. **a click request was silently answered with the navigation message**. | J | **CLOSED (mechanism) / live YouTube acceptance pending** | Code: `browserOperator.ts` returned `spokenText: "I've opened ${displayName}."` on host-match alone (`browserExecutor.ts` old lines ~110–114 held the silent-success fallthrough). Fixed by the Browser Action Contract: `browserActionContract.ts` + `browserPageInspection.ts` + rewritten `browserOperator.ts`/`browserExecutor.ts`; `semanticGoalParser.ts` now routes click/type page-interaction intents to the browser. Suites: `browserActionContract.test.ts` (pure rules) + `browserInteractionContract.test.ts` (real headless Chromium against a consent fixture). |

## Required browser loop (permanent invariant — added with D22)

Browser actions must follow this sequence. Navigation alone is **never** task completion while a blocking page state prevents the requested goal:

```
UNDERSTAND GOAL
→ NAVIGATE
→ INSPECT ACTUAL PAGE STATE
→ IDENTIFY VISIBLE BLOCKERS / CONTROLS
→ PERFORM USER-AUTHORIZED ACTION
→ VERIFY DOM/PAGE STATE CHANGED
→ CONTINUE ORIGINAL GOAL
→ REPORT RESULT
```

**Required capabilities** (implemented in `browserActionContract.ts` + `browserPageInspection.ts`): inspect current URL · inspect page title · inspect visible interactive elements · find buttons by visible text / accessible name · click · type · press Enter · scroll · wait for page transition · detect dialogs/modals · detect login screens · verify element disappeared/appeared · verify requested target loaded. DOM/accessibility identity is preferred; coordinates are a documented last resort only.

**Consent boundary (non-negotiable).** Cookie/privacy choices are the user's decision. Jarvis must not silently choose *Accept all* vs *Reject all* unless (a) the user explicitly said which one in that turn, or (b) a stored per-domain preference authorizes it — `google.com` / `youtube.com`: `cookieConsentPreference = accept_all | reject_optional | ask`. The preference is never inferred from unrelated conversations. Default is `ask`.

**Goal continuation.** After clearing a blocking dialog Jarvis must return to the ORIGINAL browser goal and must not stop after merely clearing the modal.

**Conversational correction.** "No, that's the Google screen. Accept it and continue." / "Click accept all." / "That's not what I wanted." / "Continue to YouTube." resolve against the CURRENT browser state and the PREVIOUS browser goal — never resetting to "What would you like me to do with browser?".

**Browser state kept across turns** (`browserStateStore`): `lastBrowserGoal` · `lastBrowserUrl` · `lastBrowserTitle` · `lastBrowserAction` · `lastBrowserResult` · `blockingDialog` · `pendingBrowserAction` · `visibleTarget` · `verificationState` (+ `blockedReason`).

**Verification.** A click requires the evidence chain BUTTON FOUND → CLICK SENT → ELEMENT/DIALOG STATE CHANGED → TARGET PAGE USABLE. "I clicked it" without verification is forbidden.

**Metrics.** `browser_action_requested` · `browser_action_verified` · `browser_action_failed` · `browser_blocker_detected` · `browser_blocker_resolved` · `browser_context_lost`.

**Planned stability regression.** Repeated navigation when a click was requested must open a stability regression automatically.

## Acceptance matrix (must all hold before "repaired")

| Criterion | Status |
|---|---|
| server TypeScript clean | ✅ `tsc --noEmit` exit 0 |
| Focused regressions pass | ✅ 5 suites + corpus |
| Existing verification gates pass | ✅ `npm run verify:fast` LEVEL 1 (15/15 suites) |
| Build passes | ✅ `d14253df-dirty-20260918-191855` |
| Hash-verified deployment | ✅ `deploy-server-artifact.cjs` → `RESULT: OK` |
| Runtime health confirms deployed buildId | ✅ `/api/health` = `…-191855`, `healthy` |
| Argus runtime verification | ⏳ **NOT yet executed** — Argus verifies *goals/contracts* (`POST /api/argus/contracts` needs a goalId), so it requires an implementation-goal run; the live corpus observation was made by an independent HTTP client instead |
| Live conversational acceptance | ✅ typed: live corpus PASS 7/0/5 + chains 1–4 earlier; ⏳ microphone chains |
| No success-without-verification | ✅ (D11 closed; navigate/browser/desktop gated) |
| No repeated generic clarification loops | ✅ (D12) |
| Continuation across short follow-ups | ✅ (chains 2,3,5,7,8,12) |
| Real delegation state | ❌ Phase F not started |
| Natural responses | 🟡 operate/navigate paths natural; remaining mechanical sites tracked |

## Runtime log

| When | buildId | Note |
|---|---|---|
| Phase A deploy | `…-185839` | live chains 1–4 pass; `Why not?` explains the real reason |
| Phase B/C + corpus | `…-191539` | wording/verified-gating; corpus live 6/1 (stop fixture wrong) |
| **Phase B/E hardening** | **`…-191855`** | D21 id-leak closed; **live corpus PASS 7/0/5**; `verify:fast` LEVEL 1; lint 0 new |

## Next actions (supervisor)

1. **Phase F (real delegation)** — highest remaining functional gap: wire `Start working on Free Cash` → OperationalController/Supervisor → real worker state (queued/waiting/active/finished/failed/blocked) with evidence gating. To be implemented by **Codex** against a tight spec, verified by me + corpus.
2. **D14** (navigate → project view doesn't open) — sits under Phase F and Phase J; diagnose the UI route before the internal browser work.
3. **Argus contract verification** — create the implementation goal + contract so Argus independently verifies a corpus artifact.
4. **External architecture review** (LangGraph.js / OpenHands SDK / OpenAI Agents SDK JS) — evaluation table only, no migration, no installs.
5. Phases D (language/STT context), I (project intelligence), J (internal browser), K (aliases), L (durable memory) remain.
