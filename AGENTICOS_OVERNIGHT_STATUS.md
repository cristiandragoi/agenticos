# AGENTICOS OVERNIGHT STATUS

Updated continuously. Resume point for any session.

## CURRENT PHASE
Phase 0 COMPLETE — Jarvis Live UX GREEN. Next: Project Workspace V2 (Board first).

## PHASE 0 — VERIFIED (2026-08-11)
- [x] Collapsible lower dock: CSS added (workspaceCollapsed/composerCollapsed/dockToggle/liveWork*), acceptance PASS:
      EXPANDED ws=202px stage=286px composer=137px → COLLAPSED ws=50px stage=390px composer=none →
      RE-EXPANDED restores. DRAFT "DRAFT-SURVIVES" survived collapse AND re-expand. Toggle in top status lane.
- [x] Humanoid head: shape isHeadLike=true (aspect 1.17, widest 0.48, chin 0.73), sync-first-frame draws even when
      rAF throttled (alphaMax 255, lit 26774). 12 semantic states → spec colors (unit tests 2/2 + 1/1).
- [x] Runtime-state truth: idle→delegated→idle via real task/cancel; stale queued task no longer pins (recency+project scoping).
- [x] Live Work on Jarvis page: panel present; real events shown (board_linked, created, cancelled; AGENT=Research,
      STATUS=1 active, badge DELEGATED); no token noise.
- [x] Voice code path: TTS request fired (/voice/tts, aura-helios-en), [VoiceDiag] synthesis OK → playAudio,
      Voice Trace "6/6 stages ok", zero MEDIA_ELEMENT errors. PHYSICAL AUDIO NOT VERIFIED (headless; code path verified).
- [x] Voice control surface: VOICE ON/OFF toggle changes state; MIC, mode buttons, primary control present.

## FILES CHANGED (cumulative this overnight)
- src/pages/JarvisStudio.tsx — live-events poll + Live Work panel JSX + dock state/toggle + runtime poll
- src/pages/JarvisCommandCenter.module.css — workspaceCollapsed, composerCollapsed, dockToggle, liveWork* styles
- src/components/jarvis/JarvisCore.tsx — humanoid head (prior session, verified)
- server/src/routers/jarvis.ts — runtime-state truth (prior), revenue projectId (prior)
- server/src/domains/jarvis/orchestrator.ts — handleHermes projectId (prior)
- src/pages/ProjectsPage.tsx, src/store/projectStore.tsx — refresh (prior)
- tests: src/__tests__/JarvisCoreHead.test.tsx, JarvisCoreColor.test.tsx, MissionControlJarvis.test.tsx (prior)

## TESTS/BUILDS
- frontend tsc PASS, frontend build PASS, server tsc PASS, server build PASS
- vitest: 77/77 (layout, head, color, mission-control, voice, gateway)

## NEXT EXACT ACTION
Phase 1 — Project Workspace V2: extend ProjectsPage with top-level workspace tabs:
OVERVIEW / BOARD / LIVE WORK / AGENTS / KNOWLEDGE / ARTIFACTS / FILES / RUNS / GRAPH.
Start with BOARD (Phase 2) — real background-task cards grouped by status, project-scoped.

## BLOCKERS
- Electron CDP window rAF throttled when unfocused → live pixel-color transitions not observable; unit tests + data-orb-state prove mapping
- PHYSICAL AUDIO cannot be verified headless (code path verified)

## TEST-FIXTURE RULE
Acceptance projects named `TEST-*`, deleted after acceptance, never left in normal Projects UI (user explicit).
