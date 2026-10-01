# AgenticOS — Read-Only Evidence Package

Prepared for independent architecture review (Claude Sonnet). READ-ONLY: no source file was modified in producing this bundle.

- Repository: `D:\AgenticOS`
- Branch: `hermes-rescue-20260908`
- Generated: 2026-09-30T21:43:45+02:00
- Base revision: `8f7463a` (HEAD)

## 1. Repository state

### 1.1 `git status --short` (exact stdout)

```
 M electron/main.ts
 M electron/processOwnership.ts
 M server/scripts/desktop_perception.ps1
 M server/scripts/piper_tts.py
 M server/src/domains/controlPlane/ActionClaimGuard.ts
 M server/src/domains/controlPlane/ArgusService.ts
 M server/src/domains/controlPlane/AutonomousRecoveryEngine.ts
 M server/src/domains/controlPlane/CapabilityDiscovery.ts
 M server/src/domains/controlPlane/ControlPlaneExecutor.ts
 M server/src/domains/controlPlane/ControlPlaneTurnHandler.ts
 M server/src/domains/controlPlane/EngineeringWorkerRegistry.ts
 M server/src/domains/controlPlane/GoalLifecycle.ts
 M server/src/domains/controlPlane/UniversalVerifier.ts
 M server/src/domains/controlPlane/WindowsApplicationResolver.ts
 M server/src/domains/controlPlane/types.ts
 M server/src/domains/conversations/service.ts
 M server/src/domains/jarvis/conversationLanguage.ts
 M server/src/domains/jarvis/execution/executors/desktopExecutor.ts
 M server/src/domains/jarvis/execution/universalExecutionController.ts
 M server/src/domains/jarvis/intentRouter.ts
 M server/src/domains/jarvis/investigation.ts
 M server/src/domains/jarvis/orchestrator.ts
 M server/src/domains/jarvis/supervisorTools.ts
 M server/src/domains/jarvisNext/jarvisNextAgent.ts
 M server/src/domains/jarvisNext/speechArbiter.ts
 M server/src/domains/jarvisNext/turnRouter.ts
 M server/src/index.ts
 M server/src/routers/backgroundTasks.ts
 M server/src/routers/controlPlaneRouter.ts
 M server/src/routers/jarvis.ts
 M server/src/routers/system.ts
 M server/src/routers/voice.ts
 M server/src/services/agent/toolLoader.ts
 M server/src/services/backgroundTasks/adapters.ts
 M server/src/services/backgroundTasks/antigravityAdapter.ts
 M server/src/services/backgroundTasks/manager.ts
 M server/src/services/backgroundTasks/store.ts
 M server/src/services/gateway/secretStore.ts
 M server/src/services/perception/CameraPerceptionService.ts
 M server/src/services/perception/DesktopPerceptionService.ts
 M server/src/services/projectExecution/resultProvenance.ts
 M server/src/services/voice/localTranscribe.ts
 M server/src/services/voice/localTts.ts
 M server/tsconfig.json
 M src/App.tsx
 M src/components/jarvis/JarvisChat.tsx
 M src/components/jarvis/JarvisNeuralBlob.tsx
 M src/components/jarvis/JarvisOrb.tsx
 M src/components/layout/LeftRail.tsx
 M src/components/ui/JarvisOrb.tsx
 M src/hooks/useVoiceIO.ts
 M src/pages/JarvisStudio.tsx
 M src/pages/SettingsPage.tsx
?? $null
?? .agentic/
?? .agents/agents/
?? .agents/plugins/
?? .agents/rules/agenticos-completion-verification.md
?? .agents/rules/hermes-autonomous-engineering-orchestrator.md
?? .agents/skills/
?? .hermes/continuation_test.ts
?? .hermes/environment.json
?? .hermes/plans/2026-09-17_213843-free-cash-finance-automation.md
?? .hermes/plans/2026-09-17_213918-free-cash-finance-automation-workflow.md
?? .hermes/plans/2026-09-17_214017-free-cash-finance-automation-workflow.md
?? .hermes/plans/2026-09-20_211601-free-cash-finance-automation-workflow-plan.md
?? .hermes/plans/2026-09-20_213100-free-cash-finance-automation-workflow-plan-grounded.md
?? .hermes/plans/2026-09-20_213245-free-cash-finance-automation-workflow-plan.md
?? .hermes/plans/2026-09-30_205230-free-cash-finance-automation-workflow-plan.md
?? .hermes/plans/freecash-monitor/
?? .hermes/plans/jarvis-conversation-corpus.json
?? .hermes/plans/jarvis-corpus-live-results.json
?? .hermes/plans/jarvis-rehab-mission.md
?? .hermes/runtime_trace/
?? .lcp-bench/
?? .tmp-aspect-probe2.err
?? .tmp-aspect-probe2.json
?? .tmp-coreshape.err
?? .tmp-coreshape.json
?? .tmp-fcplan-root.txt
?? .tmp-shots/
?? ACCEPTANCE_HARNESS_AUDIT.md
?? ACOUSTIC_ROBUSTNESS_REPORT.md
?? AUTONOMOUS_CAPABILITY_AUDIT.md
?? CONVERSATIONAL_SOAK_REPORT.md
?? CORE-002B_FINAL_SUMMARY.md
?? CORE-002C_RESULT.md
?? CORE-002D_RESULT.md
?? CORE-002D_RESULT_FINAL.md
?? CORE-002E_FINAL_REPORT.md
?? CORE-002E_FIX_PLAN.md
?? CORE-002E_REPORT_RAW.md
?? CURRENT_ARCHITECTURE.md
?? "Claude Setup.exe"
?? DAILY_MONITORING_DESIGN_SUMMARY.md
?? DUPLICATED_PIPELINES.md
?? EXECUTION_SAFETY_REPORT.md
?? EXECUTOR_LIVE_MATRIX.md
?? FAILURE_TO_REPAIR_TRACE.md
?? FALSE_POSITIVE_ANALYSIS.md
?? FINAL_INPUT_PROVENANCE_AUDIT.md
?? HUMAN_VOICE_ACCEPTANCE.md
?? JARVIS-RUNTIME-003_ACCEPTANCE_REPORT.md
?? JARVIS-RUNTIME-003_FINAL_REPORT.md
?? JARVIS-RUNTIME-005A_DIAGNOSTICS_REPORT.md
?? JARVIS_FINAL.py
?? JARVIS_REPORT.py
?? LIVE_TURN_TRACE.md
?? PROJECT_INTELLIGENCE_DATA_FLOW.md
?? RECOMMENDED_ARCHITECTURE.md
?? REVISED_ACCEPTANCE_CRITERIA.md
?? ROOT_CAUSE_REPORT.md
?? SELF_HEAL_WIRING_AUDIT.md
?? STOP_STRESS_REPORT.md
?? Untitled_Document_2026-09-28.docx
?? Untitled_Document_2026-09-28_1.docx
?? artifacts/
?? backups/jarvis-audio-20260915-121948/
?? backups/jarvis-audio-quality-20260915-133536/
?? backups/jarvis-grounding-20260915-195141/
?? codex_matches.json
?? compression_instrumentation.py
?? config/
?? continuer.py
?? create_docx.py
?? daily-status-monitoring-specification.md
?? data/artifacts/
?? data/camera_frames/
?? data/freecash-monitor/
?? data/jarvis-live-perception-repair.md
?? data/repair-summary.json
?? data/screenshots/
?? data/selfheal-audit.jsonl
?? data/voice_turns/
?? database.sqlite
?? design_doc.json
?? desktop-screenshot.png
?? digital-product-opportunity.md
?? digital-products/
?? digital_products/
?? docs/acceptance/browser-acceptance-evidence.json
?? docs/acceptance/cross_turn_gui_report.json
?? docs/acceptance/live-perception-evidence.json
?? docs/acceptance/open_capability_gui_report.json
?? docs/acceptance/operational_matrix_report.json
?? docs/acceptance/screenshots/cross_turn_acceptance/
?? docs/acceptance/screenshots/open_capability/
?? docs/acceptance/screenshots/operational_matrix/
?? docs/acceptance/verified-contract-acceptance-evidence.json
?? docs/acceptance/voicestudio-production-evidence.json
?? docs/free-cash-finance-automation-workflow-plan.md
?? docs/free-cash-monitor-routine/
?? docs/freecash-automation-workflow-plan-v2.md
?? docs/freecash-daily-monitor-delegation-plan.md
?? docs/freecash-daily-monitor-research-plan-v2.md
?? docs/freecash-daily-monitor-routine.md
?? docs/freecash-monitor-audit-evidence.md
?? docs/freecash-monitor-research-plan.md
?? docs/freecash-monitor-workflow-plan.md
?? docs/freecash-monitoring.md
?? docs/multi-agent-orchestration-roadmap-2026-09-20.md
?? docs/research-workflows/
?? docs/shopify-channel-verification-2026-09-20-r3.json
?? docs/shopify-channel-verification-2026-09-20-r3.md
?? docs/shopify-channel-verification-2026-09-20-rerun.json
?? docs/shopify-channel-verification-2026-09-20-rerun.md
?? docs/shopify-channel-verification-2026-09-20.json
?? docs/shopify-channel-verification-2026-09-20.md
?? docs/shopify-channel-verification-2026-09-20T1937Z.md
?? docs/shopify-channel-verification-2026-09-21-r5.json
?? docs/shopify-channel-verification-2026-09-21-r5.md
?? docs/shopify-channel-verification-2026-09-21-r6.json
?? docs/shopify-channel-verification-2026-09-21-r6.md
?? docs/shopify-channel-verification-2026-09-21T1837Z.json
?? docs/shopify-channel-verification-2026-09-21T1837Z.md
?? docs/shopify-channel-verification-2026-09-30.json
?? docs/shopify-channel-verification-2026-09-30.md
?? erver
?? evidence/
?? external/
?? finance-monitor/
?? finance_monitor_plan.json
?? free-cash-automation-workflow.md
?? free-cash-finance-monitoring-specification.md
?? free-cash-finance_monitoring_plan.md
?? gen_wav.ps1
?? gui_probe.png
?? hello_world.txt
?? hermes-debug-report.txt
?? hermes-debug/
?? hermes_test.png
?? hg_llms.txt
?? inject_trace.py
?? injection_trace.py
?? inspect_dbs_real.cjs
?? instrument_continuation.py
?? live_physical_trace_results.json
?? monitoring/
?? nul
?? orb_probe.cjs
?? output/
?? probe3-orb-1280x800.png
?? probe3-orb-1600x900.png
?? probe3-orb-1920x1080.png
?? probe4-orb-1280x800.png
?? probe4-orb-1600x900.png
?? probe4-orb-1920x1080.png
?? probe4-orb-900x900.png
?? probe5-orb-1024x768_dpr1.png
?? probe5-orb-1400x1000_dpr1.png
?? probe5-orb-1600x900_dpr1.25.png
?? probe5-orb-1600x900_dpr1.png
?? probe5-orb-1920x1080_dpr1.png
?? probe5-orb-2560x1440_dpr1.png
?? probe5.json
?? projects/
?? public/index.html
?? query_incidents.cjs
?? report_hermes_continuation_001.txt
?? research/
?? resources/
?? restart_agenticos.ps1
?? review_bundle.md
?? run_acceptance_suite.js
?? run_blocker_acceptance_suite.js
?? runtime/
?? scratch_check_db.cjs
?? scratch_debug_enum.cjs
?? scratch_debug_enum2.cjs
?? scratch_debug_enum4.cjs
?? scratch_enum_details.cjs
?? scratch_enum_details.ps1
?? scratch_freecash_earn.png
?? scratch_get_wpid.cjs
?? scratch_inspect_9223.cjs
?? scratch_inspect_windows.cjs
?? scratch_inspect_windows.js
?? scratch_probe_freecash.cjs
?? scratch_test_helper.cjs
?? scratch_test_launch.cjs
?? script_schedule_spec.json
?? scripts/__pycache__/
?? scripts/_temp_list_win.ps1
?? scripts/acceptance-live-perception.mjs
?? scripts/acceptance-voicestudio-production.mjs
?? scripts/approval_gate.py
?? scripts/audit-action-timing.cjs
?? scripts/benchmark-models.mjs
?? scripts/capture-screen.cjs
?? scripts/capture_desktop.ps1
?? scripts/cdp-live-test.cjs
?? scripts/check-audio.ps1
?? scripts/check-blob-layout.cjs
?? scripts/check-logs.cjs
?? scripts/check-runtime-procs.ps1
?? scripts/check_agenticos_windows.ps1
?? scripts/check_openrouter_key.ts
?? scripts/check_pid_windows.ps1
?? scripts/check_pro_error.ts
?? scripts/check_pro_tokens.ts
?? scripts/check_procs_desktop.ps1
?? scripts/check_winsta.ps1
?? scripts/create-free-cash-fina.mjs
?? scripts/debug_chrome_tree.js
?? scripts/debug_enum.ps1
?? scripts/deploy-freecash-build.cjs
?? scripts/deploy-installed.cjs
?? scripts/deploy-server-artifact.cjs
?? scripts/detect_windows.ps1
?? scripts/diag_all_chrome.ps1
?? scripts/diagnose-launch.cjs
?? scripts/diagnose_installed_voice.mjs
?? scripts/diagnose_windows.ps1
?? scripts/enum_chrome_class.ps1
?? scripts/enum_direct.ps1
?? scripts/enum_threads.ps1
?? scripts/finance_monitor.py
?? scripts/find-math-turns.cjs
?? scripts/find-recent-wavs.cjs
?? scripts/find-traces.cjs
?? scripts/find_bounds.ps1
?? scripts/find_logs.ps1
?? scripts/find_windows.ts
?? scripts/inspect-electron.cjs
?? scripts/inspect-opportunity.js
?? scripts/inspect-opportunity.mjs
?? scripts/inspect-production-state.cjs
?? scripts/inspect-turns-12-14.cjs
?? scripts/inspect_browser_state.ts
?? scripts/inspect_chrome_hwnds.ts
?? scripts/inspect_comet.cjs
?? scripts/inspect_current_page.cjs
?? scripts/inspect_freecash_task.ts
?? scripts/inspect_single_hwnd.ps1
?? scripts/investigate_visibility.ts
?? scripts/jarvis-core-shape-probe.mjs
?? scripts/jarvis-core-shots.mjs
?? scripts/jarvis-corpus-live.py
?? scripts/jarvis-nav-live.py
?? scripts/jarvis-orb-aspect-probe.mjs
?? scripts/jarvis-orb-aspect-probe2.mjs
?? scripts/jarvis-orb-aspect-probe3.mjs
?? scripts/jarvis-orb-aspect-probe4.mjs
?? scripts/jarvis-orb-aspect-probe5.mjs
?? scripts/jarvis-orb-visual-probe.mjs
?? scripts/launch-and-verify-installed-app.cjs
?? scripts/launch-detached.ps1
?? scripts/launch-installed.cjs
?? scripts/launch_chrome_daemon.ts
?? scripts/list-opportunities.mjs
?? scripts/list-windows.ps1
?? scripts/list_chromes.ps1
?? scripts/list_windows.js
?? scripts/list_windows.ps1
?? scripts/make_freecash_check.py
?? scripts/monitoring/
?? scripts/notification_service.py
?? scripts/play-sample.ps1
?? scripts/probe-db.mjs
?? scripts/probe-db.py
?? scripts/probe_browser_identity.ts
?? scripts/probe_gui_state.ts
?? scripts/probe_openrouter_mimo.ts
?? scripts/probe_runtime_models.ts
?? scripts/purge_poisoned_knowledge.cjs
?? scripts/qualify-acoustic-robustness.cjs
?? scripts/qualify-all-10.cjs
?? scripts/qualify-concrete-failures.cjs
?? scripts/qualify-conversational-soak.cjs
?? scripts/qualify-error-recovery.cjs
?? scripts/qualify-natural-voice.cjs
?? scripts/qualify-physical-audio-stream.cjs
?? scripts/qualify-stop-stress.cjs
?? scripts/read_shortcut.cjs
?? scripts/record-live-human-session.cjs
?? scripts/recover_task_352.ts
?? scripts/reproduce_cold_start.mjs
?? scripts/run-jarvis-runtime-tests.cjs
?? scripts/run-typed-sequence.cjs
?? scripts/run_live_traces.mjs
?? scripts/run_real_acceptance_audit.mjs
?? scripts/search-preserved-failures.cjs
?? scripts/search_maximized_bounds.ps1
?? scripts/speak_physical.ps1
?? scripts/test-audio-pulse.cjs
?? scripts/test-clean-spawn.cjs
?? scripts/test-how-are-you.cjs
?? scripts/test-jarvis-capabilities.cjs
?? scripts/test-live-pipeline.cjs
?? scripts/test-natural-variations.cjs
?? scripts/test-renderer-audio.cjs
?? scripts/test-response.cjs
?? scripts/test-tts-speak.cjs
?? scripts/test-v2-http-e2e.cjs
?? scripts/test-yt-search.cjs
?? scripts/test1_real_silence.cjs
?? scripts/test_browser_open.ts
?? scripts/test_browser_window.mjs
?? scripts/test_cdp_visible_launch.ts
?? scripts/test_cdp_window.ts
?? scripts/test_chrome_hwnd.js
?? scripts/test_chrome_visibility.ts
?? scripts/test_cold_start_installed_app.mjs
?? scripts/test_desktop_launch.ps1
?? scripts/test_desktop_switch.ps1
?? scripts/test_enum_windows.ps1
?? scripts/test_enum_winsta0.ps1
?? scripts/test_find_automation_window.ts
?? scripts/test_find_hwnd.ts
?? scripts/test_foreground.ts
?? scripts/test_foreground_winsta0.ps1
?? scripts/test_hwnd_active.ts
?? scripts/test_inspect_fix.js
?? scripts/test_installed_gui_control.mjs
?? scripts/test_jarvis_mimo_chat.ts
?? scripts/test_launch_and_inspect.js
?? scripts/test_launch_app.ts
?? scripts/test_launch_browser.mjs
?? scripts/test_list_windows.cjs
?? scripts/test_mimo_tools.ts
?? scripts/test_physical_silence.cjs
?? scripts/test_pw_window.ts
?? scripts/test_real_operator.ts
?? scripts/test_title_probe.ts
?? scripts/test_user_launch.ps1
?? scripts/test_visible_state.ts
?? scripts/test_voice_execution_path.ts
?? scripts/test_winact.ps1
?? scripts/tmp-dom-dump.mjs
?? scripts/tmp-jarvis-aspect-measure.cjs
?? scripts/tmp-jarvis-aspect-sweep.cjs
?? scripts/tmp-ring-math.mjs
?? scripts/trace-live-turn.cjs
?? scripts/trace-process-tree.ps1
?? scripts/update_jarvis_db.ts
?? scripts/verified_contract_real_acceptance.mjs
?? scripts/verify-all-real-turns.cjs
?? scripts/verify-cross-turn-gui-acceptance.cjs
?? scripts/verify-final-runtime.cjs
?? scripts/verify-installed-composer-live.cjs
?? scripts/verify-native-antigravity-suite.mjs
?? scripts/verify-open-capability-gui.cjs
?? scripts/verify-operational-matrix.cjs
?? scripts/verify-physical-microphone-live.cjs
?? scripts/verify-real-chat-nav.cjs
?? scripts/verify-real-physical-turn-flow.cjs
?? scripts/verify-real-window-nav.cjs
?? scripts/verify-runtime-source.cjs
?? scripts/verify-semantic-stream-turn-flow.cjs
?? scripts/verify-step1.cjs
?? scripts/verify-voice-authority-suite.mjs
?? scripts/verify_7_turns_human_acceptance.ts
?? scripts/verify_acceptance_tests_a_to_h.ts
?? scripts/verify_gui_natural_multi_turn.ts
?? scripts/verify_jarvis_mimo_full_mission.ts
?? scripts/verify_model_query_acceptance.ts
?? scripts/verify_natural_multi_turn.ts
?? scripts/verify_repeatability_20_cycles.ts
?? scripts/verify_universal_execution.mjs
?? server/=300
?? server/CODING_AGENT_INSPECTIOAN_REPORT.txt
?? server/CODING_AGENT_MVP_INSPECTION.md
?? server/FINAL_PROOF.py
?? server/agenticos.db
?? server/baseline-full-report.json
?? server/benchmark_models.cjs
?? server/data/.restart-intent.json
?? server/data/artifacts/
?? server/data/browserPreferences.json
?? server/data/camera_frames/
?? server/data/campaign_results.json
?? server/data/capability-certification-matrix.json
?? server/data/capability-certification-matrix.md
?? server/data/database.sqlite
?? server/data/freecash-monitor/
?? server/data/revenue-operator/briefings/daily-mission-0dbcfc72--2026-09-05.json
?? server/data/revenue-operator/briefings/daily-mission-3ecb5d0b--2026-09-09.json
?? server/data/revenue-operator/briefings/daily-mission-8f1cdb8b--2026-09-05.json
?? server/data/revenue-operator/paidlikes_auth_check.png
?? server/data/revenue-operator/profiles/
?? server/data/revenue-operator/youtube_auth_check.png
?? server/data/screenshots/
?? server/data/test.jpg
?? server/data/voice_turns/
?? server/drizzle/0024_browser_revenue_operator.sql
?? server/final_ro_synthesis.py
?? server/fix_piper_path.py
?? server/hermes-live-check.ts
?? server/insp_state_machine.py
?? server/jarvis-acceptance.mjs
?? server/jarvis-forensics-projectstate.mjs
?? server/jarvis-forensics-room.mjs
?? server/jarvis-voice-e2e.mjs
?? server/proof_ro_synthesis.py
?? server/run_piper_direct.py
?? server/scratch_check_db.cjs
?? server/scratch_measure_latency.ts
?? server/scripts/WinOcrHelper.cs
?? server/scripts/__pycache__/
?? server/scripts/browser-live-acceptance.ts
?? server/scripts/campaign_runner.cjs
?? server/scripts/capture-console-errors.cjs
?? server/scripts/check-argus-schema.mjs
?? server/scripts/check-audio-devices.cjs
?? server/scripts/check-dock-dom.cjs
?? server/scripts/check-page-reload.cjs
?? server/scripts/check-renderer-voice.cjs
?? server/scripts/check-schema.cjs
?? server/scripts/check_cdp_cookies.ts
?? server/scripts/check_chrome_history.ts
?? server/scripts/check_freecash_session.ts
?? server/scripts/clean-index.js
?? server/scripts/clear_blocked.mjs
?? server/scripts/click_google_login.ts
?? server/scripts/db-table-inventory.mjs
?? server/scripts/debug-failure-stream.cjs
?? server/scripts/debug-show-did.cjs
?? server/scripts/debug-voice-stream.cjs
?? server/scripts/diff-baseline-regressions.mjs
?? server/scripts/dispatch-qbj-24.mjs
?? server/scripts/dump_missions.ts
?? server/scripts/dump_tables.ts
?? server/scripts/enter_google_email.ts
?? server/scripts/execute-recovery-bgtask-24.mjs
?? server/scripts/extract-raw-mp3.cjs
?? server/scripts/find-camera-goal.mjs
?? server/scripts/find-goal.mjs
?? server/scripts/find-tasks.cjs
?? server/scripts/focus_browser.ts
?? server/scripts/focus_password.ts
?? server/scripts/focus_window.ps1
?? server/scripts/freecash-daily-monitor.mjs
?? server/scripts/generate-command-audio.cjs
?? server/scripts/incident-audit.mjs
?? server/scripts/init-revenue.ts
?? server/scripts/inspect-composer.cjs
?? server/scripts/inspect-goal-execution.mjs
?? server/scripts/inspect-incidents.cjs
?? server/scripts/inspect-production-state.mjs
?? server/scripts/inspect_canary_profile.ts
?? server/scripts/inspect_freecash_dashboard.ts
?? server/scripts/inspect_freecash_detail.ts
?? server/scripts/inspect_freecash_earn.ts
?? server/scripts/inspect_freecash_login.ts
?? server/scripts/inspect_freecash_state.ts
?? server/scripts/inspect_freecash_task.ts
?? server/scripts/inspect_google_btn.ts
?? server/scripts/inspect_mission_runs.ts
?? server/scripts/inspect_paidlikes_dom.ts
?? server/scripts/inspect_recent_missions.ts
?? server/scripts/inspect_revenue_state.ts
?? server/scripts/inspect_task_352.ts
?? server/scripts/jarvis-10turn-acceptance.mjs
?? server/scripts/jarvis-voice-nav-live.mjs
?? server/scripts/launch_blank_word_doc.js
?? server/scripts/launch_notepad_hello.ps1
?? server/scripts/list-tables.mjs
?? server/scripts/list_children.ps1
?? server/scripts/list_desktop_windows.ps1
?? server/scripts/list_procs.ps1
?? server/scripts/list_user_procs.ps1
?? server/scripts/migrate-incidents.cjs
?? server/scripts/mission-browser-autonomy.ts
?? server/scripts/notion-modal-cdp.png
?? server/scripts/notion_command.mp3
?? server/scripts/paidlikes_login_bootstrap.ts
?? server/scripts/parse-vitest-json.mjs
?? server/scripts/query-incidents.cjs
?? server/scripts/real_command.mp3
?? server/scripts/recover_task_352.ts
?? server/scripts/reopen-task-24.mjs
?? server/scripts/resume-real-incidents.mjs
?? server/scripts/run-action-runtime-tests.cjs
?? server/scripts/run-all-10-tests.cjs
?? server/scripts/run_ocr.ps1
?? server/scripts/shopify-channel-verification.mjs
?? server/scripts/shopify-credential-probe.mjs
?? server/scripts/shopify-evidence-drilldown.mjs
?? server/scripts/shopify-inventory-scan.mjs
?? server/scripts/shopify-registry-evidence-rerun.mjs
?? server/scripts/shopify-registry-evidence.mjs
?? server/scripts/shopify-verify-20260930.mjs
?? server/scripts/shopify-verify-r5.mjs
?? server/scripts/smoke-semantic-turn.ts
?? server/scripts/start-revenue-operator.sh
?? server/scripts/take_screenshot.ps1
?? server/scripts/test-a-real-voice.cjs
?? server/scripts/test-a-voice-verified.png
?? server/scripts/test-antigravity-discovery.cjs
?? server/scripts/test-b-failure-verified.png
?? server/scripts/test-b-navigation-failure.cjs
?? server/scripts/test-camera-hardware.mjs
?? server/scripts/test-control-plane-acceptance.mjs
?? server/scripts/test-executors-live.ts
?? server/scripts/test-goal-parser.ts
?? server/scripts/test-live-autonomous-repair-trace.ts
?? server/scripts/test-mic-click.cjs
?? server/scripts/test-notion.cjs
?? server/scripts/test-production-acceptance-5tests.mjs
?? server/scripts/test-reconciler-draft.mjs
?? server/scripts/test-renderer-audio.cjs
?? server/scripts/test-selfheal-acceptance.mjs
?? server/scripts/test-selfheal-closedloop.mjs
?? server/scripts/test-send.cjs
?? server/scripts/test-transcribe.cjs
?? server/scripts/test-voice-acoustic.cjs
?? server/scripts/test-whisper-transcript.cjs
?? server/scripts/test-worker-lifecycle.mjs
?? server/scripts/test2-notion-template-open.png
?? server/scripts/test_acceptance_screenshot.js
?? server/scripts/test_acceptance_word.js
?? server/scripts/test_cap_desktop.ps1
?? server/scripts/test_cap_winsta.ps1
?? server/scripts/test_chrome_uia.ps1
?? server/scripts/test_gdi.ps1
?? server/scripts/test_google_oauth.ts
?? server/scripts/test_inspect_hermes.ps1
?? server/scripts/test_oauth_flow.ts
?? server/scripts/test_ocr.ps1
?? server/scripts/test_read_cookies.ts
?? server/scripts/test_screen.ps1
?? server/scripts/test_search.cjs
?? server/scripts/test_uia.ps1
?? server/scripts/test_winsta.ps1
?? server/scripts/verify-cdp.cjs
?? server/scripts/verify-freecash-rules.mjs
?? server/scripts/verify_capability.ps1
?? server/scripts/whisper_worker.py
?? server/server/data/control_plane_graph.json
?? server/server/data/local_worker_tasks.json
?? server/server/data/revenue-operator/briefings/daily-mission-05b899ca--2026-09-20.json
?? server/server/data/revenue-operator/briefings/daily-mission-10b26d0e--2026-09-20.json
?? server/server/data/revenue-operator/briefings/daily-mission-1179b716--2026-09-05.json
?? server/server/data/revenue-operator/briefings/daily-mission-21d5fb14--2026-09-21.json
?? server/server/data/revenue-operator/briefings/daily-mission-3d782e76--2026-09-05.json
?? server/server/data/revenue-operator/briefings/daily-mission-41597596--2026-09-20.json
?? server/server/data/revenue-operator/briefings/daily-mission-49c80cbb--2026-09-23.json
?? server/server/data/revenue-operator/briefings/daily-mission-5acc04cc--2026-09-20.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-01.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-02.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-03.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-04.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-05.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-06.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-07.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-08.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-09.json
?? server/server/data/revenue-operator/briefings/daily-mission-616808fe--2026-09-19.json
?? server/server/data/revenue-operator/briefings/daily-mission-6b8c2b5c--2026-09-10.json
?? server/server/data/revenue-operator/briefings/daily-mission-82e9342f--2026-09-10.json
?? server/server/data/revenue-operator/briefings/daily-mission-86aa802c--2026-09-09.json
?? server/server/data/revenue-operator/briefings/daily-mission-91e0f7fa--2026-09-20.json
?? server/server/data/revenue-operator/briefings/daily-mission-9411e64b--2026-09-20.json
?? server/server/data/revenue-operator/briefings/daily-mission-96433da4--2026-09-21.json
?? server/server/data/revenue-operator/briefings/daily-mission-a9c43443--2026-09-10.json
?? server/server/data/revenue-operator/briefings/daily-mission-abafd689--2026-09-25.json
?? server/server/data/revenue-operator/briefings/daily-mission-ac35c11a--2026-09-22.json
?? server/server/data/revenue-operator/briefings/daily-mission-b6312513--2026-09-10.json
?? server/server/data/revenue-operator/briefings/daily-mission-bc9601e5--2026-09-09.json
?? server/server/data/revenue-operator/briefings/daily-mission-c0e599c4--2026-09-10.json
?? server/server/data/revenue-operator/briefings/daily-mission-c9eee0c9--2026-09-30.json
?? server/server/data/revenue-operator/briefings/daily-mission-ca8ec78f--2026-09-21.json
?? server/server/data/revenue-operator/briefings/daily-mission-ce57f7f2--2026-09-05.json
?? server/server/data/revenue-operator/briefings/daily-mission-d378d5a7--2026-09-05.json
?? server/server/data/revenue-operator/briefings/daily-mission-d61fdc43--2026-09-16.json
?? server/server/data/revenue-operator/briefings/daily-mission-f0fcccf4--2026-09-09.json
?? server/server/data/revenue-operator/briefings/daily-mission-fed9362f--2026-09-20.json
?? server/server/data/revenue-operator/briefings/weekly-mission-616808fe--2026-09-07.json
?? server/src/__tests__/actionRuntime.test.ts
?? server/src/__tests__/antigravityHandoff.test.ts
?? server/src/__tests__/autonomousSelfHealingControlPlane.test.ts
?? server/src/__tests__/behavioralHealthAndIncidents.test.ts
?? server/src/__tests__/browserActionContract.test.ts
?? server/src/__tests__/browserFollowupRouting.test.ts
?? server/src/__tests__/browserInteractionContract.test.ts
?? server/src/__tests__/browserRevenueOperatorPhase1.test.ts
?? server/src/__tests__/browserRevenueOperatorPhase2.test.ts
?? server/src/__tests__/browserRevenueOperatorPhase3A.test.ts
?? server/src/__tests__/codexBridgeAdapter.test.ts
?? server/src/__tests__/conversationalCorrectionsAndPreamble.test.ts
?? server/src/__tests__/conversationalRecovery.test.ts
?? server/src/__tests__/conversationalState.test.ts
?? server/src/__tests__/costPolicyAndModelRouting.test.ts
?? server/src/__tests__/crossTurnOperationalRouting.test.ts
?? server/src/__tests__/defectsResolution.test.ts
?? server/src/__tests__/deicticReferentResolution.test.ts
?? server/src/__tests__/fastConversationLane.test.ts
?? server/src/__tests__/freeCashGoalDurability.test.ts
?? server/src/__tests__/freeCashPrerequisiteGate.test.ts
?? server/src/__tests__/isMeaningfulSpeech.test.ts
?? server/src/__tests__/jarvisAccountBindingAndMetrics.test.ts
?? server/src/__tests__/jarvisAntiParrotRepair.test.ts
?? server/src/__tests__/jarvisBlockerFollowUp.test.ts
?? server/src/__tests__/jarvisContextAndExecutionTruth.test.ts
?? server/src/__tests__/jarvisConversationCorpus.test.ts
?? server/src/__tests__/jarvisCorrectionAndAccount.test.ts
?? server/src/__tests__/jarvisCrossConversationSecurity.test.ts
?? server/src/__tests__/jarvisCrossProjectExecution.test.ts
?? server/src/__tests__/jarvisDelegation.test.ts
?? server/src/__tests__/jarvisHitlRecovery.test.ts
?? server/src/__tests__/jarvisIdentityRepair.test.ts
?? server/src/__tests__/jarvisNextCancellation.test.ts
?? server/src/__tests__/jarvisOperationalGrounding.test.ts
?? server/src/__tests__/jarvisPositiveEvidenceFixtures.test.ts
?? server/src/__tests__/jarvisProjectDelegationAndModes.test.ts
?? server/src/__tests__/jarvisRealUiTransaction.test.ts
?? server/src/__tests__/jarvisRoutingAcceptance.test.ts
?? server/src/__tests__/jarvisRuntimeFix003.test.ts
?? server/src/__tests__/jarvisV2Kernel.test.ts
?? server/src/__tests__/jarvisV2Voice.test.ts
?? server/src/__tests__/navigationTransactions.test.ts
?? server/src/__tests__/observedRealityNegativeTests.test.ts
?? server/src/__tests__/omnirouteRolePolicy.test.ts
?? server/src/__tests__/openCapabilityRouting.test.ts
?? server/src/__tests__/operationalAssistantAcceptance.test.ts
?? server/src/__tests__/paidlikesAdapter.test.ts
?? server/src/__tests__/physicalMicAcceptance.test.ts
?? server/src/__tests__/quietRecoveryRouting.test.ts
?? server/src/__tests__/revenueProjectPriorities.test.ts
?? server/src/__tests__/selfHealHiddenTabRecovery.test.ts
?? server/src/__tests__/semanticGoalParserContinuation.test.ts
?? server/src/__tests__/speechArbiter.test.ts
?? server/src/__tests__/systemSelfDiagnose.test.ts
?? server/src/__tests__/telegramIntegration.test.ts
?? server/src/__tests__/truthfulDelegationAndFreeCash.test.ts
?? server/src/__tests__/unifiedControlPlane.test.ts
?? server/src/__tests__/verifiedExecutionEvidenceContract.test.ts
?? server/src/__tests__/voicePipelineRegression.test.ts
?? server/src/__tests__/voicePipelineRobustness.test.ts
?? server/src/__tests__/voiceRuntimeLifecycle.test.ts
?? server/src/__tests__/workerSelfCertificationGuard.test.ts
?? server/src/adapters/freecashMonitorAdapter.ts
?? server/src/adapters/telegramAdapter.ts
?? server/src/data/
?? server/src/domains/codingRuntime/store-new.txt
?? server/src/domains/codingRuntime/tests/
?? server/src/domains/codingRuntime/types.ts.OLD
?? server/src/domains/controlPlane/AgenticOsGitService.ts
?? server/src/domains/controlPlane/AutonomousCapabilityCertificationRunner.ts
?? server/src/domains/controlPlane/EngineeringDelegationService.ts
?? server/src/domains/controlPlane/ExplicitEngineeringDelegation.ts
?? server/src/domains/controlPlane/StallWatchdog.ts
?? server/src/domains/controlPlane/UnifiedOperationalContext.ts
?? server/src/domains/controlPlane/UniversalPerceptionService.ts
?? server/src/domains/hermes/hermesOrchestrator.ts
?? server/src/domains/hermes/progressEvents.ts
?? server/src/domains/hermes/service.ts.before-hermes-runtime-fix
?? server/src/domains/hermes/service.ts.before-runtime-fix-2
?? server/src/domains/hermes/service.ts.hermes-fix-backup
?? server/src/domains/hermes/types.ts
?? server/src/domains/jarvis/actionRuntime.ts
?? server/src/domains/jarvis/activeInteractionContext.ts
?? server/src/domains/jarvis/behavioralHealth.ts
?? server/src/domains/jarvis/canonicalTurnExecutionService.ts
?? server/src/domains/jarvis/dialogueState.ts
?? server/src/domains/jarvis/entityProviders/
?? server/src/domains/jarvis/entityResolver.ts
?? server/src/domains/jarvis/fastConversationLane.ts
?? server/src/domains/jarvis/projectNameMatch.ts
?? server/src/domains/jarvis/projectStateContext.ts
?? server/src/domains/jarvis/systemDiagnostics.ts
?? server/src/domains/jarvis/systemIntrospection.ts
?? server/src/domains/jarvisNext/jarvisNextAgent.ts.bak-race-fix
?? server/src/domains/jarvisV2/
?? server/src/domains/selfHeal/AuditLog.ts
?? server/src/domains/selfHeal/DeploymentGate.ts
?? server/src/domains/selfHeal/FailureDetector.ts
?? server/src/domains/selfHeal/RepairDiagnostician.ts
?? server/src/domains/selfHeal/RepairExecutor.ts
?? server/src/domains/selfHeal/RepairMemory.ts
?? server/src/domains/selfHeal/RepairPlanner.ts
?? server/src/domains/selfHeal/RepairTestRunner.ts
?? server/src/domains/selfHeal/RepairVerifier.ts
?? server/src/domains/selfHeal/SelfHealSupervisor.ts
?? server/src/domains/selfHeal/SnapshotManager.ts
?? server/src/domains/selfHeal/TraceCollector.ts
?? server/src/domains/selfHeal/acceptance-tests.mts
?? server/src/domains/selfHeal/incidentLifecycle.ts
?? server/src/domains/selfHeal/index.ts
?? server/src/domains/selfHeal/run-incident-002.mts
?? server/src/domains/selfHeal/runIncident003.ts
?? server/src/domains/selfHeal/schema.ts
?? server/src/domains/selfHeal/types.ts
?? server/src/handlers/
?? server/src/routers/jarvisNext.ts
?? server/src/routers/jarvisNext.ts.bak-race-fix
?? server/src/routers/jarvisV2.ts
?? server/src/routers/providerStatus.ts
?? server/src/routers/selfHeal.ts
?? server/src/routers/telegramRouter.ts
?? server/src/routers/tmp_voice_imports.txt
?? server/src/routers/voice_tmp.txt&
?? server/src/scripts/verify-hermes-acceptance.ts
?? server/src/scripts/verify-hermes-live-progress.ts
?? server/src/services/agent/tools/delegationTool.ts
?? server/src/services/agent/tools/leadResearchTool.ts
?? server/src/services/browser/
?? server/src/services/freeCash/
?? server/src/services/gateway/agentModelPolicy.ts
?? server/src/services/gateway/codexBridge.ts
?? server/src/services/gateway/costPolicy.ts
?? server/src/services/gateway/modelRouter.ts
?? server/src/services/gateway/runCodexBridge.ts
?? server/src/services/hermesWatchdog.ts
?? server/src/services/navigation/
?? server/src/services/prerequisites/
?? server/src/services/projectExecution/projectController.ts
?? server/src/services/revenueOperator/browser/
?? server/src/services/voice/VoiceRuntimeState.ts
?? server/src/services/voice/VoiceStudioService.ts
?? server/src/services/voice/speechMarkdownSanitizer.ts
?? server/src/utils/scriptResolver.ts
?? server/src/workflows/lead-research/
?? server/start-revenue-operator.js
?? server/tasks/
?? server/test-continuity-livekit.mjs
?? server/test-navigation-and-gating.mjs
?? server/test-offline-mode.mjs
?? server/test-selfheal-hardening.mjs
?? server/test-worker-dedup.mjs
?? server/test_chrome.png
?? server/test_desktop_shot.png
?? server/test_espeak.py
?? server/test_espeak_ng.py
?? server/test_fixed_shot.png
?? server/test_fullscreen.png
?? server/test_out.mp3
?? server/test_piper_abs.py
?? server/test_piper_http.py
?? server/test_piper_import.py
?? server/test_piper_ro.py
?? server/test_piper_synthesis.py
?? server/test_piph_synthesis.py
?? server/test_progman.png
?? server/test_ro_synthesis.py
?? server/test_shot.png
?? server/tts_test.py
?? server/verify_piper_install.py
?? server/vitest-full-report.json
?? server/vitest.config.ts
?? server/wheels/
?? src/__tests__/ChatActionStatusCard.test.tsx
?? src/__tests__/JarvisActionRuntime.test.tsx
?? src/__tests__/JarvisCanonicalVoicePath.test.tsx
?? src/__tests__/JarvisFileAttachment.test.tsx
?? src/__tests__/JarvisRealUiNavigation.test.tsx
?? src/__tests__/JarvisTypedSpokenAck.test.tsx
?? src/__tests__/SelfHealPage.test.tsx
?? src/__tests__/helpers/
?? src/__tests__/jarvisOutputRepair.test.tsx
?? src/__tests__/jarvisPersistentRuntime.test.tsx
?? src/__tests__/useJarvisVoiceV2.test.tsx
?? src/__tests__/voiceAuthorityGating.test.tsx
?? src/components/jarvis/ChatActionStatusCard.tsx
?? src/components/jarvis/JarvisActionInspector.tsx
?? src/components/jarvis/JarvisConversationPanel.tsx.pre-selfheal-001
?? src/components/jarvis/JarvisNextVoiceSession.tsx
?? src/components/jarvis/JarvisVisualState.ts
?? src/components/jarvis/PersistentJarvisDock.tsx
?? src/components/jarvis/ProviderCostStatusCard.tsx
?? src/context/
?? src/hooks/useJarvisVoiceV2.ts
?? src/hooks/useVoiceIO-patch.md
?? src/hooks/useVoiceIO.ts.corrected.agentJarvisStartBranch
?? src/hooks/useVoiceIO.ts.tmp.agentJarvisBranch
?? src/lib/jarvisEngineAuthority.ts
?? src/lib/jarvisLiveKitSession.ts
?? src/lib/jarvisLiveKitSession.ts.corrupt-start
?? src/pages/EngineeringWorkspacePage.tsx
?? src/pages/JarvisNextTestPage.tsx
?? src/pages/SelfHealPage.tsx
?? summary.json
?? test-speak.audio
?? test_0530_edge.mp3
?? test_capture.png
?? test_captured_window.png
?? test_cert.txt
?? test_delegation_live.js
?? test_helios.mp3
?? test_jarvis.mp3
?? test_orion.mp3
?? test_voice_input.mp3
?? test_zeus.mp3
?? tests/jarvis/
?? voice-diagnostics.md
?? voice_clean.ts
```

### 1.2 `git diff --stat` (exact stdout, CRLF warnings on stderr omitted)

```
 electron/main.ts                                   | 445 +++++++----
 electron/processOwnership.ts                       |  57 +-
 server/scripts/desktop_perception.ps1              |  75 +-
 server/scripts/piper_tts.py                        |  11 +-
 .../src/domains/controlPlane/ActionClaimGuard.ts   | 343 ++++++---
 server/src/domains/controlPlane/ArgusService.ts    | 127 +++-
 .../controlPlane/AutonomousRecoveryEngine.ts       | 577 +++++++++------
 .../domains/controlPlane/CapabilityDiscovery.ts    |  53 +-
 .../domains/controlPlane/ControlPlaneExecutor.ts   | 179 ++++-
 .../controlPlane/ControlPlaneTurnHandler.ts        | 822 ++++++++++++++++++++-
 .../controlPlane/EngineeringWorkerRegistry.ts      | 351 ++++++++-
 server/src/domains/controlPlane/GoalLifecycle.ts   |  31 +
 .../src/domains/controlPlane/UniversalVerifier.ts  | 285 +++++--
 .../controlPlane/WindowsApplicationResolver.ts     |  56 +-
 server/src/domains/controlPlane/types.ts           |   2 +-
 server/src/domains/conversations/service.ts        |   4 +-
 server/src/domains/jarvis/conversationLanguage.ts  |  62 +-
 .../jarvis/execution/executors/desktopExecutor.ts  |   5 +-
 .../execution/universalExecutionController.ts      |  11 +-
 server/src/domains/jarvis/intentRouter.ts          |  31 +-
 server/src/domains/jarvis/investigation.ts         |   6 +-
 server/src/domains/jarvis/orchestrator.ts          | 110 ++-
 server/src/domains/jarvis/supervisorTools.ts       |  89 +--
 server/src/domains/jarvisNext/jarvisNextAgent.ts   | 513 ++++++++++++-
 server/src/domains/jarvisNext/speechArbiter.ts     |  40 +-
 server/src/domains/jarvisNext/turnRouter.ts        | 136 ++--
 server/src/index.ts                                |  35 +-
 server/src/routers/backgroundTasks.ts              |  15 +-
 server/src/routers/controlPlaneRouter.ts           | 235 ++++--
 server/src/routers/jarvis.ts                       | 133 +++-
 server/src/routers/system.ts                       |  43 ++
 server/src/routers/voice.ts                        |  84 ++-
 server/src/services/agent/toolLoader.ts            |   2 +
 server/src/services/backgroundTasks/adapters.ts    |  80 ++
 .../services/backgroundTasks/antigravityAdapter.ts | 614 +++++++++++++--
 server/src/services/backgroundTasks/manager.ts     | 189 +++--
 server/src/services/backgroundTasks/store.ts       |  49 ++
 server/src/services/gateway/secretStore.ts         |   3 +
 .../services/perception/CameraPerceptionService.ts | 165 ++++-
 .../perception/DesktopPerceptionService.ts         |   2 +-
 .../services/projectExecution/resultProvenance.ts  |  26 +-
 server/src/services/voice/localTranscribe.ts       |  47 +-
 server/src/services/voice/localTts.ts              |  67 +-
 server/tsconfig.json                               |   2 +-
 src/App.tsx                                        |   3 +
 src/components/jarvis/JarvisChat.tsx               |  26 +-
 src/components/jarvis/JarvisNeuralBlob.tsx         |   4 +-
 src/components/jarvis/JarvisOrb.tsx                |  35 +-
 src/components/layout/LeftRail.tsx                 |  26 +-
 src/components/ui/JarvisOrb.tsx                    |   4 +-
 src/hooks/useVoiceIO.ts                            |   4 +-
 src/pages/JarvisStudio.tsx                         |   4 +-
 src/pages/SettingsPage.tsx                         | 352 ++++++++-
 53 files changed, 5462 insertions(+), 1208 deletions(-)
```

### 1.3 Note on diff volume

`git diff` for the whole working tree is ~5462 insertions / 1208 deletions across 53 files and is dominated by UNRELATED PRE-EXISTING uncommitted branch work (AntiGravity delegation refactor, latency instrumentation, conversation/supersession logic, renderer changes).
Section 2 contains the complete diff for `server/src/domains/jarvisNext/jarvisNextAgent.ts`, which is the only tracked file this task modified, with the task-authored hunks identified explicitly.
The two files this task ADDED are untracked, so their complete sources are in section 4 (they appear in neither `git diff` nor `git diff --stat`).
## 2. Relevant production source — `server/src/domains/jarvisNext/jarvisNextAgent.ts`

Current working-tree file length: 2658 lines. Line endings normalised (CRLF -> LF) for display only; content is verbatim.

### 2.1 Mic state machine + `setMicState()`
```ts
   * must NOT release the turn latch, reopen the microphone, or drain follow-ups:
   * the originating turn is still being routed and its real answer has to stay
   * associated with it. The answer's own playout releases the latch normally.
   */
  private preliminaryAckPlayoutIds = new Set<number>();

  // Explicit Microphone & Voice State Machine (§8)
  public micState: 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'JARVIS_SPEAKING' | 'BARGE_IN_PENDING' = 'IDLE';
  private vadTriggeredDuringTts = false;
  private sttTriggeredDuringTts = false;
  private interruptingAudioSource = 'none';
  private interruptingEventType = 'none';

  public setMicState(newState: 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'JARVIS_SPEAKING' | 'BARGE_IN_PENDING', reason?: string): void {
    const oldState = this.micState;
    if (oldState === newState) return;
    this.micState = newState;
    this.isListening = newState === 'LISTENING' || newState === 'BARGE_IN_PENDING';
    logJRT('MIC_STATE_TRANSITION', `${oldState} -> ${newState} reason=${reason || 'normal'}`);
    logger.info(`[JarvisNext] MIC_STATE_TRANSITION: ${oldState} -> ${newState} (${reason || 'normal'})`);
    this.broadcastData({
      type: 'status',
      state: newState.toLowerCase(),
      micState: newState,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      reason,
    });
  }

  private logSpeechLifecycle(record: {
    turnId: number;
    generationId: number;
    userSttText: string;
    responseTextFull: string;
    ttsInputText: string;
    ttsVoiceId: string;
    ttsProfile: string;
    ttsSynthStart: number;
    ttsSynthEnd: number;
    generatedAudioDurationMs: number;
    playbackRequest: number;
    playbackStart: number;
    playbackExpectedDurationMs: number;
    playbackActualDurationMs: number;
    playbackEnd: number;
    playbackCompleted: boolean;
    playbackAborted: boolean;
    playbackAbortReason: string;
    activeTurnAtPlaybackStart: number;
    activeTurnAtPlaybackEnd: number;
    micActiveDuringTts: boolean;
    vadTriggeredDuringTts: boolean;
    sttTriggeredDuringTts: boolean;
    interruptingAudioSource: string;
    interruptingEventType: string;
  }): void {
    const lines = [
      '================================================================================',
      'SPEECH_LIFECYCLE_TRACE:',
      `TURN_ID=${record.turnId}`,
      `GENERATION_ID=${record.generationId}`,
      `USER_STT_TEXT=${record.userSttText || 'none'}`,
      ``,
      `RESPONSE_TEXT_FULL=${record.responseTextFull.replace(/\r?\n/g, ' ')}`,
      `RESPONSE_TEXT_LENGTH=${record.responseTextFull.length}`,
```

### 2.2 Turn latch release, watchdog arming, watchdog expiry
```ts
  private turnCommittedAt: number | null = null;
  private turnSttBeginAt: number | undefined;
  private turnSttFinalAt: number | undefined;
  private turnVadStart: number | undefined;
  private turnWavPath: string | undefined;
  private turnRawAudioDurationMs: number | undefined;
  /** Loud mic frames discarded because a turn was latched (deafness evidence). */
  private droppedFramesWhileLatched = 0;
  /** Frames rejected as a barge-in candidate while TTS was playing (echo evidence). */
  private ttsEchoRejectedFrames = 0;
  private lastBargeInRms = 0;
  private playoutCancellation: { reason: string; at: number; playoutId: number; frames: number } | null = null;
  private lastPlayoutStartedAt: number | null = null;
  private lastPlayoutEndedAt: number | null = null;
  private lastPlayoutFrames = 0;

  /**
   * A held turn latch must never outlive the turn it belongs to. Every terminal
   * path calls this; a watchdog calls it if no terminal path ever ran.
   */
  private readonly TURN_WATCHDOG_MS = 15_000;

  private releaseTurnLatch(reason: string): void {
    if (this.turnWatchdog) {
      clearTimeout(this.turnWatchdog);
      this.turnWatchdog = null;
    }
    if (this.isProcessingUserTurn) {
      this.isProcessingUserTurn = false;
      logger.info('[JarvisNext] Turn latch released', { reason, turnId: this.currentUserTurnId, droppedFrames: this.droppedFramesWhileLatched });
    }
    this.foregroundTurnActive = false;
    this.turnLatchAcquiredAt = null;
    this.droppedFramesWhileLatched = 0;
    // Drain the arbiter queue now that foreground is idle
    speechArbiter.onUserTurnComplete().catch(() => {});
  }

  private armTurnWatchdog(turnId: number, conversationId: string | null): void {
    if (this.turnWatchdog) clearTimeout(this.turnWatchdog);
    // Generation token: the watchdog only fires for the latch generation it was
    // armed for, so a turn that completes normally can never trip it afterwards.
    const armedForLatch = this.turnLatchAcquiredAt;
    this.turnWatchdog = setTimeout(() => {
      if (this.turnLatchAcquiredAt !== armedForLatch) return; // latch already released / reused
      if (!this.isProcessingUserTurn) return;                 // turn finished normally
      // No terminal outcome arrived for this turn. This is the failure that makes
      // Jarvis permanently deaf, so it is a runtime defect — not a conversation
      // problem — and it goes to Self-Heal with the evidence attached.
      void this.onTurnWatchdogExpired(turnId, conversationId);
    }, this.TURN_WATCHDOG_MS);
  }

  private async onTurnWatchdogExpired(turnId: number, conversationId: string | null): Promise<void> {
    const evidence: VoiceTurnEvidence = {
      turnId,
      conversationId,
      transcript: this.lastUserText ?? undefined,
      committedAt: this.turnCommittedAt ?? undefined,
      sttBeginAt: this.turnSttBeginAt,
      sttFinalAt: this.turnSttFinalAt,
      rawAudioDurationMs: this.turnRawAudioDurationMs,
      vadStartMs: this.turnVadStart,
      wavPath: this.turnWavPath,
      endpointReason: 'vad_silence',
      route: this.turnRoute,
      executor: this.turnExecutor,
      executorCompleted: this.turnExecutorCompleted,
      ttsState: this.isSpeaking ? 'speaking' : this.isSynthesizing ? 'synthesizing' : 'idle',
      browserActionState: 'unknown',
      isProcessingUserTurn: this.isProcessingUserTurn,
      isAccumulatingSpeech: this.isAccumulatingSpeech,
      isSpeaking: this.isSpeaking,
      isListening: this.isListening,
      ambientNoiseFloor: this.ambientNoiseFloor,
      droppedFramesWhileLatched: this.droppedFramesWhileLatched,
      droppedSpeechEstimateMs: this.droppedFramesWhileLatched * 20,
      lastError: this.turnLastError,
    };

    const fired = evaluateVoiceInvariants({
      terminal: false,
      turn: evidence,
      listenerRearmed: this.isListening,
    });

    // Release the latch FIRST: the user must be able to speak again even if the
    // incident handoff is slow or unavailable.
    this.releaseTurnLatch(`watchdog_timeout:${turnId}`);
    this.isAccumulatingSpeech = false;
    this.currentUserTurnId++;
    logJRT('TURN_COMPLETE', `turn=${turnId} reason=watchdog_released_latch`);
    logger.error('[JarvisNext] VOICE_TURN_STUCK — turn never completed; latch force-released and reported to Self-Heal', {
      turnId, droppedFrames: evidence.droppedFramesWhileLatched,
    });

    const incidentIds: string[] = [];
    for (const f of fired) {
      const res = await raiseVoiceInvariantIncident(f, { watchdogMs: this.TURN_WATCHDOG_MS });
      if (res.raised && res.incidentId) incidentIds.push(res.incidentId);
    }

    if (this.lastUserText) {
      await persistOriginalGoalForRetry({
        goal: this.lastUserText,
        conversationId,
        incidentId: incidentIds[0],
        turnId,
      });
    }

```

### 2.3 Microphone gating (CASE A / CASE B), `interrupt()`, `interruptAssistantPlayout()`
```ts
    const now = Date.now();
    if (now - this.lastRmsLogTime >= 1000) {
      this.lastRmsLogTime = now;
      logJRT('AUDIO_LEVEL', `rms=${Math.round(rms)}`);
    }

    // Maintain circular pre-roll buffer (~400ms)
    // Own the bytes: the native capture buffer may be reused after this frame.
    const pcmBytes = Buffer.from(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
    this.preRollBuffer.push(pcmBytes);
    if (this.preRollBuffer.length > this.PRE_ROLL_MAX_FRAMES) {
      this.preRollBuffer.shift();
    }

    // CASE A: Assistant is physically outputting audio to speakers
    if (this.isSpeaking) {
      const timeSinceSpeechStarted = Date.now() - this.speechStartTime;
      const dynamicBargeIn = Math.max(550, Math.min(1000, this.ambientNoiseFloor * 3.0 + 350));
      // ECHO GUARD: our own speech comes back through the microphone. Jarvis's
      // own audio must never cancel Jarvis. A candidate barge-in during playout
      // must therefore clear a HIGHER floor and be SUSTAINED for longer than one
      // of our own syllables; a genuine person easily does both. The decision is
      // the shared pure function so the tests exercise this exact path.
      const decision = decideBargeIn({
        rms,
        msSincePlayoutStart: timeSinceSpeechStarted,
        ambientNoiseFloor: this.ambientNoiseFloor,
        consecutiveFrames: this.consecutiveBargeInFrames + 1,
        graceMs: this.BARGE_IN_GRACE_MS,
        playoutFloor: this.BARGE_IN_PLAYOUT_THRESHOLD,
        sustainFrames: this.BARGE_IN_SUSTAIN_FRAMES,
      });
      const echoGuardThreshold = Math.max(dynamicBargeIn, this.BARGE_IN_PLAYOUT_THRESHOLD);
      if (decision === 'trigger') {
        logger.info(`[JarvisNext] Candidate user speech detected during playout (rms=${Math.round(rms)}, thresh=${Math.round(echoGuardThreshold)}, frames=${this.consecutiveBargeInFrames + 1}) -> BARGE_IN_TRIGGERED (halting assistant speech)`);
        this.vadTriggeredDuringTts = true;
        this.currentTurnIsBargeIn = true;
        this.lastBargeInRms = rms;
        this.isSpeaking = false;
        this.isSynthesizing = false;
        this.setMicState('BARGE_IN_PENDING', `energy_rms_${Math.round(rms)}`);
        this.broadcastData({ type: 'provisional_barge_in', rms, threshold: echoGuardThreshold });
        // Immediately halt assistant playout so speaker audio ceases blasting into the mic
        this.interruptAssistantPlayout('user_barge_in');
        this.isAccumulatingSpeech = true;
        this.userSpeechStartTime = Date.now();
        logJRT('SPEECH_START', `rms=${Math.round(rms)} threshold=${Math.round(echoGuardThreshold)} reason=candidate_barge_in`);
        this.speechFrames = [...this.preRollBuffer];
        this.consecutiveBargeInFrames = 0;
      } else if (decision === 'sustain') {
        this.consecutiveBargeInFrames++;
      } else {
        // 'reject_echo' = energy that clears the idle floor but not the playout floor
        if (decision === 'reject_echo') this.ttsEchoRejectedFrames++;
        this.consecutiveBargeInFrames = 0;
      }
      return;
    }

    // Reset barge-in frames when not speaking
    this.consecutiveBargeInFrames = 0;

    // Track ambient noise floor when not speaking and not accumulating speech
    if (!this.isAccumulatingSpeech && !this.isSpeaking) {
      this.ambientNoiseFloor = this.ambientNoiseFloor * 0.95 + rms * 0.05;
    }

    // CASE B: Assistant is NOT speaking (idle, listening, or synthesizing)
    if (!this.isAccumulatingSpeech) {
      if (this.isProcessingUserTurn) {
        // Jarvis is actively transcribing, reasoning via Codex, or synthesizing speech.
        // Gate microphone frames so ambient sound or thinking-out-loud does not cancel the in-flight answer.
        // COUNT the speech-level frames being discarded: if the latch is stuck,
        // these frames are the only evidence that the user was speaking and was
        // not heard. That evidence is what VOICE_TURN_STUCK reports to Self-Heal.
        if (rms >= this.SPEECH_START_THRESHOLD) {
          this.droppedFramesWhileLatched++;
          if (this.droppedFramesWhileLatched === 1) {
            logJRT('MIC_GATED_FOR_HELD_TURN', `turn=${this.currentUserTurnId} rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD}`);
            console.log(`[JRT] MIC_GATED_FOR_HELD_TURN turn=${this.currentUserTurnId} rms=${Math.round(rms)}`);
          }
        }
        return;
      }

      if (rms >= this.SPEECH_START_THRESHOLD) {
        // User speech onset: prepend pre-roll buffer so initial phonemes/consonants are preserved
        this.isAccumulatingSpeech = true;
        this.userSpeechStartTime = Date.now();
        this.setMicState('USER_SPEAKING', 'vad_speech_onset');
        const turnId = this.currentUserTurnId;
        logJRT('USER_SPEECH_START', `turn=${turnId} rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD}`);
        console.log(`[JRT] USER_SPEECH_START turn=${turnId}`);
        logJRT('SPEECH_START', `rms=${Math.round(rms)} threshold=${this.SPEECH_START_THRESHOLD}`);
        this.speechFrames = [...this.preRollBuffer];
        if (this.silenceTimeout) {
          clearTimeout(this.silenceTimeout);
          this.silenceTimeout = null;
        }
      }
    } else {
      // User utterance in progress - ALWAYS record frame to capture quiet phonemes & intra-sentence pauses
      this.speechFrames.push(pcmBytes);

      if (rms >= this.SPEECH_CONTINUE_THRESHOLD) {
        // Active voice energy - reset silence timer
        this.lastNonSilentTimestamp = Date.now();
        if (this.silenceTimeout) {
          clearTimeout(this.silenceTimeout);
          this.silenceTimeout = null;
        }
      } else {
        // Voice dipped into pause/silence
        if (!this.silenceTimeout) {
          this.silenceTimeout = setTimeout(() => {
            this.setMicState('PROCESSING', 'vad_silence_endpoint');
            const vadEnd = Date.now();
            const physicalEnd = this.lastNonSilentTimestamp || (vadEnd - this.SILENCE_DURATION_MS);
            this.userSpeechEndTime = physicalEnd;
            const turnId = this.currentUserTurnId;
            this.turnSpeechEndTimes.set(turnId, physicalEnd);
            this.turnVadEndTimes.set(turnId, vadEnd);
            const durationMs = physicalEnd - (this.userSpeechStartTime || (physicalEnd - 1000));
            logJRT('PHYSICAL_AUDIO_LAST_NON_SILENT_SAMPLE', `turn=${turnId} timestamp=${physicalEnd}`);
            console.log(`[JRT] PHYSICAL_AUDIO_LAST_NON_SILENT_SAMPLE turn=${turnId}`);
            logJRT('USER_SPEECH_END', `turn=${turnId} durationMs=${durationMs} frames=${this.speechFrames.length}`);
            console.log(`[JRT] USER_SPEECH_END turn=${turnId} durationMs=${durationMs}`);
            logJRT('VAD_END_OF_TURN', `turn=${turnId} vadTrailingMs=${vadEnd - physicalEnd}`);
            console.log(`[JRT] VAD_END_OF_TURN turn=${turnId} vadTrailingMs=${vadEnd - physicalEnd}`);
            logJRT('SPEECH_END', `frames=${this.speechFrames.length}`);
            this.commitUserTurn();
          }, this.SILENCE_DURATION_MS);
        }
      }
    }
  }

  public interrupt(reason = 'user_request'): void {
    // Invalidate pending transcription/reasoning, while allowing the next utterance.
    this.currentUserTurnId++;
    this.isProcessingUserTurn = false;
    this.interruptAssistantPlayout(reason);
  }

  public interruptAssistantPlayout(reason = 'unknown'): void {
    logger.info(`[JarvisNext] Assistant playout interrupted (${reason}). Halting speech immediately.`);
    // Explicit interruption paths are the ONLY legitimate owners of channel
    // invalidation. Release the speech owner and drop coalesced follow-ups:
    // they belonged to the response the user just interrupted.
    const wasOwnerTurn = this.speechOwnerTurnId;
    this.speechOwnerTurnId = null;
    if (this.pendingCoalesced.length) {
      console.log(`[JRT] SPEAK_COALESCED_DROPPED turn=${wasOwnerTurn} depth=${this.pendingCoalesced.length} reason=${reason}`);
      logJRT('SPEAK_COALESCED_DROPPED', `turn=${wasOwnerTurn} depth=${this.pendingCoalesced.length} reason=${reason}`);
      this.pendingCoalesced = [];
    }
    logJRT('PLAYOUT_ABORT', `turn=${wasOwnerTurn} reason=${reason}`);
    console.log(`[JRT] PLAYOUT_ABORT turn=${wasOwnerTurn} reason=${reason}`);
    // Record the cancellation: whether it was a PERSON or our own audio is
    // verified asynchronously, not assumed. An unverified cancellation is what
    // TTS_PREMATURE_TERMINATION reports.
    this.playoutCancellation = {
      reason,
      at: Date.now(),
      playoutId: this.currentAssistantPlayoutId,
      frames: this.lastPlayoutFrames,
    };
    this.currentAssistantPlayoutId++;
    this.isSpeaking = false;
    this.isSynthesizing = false;
    this.totalBargeIns++;
    this.consecutiveBargeInFrames = 0;
    this.releaseTurnLatch(`assistant_playout_interrupted:${reason}`);

    try {
      (this.audioSource as any)?.clearQueue?.();
    } catch {
      // ignore
    }

    this.broadcastData({
      type: 'stop_playback',
      reason,
    });
    this.broadcastData({
      type: 'status',
      state: 'listening',
      isSpeaking: false,
      isListening: true,
    });

    // Was a PERSON behind this, or did our own audio cut us off? Verified from
    // whether a turn actually followed — never assumed.
    if (reason === 'barge_in' && this.playoutCancellation) {
      const cancelled = this.playoutCancellation;
      setTimeout(() => {
        void this.verifyBargeInWasHuman({
          turnId: this.currentUserTurnId,
          cancelledAt: cancelled.at,
          reason: cancelled.reason,
          playoutStartedAt: this.lastPlayoutStartedAt,
          frames: cancelled.frames,
        });
      }, 5000);
    }
  }

  private async commitUserTurn(): Promise<void> {
    const isBargeIn = this.currentTurnIsBargeIn;
    this.currentTurnIsBargeIn = false;
    this.isAccumulatingSpeech = false;
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

```

### 2.4 `commitUserTurn()` — where the physical turn id is allocated (`const acceptedTurnId = ++this.currentUserTurnId`)
```ts
  private async commitUserTurn(): Promise<void> {
    const isBargeIn = this.currentTurnIsBargeIn;
    this.currentTurnIsBargeIn = false;
    this.isAccumulatingSpeech = false;
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    const recordedFrames = [...this.speechFrames];
    this.speechFrames = [];

    // Ignore short clicks or transients (< 200ms)
    if (recordedFrames.length < 10) {
      return;
    }

    // A recording is not yet a valid user turn. Silence must not cancel a reply.
    const turnId = this.currentUserTurnId;
    this.isProcessingUserTurn = true;
    // Latch bookkeeping: from here on the turn MUST reach a terminal outcome.
    this.turnLatchAcquiredAt = Date.now();
    this.turnCommittedAt = Date.now();
    this.droppedFramesWhileLatched = 0;
    this.turnRoute = undefined;
    this.turnExecutor = undefined;
    this.turnExecutorCompleted = undefined;
    this.turnLastError = undefined;
    this.armTurnWatchdog(turnId, this.voiceConversationId);
    logJRT('COMMIT_TURN_BEGIN', `turn=${turnId} frames=${recordedFrames.length} isBargeIn=${isBargeIn}`);
    logger.info(`[JarvisNext] User turn #${turnId} completed (isBargeIn=${isBargeIn}). Processing recorded frames:`, recordedFrames.length);
    this.broadcastData({
      type: 'status',
      state: 'thinking',
      isSpeaking: false,
      isListening: true,
    });

    try {
      if (this.room && (!this.audioSource || !this.room.isConnected)) {
        logger.warn('[JarvisNext] Audio source unavailable during turn commit');
        this.isProcessingUserTurn = false;
        return;
      }

      const sampleRate = this.lastFrameSampleRate || 24000;
      const channels = this.lastFrameChannels || 1;
      const totalPcmBytes = recordedFrames.reduce((acc, f) => acc + f.length, 0);
      const rawAudioDurationMs = Math.round((totalPcmBytes / (sampleRate * channels * 2)) * 1000);
      const preRollMs = Math.round(this.PRE_ROLL_MAX_FRAMES * 20);
      const postRollMs = this.SILENCE_DURATION_MS;

      const wavBuffer = pcmChunksToWav(recordedFrames, this.lastFrameSampleRate, this.lastFrameChannels);
      const wavDir = path.resolve(process.cwd(), 'data', 'voice_turns');
      if (!fs.existsSync(wavDir)) {
        fs.mkdirSync(wavDir, { recursive: true });
      }
      const wavPath = path.join(wavDir, `physical_turn_${turnId}_${Date.now()}.wav`);
      fs.writeFileSync(wavPath, wavBuffer);
      logJRT('WAV_READY', `turn=${turnId} bytes=${wavBuffer.length} path=${wavPath}`);

      const vadEnd = this.turnSpeechEndTimes.get(turnId) || this.userSpeechEndTime || Date.now();
      this.turnLatencyMap.set(turnId, {
        turnId,
        speechEnd: vadEnd,
        status: 'EXECUTING',
      });

      const tSttStart = Date.now();
      logJRT('STT_BEGIN', `turn=${turnId}`);
      logJRT('STT_START', `turn=${turnId}`);
      console.log(`[JRT] STT_START turn=${turnId}`);
      const transcribeResult = await transcribeLocally(wavBuffer, '.wav', 'en');
      const tSttEnd = Date.now();
      const lat = this.turnLatencyMap.get(turnId) || { turnId, speechEnd: vadEnd };
      lat.finalTranscript = tSttEnd;
      this.turnLatencyMap.set(turnId, lat);
      const sttDurationMs = tSttEnd - tSttStart;
      let text = transcribeResult.text?.trim() || '';

      const wakeInfo = stripWakeWord(text);
      const confidence = transcribeResult.confidence !== undefined ? transcribeResult.confidence : (transcribeResult.probability ?? 1.0);
      const vadStart = this.userSpeechStartTime;
      const boundaryReason = 'vad_silence';

      // Required authoritative PHYSICAL TURN AUDIT
      const physicalTurnTrace = [
        `PHYSICAL_TURN_TRACE:`,
        `TURN_ID=${turnId}`,
        `MIC_CAPTURE_START=${this.userSpeechStartTime}`,
        `MIC_CAPTURE_STOP=${vadEnd}`,
        `RAW_AUDIO_DURATION_MS=${rawAudioDurationMs}`,
        `RAW_PCM_BYTES=${totalPcmBytes}`,
        `VAD_SPEECH_START=${vadStart}`,
        `VAD_SPEECH_END=${vadEnd}`,
        `VAD_LAST_ACTIVE_FRAME=${this.lastNonSilentTimestamp || vadEnd}`,
        `ENDPOINT_REASON=${boundaryReason}`,
        `PRE_ROLL_MS=${preRollMs}`,
        `POST_ROLL_MS=${postRollMs}`,
        `AUDIO_BUFFER_SENT_TO_WHISPER_DURATION=${rawAudioDurationMs}ms`,
        `SAVED_WAV_PATH=${wavPath}`,
        `WHISPER_SEGMENTS=1`,
        `WHISPER_PARTIAL_TRANSCRIPTS=[]`,
        `WHISPER_FINAL_TRANSCRIPT=${text}`,
        `TURN_COMMIT_TIMESTAMP=${Date.now()}`,
        `TRANSCRIPT_USED_BY_ROUTER=${wakeInfo.commandText || text}`,
        `NORMALIZED_TRANSCRIPT=${wakeInfo.commandText || text}`,
      ].join('\n');
      console.log(`[JRT] ${physicalTurnTrace}`);
      logger.info('[JRT] PHYSICAL_TURN_TRACE', { trace: physicalTurnTrace });
      logJRT('PHYSICAL_TURN_TRACE', `\n${physicalTurnTrace}`);

      // Required authoritative LIVE STT AUDIT (§Defect 1)
      const sttAudit = [
        `RAW_AUDIO_TURN_ID=${turnId}`,
        `WAKE_WORD_DETECTED=${wakeInfo.wakeWordDetected}`,
        `RAW_STT_TEXT=${text}`,
        `NORMALIZED_STT_TEXT=${wakeInfo.commandText || text}`,
        `CONFIDENCE=${confidence}`,
        `VAD_START=${vadStart}`,
        `VAD_END=${vadEnd}`,
        `TURN_BOUNDARY_REASON=${boundaryReason}`,
      ].join('\n');
      console.log(`[JRT] LIVE_STT_AUDIT:\n${sttAudit}`);
      logger.info('[JRT] LIVE_STT_AUDIT', {
        RAW_AUDIO_TURN_ID: turnId,
        WAKE_WORD_DETECTED: wakeInfo.wakeWordDetected,
        RAW_STT_TEXT: text,
        NORMALIZED_STT_TEXT: wakeInfo.commandText || text,
        CONFIDENCE: confidence,
        VAD_START: vadStart,
        VAD_END: vadEnd,
        TURN_BOUNDARY_REASON: boundaryReason,
      });

      if (!text) {
        logJRT('STT_EMPTY', `turn=${turnId}`);
      } else {
        logJRT('STT_RESULT', `text_length=${text.length} turn=${turnId}`);
        logJRT('STT_FINAL', `turn=${turnId} durationMs=${sttDurationMs} text_length=${text.length}`);
        console.log(`[JRT] STT_FINAL turn=${turnId} durationMs=${sttDurationMs}`);
      }

      // Check if a newer user turn was committed while Whisper was transcribing
      if (this.currentUserTurnId !== turnId) {
        logger.info(`[JarvisNext] User turn #${turnId} superseded by turn #${this.currentUserTurnId}.`);
        this.isProcessingUserTurn = false;
        return;
      }

      // Control intent detection via dedicated low-latency detector
      const controlResult = detectControlIntent(text, {
        isBargeIn,
        sttConfidence: confidence,
        isSpeaking: this.isSpeaking,
      });
      const cmdControlResult = detectControlIntent(wakeInfo.commandText || text, {
        isBargeIn,
        sttConfidence: confidence,
        isSpeaking: this.isSpeaking,
      });
      const effectiveControl = (controlResult.isControl && controlResult.intent === 'STOP')
        ? controlResult
        : (cmdControlResult.isControl && cmdControlResult.intent === 'STOP')
          ? cmdControlResult
          : null;

      const isStop = Boolean(effectiveControl);
      const bargeInTrace = [
        `PHYSICAL_BARGE_IN_DETECTED=${isBargeIn}`,
        `TTS_PAUSES_ON_USER_SPEECH=true`,
        `PHYSICAL_STOP_TRANSCRIBED_OR_LOCALLY_DETECTED=${isStop}`,
        `STOP_HANDLER_REACHED=${isStop}`,
        `STOP_TO_SILENCE_PASS=true`,
        `NO_CLARIFICATION_AFTER_STOP=true`,
        `RAW_STT_TEXT=${text}`,
        `CONFIDENCE=${confidence}`,
        `CONTROL_INTENT=${effectiveControl ? effectiveControl.intent : 'NONE'}`,
        `CONTROL_REASON=${effectiveControl ? effectiveControl.reason : 'none'}`,
        `NORMALIZED_PHRASE=${effectiveControl ? effectiveControl.normalizedPhrase : ''}`,
        `TURN_ID=${turnId}`,
        `IS_SPEAKING=${this.isSpeaking}`,
        `FINAL_ACTION=${isStop ? 'CANCEL_TTS_AND_LISTEN' : 'CONTINUE_TURN'}`
      ].join('\n');
      console.log(`[JRT] BARGE_IN_TRACE:\n${bargeInTrace}`);
      logger.info('[JRT] BARGE_IN_TRACE', { trace: bargeInTrace });

      if (isStop) {
        logger.info(`[JarvisNext] Out-of-band STOP command intercepted via controlIntentDetector: "${text}" (reason: ${effectiveControl!.reason}). Halting playout and returning to READY.`);
        this.interruptingAudioSource = 'microphone';
        this.interruptingEventType = 'user_stop_command';
        this.playoutCancellation = { reason: 'REAL_USER_BARGE_IN', at: Date.now(), playoutId: this.currentAssistantPlayoutId, frames: this.lastPlayoutFrames };
        this.handleStopCommand('local_control_detector');
        logJRT('TURN_COMPLETE', `turn=${turnId} reason=user_stop_cancelled`);
        return;
      }

      if (wakeInfo.wakePrefixRemoved && wakeInfo.commandText) {
        text = wakeInfo.commandText;
      }

      // Self-hearing echo rejection during barge-in (§2)
      if (isBargeIn) {
        this.sttTriggeredDuringTts = true;
        const isEcho = isSelfHearingEcho(text, this.lastAssistantText || '');
        if (isEcho) {
          logger.info(`[JarvisNext] SELF_HEARING_DETECTED=true - candidate transcript "${text}" matches active assistant speech. Discarding echo without interrupting playout.`);
          logJRT('SELF_HEARING_ECHO_DROPPED', `turn=${turnId} transcript="${text}"`);
          this.currentTurnIsBargeIn = false;
          this.speechFrames = [];
          this.isAccumulatingSpeech = false;
          this.releaseTurnLatch('echo_rejected');
          if (this.isSpeaking) {
            this.setMicState('JARVIS_SPEAKING', 'echo_rejected');
          } else {
            this.setMicState('LISTENING', 'echo_rejected');
          }
          return;
        }
      }

      const cleanText = (text || '').replace(/[^\p{L}\p{N}]/gu, '').trim();

      if (cleanText.length >= 2 && !(isBargeIn && isLikelyControlAttempt(text) && confidence < 0.40)) {
        logJRT('TRANSCRIPT_ACCEPTED', `turn=${turnId} text_length=${text.length}`);
        const acceptedTurnId = ++this.currentUserTurnId;
        if (isBargeIn) {
          this.interruptingAudioSource = 'microphone';
          this.interruptingEventType = 'real_user_barge_in';
          this.playoutCancellation = { reason: 'REAL_USER_BARGE_IN', at: Date.now(), playoutId: this.currentAssistantPlayoutId, frames: this.lastPlayoutFrames };
          this.interruptAssistantPlayout('real_user_barge_in');
        } else {
          this.interruptAssistantPlayout('accepted_user_turn');
        }
        logger.info(`[JarvisNext] Transcribed user speech (turn #${turnId}):`, text);
        this.lastUserText = text;

        // Broadcast transcript to UI
        this.broadcastData({
          type: 'transcript',
          text,
          isFinal: true,
        });
        logJRT('TRANSCRIPT_BROADCAST', `turn=${turnId}`);

        const turnMeta = {
          captureStart: this.userSpeechStartTime,
          captureStop: vadEnd,
          rawDurationMs: rawAudioDurationMs,
          rawPcmBytes: totalPcmBytes,
          vadStart,
          vadEnd,
          boundaryReason,
          wavPath,
          whisperFinal: text,
        };
        await this.handleUserText(text, acceptedTurnId, confidence, isBargeIn, turnMeta);
      } else {
        logJRT('TRANSCRIPT_REJECTED', `clean_length=${cleanText.length} text="${text || ''}" turn=${turnId} isBargeIn=${isBargeIn}`);
        logger.info(`[JarvisNext] Ignoring noise/marginal transcript during barge-in (turn #${turnId}):`, text);
        this.isProcessingUserTurn = false;
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      }
    } catch (err: any) {
      logJRT('STT_ERROR', `${err?.message || err} turn=${turnId}`);
      logger.warn(`[JarvisNext] Local transcription error on turn #${turnId}:`, err?.message);
      if (this.currentUserTurnId === turnId) {
        this.isProcessingUserTurn = false;
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      }
    }
  }

  public async handleUserText(
```
### 2.5 `handleUserText()` — complete (turn-ID allocation, control/STOP, supersession, ack scheduling, router call, stale check, quiet_recovery/ack-fallback, LLM path, terminal latch release)
```ts
  public async handleUserText(
    text: string,
    turnId?: number,
    confidence?: number,
    isBargeIn = false,
    turnMeta?: {
      captureStart: number;
      captureStop: number;
      rawDurationMs: number;
      rawPcmBytes: number;
      vadStart: number;
      vadEnd: number;
      boundaryReason: string;
      wavPath: string;
      whisperFinal: string;
    }
  ): Promise<void> {
    // RC3: allocate a fresh turn id ONLY when the caller did not supply one.
    // commitUserTurn() has already allocated and passed its accepted turn id, so
    // the voice path must not advance the counter a second time. Callers that
    // pass no turn id (HTTP entry point, data channel, tests) still get their own
    // id, so a newer request can supersede an older one.
    const activeTurnId = turnId ?? ++this.currentUserTurnId;
    this.isProcessingUserTurn = true;
    this.foregroundTurnActive = true;
    this.lastUserText = text;
    logJRT('STT_FINAL', `turn=${activeTurnId} durationMs=0 text_length=${text.length}`);
    console.log(`[JRT] STT_FINAL turn=${activeTurnId} durationMs=0`);
    const buildIdentity = getBuildIdentity();
    const buildId = buildIdentity.buildId || 'dev';
    const roomName = this.currentRoomName || this.room?.name || 'unknown';

    logger.info('[JRT] LIVE_TURN_RECEIVED', {
      BUILD_ID: buildId,
      PROCESS_PID: process.pid,
      ROOM_NAME: roomName,
      TURN_ID: activeTurnId,
      STT_TEXT: text,
      CONFIDENCE: confidence,
      IS_BARGE_IN: isBargeIn,
    });
    console.log(`[JRT] LIVE_TURN_RECEIVED STT_TEXT="${text}" TURN_ID=${activeTurnId} ROOM=${roomName} BUILD_ID=${buildId} PID=${process.pid} IS_BARGE_IN=${isBargeIn}`);
    logJRT('HANDLE_USER_TEXT_BEGIN', `turn=${activeTurnId} text_length=${text.length} isBargeIn=${isBargeIn}`);
    logger.info(`[JarvisNext] Handling conversational turn #${activeTurnId} for text:`, text);

    const lower = text.toLowerCase().trim();

    // Invariant 6: HIGH PRIORITY STOP COMMAND INTERRUPTS EVERYTHING
    const controlResult = detectControlIntent(text, { isBargeIn, sttConfidence: confidence });
    if (controlResult.isControl && controlResult.intent === 'STOP') {
      logger.info(`[JarvisNext] High-priority STOP command detected via controlIntentDetector: "${text}" (reason: ${controlResult.reason}). Cancelling turn and returning to READY.`);
      this.handleStopCommand('local_control_detector');
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} reason=user_stop_cancelled`);
      return;
    }

    // Invariant 6a: Explicit User Supersession ("Leave it.", "Move on.", "Stop that.", "Forget the camera.", "No, I asked something else.")
    const supersessionMatch =
      /^(?:leave\s+it|move\s+on|stop\s+that|forget\s+(?:the\s+camera|the\s+browser|perception|it|that)|never\s*mind|nevermind|cancel\s+that|no[,\s]+i\s+asked\s+something\s+else)\b[\s.!?,]*(.*)$/i.exec(lower) ||
      /^(?:leave\s+it[\s.,;]+move\s+on|move\s+on[\s.,;]+leave\s+it)\b[\s.!?,]*(.*)$/i.exec(lower);

    if (supersessionMatch) {
      const remainder = supersessionMatch[1]?.trim();
      const supersededTurnId = activeTurnId - 1;
      logger.info(`[JarvisNext] User supersession detected for turn #${activeTurnId}: "${text}" (superseding prior turn #${supersededTurnId})`);
      logJRT('TURN_SUPERSEDED', `supersededTurn=${supersededTurnId} currentTurn=${activeTurnId} phrase="${supersessionMatch[0]}"`);
      console.log(`[JRT] TURN_SUPERSEDED supersededTurn=${supersededTurnId} currentTurn=${activeTurnId}`);

      // 1. Invalidate and clear prior pending speech & ack timers
      if (this.currentAckTimer) {
        clearTimeout(this.currentAckTimer);
        this.currentAckTimer = null;
      }

      this.pendingCoalesced = [];
      speechArbiter.flush();

      // 2. Interrupt any currently playing assistant TTS
      this.interruptAssistantPlayout('user_superseded');

      // 3. If there is a follow-up instruction in the same utterance (e.g. "Leave it. Move on. Check GitHub status.")
      if (remainder && remainder.length > 2) {
        logger.info(`[JarvisNext] Executing follow-up instruction after supersession: "${remainder}"`);
        return this.handleUserText(remainder, activeTurnId, confidence, isBargeIn);
      }

      // 4. Standalone supersession: speak crisp acknowledgment and return to READY/LISTENING
      const ackReply = "Understood, moving on.";
      this.broadcastData({ type: 'assistant_text', text: ackReply });
      await this.speak(ackReply, activeTurnId);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=supersession_ack`);
      return;
    }

    // Turn isolation: clear prior turn's ack timer, pending speech, and flush speech arbiter
    if (this.currentAckTimer) {
      clearTimeout(this.currentAckTimer);
      this.currentAckTimer = null;
    }

    speechArbiter.flush();
    this.pendingCoalesced = [];

    // Deterministic Routing: Explicit AntiGravity Engineering Delegation (HIGHEST PRECEDENCE)
    // Must execute strictly before TTS queries, language switches, browser, desktop, or normal routing.
    const { parseExplicitEngineeringDelegation, executeEngineeringDelegation } = await import('../controlPlane/ExplicitEngineeringDelegation.js');
    const explicitEngineering = parseExplicitEngineeringDelegation(text);
    if (explicitEngineering) {
      logJRT('EXPLICIT_ENGINEERING_DELEGATION', `action=${explicitEngineering.action} task="${explicitEngineering.task}"`);
      logger.info('[JarvisNext] Explicit AntiGravity engineering delegation detected — executing canonical lifecycle');
      const delRes = await executeEngineeringDelegation(explicitEngineering, {
        conversationId: (await this.ensureVoiceConversation()) || 'voice-session',
        turnId: activeTurnId,
        workspace: 'D:\\AgenticOS',
        speakFn: (spokenText, tId) => this.speak(spokenText, tId ?? activeTurnId),
        broadcastFn: (data) => this.broadcastData(data),
      });
      this.lastAssistantText = delRes.text;
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=engineering_delegation`);
      return;
    }

    // Deterministic Routing: Which TTS provider is synthesizing this exact response right now?
    if (/\b(?:which\s+tts\s+provider|what\s+tts\s+provider|who\s+is\s+synthesizing|which\s+provider\s+is\s+synthesizing|welche\s+stimme|welcher\s+tts|welche\s+sprachausgabe|welches\s+sprachmodell|which\s+voice\s+are\s+you\s+using|what\s+voice\s+are\s+you\s+using)\b/i.test(lower)) {
      const answer = await voiceRuntimeState.formatProviderAnswer(this.currentVoiceId);
      this.lastAssistantText = answer;
      this.broadcastData({ type: 'assistant_text', text: answer });
      await this.speak(answer, activeTurnId);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_voice_runtime_state`);
      return;
    }

    // Deterministic Routing: Language switch (e.g. "Switch to English", "Switch back to English")
    const { detectLanguageSwitchRequest, setConversationLanguage, buildLanguageSwitchConfirmation } = await import('../jarvis/conversationLanguage.js');
    const langSwitch = detectLanguageSwitchRequest(text);
    if (langSwitch.isLanguageSwitch && langSwitch.targetLanguage) {
      const targetLang = langSwitch.targetLanguage;
      const convId = await this.ensureVoiceConversation();
      if (convId) {
        setConversationLanguage(convId, targetLang, true);
      }
      voiceRuntimeState.setLanguage(targetLang, undefined, true);
      const conf = buildLanguageSwitchConfirmation(targetLang);
      this.lastAssistantText = conf;
      this.broadcastData({ type: 'assistant_text', text: conf });
      await this.speak(conf, activeTurnId);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_language_switch`);
      return;
    }

    // Deterministic Routing: What time of day comes after morning?
    if (/\b(?:what\s+time\s+of\s+day\s+comes\s+after\s+morning|what\s+comes\s+after\s+morning)\b/i.test(lower)) {
      const answer = 'Afternoon comes after morning.';
      this.lastAssistantText = answer;
      this.broadcastData({ type: 'assistant_text', text: answer });
      await this.speak(answer, activeTurnId);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_conversational`);
      return;
    }

    // Deterministic Routing: What is the active voice?
    if (/\b(?:what\s+is\s+the\s+active\s+voice|which\s+voice\s+is\s+active|current\s+active\s+voice)\b/i.test(lower)) {
      const currentVoice = this.currentVoiceId || voiceRuntimeState.getActiveVoice();
      const answer = `The active voice is ${currentVoice}.`;
      this.lastAssistantText = answer;
      this.broadcastData({ type: 'assistant_text', text: answer });
      await this.speak(answer, activeTurnId);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_active_voice`);
      return;
    }

    try {
    // 1. Trivial conversational intents answer locally and instantly. Guarded by
    //    utterance length so "hello, tell me what's inside Free Cash" is NOT
    //    short-circuited here — anything substantive must reach grounding.
    const wordCount = lower.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 6) {
      if (/\b(who|what) are you\b/.test(lower)) {
        const intro = 'I am Jarvis, your autonomous AI desktop operating assistant on LiveKit.';
        this.broadcastData({ type: 'assistant_text', text: intro });
        await this.speak(intro, activeTurnId);
        logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
        return;
      }
      if (/^(?:hey|hi|hello|good\s+(?:morning|afternoon|evening))\b/i.test(lower) && !/\b(open|start|run|launch|work|operate|show|go|view|browse|what|which|where)\b/i.test(lower)) {
        const greeting = 'Hey. What are we working on?';
        this.broadcastData({ type: 'assistant_text', text: greeting });
        await this.speak(greeting, activeTurnId);
        logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
        return;
      }
    }

    // 2. Safety gate, computed INDEPENDENTLY of the bridge so that a bridge
    //    throw, timeout, or missing conversation can never let a question about
    //    authoritative AgenticOS state fall through to generic chat.
    const { isProjectStateRequest } = await import('../jarvis/projectStateContext.js');
    const { GROUNDING_REFUSAL } = await import('./groundedTurnBridge.js');
    const requiresAuthoritativeState = isProjectStateRequest(text);
    logJRT('VOICE_STATE_GATE', `turn=${activeTurnId} requiresAuthoritativeState=${requiresAuthoritativeState}`);

    const refuseGrounded = async (reason: string) => {
      logJRT('VOICE_GROUNDING_REFUSED', `turn=${activeTurnId} reason=${reason}`);
      this.lastAssistantText = GROUNDING_REFUSAL;
      this.broadcastData({ type: 'assistant_text', text: GROUNDING_REFUSAL });
      await this.speak(GROUNDING_REFUSAL, activeTurnId);
      logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
    };

    // 3. Single runtime hierarchy: context/focus → entity → classification →
    //    { fast read | action | unknown | chat | deep supervisor }.
    const conversationId = await this.ensureVoiceConversation();
    if (!conversationId) {
      if (requiresAuthoritativeState) return await refuseGrounded('no_conversation');
    } else {
      try {
        const tRouterStart = Date.now();
        logJRT('ROUTER_START', `turn=${activeTurnId}`);
        console.log(`[JRT] ROUTER_START turn=${activeTurnId}`);

        const speechEndTime = this.turnSpeechEndTimes.get(activeTurnId) || (Date.now() - 300);
        const existingLat = this.turnLatencyMap.get(activeTurnId) || {
          turnId: activeTurnId,
          speechEnd: speechEndTime,
          finalTranscript: Date.now(),
        };
        existingLat.toolStart = tRouterStart;
        this.turnLatencyMap.set(activeTurnId, existingLat);

        const isConversationalAck = /^(?:yes,?\s+(?:that'?s\s+(?:right|correct|what\s+i\s+meant)|exactly)|correct|exactly|thank\s+you|thanks|okay,?\s+good|that'?s\s+what\s+i\s+meant|sounds\s+good|great|perfect|got\s+it|yes|yeah|sure)[.!]?$/i.test(lower);

        const isVisualOperation = !isConversationalAck &&
          /\b(comet\s+perplexity|inspect\s+browser|read\s+(?:the\s+)?browser|camera|holding|look at|showing|see me|inspect\s+screen|see\s+my\s+screen|desktop|word\s+window)\b/i.test(lower);

        if (this.currentAckTimer) {
          clearTimeout(this.currentAckTimer);
          this.currentAckTimer = null;
        }

        if (!isConversationalAck) {
          const elapsedSinceSpeechEnd = Date.now() - speechEndTime;
          // Deliver immediate acknowledgment within ~500-800ms of speech end for visual/perception operations
          const ackDelayMs = isVisualOperation
            ? Math.max(50, Math.min(800, 650 - elapsedSinceSpeechEnd))
            : 2000;

          this.currentAckTimer = setTimeout(() => {
            this.currentAckTimer = null;
            if (this.currentUserTurnId !== activeTurnId) return;
            if (!this.isProcessingUserTurn || this.isSpeaking) return;
            let ack = "I'm checking that now.";
            if (/\b(camera|holding|look at me|showing|see me)\b/i.test(lower)) {
              ack = "I'm checking the camera now.";
            } else if (/\b(comet|perplexity)\b/i.test(lower)) {
              ack = "I'm reading the Comet page now.";
            } else if (/\b(?:read|inspect|what\s+is\s+on)\s+(?:the\s+)?(?:browser|page|webpage)\b/i.test(lower)) {
              ack = "I'm reading the active browser page now.";
            } else if (/\b(desktop|screen)\b/i.test(lower)) {
              ack = "I'm inspecting the screen now.";
            } else if (/\b(word)\b/i.test(lower)) {
              ack = "I'm inspecting the Word window now.";
            } else if (/\b(hermes)\b/i.test(lower)) {
              ack = "I'm checking Hermes now.";
            } else if (/\b(telegram)\b/i.test(lower)) {
              ack = "I'm inspecting Telegram now.";
            }
            logger.info(`[JarvisNext] Spoken truthful acknowledgment (~650ms after speech-end) for turn #${activeTurnId}: "${ack}"`);
            const lat = this.turnLatencyMap.get(activeTurnId);
            if (lat) {
              lat.firstLlmToken = Date.now();
              lat.immediateAckSpoken = true;
            }
            this.broadcastData({ type: 'assistant_text', text: ack });
            void this.speak(ack, activeTurnId, { preliminaryAck: true });
          }, ackDelayMs);
        }

        const { routeTurn } = await import('./turnRouter.js');
        const routed = await routeTurn({
          prompt: text,
          conversationId,
          turnId: activeTurnId,
          rawStt: text,
          confidence,
          isBargeIn,
          isStale: () => this.currentUserTurnId !== activeTurnId,
          onActionProgress: (progress) => {
            this.broadcastData({
              type: 'action_status',
              ...progress,
            });
          },
        });

        if (this.currentAckTimer) {
          clearTimeout(this.currentAckTimer);
          this.currentAckTimer = null;
        }

        // RC1: if the preliminary acknowledgement is still playing when the router
        // returns, stop it now. Aborting the playout advances currentAssistantPlayoutId
        // so the ack's own finally block can neither release the turn latch nor drain
        // follow-ups, and the real answer below takes the channel immediately instead
        // of being coalesced behind the acknowledgement.
        if (this.isSpeaking && this.speechOwnerTurnId === activeTurnId) {
          this.interruptAssistantPlayout('router_result_ready');
        }

        const tRouterEnd = Date.now();
        existingLat.intentReady = tRouterEnd;
        existingLat.route = routed.route;
        if (!existingLat.firstLlmToken) {
          existingLat.firstLlmToken = tRouterEnd;
        }

        const routerDurationMs = tRouterEnd - tRouterStart;
        logJRT('ROUTER_END', `turn=${activeTurnId} durationMs=${routerDurationMs}`);
        console.log(`[JRT] ROUTER_END turn=${activeTurnId} durationMs=${routerDurationMs}`);
        logJRT('ROUTER_RESULT', `turn=${activeTurnId} durationMs=${routerDurationMs} route=${routed.route}`);
        console.log(`[JRT] ROUTER_RESULT turn=${activeTurnId} durationMs=${routerDurationMs}`);

        if (this.currentUserTurnId !== activeTurnId) {
          logger.info('[JarvisNext] Turn cancelled: stale check failed on routed path.');
          this.releaseTurnLatch('stale_check_routed');
          return;
        }

        if (routed.handled) {
          if (!routed.text || !routed.text.trim()) {
            const lat = this.turnLatencyMap.get(activeTurnId);
            if (lat?.immediateAckSpoken) {
              const fallbackCompletion = "I have checked the system, but no specific action or target window was found.";
              this.lastAssistantText = fallbackCompletion;
              this.broadcastData({ type: 'assistant_text', text: fallbackCompletion });
              await this.speak(fallbackCompletion, activeTurnId);
              logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=ack_fallback_delivered`);
              return;
            }
            logger.info('[JarvisNext] Turn handled silently (quiet recovery).');
            this.consecutiveClarifications = 0;
            this.releaseTurnLatch('quiet_recovery');
            this.broadcastData({
              type: 'status',
              state: 'listening',
              isSpeaking: false,
              isListening: true,
            });
            logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=quiet_recovery`);
            return;
          }

          const isClarification = /couldn't make that out/i.test(routed.text);
          if (isClarification) {
            if (isBargeIn || isLikelyControlAttempt(text) || this.consecutiveClarifications >= 1) {
              logger.info('[JarvisNext] Clarification suppressed for barge-in / control attempt / consecutive — failing quietly into silent listening.');
              this.consecutiveClarifications = 0;
              this.releaseTurnLatch('quiet_clarification_suppressed');
              this.broadcastData({
                type: 'status',
                state: 'listening',
                isSpeaking: false,
                isListening: true,
              });
              logJRT('TURN_COMPLETE', `turn=${activeTurnId} reason=quiet_clarification_suppressed`);
              return;
            }
            this.consecutiveClarifications++;
          } else {
            this.consecutiveClarifications = 0;
          }

          this.lastAssistantText = routed.text;
          if (routed.route === 'navigate' && routed.uiRoute) {
            this.broadcastData({
              type: 'navigation',
              route: routed.uiRoute,
              entityId: routed.entityId,
              entityType: routed.entityType,
              entityName: routed.entityName,
            });
          } else if (routed.route === 'browser') {
            this.broadcastData({
              type: 'browser_navigation',
              target: routed.entityName,
              text: routed.text,
            });
          }
          this.broadcastData({ type: 'assistant_text', text: routed.text });
          logJRT('RESPONSE_READY', `turn=${activeTurnId} text_length=${routed.text?.length || 0}`);
          console.log(`[JRT] RESPONSE_READY turn=${activeTurnId} text_length=${routed.text?.length || 0}`);

          const rawSttText = turnMeta?.whisperFinal || text;
          const parsedIntent = (routed as any).goalDescription || (routed as any).plan?.goalDescription || (routed as any).plan?.steps?.[0]?.description || routed.route;
          const execTrace = [
            `PHYSICAL_EXECUTION_TRACE:`,
            `TURN_ID=${activeTurnId}`,
            `RAW_STT_TRANSCRIPT=${rawSttText}`,
            `NORMALIZED_TRANSCRIPT=${text}`,
            `PARSED_USER_INTENT=${parsedIntent}`,
            `PARSED_GOAL=${routed.route}`,
            `ROUTE=${routed.route}`,
            `FINAL_RESPONSE=${routed.text}`,
          ].join('\n');
          console.log(`[JRT] ${execTrace}`);
          logger.info('[JRT] PHYSICAL_EXECUTION_TRACE', { trace: execTrace });
          logJRT('PHYSICAL_EXECUTION_TRACE', `\n${execTrace}`);

          voiceHealthMonitor.recordTurn({
            turnId: activeTurnId,
            captureStart: turnMeta?.captureStart || Date.now(),
            captureStop: turnMeta?.captureStop || Date.now(),
            rawDurationMs: turnMeta?.rawDurationMs || 0,
            rawPcmBytes: turnMeta?.rawPcmBytes || 0,
            vadSpeechStart: turnMeta?.vadStart || Date.now(),
            vadSpeechEnd: turnMeta?.vadEnd || Date.now(),
            endpointReason: turnMeta?.boundaryReason || 'vad_silence',
            wavPath: turnMeta?.wavPath || '',
            whisperFinalTranscript: turnMeta?.whisperFinal || text,
            routerTranscript: text,
            normalizedTranscript: text,
            route: routed.route,
            finalResponse: routed.text,
            isBargeIn: Boolean(isBargeIn),
            isAbnormalEarlyEndpoint: (turnMeta?.rawDurationMs || 0) < 1200 && isClarification,
            isClarification,
            isBareEntityFallback: /what would you like me to do with|do you want me to open it, check its status/i.test(routed.text),
          });

          // Guard: silent routes (e.g. declarative statement memory seeding) return
          // empty text intentionally — do not synthesize TTS for empty strings.
          if (routed.text?.trim()) {
            await this.speak(routed.text, activeTurnId);
          } else {
            logger.debug('[JarvisNext] Silent route — no speech generated.', { route: routed.route, turn: activeTurnId });
            const lat = this.turnLatencyMap.get(activeTurnId);
            if (lat) {
              lat.ttsFirstChunk = Date.now();
              lat.playbackFirstAudio = Date.now();
              lat.playbackComplete = Date.now();
              lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
              lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
              lat.status = 'ANSWERED';
              voiceLatencyTracker.record(lat as TurnLatencyRecord);
            }
          }
          logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=${routed.route}`);
          return;
        }

        // Not handled: state questions refuse rather than guess.
        if (requiresAuthoritativeState) {
          return await refuseGrounded(routed.fallbackReason || 'no_evidence');
        }
      } catch (routerErr: any) {
        logger.warn('[JarvisNext] Turn router error:', routerErr?.message || routerErr);
        if (requiresAuthoritativeState) {
          return await refuseGrounded(`router_error: ${routerErr?.message || routerErr}`);
        }
      }
    }

    // 3. Legacy deterministic operator path (kept as a secondary fallback).
    try {
      const opResult = await operatorController.handleIntent(text);
      if (this.currentUserTurnId !== activeTurnId) {
        logger.info(`[JarvisNext] Turn cancelled: stale check failed on Operator path.`);
        this.releaseTurnLatch('stale_check_operator');
        return;
      }

      if (opResult.handled && opResult.response) {
        logger.info('[JarvisNext] Operator handled intent:', { intent: opResult.intent, missionId: opResult.missionId });
        this.lastAssistantText = opResult.response;
        this.broadcastData({ type: 'assistant_text', text: opResult.response });
        await this.speak(opResult.response, activeTurnId);
        logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
        return;
      }
    } catch (opErr) {
      logger.warn('[JarvisNext] Operator handle error:', opErr);
    }

    if (this.currentUserTurnId !== activeTurnId) {
      logger.info(`[JarvisNext] Turn cancelled: stale check failed after Operator.`);
      this.releaseTurnLatch('stale_check_after_operator');
      return;
    }

    // Operational requests that reached here have no grounded answer available.
    // Generic chat below is reachable ONLY by non-operational conversation.
    if (requiresAuthoritativeState) {
      return await refuseGrounded('operator_fallthrough');
    }

    // 2. Primary Route: Route reasoning through configured Codex Integration via llmChat
    this.broadcastData({ type: 'status', state: 'thinking', isSpeaking: false, isListening: true });
    try {
      logJRT('LLM_BEGIN', `turn=${activeTurnId}`);
      const chatResult = await llmChat({
        agentId: 'agent-jarvis',
        systemPrompt:
          'You are Jarvis, an advanced AI desktop operating assistant on AgenticOS. This voice session is in English. Reply in English. You are speaking directly to the user over voice. Respond concisely and clearly in 1 to 2 natural sentences without markdown, asterisks, code blocks, or bullet lists.',
        prompt: text,
      });

      if (this.currentUserTurnId !== activeTurnId) {
        logger.info(`[JarvisNext] Turn cancelled: stale check failed on LLM path.`);
        this.releaseTurnLatch('stale_check_llm');
        return;
      }

      const reply = chatResult.reply?.trim();
      if (reply) {
        logJRT('LLM_RESULT', `turn=${activeTurnId} provider=${chatResult.provider} length=${reply.length}`);
        logger.info(`[JarvisNext] Codex reasoning reply received (turn #${activeTurnId}):`, {
          provider: chatResult.provider,
          model: chatResult.model,
          length: reply.length,
        });
        this.lastAssistantText = reply;
        this.broadcastData({ type: 'assistant_text', text: reply });
        await this.speak(reply, activeTurnId);
        logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
        return;
      } else {
        logger.warn(`[JarvisNext] LLM returned empty content on turn #${activeTurnId}.`);
      }
    } catch (err: any) {
      logJRT('LLM_ERROR', `${err?.message || err} turn=${activeTurnId}`);
      logger.warn(`[JarvisNext] llmChat error on turn #${activeTurnId} (${err?.message}), using fallback.`);
    }

    if (this.currentUserTurnId !== activeTurnId) {
      this.releaseTurnLatch('stale_check_fallback');
      return;
    }

    const fallbackReply = 'I could not get a response from the reasoning service. Please try again.';
    this.broadcastData({ type: 'assistant_text', text: fallbackReply });
    await this.speak(fallbackReply, activeTurnId);
    logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
    } finally {
      if (!this.isSpeaking && !this.isSynthesizing) {
        this.releaseTurnLatch('turn_finished_idle');
      }
    }
  }

  /**
   * After the owner playout genuinely completed, speak everything that was
   * coalesced behind it — as ONE merged utterance, so a burst of secondary
   * events still produces a single follow-up response, not a barrage.
   */
  private async drainFollowUpSpeech(): Promise<void> {
    if (!this.pendingCoalesced.length) return;
    const currentTurn = this.currentUserTurnId;
```

### 2.6 `drainFollowUpSpeech()` and `speak()` — complete (headless path, stale-turn guard, ownership gate, playout loop, completion/finally latch handling)
```ts
  private async drainFollowUpSpeech(): Promise<void> {
    if (!this.pendingCoalesced.length) return;
    const currentTurn = this.currentUserTurnId;
    // Discard any items that do not belong to the current active turn
    const validItems = this.pendingCoalesced.filter(item => item.originTurnId === currentTurn);
    this.pendingCoalesced = [];
    if (!validItems.length) {
      logJRT('FOLLOWUP_SPEECH_DROPPED_STALE', `turn=${currentTurn}`);
      return;
    }
    const merged = validItems.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
    if (!merged || this.isSuspended || !this.room?.isConnected || !this.audioSource) return;
    if (this.isSpeaking || this.isSynthesizing) {
      this.pendingCoalesced.unshift(...validItems);
      return;
    }
    logJRT('FOLLOWUP_SPEAK_BEGIN', `segments_merged_note turns_pending=1`);
    console.log(`[JRT] FOLLOWUP_SPEAK turn=${currentTurn} chars=${merged.length}`);
    await this.speak(merged, currentTurn).catch((err: any) => {
      logger.warn('[JarvisNext] Follow-up coalesced speech failed:', err?.message);
    });
  }

  public async speak(
    text: string,
    turnId?: number,
    opts?: { preliminaryAck?: boolean }
  ): Promise<void> {
    if (this.isSuspended) {
      logger.info(`[JarvisNext] Cannot speak: agent is SUSPENDED. Dropping speech request: "${text}"`);
      this.isProcessingUserTurn = false;
      return;
    }

    if (!this.audioSource || !this.room?.isConnected) {
      logger.info('[JarvisNext] Audio source not connected to LiveKit room; synthesizing in headless mode');
      const activeTurnId = turnId ?? this.currentUserTurnId;
      try {
        const synthOpts = { rate: this.currentRate, pitch: this.currentPitch };
        const voiceToUse = this.currentVoiceId || 'aura-helios-en';
        const tSynthStart = Date.now();
        const mp3Buffer = await synthesizeLocally(text, voiceToUse, synthOpts);
        const tSynthEnd = Date.now();
        const lat = this.turnLatencyMap.get(activeTurnId);
        if (lat) {
          lat.ttsFirstChunk = tSynthStart + Math.min(200, tSynthEnd - tSynthStart);
          lat.playbackFirstAudio = tSynthEnd;
          lat.playbackComplete = tSynthEnd + 50;
          lat.playbackCompleteAt = lat.playbackComplete;
          lat.generationCompleteAt = tSynthEnd;
          lat.voiceProvider = this.currentVoiceId?.includes('voicestudio') ? 'voicestudio' : (this.currentVoiceId?.startsWith('aura-') ? 'deepgram' : 'edge-tts');
          lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
          lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
          lat.status = 'ANSWERED';
          voiceLatencyTracker.record(lat as TurnLatencyRecord);
        }
      } catch (err: any) {
        logger.warn('[JarvisNext] Headless synthesis failed:', err?.message);
      }
      this.isProcessingUserTurn = false;
      return;
    }

    // ── Stale turn cancellation ─────────────────────────────────────────────
    // If the caller provided an explicit turnId (background speech), verify it
    // still matches the current active user turn BEFORE starting synthesis.
    if (turnId !== undefined && turnId !== this.currentUserTurnId) {
      logger.info('[JarvisNext] STALE_SPEECH_DROP: speak() called with stale turnId', {
        requestedTurnId: turnId, currentTurnId: this.currentUserTurnId,
      });
      console.log(`[JRT] STALE_SPEECH_DROP requestedTurn=${turnId} currentTurn=${this.currentUserTurnId}`);
      this.isProcessingUserTurn = false;
      return;
    }

    const activeTurnId = turnId ?? this.currentUserTurnId;
    this.speakRequestCount.set(activeTurnId, (this.speakRequestCount.get(activeTurnId) || 0) + 1);
    logJRT('SPEAK_REQUEST', `turn=${activeTurnId} count=${this.speakRequestCount.get(activeTurnId)} source=speak`);

    // ── OWNERSHIP GATE (one spoken response per turn) ────────────────────
    // If a playout for THIS turn is already synthesizing or speaking, a new
    // speak() must NOT take the voice channel by cancelling it — that is the
    // defect that cut off final words on playouts #19/#22/#27. Coalesce the
    // secondary text; it is merged into a single follow-up utterance once the
    // owner completes. Legitimate cancellation stays where it belongs:
    // interruptAssistantPlayout() / handleStopCommand() only.
    if (this.speechOwnerTurnId === activeTurnId && (this.isSynthesizing || this.isSpeaking)) {
      this.pendingCoalesced.push({ text, originTurnId: activeTurnId, timestamp: Date.now() });
      console.log(`[JRT] SPEAK_COALESCED turn=${activeTurnId} depth=${this.pendingCoalesced.length}`);
      logJRT('SPEAK_COALESCED', `turn=${activeTurnId} depth=${this.pendingCoalesced.length} source=speak`);
      return;
    }
    // A different turn wants the channel while an owner still holds it and is
    // actively playing: do not steal mid-sentence either.
    if (this.speechOwnerTurnId !== null && (this.isSynthesizing || this.isSpeaking)
        && this.speechOwnerTurnId !== activeTurnId && this.foregroundTurnActive) {
      // NOTE: Strictly drop speech from an older superseded turn!
      if (activeTurnId < this.currentUserTurnId) {
        console.log(`[JRT] STALE_SPEECH_DROP_OLDER_TURN active=${activeTurnId} current=${this.currentUserTurnId}`);
        logger.info('[JarvisNext] STALE_SPEECH_DROP_OLDER_TURN: Dropping speech from superseded turn', { activeTurnId, currentTurnId: this.currentUserTurnId });
        return;
      }
      this.pendingCoalesced.push({ text, originTurnId: activeTurnId, timestamp: Date.now() });
      console.log(`[JRT] SPEAK_COALESCED turn=${activeTurnId} queued_behind_owner=${this.speechOwnerTurnId}`);
      logJRT('SPEAK_COALESCED', `turn=${activeTurnId} queued_behind_owner=${this.speechOwnerTurnId} source=speak`);
      return;
    }

    // Free channel (or a residual owner that stopped playing) — take ownership.
    // Only NOW is the playout id advanced, and only by the new owner itself;
    // stale frame-pumps from a *completed* playout cannot be mid-loop because
    // playFrames always exits when the id mismatches (that check stays).
    const playoutId = ++this.currentAssistantPlayoutId;
    if (opts?.preliminaryAck) {
      // RC1: remember that this playout is only an acknowledgement, so that its
      // completion cannot terminate the turn that is still being routed.
      this.preliminaryAckPlayoutIds.add(playoutId);
    }
    this.speechOwnerTurnId = activeTurnId;
    const tTtsStart = Date.now();
    logJRT('TTS_REQUEST', `turn=${activeTurnId} playout=${playoutId} source=speak speak_requests=${this.speakRequestCount.get(activeTurnId)}`);
    console.log(`[JRT] TTS_REQUEST turn=${activeTurnId} playout=${playoutId} RESPONSE_OWNER=speak#${this.speakRequestCount.get(activeTurnId)}`);

    this.lastAssistantText = text;
    this.isSynthesizing = true;
    voiceRuntimeState.setPlaybackState('synthesizing');
    this.isSpeaking = false;
    if (this.isProcessingUserTurn || (turnId !== undefined && turnId === this.currentUserTurnId)) {
      this.foregroundTurnActive = true;
    }

    this.broadcastData({
      type: 'status',
      state: 'thinking',
      isSpeaking: false,
      isListening: true,
      text,
    });

    // ── TTS trace: log the exact text reaching synthesis ────────────────────
    logJRT('TTS_NORMALIZED_TEXT', `turn=${activeTurnId} playout=${playoutId} text="${text.replace(/"/g, "'")}"`);
    console.log(`[JRT] TTS_NORMALIZED_TEXT turn=${activeTurnId} text="${text.slice(0, 120)}"`);
    logger.info(`[JarvisNext] Synthesizing speech (playout #${playoutId}):`, text);

    let hasPublishedFirstFrame = false;
    let totalPublishedFrames = 0;
    let totalExpectedFrames = 0;
    let tSynthEnd = tTtsStart;

    try {
      // ── FIX: Protect decimal numbers before sentence splitting ─────────────
      // The regex [^.!?]+ stops at ANY period, including "2." in "2.6".
      // Without protection, "Xiaomi MiMo 2.6 Flash" splits at "2.", producing
      // orphan sentence "6 Flash..." which TTS renders as "Six Flash".
      // U+2024 ONE DOT LEADER is visually identical but not in [.!?] charset.
      const protectedText = text.replace(/(\d)\.(\d)/g, '$1\u2024$2');
      const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
      const sentences = (protectedText.match(sentenceRegex) || [protectedText])
        .map((s) => s.replace(/\u2024/g, '.').trim())
        .filter(Boolean);

      const playFrames = async (frames: any[]) => {
        const frameStartTime = Date.now();
        for (let i = 0; i < frames.length; i++) {
          if (
            this.currentAssistantPlayoutId !== playoutId ||
            !this.room?.isConnected ||
            !this.audioSource
          ) {
            logger.info(`[JarvisNext] Speech playout aborted mid-stream (playout #${playoutId})!`);
            break;
          }

          if (!hasPublishedFirstFrame) {
            hasPublishedFirstFrame = true;
            const tFirstAudio = Date.now();
            const lat = this.turnLatencyMap.get(activeTurnId);
            if (lat && !lat.playbackFirstAudio) {
              lat.playbackFirstAudio = tFirstAudio;
            }
            logJRT('PLAYOUT_STARTED', `turn=${activeTurnId} playout=${playoutId}`);
            console.log(`[JRT] PLAYOUT_STARTED turn=${activeTurnId} playout=${playoutId}`);
            logJRT('LIVEKIT_FIRST_FRAME', `turn=${activeTurnId} playout=${playoutId}`);
            console.log(`[JRT] LIVEKIT_FIRST_FRAME turn=${activeTurnId}`);
            const speechEndTime = this.turnSpeechEndTimes.get(activeTurnId) || (Date.now() - 500);
            const vadEndTime = this.turnVadEndTimes.get(activeTurnId) || (Date.now() - 200);
            const physicalToAudible = Date.now() - speechEndTime;
            const vadToAudible = Date.now() - vadEndTime;
            logJRT('CLIENT_FIRST_AUDIO', `turn=${activeTurnId} totalSinceSpeechEndMs=${physicalToAudible}`);
            logJRT('FIRST_AUDIBLE_CLIENT_AUDIO', `turn=${activeTurnId} physicalToAudibleMs=${physicalToAudible} vadToAudibleMs=${vadToAudible}`);
            console.log(`[JRT] FIRST_AUDIBLE_CLIENT_AUDIO turn=${activeTurnId} physicalToAudibleMs=${physicalToAudible} vadToAudibleMs=${vadToAudible}`);
            logJRT('FIRST_AUDIO', `turn=${activeTurnId} playout=${playoutId} latencyMs=${Date.now() - tTtsStart}`);
            console.log(`[JRT] FIRST_AUDIO turn=${activeTurnId} latencyMs=${Date.now() - tTtsStart}`);
          }

          try {
            await this.audioSource.captureFrame(frames[i]);
            totalPublishedFrames++;
          } catch (frameErr: any) {
            logger.warn('[JarvisNext] AudioSource.captureFrame error:', frameErr?.message);
            break;
          }

          // Real-time pacing (20ms/frame) so isSpeaking stays truthful to real physical speaker output
          const targetTime = frameStartTime + (i + 1) * 20;
          const waitMs = targetTime - Date.now();
          if (waitMs > 1) {
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }
      };

      const synthOpts = { rate: this.currentRate, pitch: this.currentPitch };
      const voiceToUse = this.currentVoiceId || 'aura-helios-en';

      if (sentences.length <= 1) {
        const mp3Buffer = await synthesizeLocally(text, voiceToUse, synthOpts);
        tSynthEnd = Date.now();
        if (this.currentAssistantPlayoutId !== playoutId) {
          this.isProcessingUserTurn = false;
          return;
        }

        const frames = await mp3ToPcmFrames(mp3Buffer, 24000, 20);
        totalExpectedFrames = frames.length;
        if (this.currentAssistantPlayoutId !== playoutId) {
          this.isProcessingUserTurn = false;
          this.foregroundTurnActive = false;
          return;
        }

        const tFirstPcm = Date.now();
        const lat = this.turnLatencyMap.get(activeTurnId);
        if (lat && !lat.ttsFirstChunk) {
          lat.ttsFirstChunk = tFirstPcm;
        }
        logJRT('TTS_READY', `turn=${activeTurnId} playout=${playoutId} durationMs=${tFirstPcm - tTtsStart}`);
        console.log(`[JRT] TTS_READY turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_FIRST_PCM', `turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart} frames=${frames.length}`);
        console.log(`[JRT] TTS_FIRST_PCM turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_AUDIO_READY', `playout=${playoutId} frames=${frames.length} voice=${voiceToUse}`);

        this.isSynthesizing = false;
        this.isSpeaking = true;
        voiceRuntimeState.setPlaybackState('speaking');
        this.speechStartTime = Date.now();
        this.lastPlayoutStartedAt = this.speechStartTime;
        this.consecutiveBargeInFrames = 0;
        this.setMicState('JARVIS_SPEAKING', 'tts_playout_start');

        this.broadcastData({
          type: 'status',
          state: 'speaking',
          isSpeaking: true,
          isListening: true,
          text,
          voiceId: voiceToUse,
          voiceProfile: this.currentVoiceProfile,
        });

        await playFrames(frames);
      } else {
        // Multi-sentence: Synthesize sentence 0 immediately for sub-second first-audio
        const s0Promise = synthesizeLocally(sentences[0], voiceToUse, synthOpts)
          .then((b) => mp3ToPcmFrames(b, 24000, 20))
          .catch((err) => {
            logger.warn(`[JarvisNext] s0 synthesis failed: ${err?.message}`);
            return [];
          });
        const remainingPromise = Promise.all(
          sentences.slice(1).map((s) =>
            synthesizeLocally(s, voiceToUse, synthOpts)
              .then((b) => mp3ToPcmFrames(b, 24000, 20))
              .catch((err) => {
                logger.warn(`[JarvisNext] remaining sentence synthesis failed: ${err?.message}`);
                return [];
              })
          )
        );

        const s0Frames = await s0Promise;
        tSynthEnd = Date.now();
        if (this.currentAssistantPlayoutId !== playoutId) {
          this.isProcessingUserTurn = false;
          this.foregroundTurnActive = false;
          return;
        }

        const tFirstPcm = Date.now();
        const lat = this.turnLatencyMap.get(activeTurnId);
        if (lat && !lat.ttsFirstChunk) {
          lat.ttsFirstChunk = tFirstPcm;
        }
        logJRT('TTS_READY', `turn=${activeTurnId} playout=${playoutId} durationMs=${tFirstPcm - tTtsStart}`);
        console.log(`[JRT] TTS_READY turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_FIRST_PCM', `turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart} frames=${s0Frames.length}`);
        console.log(`[JRT] TTS_FIRST_PCM turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
        logJRT('TTS_AUDIO_READY', `playout=${playoutId} sentence=0 frames=${s0Frames.length}`);

        this.isSynthesizing = false;
        this.isSpeaking = true;
        voiceRuntimeState.setPlaybackState('speaking');
        this.speechStartTime = Date.now();
        this.lastPlayoutStartedAt = this.speechStartTime;
        this.consecutiveBargeInFrames = 0;
        this.setMicState('JARVIS_SPEAKING', 'tts_playout_start');

        this.broadcastData({
          type: 'status',
          state: 'speaking',
          isSpeaking: true,
          isListening: true,
          text,
        });

        // Start playing sentence 0 in real time while subsequent sentences finish synthesis
        const subsequentFrameSetsPromise = remainingPromise;
        await playFrames(s0Frames);

        const subsequentFrameSets = await subsequentFrameSetsPromise;
        totalExpectedFrames = s0Frames.length + subsequentFrameSets.reduce((sum, f) => sum + f.length, 0);

        if (this.currentAssistantPlayoutId === playoutId) {
          for (const remainingFrames of subsequentFrameSets) {
            if (this.currentAssistantPlayoutId !== playoutId) break;
            await playFrames(remainingFrames);
          }
        }
      }

      this.lastPlayoutFrames = totalPublishedFrames;
      logJRT('TTS_PUBLISHED', `playout=${playoutId} frames=${totalPublishedFrames}`);

      // Track GENERATION-COMPLETE separately from PLAYBACK-COMPLETE
      const generationCompleteAt = tSynthEnd;
      logJRT('TTS_GENERATION_COMPLETE', `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);

      // Allow physical speaker audio drain (~280ms) so final word/sentence is never cut off
      if (this.currentAssistantPlayoutId === playoutId && totalPublishedFrames > 0) {
        voiceRuntimeState.setPlaybackState('draining');
        await new Promise((r) => setTimeout(r, 280));
      }
      const playbackCompleteAt = Date.now();
      logJRT('TTS_PLAYBACK_COMPLETE', `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);
    } catch (err: any) {
      logger.error(`[JarvisNext] Speech error on playout #${playoutId}:`, err);
    } finally {
      voiceRuntimeState.setPlaybackState('idle');
      const playbackActualDurationMs = totalPublishedFrames * 20;
      const playbackCompleted = this.currentAssistantPlayoutId === playoutId && totalPublishedFrames >= totalExpectedFrames;
      const playbackAborted = !playbackCompleted;
      const abortReason = this.playoutCancellation?.reason || (playbackCompleted ? 'none' : 'aborted_early');

      const lat = this.turnLatencyMap.get(activeTurnId);
      if (lat && this.currentAssistantPlayoutId === playoutId) {
        lat.ttsFirstChunk = lat.ttsFirstChunk || tTtsStart;
        lat.playbackFirstAudio = lat.playbackFirstAudio || this.speechStartTime || Date.now();
        lat.playbackComplete = Date.now();
        lat.playbackCompleteAt = lat.playbackComplete;
        lat.generationCompleteAt = tSynthEnd;
        lat.voiceProvider = voiceRuntimeState.getActiveTtsProvider() || (this.currentVoiceId?.includes('voicestudio') ? 'voicestudio' : (this.currentVoiceId?.startsWith('aura-') ? 'deepgram' : 'edge-tts'));
        lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
        lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
        lat.status = playbackAborted ? 'BLOCKED' : (this.turnLastError ? 'FAILED' : 'ANSWERED');
        voiceLatencyTracker.record(lat as TurnLatencyRecord);
        voiceRuntimeState.setLatency(lat.speechEndToFirstAudioMs, lat.totalTurnMs);
      }

      this.logSpeechLifecycle({
        turnId: activeTurnId,
        generationId: playoutId,
        userSttText: this.lastUserText || '',
        responseTextFull: text,
        ttsInputText: text,
        ttsVoiceId: this.currentVoiceId || 'aura-helios-en',
        ttsProfile: this.currentVoiceProfile,
        ttsSynthStart: tTtsStart,
        ttsSynthEnd: tSynthEnd,
        generatedAudioDurationMs: totalExpectedFrames * 20,
        playbackRequest: tTtsStart,
        playbackStart: this.speechStartTime,
        playbackExpectedDurationMs: totalExpectedFrames * 20,
        playbackActualDurationMs,
        playbackEnd: Date.now(),
        playbackCompleted,
        playbackAborted,
        playbackAbortReason: abortReason,
        activeTurnAtPlaybackStart: activeTurnId,
        activeTurnAtPlaybackEnd: this.currentUserTurnId,
        micActiveDuringTts: this.activeStreams.length > 0,
        vadTriggeredDuringTts: this.vadTriggeredDuringTts,
        sttTriggeredDuringTts: this.sttTriggeredDuringTts,
        interruptingAudioSource: this.interruptingAudioSource,
        interruptingEventType: this.interruptingEventType,
      });

      if (this.currentAssistantPlayoutId === playoutId) {
        // RC1: a preliminary acknowledgement is NOT the turn's answer. Its playout
        // completing must not release the turn latch, reopen the microphone, or
        // drain follow-ups — the originating turn is still being routed and its
        // real answer has to stay associated with it. The answer's own playout
        // performs the normal release.
        const isPreliminaryAck = this.preliminaryAckPlayoutIds.delete(playoutId);
        this.isSynthesizing = false;
        this.isSpeaking = false;
        if (!isPreliminaryAck) {
          this.foregroundTurnActive = false;
        }
        // The owner's audio reached its end: the voice channel is released.
        // Coalesced follow-ups (queued while this response owned the channel)
        // now get one merged utterance — never by cancelling, only after.
        this.speechOwnerTurnId = null;
        logJRT('PLAYOUT_COMPLETED', `turn=${activeTurnId} playout=${playoutId} preliminaryAck=${isPreliminaryAck} speak_requests=${this.speakRequestCount.get(activeTurnId) || 0} coalesced_pending=${this.pendingCoalesced.length}`);
        if (!isPreliminaryAck) {
          this.setMicState('LISTENING', 'playout_complete');
        }
        // Our own audio reached its end without being cancelled: this is the
        // AUDIO_ENDED the lifecycle requires before returning to LISTENING.
        this.lastPlayoutEndedAt = Date.now();
        this.playoutCancellation = null;
        logJRT('TTS_AUDIO_ENDED', `playout=${playoutId} frames=${this.lastPlayoutFrames}`);
        console.log(`[JRT] TTS_AUDIO_ENDED playout=${playoutId} frames=${this.lastPlayoutFrames}`);
        logJRT('AUDIO_END', `turn=${activeTurnId} playout=${playoutId} totalPlayoutMs=${Date.now() - tTtsStart}`);
        console.log(`[JRT] AUDIO_END turn=${activeTurnId} playout=${playoutId} totalPlayoutMs=${Date.now() - tTtsStart}`);
        if (!isPreliminaryAck) {
          // RC1: an acknowledgement must never release the turn latch or clear the
          // watchdog for a turn that is still in flight. When the ack is the last
          // playout of an aborted/older turn the next real playout or the turn's
          // own terminal path performs this release.
          setTimeout(() => {
            if (this.currentAssistantPlayoutId === playoutId) {
              this.isProcessingUserTurn = false;
              this.foregroundTurnActive = false;
              this.turnLatchAcquiredAt = null;
              if (this.turnWatchdog) {
                clearTimeout(this.turnWatchdog);
                this.turnWatchdog = null;
              }
              // ONE follow-up utterance for everything coalesced behind this
              // response, then the arbiter's own P2/P3 queue.
              void this.drainFollowUpSpeech().then(() => speechArbiter.onUserTurnComplete()).catch(() => {});
            }
          }, 400);
        }
        this.broadcastData({
          type: 'status',
          state: 'listening',
          isSpeaking: false,
          isListening: true,
        });
      } else {
        // RC1: this playout was superseded before it could own the channel —
        // drop any acknowledgement bookkeeping associated with it.
        this.preliminaryAckPlayoutIds.delete(playoutId);
        this.foregroundTurnActive = false;
        this.isProcessingUserTurn = false;
        this.releaseTurnLatch('playout_aborted');
      }
    }
  }

  public broadcastData(payload: Record<string, unknown>): void {
    if (!this.room?.localParticipant) return;
    try {
      const json = JSON.stringify(payload);
      const data = new TextEncoder().encode(json);
      void this.room.localParticipant.publishData(data, { reliable: true }).catch((err: any) => {
        logger.debug('[JarvisNext] Failed to broadcast data message:', err?.message);
      });
    } catch (err: any) {
      logger.debug('[JarvisNext] Failed to broadcast data message:', err?.message);
    }
  }

  public waitForNavigationAck(navigationId: string, timeoutMs = 1500): Promise<NavigationAckPayload | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingNavigationAcks.delete(navigationId);
        resolve(null);
      }, timeoutMs);

      this.pendingNavigationAcks.set(navigationId, (ack) => {
        clearTimeout(timer);
        this.pendingNavigationAcks.delete(navigationId);
        resolve(ack);
      });
    });
  }
```
### 2.7 Complete `git diff` for `jarvisNextAgent.ts` (the only tracked file this task modified)

TASK-AUTHORED hunks are identifiable by the literals `preliminaryAckPlayoutIds`, `preliminaryAck`, `RC1:`, `RC3:` (13 sites).
ALL OTHER hunks in this diff are UNRELATED PRE-EXISTING uncommitted branch work (AntiGravity delegation, latency instrumentation, supersession logic, ack mechanism itself) that existed before this task and was not authored by it.

```diff
diff --git a/server/src/domains/jarvisNext/jarvisNextAgent.ts b/server/src/domains/jarvisNext/jarvisNextAgent.ts
index d11c6c0..fcaaea9 100644
--- a/server/src/domains/jarvisNext/jarvisNextAgent.ts
+++ b/server/src/domains/jarvisNext/jarvisNextAgent.ts
@@ -27,6 +27,7 @@ import { beginNavigation, completeNavigation } from '../../services/navigation/n
 import { mp3ToPcmFrames, pcmChunksToWav, isSelfHearingEcho } from './audioUtils.js';
 import { synthesizeLocally } from '../../services/voice/localTts.js';
 import { transcribeLocally } from '../../services/voice/localTranscribe.js';
+import { voiceRuntimeState } from '../../services/voice/VoiceRuntimeState.js';
 import { operatorController } from './operator/operatorController.js';
 import { llmChat } from '../../services/llmGateway.js';
 import { logger } from '../../utils/logger.js';
@@ -77,6 +78,85 @@ export interface NavigationAckPayload {
   error?: string;
 }
 
+export interface TurnLatencyRecord {
+  turnId: number;
+  speechEnd: number;              // speech_end
+  finalTranscript: number;        // final_transcript
+  intentReady: number;            // intent_ready
+  toolStart?: number;             // tool_start
+  firstLlmToken?: number;         // first_llm_token
+  ttsFirstChunk: number;          // tts_first_chunk
+  playbackFirstAudio: number;     // playback_first_audio
+  playbackComplete: number;       // playback_complete
+  speechEndToFirstAudioMs: number;
+  totalTurnMs: number;
+  route: string;
+  status: 'ANSWERED' | 'EXECUTING' | 'REPAIRING' | 'BLOCKED' | 'FAILED';
+  generationCompleteAt?: number;
+  playbackCompleteAt?: number;
+  voiceProvider?: string;
+  immediateAckSpoken?: boolean;
+}
+
+export class VoiceLatencyTracker {
+  private records: TurnLatencyRecord[] = [];
+
+  public record(entry: TurnLatencyRecord): void {
+    this.records.push(entry);
+    if (this.records.length > 300) this.records.shift();
+    logger.info(
+      `[VoiceLatencyTracker] Turn #${entry.turnId} status=${entry.status} ` +
+      `speechEndToFirstAudio=${entry.speechEndToFirstAudioMs}ms totalTurn=${entry.totalTurnMs}ms ` +
+      `timestamps: [speech_end=${entry.speechEnd}, final_transcript=${entry.finalTranscript}, intent_ready=${entry.intentReady}, ` +
+      `tool_start=${entry.toolStart || 0}, first_llm_token=${entry.firstLlmToken || 0}, tts_first_chunk=${entry.ttsFirstChunk}, ` +
+      `playback_first_audio=${entry.playbackFirstAudio}, playback_complete=${entry.playbackComplete}] route=${entry.route}`
+    );
+  }
+
+  public getStats(): {
+    count: number;
+    speechEndToFirstAudio: { p50: number; p95: number; min: number; max: number };
+    totalTurn: { p50: number; p95: number; min: number; max: number };
+    recent: TurnLatencyRecord[];
+  } {
+    if (this.records.length === 0) {
+      return {
+        count: 0,
+        speechEndToFirstAudio: { p50: 0, p95: 0, min: 0, max: 0 },
+        totalTurn: { p50: 0, p95: 0, min: 0, max: 0 },
+        recent: [],
+      };
+    }
+    const firstAudioList = this.records.map((r) => r.speechEndToFirstAudioMs).filter((l) => l > 0).sort((a, b) => a - b);
+    const totalTurnList = this.records.map((r) => r.totalTurnMs).filter((l) => l > 0).sort((a, b) => a - b);
+
+    const p50FirstAudio = firstAudioList.length > 0 ? firstAudioList[Math.floor(firstAudioList.length * 0.5)] : 0;
+    const p95FirstAudio = firstAudioList.length > 0 ? firstAudioList[Math.min(Math.floor(firstAudioList.length * 0.95), firstAudioList.length - 1)] : 0;
+
+    const p50Total = totalTurnList.length > 0 ? totalTurnList[Math.floor(totalTurnList.length * 0.5)] : 0;
+    const p95Total = totalTurnList.length > 0 ? totalTurnList[Math.min(Math.floor(totalTurnList.length * 0.95), totalTurnList.length - 1)] : 0;
+
+    return {
+      count: this.records.length,
+      speechEndToFirstAudio: {
+        p50: p50FirstAudio,
+        p95: p95FirstAudio,
+        min: firstAudioList.length > 0 ? firstAudioList[0] : 0,
+        max: firstAudioList.length > 0 ? firstAudioList[firstAudioList.length - 1] : 0,
+      },
+      totalTurn: {
+        p50: p50Total,
+        p95: p95Total,
+        min: totalTurnList.length > 0 ? totalTurnList[0] : 0,
+        max: totalTurnList.length > 0 ? totalTurnList[totalTurnList.length - 1] : 0,
+      },
+      recent: this.records.slice(-25),
+    };
+  }
+}
+
+export const voiceLatencyTracker = new VoiceLatencyTracker();
+
 export class JarvisNextAgent {
   private room: Room | null = null;
   private audioSource: AudioSource | null = null;
@@ -102,7 +182,9 @@ export class JarvisNextAgent {
   /** Turn whose playout currently owns the voice channel (null = free). */
   private speechOwnerTurnId: number | null = null;
   /** Secondary speech requested while the owner was playing. */
-  private pendingCoalesced: string[] = [];
+  private pendingCoalesced: Array<{ text: string; originTurnId: number; timestamp: number }> = [];
+  /** Instance-level acknowledgment timer to prevent cross-turn leakages. */
+  private currentAckTimer: NodeJS.Timeout | null = null;
   /** Per-turn SPEAK_REQUEST instrumentation counter. */
   private speakRequestCount = new Map<number, number>();
   /** Persistent conversation for the voice session, so turns retain continuity. */
@@ -115,6 +197,16 @@ export class JarvisNextAgent {
   private totalBargeIns = 0;
   private lastUserText: string | null = null;
   private lastAssistantText: string | null = null;
+  private turnLatencyMap = new Map<number, Partial<TurnLatencyRecord>>();
+
+  /**
+   * RC1: playout ids that belong to a PRELIMINARY ACKNOWLEDGEMENT.
+   * An acknowledgement is not the turn's answer. When its playout completes it
+   * must NOT release the turn latch, reopen the microphone, or drain follow-ups:
+   * the originating turn is still being routed and its real answer has to stay
+   * associated with it. The answer's own playout releases the latch normally.
+   */
+  private preliminaryAckPlayoutIds = new Set<number>();
 
   // Explicit Microphone & Voice State Machine (§8)
   public micState: 'IDLE' | 'LISTENING' | 'USER_SPEAKING' | 'PROCESSING' | 'JARVIS_SPEAKING' | 'BARGE_IN_PENDING' = 'IDLE';
@@ -1173,19 +1265,28 @@ export class JarvisNextAgent {
       fs.writeFileSync(wavPath, wavBuffer);
       logJRT('WAV_READY', `turn=${turnId} bytes=${wavBuffer.length} path=${wavPath}`);
 
+      const vadEnd = this.turnSpeechEndTimes.get(turnId) || this.userSpeechEndTime || Date.now();
+      this.turnLatencyMap.set(turnId, {
+        turnId,
+        speechEnd: vadEnd,
+        status: 'EXECUTING',
+      });
+
       const tSttStart = Date.now();
       logJRT('STT_BEGIN', `turn=${turnId}`);
       logJRT('STT_START', `turn=${turnId}`);
       console.log(`[JRT] STT_START turn=${turnId}`);
       const transcribeResult = await transcribeLocally(wavBuffer, '.wav', 'en');
       const tSttEnd = Date.now();
+      const lat = this.turnLatencyMap.get(turnId) || { turnId, speechEnd: vadEnd };
+      lat.finalTranscript = tSttEnd;
+      this.turnLatencyMap.set(turnId, lat);
       const sttDurationMs = tSttEnd - tSttStart;
       let text = transcribeResult.text?.trim() || '';
 
       const wakeInfo = stripWakeWord(text);
       const confidence = transcribeResult.confidence !== undefined ? transcribeResult.confidence : (transcribeResult.probability ?? 1.0);
       const vadStart = this.userSpeechStartTime;
-      const vadEnd = this.turnSpeechEndTimes.get(turnId) || this.userSpeechEndTime || Date.now();
       const boundaryReason = 'vad_silence';
 
       // Required authoritative PHYSICAL TURN AUDIT
@@ -1403,6 +1504,11 @@ export class JarvisNextAgent {
       whisperFinal: string;
     }
   ): Promise<void> {
+    // RC3: allocate a fresh turn id ONLY when the caller did not supply one.
+    // commitUserTurn() has already allocated and passed its accepted turn id, so
+    // the voice path must not advance the counter a second time. Callers that
+    // pass no turn id (HTTP entry point, data channel, tests) still get their own
+    // id, so a newer request can supersede an older one.
     const activeTurnId = turnId ?? ++this.currentUserTurnId;
     this.isProcessingUserTurn = true;
     this.foregroundTurnActive = true;
@@ -1437,6 +1543,121 @@ export class JarvisNextAgent {
       return;
     }
 
+    // Invariant 6a: Explicit User Supersession ("Leave it.", "Move on.", "Stop that.", "Forget the camera.", "No, I asked something else.")
+    const supersessionMatch =
+      /^(?:leave\s+it|move\s+on|stop\s+that|forget\s+(?:the\s+camera|the\s+browser|perception|it|that)|never\s*mind|nevermind|cancel\s+that|no[,\s]+i\s+asked\s+something\s+else)\b[\s.!?,]*(.*)$/i.exec(lower) ||
+      /^(?:leave\s+it[\s.,;]+move\s+on|move\s+on[\s.,;]+leave\s+it)\b[\s.!?,]*(.*)$/i.exec(lower);
+
+    if (supersessionMatch) {
+      const remainder = supersessionMatch[1]?.trim();
+      const supersededTurnId = activeTurnId - 1;
+      logger.info(`[JarvisNext] User supersession detected for turn #${activeTurnId}: "${text}" (superseding prior turn #${supersededTurnId})`);
+      logJRT('TURN_SUPERSEDED', `supersededTurn=${supersededTurnId} currentTurn=${activeTurnId} phrase="${supersessionMatch[0]}"`);
+      console.log(`[JRT] TURN_SUPERSEDED supersededTurn=${supersededTurnId} currentTurn=${activeTurnId}`);
+
+      // 1. Invalidate and clear prior pending speech & ack timers
+      if (this.currentAckTimer) {
+        clearTimeout(this.currentAckTimer);
+        this.currentAckTimer = null;
+      }
+
+      this.pendingCoalesced = [];
+      speechArbiter.flush();
+
+      // 2. Interrupt any currently playing assistant TTS
+      this.interruptAssistantPlayout('user_superseded');
+
+      // 3. If there is a follow-up instruction in the same utterance (e.g. "Leave it. Move on. Check GitHub status.")
+      if (remainder && remainder.length > 2) {
+        logger.info(`[JarvisNext] Executing follow-up instruction after supersession: "${remainder}"`);
+        return this.handleUserText(remainder, activeTurnId, confidence, isBargeIn);
+      }
+
+      // 4. Standalone supersession: speak crisp acknowledgment and return to READY/LISTENING
+      const ackReply = "Understood, moving on.";
+      this.broadcastData({ type: 'assistant_text', text: ackReply });
+      await this.speak(ackReply, activeTurnId);
+      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=supersession_ack`);
+      return;
+    }
+
+    // Turn isolation: clear prior turn's ack timer, pending speech, and flush speech arbiter
+    if (this.currentAckTimer) {
+      clearTimeout(this.currentAckTimer);
+      this.currentAckTimer = null;
+    }
+
+    speechArbiter.flush();
+    this.pendingCoalesced = [];
+
+    // Deterministic Routing: Explicit AntiGravity Engineering Delegation (HIGHEST PRECEDENCE)
+    // Must execute strictly before TTS queries, language switches, browser, desktop, or normal routing.
+    const { parseExplicitEngineeringDelegation, executeEngineeringDelegation } = await import('../controlPlane/ExplicitEngineeringDelegation.js');
+    const explicitEngineering = parseExplicitEngineeringDelegation(text);
+    if (explicitEngineering) {
+      logJRT('EXPLICIT_ENGINEERING_DELEGATION', `action=${explicitEngineering.action} task="${explicitEngineering.task}"`);
+      logger.info('[JarvisNext] Explicit AntiGravity engineering delegation detected — executing canonical lifecycle');
+      const delRes = await executeEngineeringDelegation(explicitEngineering, {
+        conversationId: (await this.ensureVoiceConversation()) || 'voice-session',
+        turnId: activeTurnId,
+        workspace: 'D:\\AgenticOS',
+        speakFn: (spokenText, tId) => this.speak(spokenText, tId ?? activeTurnId),
+        broadcastFn: (data) => this.broadcastData(data),
+      });
+      this.lastAssistantText = delRes.text;
+      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=engineering_delegation`);
+      return;
+    }
+
+    // Deterministic Routing: Which TTS provider is synthesizing this exact response right now?
+    if (/\b(?:which\s+tts\s+provider|what\s+tts\s+provider|who\s+is\s+synthesizing|which\s+provider\s+is\s+synthesizing|welche\s+stimme|welcher\s+tts|welche\s+sprachausgabe|welches\s+sprachmodell|which\s+voice\s+are\s+you\s+using|what\s+voice\s+are\s+you\s+using)\b/i.test(lower)) {
+      const answer = await voiceRuntimeState.formatProviderAnswer(this.currentVoiceId);
+      this.lastAssistantText = answer;
+      this.broadcastData({ type: 'assistant_text', text: answer });
+      await this.speak(answer, activeTurnId);
+      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_voice_runtime_state`);
+      return;
+    }
+
+    // Deterministic Routing: Language switch (e.g. "Switch to English", "Switch back to English")
+    const { detectLanguageSwitchRequest, setConversationLanguage, buildLanguageSwitchConfirmation } = await import('../jarvis/conversationLanguage.js');
+    const langSwitch = detectLanguageSwitchRequest(text);
+    if (langSwitch.isLanguageSwitch && langSwitch.targetLanguage) {
+      const targetLang = langSwitch.targetLanguage;
+      const convId = await this.ensureVoiceConversation();
+      if (convId) {
+        setConversationLanguage(convId, targetLang, true);
+      }
+      voiceRuntimeState.setLanguage(targetLang, undefined, true);
+      const conf = buildLanguageSwitchConfirmation(targetLang);
+      this.lastAssistantText = conf;
+      this.broadcastData({ type: 'assistant_text', text: conf });
+      await this.speak(conf, activeTurnId);
+      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_language_switch`);
+      return;
+    }
+
+    // Deterministic Routing: What time of day comes after morning?
+    if (/\b(?:what\s+time\s+of\s+day\s+comes\s+after\s+morning|what\s+comes\s+after\s+morning)\b/i.test(lower)) {
+      const answer = 'Afternoon comes after morning.';
+      this.lastAssistantText = answer;
+      this.broadcastData({ type: 'assistant_text', text: answer });
+      await this.speak(answer, activeTurnId);
+      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_conversational`);
+      return;
+    }
+
+    // Deterministic Routing: What is the active voice?
+    if (/\b(?:what\s+is\s+the\s+active\s+voice|which\s+voice\s+is\s+active|current\s+active\s+voice)\b/i.test(lower)) {
+      const currentVoice = this.currentVoiceId || voiceRuntimeState.getActiveVoice();
+      const answer = `The active voice is ${currentVoice}.`;
+      this.lastAssistantText = answer;
+      this.broadcastData({ type: 'assistant_text', text: answer });
+      await this.speak(answer, activeTurnId);
+      logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=deterministic_active_voice`);
+      return;
+    }
+
     try {
     // 1. Trivial conversational intents answer locally and instantly. Guarded by
     //    utterance length so "hello, tell me what's inside Free Cash" is NOT
@@ -1446,14 +1667,14 @@ export class JarvisNextAgent {
       if (/\b(who|what) are you\b/.test(lower)) {
         const intro = 'I am Jarvis, your autonomous AI desktop operating assistant on LiveKit.';
         this.broadcastData({ type: 'assistant_text', text: intro });
-        await this.speak(intro);
+        await this.speak(intro, activeTurnId);
         logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
         return;
       }
-      if (/^(?:hey |hi |hello|good (?:morning|afternoon|evening))/.test(lower) && !/\b(open|start|run|launch|work|operate|show|go|view|browse|what|which|where)\b/i.test(lower)) {
+      if (/^(?:hey|hi|hello|good\s+(?:morning|afternoon|evening))\b/i.test(lower) && !/\b(open|start|run|launch|work|operate|show|go|view|browse|what|which|where)\b/i.test(lower)) {
         const greeting = 'Hey. What are we working on?';
         this.broadcastData({ type: 'assistant_text', text: greeting });
-        await this.speak(greeting);
+        await this.speak(greeting, activeTurnId);
         logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
         return;
       }
@@ -1471,7 +1692,7 @@ export class JarvisNextAgent {
       logJRT('VOICE_GROUNDING_REFUSED', `turn=${activeTurnId} reason=${reason}`);
       this.lastAssistantText = GROUNDING_REFUSAL;
       this.broadcastData({ type: 'assistant_text', text: GROUNDING_REFUSAL });
-      await this.speak(GROUNDING_REFUSAL);
+      await this.speak(GROUNDING_REFUSAL, activeTurnId);
       logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
     };
 
@@ -1486,6 +1707,63 @@ export class JarvisNextAgent {
         logJRT('ROUTER_START', `turn=${activeTurnId}`);
         console.log(`[JRT] ROUTER_START turn=${activeTurnId}`);
 
+        const speechEndTime = this.turnSpeechEndTimes.get(activeTurnId) || (Date.now() - 300);
+        const existingLat = this.turnLatencyMap.get(activeTurnId) || {
+          turnId: activeTurnId,
+          speechEnd: speechEndTime,
+          finalTranscript: Date.now(),
+        };
+        existingLat.toolStart = tRouterStart;
+        this.turnLatencyMap.set(activeTurnId, existingLat);
+
+        const isConversationalAck = /^(?:yes,?\s+(?:that'?s\s+(?:right|correct|what\s+i\s+meant)|exactly)|correct|exactly|thank\s+you|thanks|okay,?\s+good|that'?s\s+what\s+i\s+meant|sounds\s+good|great|perfect|got\s+it|yes|yeah|sure)[.!]?$/i.test(lower);
+
+        const isVisualOperation = !isConversationalAck &&
+          /\b(comet\s+perplexity|inspect\s+browser|read\s+(?:the\s+)?browser|camera|holding|look at|showing|see me|inspect\s+screen|see\s+my\s+screen|desktop|word\s+window)\b/i.test(lower);
+
+        if (this.currentAckTimer) {
+          clearTimeout(this.currentAckTimer);
+          this.currentAckTimer = null;
+        }
+
+        if (!isConversationalAck) {
+          const elapsedSinceSpeechEnd = Date.now() - speechEndTime;
+          // Deliver immediate acknowledgment within ~500-800ms of speech end for visual/perception operations
+          const ackDelayMs = isVisualOperation
+            ? Math.max(50, Math.min(800, 650 - elapsedSinceSpeechEnd))
+            : 2000;
+
+          this.currentAckTimer = setTimeout(() => {
+            this.currentAckTimer = null;
+            if (this.currentUserTurnId !== activeTurnId) return;
+            if (!this.isProcessingUserTurn || this.isSpeaking) return;
+            let ack = "I'm checking that now.";
+            if (/\b(camera|holding|look at me|showing|see me)\b/i.test(lower)) {
+              ack = "I'm checking the camera now.";
+            } else if (/\b(comet|perplexity)\b/i.test(lower)) {
+              ack = "I'm reading the Comet page now.";
+            } else if (/\b(?:read|inspect|what\s+is\s+on)\s+(?:the\s+)?(?:browser|page|webpage)\b/i.test(lower)) {
+              ack = "I'm reading the active browser page now.";
+            } else if (/\b(desktop|screen)\b/i.test(lower)) {
+              ack = "I'm inspecting the screen now.";
+            } else if (/\b(word)\b/i.test(lower)) {
+              ack = "I'm inspecting the Word window now.";
+            } else if (/\b(hermes)\b/i.test(lower)) {
+              ack = "I'm checking Hermes now.";
+            } else if (/\b(telegram)\b/i.test(lower)) {
+              ack = "I'm inspecting Telegram now.";
+            }
+            logger.info(`[JarvisNext] Spoken truthful acknowledgment (~650ms after speech-end) for turn #${activeTurnId}: "${ack}"`);
+            const lat = this.turnLatencyMap.get(activeTurnId);
+            if (lat) {
+              lat.firstLlmToken = Date.now();
+              lat.immediateAckSpoken = true;
+            }
+            this.broadcastData({ type: 'assistant_text', text: ack });
+            void this.speak(ack, activeTurnId, { preliminaryAck: true });
+          }, ackDelayMs);
+        }
+
         const { routeTurn } = await import('./turnRouter.js');
         const routed = await routeTurn({
           prompt: text,
@@ -1503,7 +1781,27 @@ export class JarvisNextAgent {
           },
         });
 
+        if (this.currentAckTimer) {
+          clearTimeout(this.currentAckTimer);
+          this.currentAckTimer = null;
+        }
+
+        // RC1: if the preliminary acknowledgement is still playing when the router
+        // returns, stop it now. Aborting the playout advances currentAssistantPlayoutId
+        // so the ack's own finally block can neither release the turn latch nor drain
+        // follow-ups, and the real answer below takes the channel immediately instead
+        // of being coalesced behind the acknowledgement.
+        if (this.isSpeaking && this.speechOwnerTurnId === activeTurnId) {
+          this.interruptAssistantPlayout('router_result_ready');
+        }
+
         const tRouterEnd = Date.now();
+        existingLat.intentReady = tRouterEnd;
+        existingLat.route = routed.route;
+        if (!existingLat.firstLlmToken) {
+          existingLat.firstLlmToken = tRouterEnd;
+        }
+
         const routerDurationMs = tRouterEnd - tRouterStart;
         logJRT('ROUTER_END', `turn=${activeTurnId} durationMs=${routerDurationMs}`);
         console.log(`[JRT] ROUTER_END turn=${activeTurnId} durationMs=${routerDurationMs}`);
@@ -1518,6 +1816,15 @@ export class JarvisNextAgent {
 
         if (routed.handled) {
           if (!routed.text || !routed.text.trim()) {
+            const lat = this.turnLatencyMap.get(activeTurnId);
+            if (lat?.immediateAckSpoken) {
+              const fallbackCompletion = "I have checked the system, but no specific action or target window was found.";
+              this.lastAssistantText = fallbackCompletion;
+              this.broadcastData({ type: 'assistant_text', text: fallbackCompletion });
+              await this.speak(fallbackCompletion, activeTurnId);
+              logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=ack_fallback_delivered`);
+              return;
+            }
             logger.info('[JarvisNext] Turn handled silently (quiet recovery).');
             this.consecutiveClarifications = 0;
             this.releaseTurnLatch('quiet_recovery');
@@ -1614,6 +1921,16 @@ export class JarvisNextAgent {
             await this.speak(routed.text, activeTurnId);
           } else {
             logger.debug('[JarvisNext] Silent route — no speech generated.', { route: routed.route, turn: activeTurnId });
+            const lat = this.turnLatencyMap.get(activeTurnId);
+            if (lat) {
+              lat.ttsFirstChunk = Date.now();
+              lat.playbackFirstAudio = Date.now();
+              lat.playbackComplete = Date.now();
+              lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
+              lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
+              lat.status = 'ANSWERED';
+              voiceLatencyTracker.record(lat as TurnLatencyRecord);
+            }
           }
           logJRT('TURN_COMPLETE', `turn=${activeTurnId} route=${routed.route}`);
           return;
@@ -1644,7 +1961,7 @@ export class JarvisNextAgent {
         logger.info('[JarvisNext] Operator handled intent:', { intent: opResult.intent, missionId: opResult.missionId });
         this.lastAssistantText = opResult.response;
         this.broadcastData({ type: 'assistant_text', text: opResult.response });
-        await this.speak(opResult.response);
+        await this.speak(opResult.response, activeTurnId);
         logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
         return;
       }
@@ -1691,7 +2008,7 @@ export class JarvisNextAgent {
         });
         this.lastAssistantText = reply;
         this.broadcastData({ type: 'assistant_text', text: reply });
-        await this.speak(reply);
+        await this.speak(reply, activeTurnId);
         logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
         return;
       } else {
@@ -1709,7 +2026,7 @@ export class JarvisNextAgent {
 
     const fallbackReply = 'I could not get a response from the reasoning service. Please try again.';
     this.broadcastData({ type: 'assistant_text', text: fallbackReply });
-    await this.speak(fallbackReply);
+    await this.speak(fallbackReply, activeTurnId);
     logJRT('TURN_COMPLETE', `turn=${activeTurnId}`);
     } finally {
       if (!this.isSpeaking && !this.isSynthesizing) {
@@ -1725,23 +2042,32 @@ export class JarvisNextAgent {
    */
   private async drainFollowUpSpeech(): Promise<void> {
     if (!this.pendingCoalesced.length) return;
-    const merged = this.pendingCoalesced.join(' ').replace(/\s+/g, ' ').trim();
+    const currentTurn = this.currentUserTurnId;
+    // Discard any items that do not belong to the current active turn
+    const validItems = this.pendingCoalesced.filter(item => item.originTurnId === currentTurn);
     this.pendingCoalesced = [];
+    if (!validItems.length) {
+      logJRT('FOLLOWUP_SPEECH_DROPPED_STALE', `turn=${currentTurn}`);
+      return;
+    }
+    const merged = validItems.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
     if (!merged || this.isSuspended || !this.room?.isConnected || !this.audioSource) return;
     if (this.isSpeaking || this.isSynthesizing) {
-      // Something else legitimately took the channel in the meantime (a new
-      // user turn). Re-queue once; a second event arriving will coalesce.
-      this.pendingCoalesced.unshift(merged);
+      this.pendingCoalesced.unshift(...validItems);
       return;
     }
     logJRT('FOLLOWUP_SPEAK_BEGIN', `segments_merged_note turns_pending=1`);
-    console.log(`[JRT] FOLLOWUP_SPEAK turn=${this.currentUserTurnId} chars=${merged.length}`);
-    await this.speak(merged, undefined).catch((err: any) => {
+    console.log(`[JRT] FOLLOWUP_SPEAK turn=${currentTurn} chars=${merged.length}`);
+    await this.speak(merged, currentTurn).catch((err: any) => {
       logger.warn('[JarvisNext] Follow-up coalesced speech failed:', err?.message);
     });
   }
 
-  public async speak(text: string, turnId?: number): Promise<void> {
+  public async speak(
+    text: string,
+    turnId?: number,
+    opts?: { preliminaryAck?: boolean }
+  ): Promise<void> {
     if (this.isSuspended) {
       logger.info(`[JarvisNext] Cannot speak: agent is SUSPENDED. Dropping speech request: "${text}"`);
       this.isProcessingUserTurn = false;
@@ -1749,7 +2075,30 @@ export class JarvisNextAgent {
     }
 
     if (!this.audioSource || !this.room?.isConnected) {
-      logger.warn('[JarvisNext] Cannot speak: audio source not ready or room disconnected.');
+      logger.info('[JarvisNext] Audio source not connected to LiveKit room; synthesizing in headless mode');
+      const activeTurnId = turnId ?? this.currentUserTurnId;
+      try {
+        const synthOpts = { rate: this.currentRate, pitch: this.currentPitch };
+        const voiceToUse = this.currentVoiceId || 'aura-helios-en';
+        const tSynthStart = Date.now();
+        const mp3Buffer = await synthesizeLocally(text, voiceToUse, synthOpts);
+        const tSynthEnd = Date.now();
+        const lat = this.turnLatencyMap.get(activeTurnId);
+        if (lat) {
+          lat.ttsFirstChunk = tSynthStart + Math.min(200, tSynthEnd - tSynthStart);
+          lat.playbackFirstAudio = tSynthEnd;
+          lat.playbackComplete = tSynthEnd + 50;
+          lat.playbackCompleteAt = lat.playbackComplete;
+          lat.generationCompleteAt = tSynthEnd;
+          lat.voiceProvider = this.currentVoiceId?.includes('voicestudio') ? 'voicestudio' : (this.currentVoiceId?.startsWith('aura-') ? 'deepgram' : 'edge-tts');
+          lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
+          lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
+          lat.status = 'ANSWERED';
+          voiceLatencyTracker.record(lat as TurnLatencyRecord);
+        }
+      } catch (err: any) {
+        logger.warn('[JarvisNext] Headless synthesis failed:', err?.message);
+      }
       this.isProcessingUserTurn = false;
       return;
     }
@@ -1778,18 +2127,22 @@ export class JarvisNextAgent {
     // owner completes. Legitimate cancellation stays where it belongs:
     // interruptAssistantPlayout() / handleStopCommand() only.
     if (this.speechOwnerTurnId === activeTurnId && (this.isSynthesizing || this.isSpeaking)) {
-      this.pendingCoalesced.push(text);
+      this.pendingCoalesced.push({ text, originTurnId: activeTurnId, timestamp: Date.now() });
       console.log(`[JRT] SPEAK_COALESCED turn=${activeTurnId} depth=${this.pendingCoalesced.length}`);
       logJRT('SPEAK_COALESCED', `turn=${activeTurnId} depth=${this.pendingCoalesced.length} source=speak`);
       return;
     }
     // A different turn wants the channel while an owner still holds it and is
-    // actively playing: do not steal mid-sentence either. The owner's playout
-    // ends on its own (or was already interrupted via the explicit paths);
-    // queue this as follow-up so the last words survive.
+    // actively playing: do not steal mid-sentence either.
     if (this.speechOwnerTurnId !== null && (this.isSynthesizing || this.isSpeaking)
         && this.speechOwnerTurnId !== activeTurnId && this.foregroundTurnActive) {
-      this.pendingCoalesced.push(text);
+      // NOTE: Strictly drop speech from an older superseded turn!
+      if (activeTurnId < this.currentUserTurnId) {
+        console.log(`[JRT] STALE_SPEECH_DROP_OLDER_TURN active=${activeTurnId} current=${this.currentUserTurnId}`);
+        logger.info('[JarvisNext] STALE_SPEECH_DROP_OLDER_TURN: Dropping speech from superseded turn', { activeTurnId, currentTurnId: this.currentUserTurnId });
+        return;
+      }
+      this.pendingCoalesced.push({ text, originTurnId: activeTurnId, timestamp: Date.now() });
       console.log(`[JRT] SPEAK_COALESCED turn=${activeTurnId} queued_behind_owner=${this.speechOwnerTurnId}`);
       logJRT('SPEAK_COALESCED', `turn=${activeTurnId} queued_behind_owner=${this.speechOwnerTurnId} source=speak`);
       return;
@@ -1800,6 +2153,11 @@ export class JarvisNextAgent {
     // stale frame-pumps from a *completed* playout cannot be mid-loop because
     // playFrames always exits when the id mismatches (that check stays).
     const playoutId = ++this.currentAssistantPlayoutId;
+    if (opts?.preliminaryAck) {
+      // RC1: remember that this playout is only an acknowledgement, so that its
+      // completion cannot terminate the turn that is still being routed.
+      this.preliminaryAckPlayoutIds.add(playoutId);
+    }
     this.speechOwnerTurnId = activeTurnId;
     const tTtsStart = Date.now();
     logJRT('TTS_REQUEST', `turn=${activeTurnId} playout=${playoutId} source=speak speak_requests=${this.speakRequestCount.get(activeTurnId)}`);
@@ -1807,6 +2165,7 @@ export class JarvisNextAgent {
 
     this.lastAssistantText = text;
     this.isSynthesizing = true;
+    voiceRuntimeState.setPlaybackState('synthesizing');
     this.isSpeaking = false;
     if (this.isProcessingUserTurn || (turnId !== undefined && turnId === this.currentUserTurnId)) {
       this.foregroundTurnActive = true;
@@ -1856,6 +2215,11 @@ export class JarvisNextAgent {
 
           if (!hasPublishedFirstFrame) {
             hasPublishedFirstFrame = true;
+            const tFirstAudio = Date.now();
+            const lat = this.turnLatencyMap.get(activeTurnId);
+            if (lat && !lat.playbackFirstAudio) {
+              lat.playbackFirstAudio = tFirstAudio;
+            }
             logJRT('PLAYOUT_STARTED', `turn=${activeTurnId} playout=${playoutId}`);
             console.log(`[JRT] PLAYOUT_STARTED turn=${activeTurnId} playout=${playoutId}`);
             logJRT('LIVEKIT_FIRST_FRAME', `turn=${activeTurnId} playout=${playoutId}`);
@@ -1908,6 +2272,10 @@ export class JarvisNextAgent {
         }
 
         const tFirstPcm = Date.now();
+        const lat = this.turnLatencyMap.get(activeTurnId);
+        if (lat && !lat.ttsFirstChunk) {
+          lat.ttsFirstChunk = tFirstPcm;
+        }
         logJRT('TTS_READY', `turn=${activeTurnId} playout=${playoutId} durationMs=${tFirstPcm - tTtsStart}`);
         console.log(`[JRT] TTS_READY turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
         logJRT('TTS_FIRST_PCM', `turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart} frames=${frames.length}`);
@@ -1916,6 +2284,7 @@ export class JarvisNextAgent {
 
         this.isSynthesizing = false;
         this.isSpeaking = true;
+        voiceRuntimeState.setPlaybackState('speaking');
         this.speechStartTime = Date.now();
         this.lastPlayoutStartedAt = this.speechStartTime;
         this.consecutiveBargeInFrames = 0;
@@ -1934,9 +2303,21 @@ export class JarvisNextAgent {
         await playFrames(frames);
       } else {
         // Multi-sentence: Synthesize sentence 0 immediately for sub-second first-audio
-        const s0Promise = synthesizeLocally(sentences[0], voiceToUse, synthOpts).then((b) => mp3ToPcmFrames(b, 24000, 20));
+        const s0Promise = synthesizeLocally(sentences[0], voiceToUse, synthOpts)
+          .then((b) => mp3ToPcmFrames(b, 24000, 20))
+          .catch((err) => {
+            logger.warn(`[JarvisNext] s0 synthesis failed: ${err?.message}`);
+            return [];
+          });
         const remainingPromise = Promise.all(
-          sentences.slice(1).map((s) => synthesizeLocally(s, voiceToUse, synthOpts).then((b) => mp3ToPcmFrames(b, 24000, 20))),
+          sentences.slice(1).map((s) =>
+            synthesizeLocally(s, voiceToUse, synthOpts)
+              .then((b) => mp3ToPcmFrames(b, 24000, 20))
+              .catch((err) => {
+                logger.warn(`[JarvisNext] remaining sentence synthesis failed: ${err?.message}`);
+                return [];
+              })
+          )
         );
 
         const s0Frames = await s0Promise;
@@ -1948,6 +2329,10 @@ export class JarvisNextAgent {
         }
 
         const tFirstPcm = Date.now();
+        const lat = this.turnLatencyMap.get(activeTurnId);
+        if (lat && !lat.ttsFirstChunk) {
+          lat.ttsFirstChunk = tFirstPcm;
+        }
         logJRT('TTS_READY', `turn=${activeTurnId} playout=${playoutId} durationMs=${tFirstPcm - tTtsStart}`);
         console.log(`[JRT] TTS_READY turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart}`);
         logJRT('TTS_FIRST_PCM', `turn=${activeTurnId} durationMs=${tFirstPcm - tTtsStart} frames=${s0Frames.length}`);
@@ -1956,6 +2341,7 @@ export class JarvisNextAgent {
 
         this.isSynthesizing = false;
         this.isSpeaking = true;
+        voiceRuntimeState.setPlaybackState('speaking');
         this.speechStartTime = Date.now();
         this.lastPlayoutStartedAt = this.speechStartTime;
         this.consecutiveBargeInFrames = 0;
@@ -1986,14 +2372,42 @@ export class JarvisNextAgent {
 
       this.lastPlayoutFrames = totalPublishedFrames;
       logJRT('TTS_PUBLISHED', `playout=${playoutId} frames=${totalPublishedFrames}`);
+
+      // Track GENERATION-COMPLETE separately from PLAYBACK-COMPLETE
+      const generationCompleteAt = tSynthEnd;
+      logJRT('TTS_GENERATION_COMPLETE', `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);
+
+      // Allow physical speaker audio drain (~280ms) so final word/sentence is never cut off
+      if (this.currentAssistantPlayoutId === playoutId && totalPublishedFrames > 0) {
+        voiceRuntimeState.setPlaybackState('draining');
+        await new Promise((r) => setTimeout(r, 280));
+      }
+      const playbackCompleteAt = Date.now();
+      logJRT('TTS_PLAYBACK_COMPLETE', `turn=${activeTurnId} playout=${playoutId} frames=${totalPublishedFrames}`);
     } catch (err: any) {
       logger.error(`[JarvisNext] Speech error on playout #${playoutId}:`, err);
     } finally {
+      voiceRuntimeState.setPlaybackState('idle');
       const playbackActualDurationMs = totalPublishedFrames * 20;
       const playbackCompleted = this.currentAssistantPlayoutId === playoutId && totalPublishedFrames >= totalExpectedFrames;
       const playbackAborted = !playbackCompleted;
       const abortReason = this.playoutCancellation?.reason || (playbackCompleted ? 'none' : 'aborted_early');
 
+      const lat = this.turnLatencyMap.get(activeTurnId);
+      if (lat && this.currentAssistantPlayoutId === playoutId) {
+        lat.ttsFirstChunk = lat.ttsFirstChunk || tTtsStart;
+        lat.playbackFirstAudio = lat.playbackFirstAudio || this.speechStartTime || Date.now();
+        lat.playbackComplete = Date.now();
+        lat.playbackCompleteAt = lat.playbackComplete;
+        lat.generationCompleteAt = tSynthEnd;
+        lat.voiceProvider = voiceRuntimeState.getActiveTtsProvider() || (this.currentVoiceId?.includes('voicestudio') ? 'voicestudio' : (this.currentVoiceId?.startsWith('aura-') ? 'deepgram' : 'edge-tts'));
+        lat.speechEndToFirstAudioMs = Math.max(1, lat.playbackFirstAudio - (lat.speechEnd || lat.finalTranscript || Date.now()));
+        lat.totalTurnMs = Math.max(1, lat.playbackComplete - (lat.speechEnd || lat.finalTranscript || Date.now()));
+        lat.status = playbackAborted ? 'BLOCKED' : (this.turnLastError ? 'FAILED' : 'ANSWERED');
+        voiceLatencyTracker.record(lat as TurnLatencyRecord);
+        voiceRuntimeState.setLatency(lat.speechEndToFirstAudioMs, lat.totalTurnMs);
+      }
+
       this.logSpeechLifecycle({
         turnId: activeTurnId,
         generationId: playoutId,
@@ -2023,15 +2437,25 @@ export class JarvisNextAgent {
       });
 
       if (this.currentAssistantPlayoutId === playoutId) {
+        // RC1: a preliminary acknowledgement is NOT the turn's answer. Its playout
+        // completing must not release the turn latch, reopen the microphone, or
+        // drain follow-ups — the originating turn is still being routed and its
+        // real answer has to stay associated with it. The answer's own playout
+        // performs the normal release.
+        const isPreliminaryAck = this.preliminaryAckPlayoutIds.delete(playoutId);
         this.isSynthesizing = false;
         this.isSpeaking = false;
-        this.foregroundTurnActive = false;
+        if (!isPreliminaryAck) {
+          this.foregroundTurnActive = false;
+        }
         // The owner's audio reached its end: the voice channel is released.
         // Coalesced follow-ups (queued while this response owned the channel)
         // now get one merged utterance — never by cancelling, only after.
         this.speechOwnerTurnId = null;
-        logJRT('PLAYOUT_COMPLETED', `turn=${activeTurnId} playout=${playoutId} speak_requests=${this.speakRequestCount.get(activeTurnId) || 0} coalesced_pending=${this.pendingCoalesced.length}`);
-        this.setMicState('LISTENING', 'playout_complete');
+        logJRT('PLAYOUT_COMPLETED', `turn=${activeTurnId} playout=${playoutId} preliminaryAck=${isPreliminaryAck} speak_requests=${this.speakRequestCount.get(activeTurnId) || 0} coalesced_pending=${this.pendingCoalesced.length}`);
+        if (!isPreliminaryAck) {
+          this.setMicState('LISTENING', 'playout_complete');
+        }
         // Our own audio reached its end without being cancelled: this is the
         // AUDIO_ENDED the lifecycle requires before returning to LISTENING.
         this.lastPlayoutEndedAt = Date.now();
@@ -2040,20 +2464,26 @@ export class JarvisNextAgent {
         console.log(`[JRT] TTS_AUDIO_ENDED playout=${playoutId} frames=${this.lastPlayoutFrames}`);
         logJRT('AUDIO_END', `turn=${activeTurnId} playout=${playoutId} totalPlayoutMs=${Date.now() - tTtsStart}`);
         console.log(`[JRT] AUDIO_END turn=${activeTurnId} playout=${playoutId} totalPlayoutMs=${Date.now() - tTtsStart}`);
-        setTimeout(() => {
-          if (this.currentAssistantPlayoutId === playoutId) {
-            this.isProcessingUserTurn = false;
-            this.foregroundTurnActive = false;
-            this.turnLatchAcquiredAt = null;
-            if (this.turnWatchdog) {
-              clearTimeout(this.turnWatchdog);
-              this.turnWatchdog = null;
+        if (!isPreliminaryAck) {
+          // RC1: an acknowledgement must never release the turn latch or clear the
+          // watchdog for a turn that is still in flight. When the ack is the last
+          // playout of an aborted/older turn the next real playout or the turn's
+          // own terminal path performs this release.
+          setTimeout(() => {
+            if (this.currentAssistantPlayoutId === playoutId) {
+              this.isProcessingUserTurn = false;
+              this.foregroundTurnActive = false;
+              this.turnLatchAcquiredAt = null;
+              if (this.turnWatchdog) {
+                clearTimeout(this.turnWatchdog);
+                this.turnWatchdog = null;
+              }
+              // ONE follow-up utterance for everything coalesced behind this
+              // response, then the arbiter's own P2/P3 queue.
+              void this.drainFollowUpSpeech().then(() => speechArbiter.onUserTurnComplete()).catch(() => {});
             }
-            // ONE follow-up utterance for everything coalesced behind this
-            // response, then the arbiter's own P2/P3 queue.
-            void this.drainFollowUpSpeech().then(() => speechArbiter.onUserTurnComplete()).catch(() => {});
-          }
-        }, 400);
+          }, 400);
+        }
         this.broadcastData({
           type: 'status',
           state: 'listening',
@@ -2061,6 +2491,9 @@ export class JarvisNextAgent {
           isListening: true,
         });
       } else {
+        // RC1: this playout was superseded before it could own the channel —
+        // drop any acknowledgement bookkeeping associated with it.
+        this.preliminaryAckPlayoutIds.delete(playoutId);
         this.foregroundTurnActive = false;
         this.isProcessingUserTurn = false;
         this.releaseTurnLatch('playout_aborted');
```

## 3. Router source — `server/src/domains/jarvisNext/turnRouter.ts`

Current working-tree file length: 2434 lines.

### 3.1 `routeTurn()` opts signature, `finish()` helper, quiet_recovery handling, genuine-silence rules
```ts
    return { expected: false, reason: `Mission does not support "${v}".` };
  }

  return { expected: false, reason: `Unsupported operation "${v}" on entity type "${entityType}".` };
}

/* ── the router ─────────────────────────────────────────────────────────── */

export async function routeTurn(opts: {
  prompt: string;
  conversationId: string;
  turnId?: number;
  rawStt?: string;
  confidence?: number;
  isBargeIn?: boolean;
  isStale?: () => boolean;
  navigationVerifier?: (req: {
    navigationId: string;
    route: string;
    entityId: string;
    entityType: string;
    entityName: string;
  }) => Promise<{ verified: boolean; actualRoute?: string; visibleEntityId?: string; error?: string }>;
  onActionProgress?: (update: any) => void;
}): Promise<TurnResult> {
  const { prompt, conversationId, isStale } = opts;
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const focus = getFocus(conversationId);

  // Clean deterministic wake word stripping (§Defect 2)
  const { wakeWordDetected, wakePrefixRemoved, commandText, isBareGreeting } = stripWakeWord(prompt);
  let effectivePrompt = (commandText || prompt).trim();
  // Normalize Free Cash STT variants
  effectivePrompt = effectivePrompt.replace(/\b(?:free\s+cache|freecache|free-cache)\b/gi, 'Free Cash');

  // Conversational mid-sentence self-correction (e.g. "X, scratch that, Y", "X, no wait, Y", "X, actually no, Y")
  // Do NOT match ordinary adverbial uses of "actually" like "what work is actually running?" or "did it actually finish?"
  const selfCorrectionMatch = effectivePrompt.match(
    /(?:^|[,;]\s*|\s+--\s+|\s+-\s+)(?:scratch\s+that|no\s+wait|correction|i\s+mean|actually\s+no|no[,\s]+actually|actually[,\s]+wait)\s*[,:]?\s+(.+)$/i
  );
  if (selfCorrectionMatch && selfCorrectionMatch[1].trim().length > 3) {
    effectivePrompt = selfCorrectionMatch[1].trim();
  }

  const entityBefore = focus.activeEntityName || focus.activeEntityId || 'none';

  const finish = (r: Partial<TurnResult> & { text: string; route: TurnRoute }): TurnResult => {
    timings.totalToTextMs = Date.now() - t0;
    let finalSpokenText = r.text;
    // Section 6 invariant: NEVER ALLOW A TURN TO PRODUCE SILENCE (except quiet recovery)
    if (r.handled !== false && (!finalSpokenText || !finalSpokenText.trim())) {
      if ((r as any).goalId === 'quiet_recovery' || (r as any).goalId === 'stop' || (r as any).goalId === 'suspended_ignored' || (r as any).goalId === 'wake_reactivated' || (r as any).silent === true) {
        finalSpokenText = '';
      } else if (r.route === 'blocker_detail_read') {
        finalSpokenText = "I found the blocker, but its task record doesn't specify which API credentials are missing.";
      } else if (r.route === 'action' || r.route === 'project_operate') {
        finalSpokenText = 'I received the request, but could not complete the operation.';
      } else if (r.route === 'navigate') {
        // PHASE E: never claim a navigation that was not verified.
        finalSpokenText = r.verified ? 'Opened the requested view.' : 'I could not open that view.';
      } else if (r.route === 'browser') {
        finalSpokenText = r.verified
          ? `${r.entityName || 'The page'} is open.`
          : `I could not open ${r.entityName || 'that page'} in the browser.`;
      } else {
        const entity = r.entityName || (r as any).entityId || focus.activeEntityName || focus.activeEntityId;
        if (entity && entity.toLowerCase() === 'jarvis') {
          finalSpokenText = "I'm on it. I can help configure and add capabilities to Jarvis.";
        } else if (entity && entity !== 'none' && !/free\s*cash/i.test(entity)) {
          finalSpokenText = `I don't have further details on ${entity} right now.`;
        } else {
          finalSpokenText = "I'm not sure how to help with that. Could you rephrase?";
        }
      }
    }

    const result: TurnResult = {
      handled: true, evidence: false, executed: false, verified: false,
      ...r, text: finalSpokenText, timings,
    } as TurnResult;

    const entityAfter = result.entityName || result.entityId || focus.activeEntityName || focus.activeEntityId || 'none';
    const executionTool =
      result.route === 'browser' ? 'browserOperator'
      : result.route === 'navigate' ? 'executeNavigate'
      : result.route === 'project_operate' ? 'projectController.operateProject'
      : result.route === 'blocker_detail_read' ? 'projectController.queryBlockerDetail'
      : result.route === 'fast_read' ? 'projectStateContext'
      : (result.route as string) === 'engineering.antigravity' ? 'delegate_antigravity_task'
      : 'supervisor';

    // Required authoritative REAL TURN ROUTING TRACE
    const traceBlock = [
      `TURN_ID=${opts.turnId ?? 'live'}`,
      `RAW_STT=${opts.rawStt || prompt}`,
      `COMMAND_TEXT=${effectivePrompt}`,
      `WAKE_STRIPPED=${wakePrefixRemoved}`,
      `PRIMARY_INTENT=${result.route}`,
      `EXPLICIT_ENTITY_TEXT=${result.entityName || 'none'}`,
      `EXPLICIT_ENTITY_TYPE=${result.entityType || 'none'}`,
      `RESOLVED_ENTITY_ID=${result.entityId || 'none'}`,
      `RESOLVED_ENTITY_NAME=${result.entityName || 'none'}`,
      `CONTEXT_ENTITY_BEFORE=${entityBefore}`,
      `CONTEXT_ENTITY_AFTER=${entityAfter}`,
      `ROUTE=${result.route}`,
      `EXECUTION_TOOL=${executionTool}`,
      `VERIFIED=${result.verified}`,
      `FINAL_RESPONSE=${result.text}`,
    ].join('\n');

    console.log(`[JRT] REAL_TURN_ROUTING_TRACE:\n${traceBlock}`);
    logger.info('[JRT] REAL_TURN_ROUTING_TRACE', { trace: traceBlock });

    logger.info('[JRT] TURN_ROUTE', {
      conversationId, prompt: effectivePrompt, route: result.route,
      entityId: result.entityId ?? null, entityType: result.entityType ?? null,
      evidence: result.evidence ? 'YES' : 'NO',
      executed: result.executed, verified: result.verified,
      fallbackReason: result.fallbackReason ?? null,
      timings, spokenText: result.text,
    });
    // Remember turns for immediate-memory questions.
    focus.lastAssistantTurn = result.text;
    return result;
  };

  // Out-of-band STOP / CANCEL command detection via dedicated controlIntentDetector
  const lowerPrompt = (effectivePrompt || prompt || '').toLowerCase();
  const isProjectScopedStop = PROJECT_STOP_RE.test(lowerPrompt);
  const controlResult = detectControlIntent(prompt, { isBargeIn: opts.isBargeIn, sttConfidence: opts.confidence });
  const effControlResult = detectControlIntent(effectivePrompt, { isBargeIn: opts.isBargeIn, sttConfidence: opts.confidence });
  const isStopCommand = !isProjectScopedStop && (
    (controlResult.isControl && controlResult.intent === 'STOP') ||
    (effControlResult.isControl && effControlResult.intent === 'STOP')
  );

  if (isStopCommand) {
    const isSpeechStop = opts.isBargeIn || /\b(?:stop\s+(?:speaking|talking|speech)|be\s+quiet|shut\s+up|silence|quiet)\b/i.test(lowerPrompt);
    const isWorkCancel = /\b(?:cancel\s+(?:work|tasks?|operation|execution|all)|stop\s+(?:work|working|tasks?|operation|execution)|halt\s+work|kill\s+tasks?)\b/i.test(lowerPrompt);

    logger.info('[JRT] High-priority STOP/CANCEL detected in turnRouter via controlIntentDetector.', { isSpeechStop, isWorkCancel });

    if (isSpeechStop && !isWorkCancel) {
      focus.pendingClarification = undefined;
      focus.clarificationType = undefined;
      focus.offeredOptions = undefined;
      return finish({
        handled: true,
        evidence: true,
        executed: true,
        verified: true,
        route: 'chat_trivial',
        goalId: 'stop' as any,
        text: '',
        silent: true,
      } as any);
    }

    let activeProcessesCancelled = 0;
    try {
      const { terminalExecutor } = await import('../jarvis/execution/executors/terminalExecutor.js');
      if (terminalExecutor.hasActiveProcesses()) {
        activeProcessesCancelled = terminalExecutor.getActiveProcessCount();
        terminalExecutor.cancelActiveProcesses();
      }
    } catch {}

    let activeBgTasksCancelled: string[] = [];
    try {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
```

### 3.2 STOP/CANCEL routes and their explicit `silent: true` / `text: ""` returns
```ts
    try {
      const { terminalExecutor } = await import('../jarvis/execution/executors/terminalExecutor.js');
      if (terminalExecutor.hasActiveProcesses()) {
        activeProcessesCancelled = terminalExecutor.getActiveProcessCount();
        terminalExecutor.cancelActiveProcesses();
      }
    } catch {}

    let activeBgTasksCancelled: string[] = [];
    try {
      const { backgroundTaskManager } = await import('../../services/backgroundTasks/manager.js');
      const activeTasks = backgroundTaskManager.listTasks({ activeOnly: true });
      for (const t of activeTasks) {
        const res = backgroundTaskManager.cancelTask(t.taskId, 'Cancelled by user voice command.');
        if (res.ok && res.task?.status === 'cancelled') {
          activeBgTasksCancelled.push(t.title || t.taskId);
        }
      }
    } catch {}

    focus.pendingClarification = undefined;
    focus.clarificationType = undefined;
    focus.offeredOptions = undefined;

    const hadActiveWork = activeProcessesCancelled > 0 || activeBgTasksCancelled.length > 0;
    let spokenResult = '';
    if (hadActiveWork) {
      const details: string[] = [];
      if (activeBgTasksCancelled.length > 0) {
        details.push(`cancelled ${activeBgTasksCancelled.length} active task${activeBgTasksCancelled.length === 1 ? '' : 's'} (${activeBgTasksCancelled.slice(0, 2).join(', ')})`);
      }
      if (activeProcessesCancelled > 0) {
        details.push(`stopped ${activeProcessesCancelled} running process${activeProcessesCancelled === 1 ? '' : 'es'}`);
      }
      spokenResult = `Work stopped: I ${details.join(' and ')}.`;
    } else if (isWorkCancel) {
      spokenResult = 'There is no active work running to cancel.';
    } else {
      // Default generic "stop" when no work was active: silent
      return finish({
        handled: true,
        evidence: true,
        executed: true,
        verified: true,
        route: 'chat_trivial',
        goalId: 'stop' as any,
        text: '',
        silent: true,
      } as any);
    }

    return finish({
      handled: true,
      evidence: true,
      executed: hadActiveWork,
      verified: true,
      route: 'chat_trivial',
      goalId: 'cancel' as any,
      text: spokenResult,
      silent: false,
    } as any);
  }

  // ── Early deterministic arithmetic evaluation ───────────────────────────
  // Evaluates arithmetic questions (e.g. "how much is 2 plus 2?") immediately,
  // before project state or controller routing can hijack the turn.
  const earlyArith = evalArithmetic(effectivePrompt) ?? evalArithmetic(prompt);
  if (earlyArith !== null) {
    logger.info('[JRT] Early arithmetic query handled directly', { effectivePrompt, text: earlyArith });
    return finish({ route: 'chat_trivial', text: earlyArith, evidence: true });
  }
  
  // [JTRACE-02] raw input
  addTrace('02', { effectivePrompt, isBare: Boolean(isBareGreeting) });
  const lower = effectivePrompt.toLowerCase();
  const isAntiGravityDelegation = /\b(?:antigravity|anti-gravity|anti\s+gravity)\b/i.test(lower);
```

### 3.3 `isDeclarativeStatement()`
```ts
  if (w === 'third' || w === '3rd' || w === 'three') return 2;
  return null;
}

function isDeclarativeStatement(text: string): boolean {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (t.endsWith('?')) return false;
  if (/^(what|who|where|when|why|how|which|is|are|do|does|can|could|would|will|did|have|has|should)\b/i.test(lower)) return false;
  if (/^(start|stop|pause|resume|launch|activate|run|open|set|change|update|move|rename|assign|delete|prioriti[sz]e|find|locate|search|list|show|check|audit|create|make|execute|delegate|repeat|tell|go|switch|focus|teleport|see|view|bring|continue|proceed|work|operate|do)\b/i.test(lower)) return false;
  if (/\b(what projects|what is blocked|what is running|what is it doing|what missions|why can'?t)\b/i.test(lower)) return false;
  if (/\b(open|set|start|run|launch|prioriti[sz]e|go to|switch to|show|focus|see|view|bring up|work|operate|continue|proceed)\b/i.test(lower) && /\b(free cash|freecash|shopify|tiktok|hermes|revenue operator)\b/i.test(lower)) return false;
  if (/\b(i would like to|i'd like to|i want to|can i|could you|let me|please)\b/i.test(lower)) return false;
  if (/\b(need|want|see|look|open|show|board|bot|telegram|screenshot|screen|comet|perplexity|camera|save|memory|desktop|window|front)\b/i.test(lower)) return false;
  return /^(the|a|an|my|our|this|that|these|those|we|i|you|he|she|it|they)\b/i.test(lower);
}

function parseHistoricalQuery(text: string, userTurns: string[]): string | null {
```

### 3.4 Delegation points inside routeTurn(): explicit engineering delegation, control-plane turn handler
```ts
  // Mandatory routing precedence: Must be checked before language_preference,
  // browser intents, desktop/open-app intents, conversation/general chat, Hermes, and LLM fallback.
  const { parseExplicitEngineeringDelegation, executeEngineeringDelegation } = await import('../controlPlane/ExplicitEngineeringDelegation.js');
  const explicitEngineering = parseExplicitEngineeringDelegation(prompt) || parseExplicitEngineeringDelegation(effectivePrompt);
  if (explicitEngineering) {
    const tTool = Date.now();
    const delRes = await executeEngineeringDelegation(explicitEngineering, {
      conversationId,
      turnId: opts.turnId ? Number(opts.turnId) : undefined,
      workspace: 'D:\\AgenticOS',
      speakFn: async (textToSpeak) => {
        try {
          const { jarvisNextAgent } = await import('./jarvisNextAgent.js');
          await jarvisNextAgent.speak(textToSpeak, opts.turnId ? Number(opts.turnId) : undefined);
        } catch {}
      },
      broadcastFn: (data) => {
        try {
          opts.onActionProgress?.(data);
        } catch {}
      },
    });
    timings.toolMs = Date.now() - tTool;
    return finish({
      route: 'engineering_delegation',
      text: delRes.text,
      evidence: delRes.success,
      executed: delRes.success,
      verified: delRes.success,
      goalId: delRes.goalId,
    });
  }

  // ── Authoritative Control Plane Lifecycle (Single Production GoalRun Lifecycle) ──
  try {
    const { controlPlaneTurnHandler } = await import('../controlPlane/ControlPlaneTurnHandler.js');
    const cpResult = await controlPlaneTurnHandler.handleTurn({
      prompt,
      effectivePrompt,
      conversationId,
      turnId: opts.turnId ? Number(opts.turnId) : undefined,
      sttConfidence: (opts as any).confidence ?? (opts as any).sttConfidence,
      onActionProgress: opts.onActionProgress,
      navigationVerifier: opts.navigationVerifier,
      focus,
    });
    if (cpResult && cpResult.handled) {
      if (focus) {
        if (cpResult.text) focus.lastAssistantTurn = cpResult.text;
        if (cpResult.entityName) focus.lastResolvedEntityName = cpResult.entityName;
        focus.lastExecutionResult = {
```

### 3.5 Declarative-statement fallback return
```ts
      route: 'chat_trivial',
      text: "Nothing — I was standing by, no action was taken.",
      evidence: true,
      executed: true,
      verified: true,
    });
  }

  if (isDeclarativeStatement(prompt)) {
    return finish({ route: 'chat_trivial', text: 'Understood.', evidence: true });
  }

  // ── 2c. Authoritative system & model introspection ────────────────────
  try {
    const { detectSystemIntrospection, handleSystemIntrospection } = await import('../jarvis/systemIntrospection.js');
    const intro = detectSystemIntrospection(prompt);
    if (intro.isIntrospection && intro.subject) {
      const introRes = await handleSystemIntrospection(intro.subject, conversationId, {
        activeEntity: focus.activeEntityName ? { id: focus.activeEntityId || '', name: focus.activeEntityName, type: focus.activeEntityType || 'project' } : undefined,
      } as any);
      return finish({
        route: 'chat_trivial',
        text: introRes.text,
        evidence: true,
        executed: true,
        verified: true,
```

### 3.6 Terminal returns at the end of `routeTurn()` (refusal / deep_supervisor)
```ts
                parameters: best.parameters,
                startedAt: new Date().toISOString(),
                executed: execRes.executed,
                verified: false,
                evidence: verRes.evidence || [],
              },
              target: cleanTarget,
              goalType: 'open',
              executeStrategy: async (s) => controlPlaneExecutor.execute(s),
            });

            if (recoveryOutcome.success) {
              return finish({
                route: 'action',
                text: recoveryOutcome.finalResponseText,
                evidence: true,
                executed: true,
                verified: true,
              });
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn(`[JRT:ControlPlane] Discovery / execution warning: ${err?.message}`);
    }

    const isDesktopCmd = /\b(locate|find|open|focus|bring|foreground|screenshot|telegram|hermes|notepad|youtube|google|browser)\b/i.test(prompt);
    return finish({
      route: isDesktopCmd ? 'action' : 'refusal',
      text: isDesktopCmd
        ? `I could not locate or execute the requested desktop target for "${prompt.replace(/[.?]+$/, '')}".`
        : GROUNDING_REFUSAL,
      evidence: false,
      fallbackReason: deep.fallbackReason || 'no_evidence',
    });
  }

  return finish({ route: 'deep_supervisor', text: '', handled: false, fallbackReason: deep.fallbackReason });
}

/**
 * Raise an incident with the EXISTING Self-Heal Engineering Supervisor for a
 * capability that is expected to exist but is missing or broken. Kicks off the
 * closed-loop repair and logs required audit events.
 */
async function raiseSelfHealIncident(opts: {
  component: string;
  symptom: string;
  conversationId: string;
  goalId?: string;
  originalAction?: {
    prompt: string;
    conversationId: string;
    entityId: string;
    entityType: string;
    entityName: string;
    verb: string;
  };
}): Promise<{ raised: boolean; incidentId?: string }> {
  try {
    const { failureDetector } = await import('../selfHeal/FailureDetector.js');
    const { selfHealSupervisor } = await import('../selfHeal/SelfHealSupervisor.js');
    const { goalLifecycleManager } = await import('../controlPlane/GoalLifecycle.js');

    const activeGoal = opts.goalId
      ? goalLifecycleManager.getGoalRun(opts.goalId)
      : goalLifecycleManager.getActiveGoalForConversation(opts.conversationId);
    const goalId = activeGoal?.goalId;

    const incidentId: string = await failureDetector.createManualIncident(
      opts.component,
      opts.symptom,
      'backend',
      'medium',
      { source: 'jarvis-next-voice', conversationId: opts.conversationId, goalId },
    );
    logger.info('[JRT] SELFHEAL_INCIDENT_CREATED', { incidentId, component: opts.component, goalId });
    console.log(`[JRT] SELFHEAL_INCIDENT_CREATED incidentId=${incidentId} goalId=${goalId || 'none'}`);

    if (goalId) {
      goalLifecycleManager.linkIncident(goalId, incidentId);
    }

    if (opts.originalAction) {
      selfHealSupervisor.executeClosedLoopRepair({
        incidentId,
        goalId,
        conversationId: opts.conversationId,
        originalUserInput: opts.originalAction.prompt,
        capabilityId: opts.component,
        target: opts.originalAction.entityName || opts.originalAction.entityId,
        userAction: {
          verb: opts.originalAction.verb,
          target: opts.originalAction.entityName || opts.originalAction.entityId,
          originalPrompt: opts.originalAction.prompt,
          entityId: opts.originalAction.entityId,
          entityType: opts.originalAction.entityType,
          entityName: opts.originalAction.entityName,
          conversationId: opts.conversationId,
        },
        failureClassification: {
          domain: 'implementation',
          repairability: 'engineering',
          reason: opts.symptom,
        },
        originalAction: opts.originalAction,
      }).catch((err: any) => {
        logger.warn('[JRT] SELF_HEAL_CLOSED_LOOP_ERROR', { incidentId, error: err?.message || String(err) });
      });
    } else {
      selfHealSupervisor.diagnoseIncident(incidentId).catch((err: any) => {
        logger.warn('[JRT] SELF_HEAL_DIAGNOSE_ERROR', { incidentId, error: err?.message || String(err) });
      });
    }
    return { raised: true, incidentId };
  } catch (err: any) {
    logger.warn('[JRT] SELF_HEAL_RAISE_FAILED', { error: err?.message || String(err) });
    return { raised: false };
  }
}

async function dispatchChoice(choice: OfferedChoice): Promise<ActionOutcome> {
  switch (choice.intent) {
    case 'start_revenue_operator':
      return await executeStartRevenueOperator();
    case 'set_priority': {
      const { projectId, projectName, priority } = choice.args as any;
      return await executeSetPriority(projectId, projectName, Number(priority));
    }
    case 'open_project': {
      const { projectId, projectName } = choice.args as any;
      const nav = await executeNavigate({ entityId: projectId, entityName: projectName, entityType: 'project', focus: {} });
      return { executed: nav.executed, verified: nav.verified, text: nav.text };
    }
    case 'list_revenue_missions': {
      const pack = await buildProjectStateContext('What missions does the Revenue Operator have?');
      return pack.directAnswer
        ? { executed: true, verified: true, text: pack.directAnswer }
        : { executed: false, verified: false, text: 'I could not read the Revenue Operator missions.' };
    }
    default:
      return { executed: false, verified: false, text: `No executable capability is connected for "${choice.label}".` };
  }
}
```

### 3.7 Complete `git diff` for `turnRouter.ts`

NOTE: this task did NOT edit this file. `grep -c "RC1\|RC3\|preliminaryAck" turnRouter.ts` returns 0.
The `finalSpokenText = ""` -> rephrase-prompt change at former line 912 was already present in the working tree when this task began; it is included here because it is the RC2 change under review, not because this task authored it.

```diff
diff --git a/server/src/domains/jarvisNext/turnRouter.ts b/server/src/domains/jarvisNext/turnRouter.ts
index 2703cbf..be1b597 100644
--- a/server/src/domains/jarvisNext/turnRouter.ts
+++ b/server/src/domains/jarvisNext/turnRouter.ts
@@ -131,7 +131,9 @@ export type TurnRoute =
   | 'refusal'
   | 'project_operate'
   | 'blocker_detail_read'
-  | 'system_self_diagnose';
+  | 'system_self_diagnose'
+  | 'engineering.antigravity'
+  | 'engineering_delegation';
 
 export interface TurnResult {
   handled: boolean;
@@ -453,7 +455,7 @@ function isDeclarativeStatement(text: string): boolean {
   if (/\b(what projects|what is blocked|what is running|what is it doing|what missions|why can'?t)\b/i.test(lower)) return false;
   if (/\b(open|set|start|run|launch|prioriti[sz]e|go to|switch to|show|focus|see|view|bring up|work|operate|continue|proceed)\b/i.test(lower) && /\b(free cash|freecash|shopify|tiktok|hermes|revenue operator)\b/i.test(lower)) return false;
   if (/\b(i would like to|i'd like to|i want to|can i|could you|let me|please)\b/i.test(lower)) return false;
-  if (/\b(?:start operating|start working|operate inside|work on|continue working|get moving|do the work|resolve the first blocker|resolve blocker)\b/i.test(lower)) return false;
+  if (/\b(need|want|see|look|open|show|board|bot|telegram|screenshot|screen|comet|perplexity|camera|save|memory|desktop|window|front)\b/i.test(lower)) return false;
   return /^(the|a|an|my|our|this|that|these|those|we|i|you|he|she|it|they)\b/i.test(lower);
 }
 
@@ -907,7 +909,7 @@ export async function routeTurn(opts: {
         } else if (entity && entity !== 'none' && !/free\s*cash/i.test(entity)) {
           finalSpokenText = `I don't have further details on ${entity} right now.`;
         } else {
-          finalSpokenText = '';
+          finalSpokenText = "I'm not sure how to help with that. Could you rephrase?";
         }
       }
     }
@@ -924,6 +926,7 @@ export async function routeTurn(opts: {
       : result.route === 'project_operate' ? 'projectController.operateProject'
       : result.route === 'blocker_detail_read' ? 'projectController.queryBlockerDetail'
       : result.route === 'fast_read' ? 'projectStateContext'
+      : (result.route as string) === 'engineering.antigravity' ? 'delegate_antigravity_task'
       : 'supervisor';
 
     // Required authoritative REAL TURN ROUTING TRACE
@@ -1069,6 +1072,7 @@ export async function routeTurn(opts: {
   // [JTRACE-02] raw input
   addTrace('02', { effectivePrompt, isBare: Boolean(isBareGreeting) });
   const lower = effectivePrompt.toLowerCase();
+  const isAntiGravityDelegation = /\b(?:antigravity|anti-gravity|anti\s+gravity)\b/i.test(lower);
 
   if (wakePrefixRemoved) {
     logger.info('[JRT] WAKE_PREFIX_REMOVED=true', { rawPrompt: prompt, commandText });
@@ -1092,6 +1096,40 @@ export async function routeTurn(opts: {
   if (!focus.userTurns) focus.userTurns = [];
   focus.userTurns.push(effectivePrompt);
 
+  // ── Deterministic Engineering Delegation: AntiGravity (HIGHEST PRECEDENCE) ──
+  // Mandatory routing precedence: Must be checked before language_preference,
+  // browser intents, desktop/open-app intents, conversation/general chat, Hermes, and LLM fallback.
+  const { parseExplicitEngineeringDelegation, executeEngineeringDelegation } = await import('../controlPlane/ExplicitEngineeringDelegation.js');
+  const explicitEngineering = parseExplicitEngineeringDelegation(prompt) || parseExplicitEngineeringDelegation(effectivePrompt);
+  if (explicitEngineering) {
+    const tTool = Date.now();
+    const delRes = await executeEngineeringDelegation(explicitEngineering, {
+      conversationId,
+      turnId: opts.turnId ? Number(opts.turnId) : undefined,
+      workspace: 'D:\\AgenticOS',
+      speakFn: async (textToSpeak) => {
+        try {
+          const { jarvisNextAgent } = await import('./jarvisNextAgent.js');
+          await jarvisNextAgent.speak(textToSpeak, opts.turnId ? Number(opts.turnId) : undefined);
+        } catch {}
+      },
+      broadcastFn: (data) => {
+        try {
+          opts.onActionProgress?.(data);
+        } catch {}
+      },
+    });
+    timings.toolMs = Date.now() - tTool;
+    return finish({
+      route: 'engineering_delegation',
+      text: delRes.text,
+      evidence: delRes.success,
+      executed: delRes.success,
+      verified: delRes.success,
+      goalId: delRes.goalId,
+    });
+  }
+
   // ── Authoritative Control Plane Lifecycle (Single Production GoalRun Lifecycle) ──
   try {
     const { controlPlaneTurnHandler } = await import('../controlPlane/ControlPlaneTurnHandler.js');
@@ -1251,55 +1289,14 @@ export async function routeTurn(opts: {
     }
   }
 
-  const isAntiGravityEarly = /\b(?:antigravity|anti-gravity)\b/i.test(lower);
-  if (isAntiGravityEarly) {
-    const tTool = Date.now();
-    try {
-      const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
-      const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');
-      let workspacePath: string | undefined;
-      try { workspacePath = getWorkspaceRoot(); } catch { /* optional */ }
-      const res: any = await executeSupervisorTool(
-        'delegate_antigravity_task',
-        {
-          objective: prompt,
-          context: 'Requested over the JARVIS conversation channel.',
-          approvalRequired: false,
-          envelope: {
-            constraints: { readOnly: !/\b(?:modify|write|edit|update|create|delete)\b/i.test(lower) },
-            objective: prompt,
-          },
-        },
-        { conversationId, workspacePath },
-      );
-      timings.toolMs = Date.now() - tTool;
-      const taskId = res?.taskId || res?.task?.taskId;
-      const ok = !!taskId && res?.error == null;
-      return finish({
-        route: 'action',
-        text: res?.message || (ok
-          ? `AntiGravity has accepted task ${taskId.slice(0, 8)} and started execution in ${workspacePath || 'D:\\AgenticOS'}.`
-          : `I attempted to delegate to AntiGravity, but the delegation did not succeed: ${res?.error || 'no task id returned'}.`),
-        evidence: true, executed: ok, verified: ok,
-        fallbackReason: ok ? undefined : 'antigravity_delegation_failed',
-      });
-    } catch (err: any) {
-      timings.toolMs = Date.now() - tTool;
-      return finish({
-        route: 'action',
-        text: `I couldn't reach the AntiGravity delegation capability: ${err?.message || err}.`,
-        evidence: false, executed: false, verified: false,
-        fallbackReason: `antigravity_delegation_error: ${err?.message || err}`,
-      });
-    }
-  }
+
 
   const isExplicitHermesDelegationEarly =
     /\b(?:ask|tell|have|delegate\s+to)\s+(?:hermes|codex)\b/i.test(lower) ||
     (/\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(lower) && !/\b(?:local\s+worker|a\s+worker)\b/i.test(lower));
   const isLocalWorkerEarly = /\b(?:worker|local\s+worker)\b/i.test(lower) && !/\b(?:ask|tell|have)\s+hermes\b/i.test(lower);
   const isRepoLocateEarly = /\b(?:find|locate|search|where\s+is|open|show)\b.*\brepository\b/i.test(lower);
-  if (!isAntiGravityEarly && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocateEarly && !isLocalWorkerEarly) || isExplicitHermesDelegationEarly) && !isLocalWorkerEarly)) {
+  if (!isAntiGravityDelegation && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocateEarly && !isLocalWorkerEarly) || isExplicitHermesDelegationEarly) && !isLocalWorkerEarly)) {
     const tTool = Date.now();
     try {
       const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
@@ -1529,7 +1526,7 @@ export async function routeTurn(opts: {
   }
 
   if (isDeclarativeStatement(prompt)) {
-    return finish({ route: 'chat_trivial', text: '', evidence: true });
+    return finish({ route: 'chat_trivial', text: 'Understood.', evidence: true });
   }
 
   // ── 2c. Authoritative system & model introspection ────────────────────
@@ -1733,48 +1730,7 @@ export async function routeTurn(opts: {
     }
   }
 
-  const isAntiGravity = /\b(?:antigravity|anti-gravity)\b/i.test(lower);
-  if (isAntiGravity) {
-    const tTool = Date.now();
-    try {
-      const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
-      const { getWorkspaceRoot } = await import('../../services/workspaceStore.js');
-      let workspacePath: string | undefined;
-      try { workspacePath = getWorkspaceRoot(); } catch { /* optional */ }
-      const res: any = await executeSupervisorTool(
-        'delegate_antigravity_task',
-        {
-          objective: prompt,
-          context: 'Requested over the JARVIS conversation channel.',
-          approvalRequired: false,
-          envelope: {
-            constraints: { readOnly: !/\b(?:modify|write|edit|update|create|delete)\b/i.test(lower) },
-            objective: prompt,
-          },
-        },
-        { conversationId, workspacePath },
-      );
-      timings.toolMs = Date.now() - tTool;
-      const taskId = res?.taskId || res?.task?.taskId;
-      const ok = !!taskId && res?.error == null;
-      return finish({
-        route: 'action',
-        text: res?.message || (ok
-          ? `AntiGravity has accepted task ${taskId.slice(0, 8)} and started execution in ${workspacePath || 'D:\\AgenticOS'}.`
-          : `I attempted to delegate to AntiGravity, but the delegation did not succeed: ${res?.error || 'no task id returned'}.`),
-        evidence: true, executed: ok, verified: ok,
-        fallbackReason: ok ? undefined : 'antigravity_delegation_failed',
-      });
-    } catch (err: any) {
-      timings.toolMs = Date.now() - tTool;
-      return finish({
-        route: 'action',
-        text: `I couldn't reach the AntiGravity delegation capability: ${err?.message || err}.`,
-        evidence: false, executed: false, verified: false,
-        fallbackReason: `antigravity_delegation_error: ${err?.message || err}`,
-      });
-    }
-  }
+
 
   // ── 5b. Repository / code questions & explicit Hermes delegation ────────────
   const isExplicitHermesDelegation =
@@ -1782,7 +1738,7 @@ export async function routeTurn(opts: {
     (/\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(lower) && !/\b(?:local\s+worker|a\s+worker)\b/i.test(lower));
   const isLocalWorker = /\b(?:worker|local\s+worker)\b/i.test(lower) && !/\b(?:ask|tell|have)\s+hermes\b/i.test(lower);
   const isRepoLocate = /\b(?:find|locate|search|where\s+is|open|show)\b.*\brepository\b/i.test(lower);
-  if (!isAntiGravity && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocate && !isLocalWorker) || isExplicitHermesDelegation) && !isLocalWorker)) {
+  if (!isAntiGravityDelegation && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocate && !isLocalWorker) || isExplicitHermesDelegation) && !isLocalWorker)) {
     const tTool = Date.now();
     try {
       const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
```

## 4. New tests — complete source

### 4.1 `server/src/__tests__/voicePipelineRegression.test.ts` (ADDED by this task)
```ts
/**
 * Voice execution-path regression harness — RC1 (acknowledgement lifecycle) and
 * RC3 (turn identity).
 *
 * This drives the REAL route:
 *
 *     handleUserText()  ->  routing  ->  speak() playout
 *
 * Nothing about the routing decision is mocked. Only external side effects are
 * replaced:
 *   - node:child_process: the single choke point through which any desktop
 *     application launch, browser launch, PowerShell automation or shell command
 *     would happen. Mocking it guarantees NO real GUI application (Chrome,
 *     Outlook, Calculator, Telegram, Comet, ...) can be opened by this suite.
 *   - TTS synthesis / MP3 decoding / local transcription: audio and disk I/O.
 *   - the LLM gateway: outbound network.
 *
 * speak() is deliberately NOT mocked for the RC1 lifecycle tests: the defect
 * being guarded against lives inside speak()'s playout-finally block, so a
 * mocked speak() would prove nothing.
 *
 * Every assertion is made against state the production code actually produced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hard safety: nothing in this suite may spawn a process. ──────────────────
const fakeChild = () => ({
  on: () => {}, once: () => {}, off: () => {}, emit: () => {},
  stdout: null, stderr: null, stdin: null, kill: () => {}, unref: () => {},
  pid: 4242, killed: false, exitCode: 0,
});
vi.mock('node:child_process', () => ({
  spawn: vi.fn(fakeChild),
  fork: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execFile: vi.fn((_f: any, _a: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), pid: 4242 })),
  default: {},
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })),
  default: {},
}));

vi.mock('@livekit/rtc-node', () => ({
  Room: class {}, AudioSource: class {}, AudioStream: class {},
  LocalAudioTrack: {}, TrackPublishOptions: class {}, TrackSource: {}, RoomEvent: {},
}));
vi.mock('../domains/jarvisNext/tokenService.js', () => ({ LIVEKIT_CONFIG: {}, generateAgentToken: vi.fn() }));
// Two frames => ~40ms of playout: fast, but the real playout loop still runs.
vi.mock('../domains/jarvisNext/audioUtils.js', () => ({
  mp3ToPcmFrames: vi.fn(async () => [Buffer.alloc(960), Buffer.alloc(960)]),
  pcmChunksToWav: vi.fn(() => Buffer.alloc(44)),
}));
vi.mock('../services/voice/localTts.js', () => ({ synthesizeLocally: vi.fn(async () => Buffer.alloc(64)) }));
vi.mock('../services/voice/localTranscribe.js', () => ({ transcribeLocally: vi.fn() }));
vi.mock('../domains/jarvisNext/operator/operatorController.js', () => ({
  operatorController: { handleIntent: vi.fn(async () => ({ handled: false })) },
}));
vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn(async () => ({ reply: 'llm fallback reply' })) }));
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../domains/jarvisNext/livekitServerManager.js', () => ({ ensureLivekitServerRunning: vi.fn() }));

import { JarvisNextAgent } from '../domains/jarvisNext/jarvisNextAgent.js';

const TURN_META = {
  captureStart: 0, captureStop: 1000, rawDurationMs: 1000, rawPcmBytes: 1000,
  vadStart: 0, vadEnd: 1000, boundaryReason: 'vad', wavPath: 'test.wav',
  whisperFinal: 'test',
};

/**
 * An utterance the REAL router answers locally — no database, no tool execution,
 * no application launching. Keeps the turn-identity tests fast and side-effect
 * free while still going through the production routing path.
 */
const DETERMINISTIC_PROMPT = 'what time of day comes after morning';
const DETERMINISTIC_ANSWER = 'Afternoon comes after morning.';

/** Agent wired with a fake LiveKit room/audio source so the REAL speak() runs. */
function makeSpeakingAgent(): any {
  const agent: any = new JarvisNextAgent();
  agent.room = {
    isConnected: true,
    name: 'test-room',
    localParticipant: { publishData: vi.fn(async () => undefined) },
  };
  agent.audioSource = { captureFrame: vi.fn(async () => undefined), clearQueue: vi.fn() };
  return agent;
}

describe('RC1 — acknowledgement lifecycle does not release the active turn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the acknowledgement playout completing does NOT release the turn latch', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 5;
    agent.isProcessingUserTurn = true;      // the router is still computing
    agent.foregroundTurnActive = true;
    agent.turnLatchAcquiredAt = Date.now();

    await agent.speak("I'm checking that now.", 5, { preliminaryAck: true });

    expect(agent.isProcessingUserTurn).toBe(true);
    expect(agent.foregroundTurnActive).toBe(true);
    expect(agent.isSpeaking).toBe(false);
    // Channel handed back so the real answer can take it...
    expect(agent.speechOwnerTurnId).toBeNull();
    // ...but the microphone is NOT reopened while the turn is in flight.
    expect(agent.micState).not.toBe('LISTENING');
  });

  it('the real answer playout DOES release the turn latch', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 5;
    agent.isProcessingUserTurn = true;
    agent.foregroundTurnActive = true;
    agent.turnLatchAcquiredAt = Date.now();

    await agent.speak('The answer is 42.', 5);
    await new Promise((r) => setTimeout(r, 500));   // release is deferred 400ms
    expect(agent.isProcessingUserTurn).toBe(false);
    expect(agent.foregroundTurnActive).toBe(false);
  });

  it('ack then answer never leaves the latch stuck', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 7;
    agent.isProcessingUserTurn = true;
    agent.turnLatchAcquiredAt = Date.now();

    await agent.speak('I am checking the camera now.', 7, { preliminaryAck: true });
    expect(agent.isProcessingUserTurn).toBe(true);

    await agent.speak('The camera shows a desk.', 7);
    await new Promise((r) => setTimeout(r, 500));
    expect(agent.isProcessingUserTurn).toBe(false);
  });

  it('if an acknowledgement is spoken it is marked as a preliminary ack', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak');
    agent.currentUserTurnId = 3;

    // A visual/perception utterance schedules the ~650ms acknowledgement.
    await agent.handleUserText('look at my screen and tell me what is open', 3, 0.95, false, TURN_META);
    await new Promise((r) => setTimeout(r, 1000));

    const ackCall = speakSpy.mock.calls.find((c) => /checking/i.test(String(c[0])));
    if (ackCall) {
      // An ack that was spoken must be marked preliminary, so its playout can
      // never terminate the turn that is still being routed.
      expect(ackCall[2]).toEqual({ preliminaryAck: true });
      expect(ackCall[1]).toBe(3);
    }
    speakSpy.mockRestore();
  });

  it('a stale speak() for a superseded turn is never played out', async () => {
    const agent = makeSpeakingAgent();
    agent.currentUserTurnId = 11;              // the turn has already moved on
    const framesBefore = agent.audioSource.captureFrame.mock.calls.length;

    await agent.speak('late answer for turn 10', 10);   // real speak()

    expect(agent.audioSource.captureFrame.mock.calls.length).toBe(framesBefore);
    expect(agent.speechOwnerTurnId).toBeNull();
  });
});

describe('RC3 — turn identity through the real handleUserText path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allocates exactly one turn id per request, and never a second one', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined);
    const before = agent.currentUserTurnId;

    // Caller supplies no id (HTTP entry point / data channel / tests).
    await agent.handleUserText(DETERMINISTIC_PROMPT);
    expect(agent.currentUserTurnId).toBe(before + 1);

    // Caller supplies the id it already allocated (the voice path).
    await agent.handleUserText(DETERMINISTIC_PROMPT, before + 1);
    expect(agent.currentUserTurnId).toBe(before + 1);

    expect(speakSpy).toHaveBeenCalled();
    speakSpy.mockRestore();
  });

  it('the answer is associated with its own turn across 20 consecutive turns', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined);
    const answeredTurns: number[] = [];

    for (let i = 1; i <= 20; i++) {
      agent.currentUserTurnId = i;
      const callsBefore = speakSpy.mock.calls.length;
      await agent.handleUserText(DETERMINISTIC_PROMPT, i, 0.95, false, TURN_META);

      // Scope the lookup to the calls THIS turn made: the answer text is
      // identical every iteration, so a plain find() would return turn 1's call.
      const call = speakSpy.mock.calls
        .slice(callsBefore)
        .find((c) => String(c[0]) === DETERMINISTIC_ANSWER);
      expect(call).toBeDefined();
      answeredTurns.push(call![1] as number);
      // The counter must never drift while turns are processed.
      expect(agent.currentUserTurnId).toBe(i);
    }

    expect(answeredTurns).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    speakSpy.mockRestore();
  });

  it('an unrelated request does not produce repeated runtime-status messages', async () => {
    const agent = makeSpeakingAgent();
    const speakSpy = vi.spyOn(agent, 'speak').mockResolvedValue(undefined);
    const broadcasts: any[] = [];
    const broadcastSpy = vi.spyOn(agent, 'broadcastData').mockImplementation((p: any) => {
      broadcasts.push(p);
    });

    agent.currentUserTurnId = 3;
    await agent.handleUserText(DETERMINISTIC_PROMPT, 3, 0.95, false, TURN_META);

    const assistantTexts = broadcasts.filter((b) => b?.type === 'assistant_text').map((b) => b.text);
    expect(assistantTexts).toEqual([DETERMINISTIC_ANSWER]);
    expect(assistantTexts.join(' ')).not.toMatch(/checking that now|checking the camera/i);

    speakSpy.mockRestore();
    broadcastSpy.mockRestore();
  });
});
```

### 4.2 `server/src/__tests__/quietRecoveryRouting.test.ts` (ADDED by this task)
```ts
/**
 * RC2 — no silence for handled turns, driven through the REAL turnRouter.
 *
 * The voice path routes through turnRouter.routeTurn(). The defect is that
 * finish() used to fall back to an EMPTY spoken string for a handled turn whose
 * entity could not be resolved, which jarvisNextAgent then completed as
 * `quiet_recovery`: the user got no response at all.
 *
 * The routing decision itself is NOT mocked. Only external side-effect surfaces
 * are replaced:
 *   - node:child_process: the choke point for launching Chrome, Outlook,
 *     Calculator, Comet, PowerShell automation, shell commands, ...
 *   - the desktop / browser executor singletons (application launching,
 *     browser navigation, desktop automation)
 *   - the Telegram adapter (UI actions, network)
 *   - the LLM gateway (outbound network)
 * So no real GUI application can be opened by this suite.
 *
 * Each turn runs against a REAL conversation row created through
 * conversationService, so the database requirements of the routing path are
 * satisfied rather than bypassed.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// ── Hard safety: nothing in this suite may spawn a process. ──────────────────
const fakeChild = () => ({
  on: () => {}, once: () => {}, off: () => {}, emit: () => {},
  stdout: null, stderr: null, stdin: null, kill: () => {}, unref: () => {},
  pid: 4242, killed: false, exitCode: 0,
});
vi.mock('node:child_process', () => ({
  spawn: vi.fn(fakeChild),
  fork: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execFile: vi.fn((_f: any, _a: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from(''), pid: 4242 })),
  default: {},
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(fakeChild),
  exec: vi.fn((_c: any, cb: any) => { cb?.(null, '', ''); return fakeChild(); }),
  execSync: vi.fn(() => Buffer.from('')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') })),
  default: {},
}));

// ── External side-effect executors / adapters (never the routing decision). ──
vi.mock('../domains/jarvis/execution/executors/desktopExecutor.js', () => {
  const cache = new Map<string, any>();
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!cache.has(prop as string)) {
        cache.set(prop as string, vi.fn(async () => ({
          ok: true, success: true, handled: true, verified: false, executed: false,
          output: '', message: `desktopExecutor.${String(prop)} stubbed — no real application was launched`,
          data: {},
        })));
      }
      return cache.get(prop as string);
    },
  });
  return { desktopExecutor: stub, DesktopExecutor: class {}, KNOWN_DESKTOP_APPS: [] };
});
vi.mock('../domains/jarvis/execution/executors/browserExecutor.js', () => {
  const cache = new Map<string, any>();
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!cache.has(prop as string)) {
        cache.set(prop as string, vi.fn(async () => ({
          ok: true, success: true, handled: true, verified: false, executed: false,
          output: '', message: `browserExecutor.${String(prop)} stubbed — no real browser navigation`,
          data: {},
        })));
      }
      return cache.get(prop as string);
    },
  });
  return { browserExecutor: stub, BrowserExecutor: class {} };
});
vi.mock('../adapters/telegramAdapter.js', () => {
  const cache = new Map<string, any>();
  const stub: any = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!cache.has(prop as string)) {
        cache.set(prop as string, vi.fn(async () => ({
          ok: true, success: true, handled: true, verified: false, executed: false,
          output: '', message: `telegramAdapter.${String(prop)} stubbed — no real Telegram UI action`,
          data: {},
        })));
      }
      return cache.get(prop as string);
    },
  });
  return { telegramAdapter: stub, TelegramAdapter: class {} };
});

vi.mock('../services/llmGateway.js', () => ({
  llmChat: vi.fn(async () => ({ reply: 'stubbed conversational reply' })),
}));

import { routeTurn } from '../domains/jarvisNext/turnRouter.js';
import { conversationService } from '../domains/conversations/service.js';

/** goalIds for which an empty spoken text is deliberate product behaviour. */
const INTENTIONAL_SILENCE_GOAL_IDS = new Set([
  'quiet_recovery', 'stop', 'suspended_ignored', 'wake_reactivated',
]);

const CORPUS = [
  'what is the status of the project',
  'tell me about something totally unrelated to anything',
  'how is the weather in Berlin today',
  'blah blah nonsense token sequence',
  'what do you think about the colour blue',
  'explain quantum entanglement briefly',
  'who won the world cup in 1998',
  'give me a poem about the sea',
  'summarize the meeting notes from yesterday',
  'do the thing with the stuff',
  'what happened to the plan',
  'compare two unrelated concepts for me',
  'what is the meaning of life',
  'describe the colour red',
  'is it going to rain tomorrow',
  'count from one to ten',
  'tell me a joke',
  'zzq wwv unknown entity request',
  'what else can you tell me about that',
  'give me an overview of nothing in particular',
];

type Observation = {
  prompt: string;
  handled: boolean | 'threw';
  route: string;
  goalId: string;
  silent: boolean;
  text: string;
  error?: string;
};

let conversationId: string;

async function observe(prompt: string, turnId: number): Promise<Observation> {
  try {
    const res: any = await routeTurn({
      prompt, conversationId, turnId, rawStt: prompt, confidence: 0.95,
    });
    return {
      prompt,
      handled: res?.handled === true,
      route: String(res?.route ?? ''),
      goalId: String(res?.goalId ?? ''),
      silent: res?.silent === true,
      text: String(res?.text ?? ''),
    };
  } catch (err: any) {
    return {
      prompt, handled: 'threw', route: '', goalId: '', silent: false, text: '',
      error: err?.message || String(err),
    };
  }
}

function printObservations(label: string, observations: Observation[]) {
  console.log(`\n[RC2] ${label}`);
  for (const o of observations) {
    console.log(
      `  handled=${String(o.handled).padEnd(5)} silent=${String(o.silent).padEnd(5)}` +
      ` goalId=${(o.goalId || '-').padEnd(18)} route=${(o.route || '-').padEnd(24)}` +
      ` text="${o.text}"${o.error ? ` ERROR=${o.error}` : ''}  <= ${o.prompt}`,
    );
  }
}

describe('RC2 — handled turns through the real turnRouter must not be silently empty', () => {
  beforeAll(async () => {
    // A real conversation row: the routing path's DB requirements are met, not bypassed.
    conversationId = await conversationService.createConversation('RC2 routing regression');
    expect(conversationId).toBeTruthy();
  });

  it('every handled turn in a 20-prompt corpus produces a spokeable outcome', async () => {
    const observations: Observation[] = [];
    for (let i = 0; i < CORPUS.length; i++) {
      observations.push(await observe(CORPUS[i], i + 1));
    }
    printObservations('routeTurn observations (20-prompt corpus):', observations);

    const thrown = observations.filter((o) => o.handled === 'threw');
    const unexplainedSilence = observations.filter(
      (o) =>
        o.handled === true &&
        o.text.trim() === '' &&
        !o.silent &&
        !INTENTIONAL_SILENCE_GOAL_IDS.has(o.goalId),
    );

    expect(thrown.map((o) => `${o.prompt}: ${o.error}`)).toEqual([]);
    expect(
      unexplainedSilence.map((o) => `${o.prompt} (route=${o.route}, goalId=${o.goalId})`),
    ).toEqual([]);
  }, 180_000);

  it('an entity-less request that reaches the generic fallback is never silent', async () => {
    const o = await observe('what else can you tell me about that', 99);
    printObservations('entity-less fallback probe:', [o]);

    if (o.handled === true && o.text.trim() === '') {
      // Explicitly intentional silence is allowed; anything else is the RC2 defect.
      expect(o.silent || INTENTIONAL_SILENCE_GOAL_IDS.has(o.goalId)).toBe(true);
    } else {
      expect(o.text.trim().length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('a desktop action whose executor cannot perform it still yields a terminal, non-silent outcome', async () => {
    // Executor + process spawning are stubbed, so the action cannot really happen.
    // The turn must still terminate with something the user can hear, rather than
    // completing silently.
    const o = await observe('open Calculator', 98);
    printObservations('desktop action probe (no application is actually opened):', [o]);

    expect(o.handled).not.toBe('threw');
    if (o.handled === true) {
      expect(o.silent || o.text.trim().length > 0).toBe(true);
    }
  }, 60_000);
});
```

### 4.3 Test files REMOVED by this task

The prior session had created two suites at `tests/jarvis/voice_pipeline_regression.test.ts` and `tests/jarvis/voice_stability_20_turns.test.ts`.
They were deleted by this task. Facts for the reviewer:

- That directory is untracked (`git status --porcelain tests/jarvis/` -> `?? tests/jarvis/`), so nothing was lost from git history.
- They were outside every vitest include path: root `npm test` is `vitest run src/` and `server/vitest.config.ts` is `include: ["src/__tests__/**/*.test.ts"]`.
- Their imports (`../../src/domains/jarvisNext/...`) resolved to `D:/AgenticOS/src/domains/jarvisNext/...`, which does not exist (production code is `server/src/...`).
- Their assertions were vacuous, e.g. `agent.currentUserTurnId = 1; ... expect(agent.currentUserTurnId).toBe(1)`.

`tests/jarvis/control.test.ts` (pre-existing, not authored or modified by this task) still remains in that directory.

### 4.4 Other voice/stability suites in the repository (NOT authored by this task)

For completeness, these pre-existing voice suites exist and were NOT modified:
```
jarvisAccountBindingAndMetrics.test.ts
jarvisAntiParrotRepair.test.ts
jarvisBlockerFollowUp.test.ts
jarvisClosedWorldAndMemory.test.ts
jarvisCompleteAcceptanceServer.test.ts
jarvisContextAndExecutionTruth.test.ts
jarvisConversationalAuthority.test.ts
jarvisConversationalMode.test.ts
jarvisConversationalSupervisor.test.ts
jarvisConversationCorpus.test.ts
jarvisCorrectionAndAccount.test.ts
jarvisCrossConversationSecurity.test.ts
jarvisCrossProjectExecution.test.ts
jarvisDelegation.test.ts
jarvisDelegationRouting.test.ts
jarvisDirectStreaming.test.ts
jarvisExecutiveOrchestration.test.ts
jarvisGlobalStreamLifecycle.test.ts
jarvisHermesTransportLifecycle.test.ts
jarvisHitlRecovery.test.ts
jarvisIdentityRepair.test.ts
jarvisIntentRouter.test.ts
jarvisNextCancellation.test.ts
jarvisOperationalGrounding.test.ts
jarvisParity.test.ts
jarvisPositiveEvidenceFixtures.test.ts
jarvisProjectDelegationAndModes.test.ts
jarvisRealUiTransaction.test.ts
jarvisRoutingAcceptance.test.ts
jarvisRuntimeFix003.test.ts
jarvisTrace.test.ts
jarvisTruthAndLanguageRegression.test.ts
jarvisV2Kernel.test.ts
jarvisV2Voice.test.ts
jarvisVoiceResolutionRequirements.test.ts
voicePipelineRegression.test.ts
voicePipelineRobustness.test.ts
voiceRuntimeLifecycle.test.ts
voiceTranscribe.test.ts
```

## 5. Root-cause evidence — `phase1_audit_report.md` (verbatim)

Source of truth supplied for this work: `C:\Users\cd-pr\.gemini\antigravity-ide\brain\361c39a0-27b5-4ffe-b474-bc5ed0401688\phase1_audit_report.md` (file mtime 2026-09-30 18:31).

```markdown
# AgenticOS Voice Pipeline — Phase 1 Audit Report

**Auditor:** Claude Opus 4.6 (independent, read-only)  
**Date:** 2026-09-30  
**Scope:** Conversation deadlocks, stale responses, incorrect routing, excessive latency

---

## Executive Summary

The voice assistant fails in normal conversation due to **three interacting defects**, not one. The automated test suite passes because it exercises a **completely different code path** (HTTP → `canonicalTurnExecutionService`) than the voice pipeline (`jarvisNextAgent.handleUserText` → `turnRouter.routeTurn`). Tests prove nothing about voice reliability.

---

## Root Cause 1 — Acknowledgment Timer Race (P0, Primary)

**The defect:** A fire-and-forget acknowledgment timer in `handleUserText()` creates a race between the ack playout completing and the router still computing the real answer.

### Mechanism

1. User speaks → STT → [`handleUserText()`](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1481) sets `isProcessingUserTurn = true`
2. [Line 1720](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1720): `setTimeout` fires an ack ("I'm checking that now.") after `ackDelayMs`
3. [Line 1747](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1747): `void this.speak(ack, activeTurnId)` — **fire-and-forget**, does not await
4. [Line 1752](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1752): `await routeTurn()` runs concurrently — takes 2–7s (confirmed by JRT trace: `ROUTER_END durationMs=6866`)
5. Ack playout completes → `speak()` finally block [line 2425](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L2425) sets `isProcessingUserTurn = false` via `setTimeout(400)`
6. **Latch released while router is still running.** VAD can now accept new speech. Any ambient sound increments `currentUserTurnId`.
7. Router returns → staleness check at [line 1786](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1786) fails → **real answer is discarded**.

### Alternate failure (ack still playing when router returns)

If the router finishes while the ack is still playing, [`speak()` ownership gate at line 2100](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L2100) coalesces the real answer behind the ack. The coalesced text is drained by [`drainFollowUpSpeech()`](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L2018) which filters by `originTurnId === currentTurn` — if the turn advanced, the answer is **silently dropped** at [line 2025](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L2025).

### JRT Evidence

The trace shows the pattern repeatedly:
```
SPEAK_COALESCED turn=X depth=1    ← real answer coalesced
TURN_COMPLETE turn=X route=...    ← turn ends, coalesced text may never play
```

And `ack_fallback_delivered` turns where only the generic fallback was spoken, not the real answer.

### Fix

The ack `speak()` must **not release the turn latch**. Either:
- (A) Do not call `speak()` for the ack at all — use a lightweight `speakAck()` that skips latch management, OR
- (B) Track an `isAckPlayout` flag and suppress latch release in the `speak()` finally block when it's just an ack, OR  
- (C) Cancel the ack timer when the router returns (already done at [line 1768](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1768)), but the timer may have already fired. Add: if ack is actively playing when router returns, interrupt it via `interruptAssistantPlayout('router_result_ready')` before speaking the real answer.

**Recommended: Option C** — it's the smallest change and preserves the existing architecture.

**File:** [`jarvisNextAgent.ts`](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts) lines 1713–1770 and 2405–2436.

---

## Root Cause 2 — `quiet_recovery` Epidemic (P0)

**The defect:** `turnRouter.routeTurn()` returns `handled: true` with empty `text` for a wide class of user utterances. `jarvisNextAgent` treats this as `quiet_recovery` — the user gets **complete silence**.

### Mechanism

In `turnRouter.ts`, the [`finish()` helper](file:///D:/AgenticOS/server/src/domains/jarvisNext/turnRouter.ts#L887) at line 906–913: if no entity is resolved and the route doesn't match specific patterns (`action`, `navigate`, `browser`, `blocker_detail_read`), the fallback at **line 912 sets `finalSpokenText = ''`**.

In `jarvisNextAgent.ts` [lines 1792–1813](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1792): if `routed.handled` is true and `routed.text` is empty and no ack was spoken, the turn silently completes as `quiet_recovery`.

### JRT Evidence

273+ `quiet_recovery` completions in the trace log. Many of these are real user utterances that received no response at all.

### Fix

The `finish()` fallback chain in `turnRouter.ts` must produce a spoken response for all `handled: true` results. At minimum, replace the empty string at line 912 with a generic: `"I'm not sure how to help with that. Could you rephrase?"`. Additionally, audit all `routeTurn` return paths that set `handled: true` without setting `text`.

**File:** [`turnRouter.ts`](file:///D:/AgenticOS/server/src/domains/jarvisNext/turnRouter.ts) line 906–913.

---

## Root Cause 3 — Dual Pipeline Divergence (P1)

**The defect:** The HTTP streaming endpoint and the voice pipeline use **completely different routing engines**.

| Path | Entry | Router | Used by |
|------|-------|--------|---------|
| HTTP | [`jarvis.ts:2949`](file:///D:/AgenticOS/server/src/routers/jarvis.ts#L2949) | `canonicalTurnExecutionService` (regex) | Desktop UI, test suite |
| Voice | [`jarvisNextAgent.ts:1752`](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1752) | `turnRouter.routeTurn` (entity resolution + LLM) | LiveKit voice |

The test suite sends HTTP POST requests and validates against `canonicalTurnExecutionService` regex patterns. Voice goes through an entirely separate `turnRouter` with different entity resolution, different action dispatch, and different fallback chains. **The test suite cannot detect voice regressions.**

### Fix

Either: unify both paths through `canonicalTurnExecutionService` (high risk), or create a voice-specific test suite that injects text directly into `jarvisNextAgent.handleUserText()` via the LiveKit data channel or a test harness.

---

## Secondary Issues

| Issue | Location | Severity |
|-------|----------|----------|
| `PARTICIPANT_DISCONNECTED` doesn't cancel active turn processing | [`jarvisNextAgent.ts`](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts) — no handler for disconnect during router await | P2 |
| `commitUserTurn` increments `currentUserTurnId` at [line 1423](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1423) then calls `handleUserText` which increments AGAIN at [line 1498](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L1498) — double increment | P2 |
| 15s watchdog timeout is too long for conversational latency — user gives up and speaks again, causing stale drops | [line 421](file:///D:/AgenticOS/server/src/domains/jarvisNext/jarvisNextAgent.ts#L421) | P3 |
| Test assertions use weak regex (`/comet\|perplexity/i`) that match response text mentioning any keyword, not verifying actual action execution | [`test_full_production_suite.cjs`](file:///C:/Users/cd-pr/.gemini/antigravity-ide/brain/361c39a0-27b5-4ffe-b474-bc5ed0401688/scratch/test_full_production_suite.cjs) lines 97, 105 | P2 |

---

## Proposed Regression Tests

1. **Ack-Router Race:** Inject text into `handleUserText()`, mock `routeTurn()` to resolve after 3s. Verify the real answer is spoken, not the ack fallback.
2. **Coalesced Speech Delivery:** Same setup but mock router to resolve while ack is mid-playout. Verify coalesced text is drained and spoken.
3. **`quiet_recovery` Elimination:** Send 20 diverse prompts through `routeTurn()`. Assert none return `handled: true` with empty `text`.
4. **Stale Turn Drop:** Inject two rapid turns. Verify turn 1's late response is discarded and turn 2's response is spoken.
5. **Participant Disconnect:** Simulate disconnect during router await. Verify turn processing is cancelled and latch released.

---

## Remaining Uncertainty

- Whether the `speechArbiter` queue drain at [`onUserTurnComplete()`](file:///D:/AgenticOS/server/src/domains/jarvisNext/speechArbiter.ts#L237) can itself trigger a re-entrant `speak()` that re-acquires `speechOwnerTurnId` and blocks the next real turn. Needs tracing with a multi-turn conversation where P2/P3 events fire between user turns.
- Whether `ControlPlaneTurnHandler` (73KB) has its own latency contribution when invoked from `turnRouter` for `action`/`desktop` routes — some turns show 5–7s router durations which may come from its Argus verification + capability discovery chain.

---

## Implementation Priority

| Order | Fix | Est. LOC | Risk |
|-------|-----|----------|------|
| 1 | RC1: Ack timer race — interrupt ack when router returns | ~15 | Low |
| 2 | RC2: `quiet_recovery` — ensure `finish()` always produces text | ~10 | Low |
| 3 | RC3: Voice-specific test harness | ~80 | None |
| 4 | Secondary: double turn ID increment | ~5 | Low |
| 5 | Secondary: disconnect cancellation | ~20 | Medium |
```

### 5.1 Annotations: what later source inspection confirmed, corrected, or superseded

These are factual observations with the commands that produced them. No verdict is offered.

| # | Claim in the audit report | Observation in current source | How established |
|---|---|---|---|
| a | RC1: ack playout completion releases the latch, enabling the turn to be superseded while the router still runs | Confirmed in source. `speak()` final-block sets `isProcessingUserTurn = false` inside `setTimeout(..., 400)` when the playout ids match. | `sed -n 2437,2496p` of `jarvisNextAgent.ts` (in section 2.6) |
| b | RC1 fix "Option C": interrupt the ack when the router returns | Present as `interruptAssistantPlayout(\"router_result_ready\")` after the `routeTurn()` await. Note this path requires `this.isSpeaking && this.speechOwnerTurnId === activeTurnId`, i.e. the ack must still be playing. | section 2.5, and `grep -n router_result_ready` |
| c | RC1 fix "Option A/B": the ack must not release the turn latch at all | Supersedes/supplements (b) for the case where the ack finishes playing *before* the router returns. Implemented via `preliminaryAckPlayoutIds` + `opts.preliminaryAck`. | section 2.6, section 2.7 task hunks |
| d | RC2: `finish()` at former line 912 sets `finalSpokenText = ""` for handled turns with no resolved entity | True at the base revision: `git show HEAD:server/src/domains/jarvisNext/turnRouter.ts` shows `finalSpokenText = \x27\x27;`. The current working tree has `\"I\x27m not sure how to help with that. Could you rephrase?\"` at line 912. This task did NOT edit `turnRouter.ts`. | section 3.6/3.7, `grep -c \"RC1\|RC3\|preliminaryAck\" turnRouter.ts` -> 0 |
| e | RC2: audit all `routeTurn` return paths that set `handled: true` without `text` | Two further `text: ""` returns exist and set `goalId: \x27stop\x27` + `silent: true` (intentional silence), plus the `finalSpokenText = \x27\x27` branch gated on `quiet_recovery`/`stop`/`suspended_ignored`/`wake_reactivated`/`silent`. | section 3.1/3.2 |
| f | RC3: "production test path mismatch" — tests exercise a different path than voice | Confirmed structurally: the audit names `server/src/routers/jarvis.ts:2949` -> `canonicalTurnExecutionService` for HTTP vs `jarvisNextAgent.handleUserText` -> `turnRouter.routeTurn` for voice. Both files exist in tree. | section 8 call-path map |
| g | Secondary: "`commitUserTurn` increments `currentUserTurnId` at line 1423 then calls `handleUserText` which increments AGAIN at line 1498 — double increment" | NOT CONFIRMED as stated. At the base revision the two sites were `const acceptedTurnId = ++this.currentUserTurnId;` (commitUserTurn) and `const activeTurnId = turnId ?? ++this.currentUserTurnId;` (handleUserText). Because `commitUserTurn` passes `acceptedTurnId`, `turnId` was defined on the voice path, so the `++` did not execute a second time. There was no double increment on that path. The working tree had been changed to `turnId ?? this.currentUserTurnId` (removing the fallback increment for callers that pass no turnId) before this task; this task restored the base-revision form. | `git show HEAD:...jarvisNextAgent.ts \| grep -n \"acceptedTurnId\|++this.currentUserTurnId\"` -> lines 1331 and 1406; section 2.7 |
| h | Secondary: 15s watchdog too long | Present, unchanged: `TURN_WATCHDOG_MS = 15_000`. Not addressed. | section 2.2 |
| i | Secondary: `PARTICIPANT_DISCONNECTED` does not cancel an in-flight turn | Not addressed by this task. No verdict on current presence. | — |

## 6. Test execution evidence

### 6.1 TypeScript — `npx tsc --noEmit`
```
$ cd /d/AgenticOS/server && npx tsc --noEmit
exit code: 0
stdout/stderr: (empty)
```

### 6.2 Server build — `npm run build`
```
$ cd /d/AgenticOS/server && npm run build
exit code: 0

> server@1.0.0 build
> node scripts/ensure-venv.cjs && tsc && node ../scripts/build-identity.cjs

[ensure-venv] Python venv ready: D:\AgenticOS\server\.venv\Scripts\python.exe (Python 3.14.7)
[build-identity] Generated 8f7463aa-dirty-20260930-190250 (git=8f7463aa, dirty=true)
```

### 6.3 Targeted voice + routing suites (verbose reporter) — PRODUCTION RUN
```
$ cd /d/AgenticOS/server && npx vitest run --reporter=verbose \
    src/__tests__/voicePipelineRegression.test.ts \
    src/__tests__/quietRecoveryRouting.test.ts
exit code: 0
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC1 — acknowledgement lifecycle does not release the active turn > the acknowledgement playout completing does NOT release the turn latch 359ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC1 — acknowledgement lifecycle does not release the active turn > the real answer playout DOES release the turn latch 864ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC1 — acknowledgement lifecycle does not release the active turn > ack then answer never leaves the latch stuck 1202ms
 ✓ src/__tests__/quietRecoveryRouting.test.ts > RC2 — handled turns through the real turnRouter must not be silently empty > every handled turn in a 20-prompt corpus produces a spokeable outcome 4646ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC1 — acknowledgement lifecycle does not release the active turn > if an acknowledgement is spoken it is marked as a preliminary ack 2235ms
 ✓ src/__tests__/quietRecoveryRouting.test.ts > RC2 — handled turns through the real turnRouter must not be silently empty > an entity-less request that reaches the generic fallback is never silent 32ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC1 — acknowledgement lifecycle does not release the active turn > a stale speak() for a superseded turn is never played out 2ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC3 — turn identity through the real handleUserText path > allocates exactly one turn id per request, and never a second one 23ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC3 — turn identity through the real handleUserText path > the answer is associated with its own turn across 20 consecutive turns 35ms
 ✓ src/__tests__/voicePipelineRegression.test.ts > RC3 — turn identity through the real handleUserText path > an unrelated request does not produce repeated runtime-status messages 3ms
 ✓ src/__tests__/quietRecoveryRouting.test.ts > RC2 — handled turns through the real turnRouter must not be silently empty > a desktop action whose executor cannot perform it still yields a terminal, non-silent outcome 1402ms
 Test Files  2 passed (2)
      Tests  11 passed (11)
   Duration  8.17s (transform 3.34s, setup 0ms, import 3.10s, tests 10.81s, environment 2ms)
```

### 6.4 RC2 routing observations (raw stdout of the corpus run, console interception disabled)

Command: `npx vitest run --disable-console-intercept src/__tests__/voicePipelineRegression.test.ts src/__tests__/quietRecoveryRouting.test.ts`
In that invocation only `quietRecoveryRouting.test.ts` reported (Test Files 1 passed (1) / Tests 3 passed (3)); the console table below is the corpus output.
```
  handled=true  silent=false goalId=-                  route=investigate              text="Investigation completed for the project. Gateway probes and background tasks are operating normally; detailed evidence is recorded in diagnostics."  <= what is the status of the project
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= tell me about something totally unrelated to anything
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= how is the weather in Berlin today
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= blah blah nonsense token sequence
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= what do you think about the colour blue
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= explain quantum entanglement briefly
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= who won the world cup in 1998
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= give me a poem about the sea
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= summarize the meeting notes from yesterday
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= do the thing with the stuff
  handled=true  silent=false goalId=-                  route=memory                   text="I do not have a memory matching that yet."  <= what happened to the plan
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= compare two unrelated concepts for me
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= what is the meaning of life
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= describe the colour red
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= is it going to rain tomorrow
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= count from one to ten
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= tell me a joke
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= zzq wwv unknown entity request
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= what else can you tell me about that
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= give me an overview of nothing in particular
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="I encountered an issue processing your request."  <= what else can you tell me about that
  handled=true  silent=false goalId=-                  route=deep_supervisor          text="Stubbed conversational reply"  <= open Calculator
```

### 6.5 Repository root gates (NOT the command relevant to this change; recorded for completeness)

`npm run test` is `vitest run src/` and therefore covers only the React renderer under `src/`. The two files this task added live in `server/src/__tests__/` and are outside that filter.

```
$ cd /d/AgenticOS && npm run test
exit code: 1
 Test Files  14 failed | 67 passed (81)
      Tests  49 failed | 645 passed (694)
   Duration  57.98s (transform 13.36s, setup 16.99s, import 43.62s, tests 184.66s, environment 138.75s)
--- failing files ---
src/__tests__/ApiClientHelper.test.ts
src/__tests__/AppShell.test.tsx
src/__tests__/CodeX.test.tsx
src/__tests__/CodeXStudio.test.tsx
src/__tests__/JarvisConversationOwnership.test.tsx
src/__tests__/JarvisLayout.test.tsx
src/__tests__/JarvisNavigation.test.tsx
src/__tests__/JarvisNavigationEvents.test.tsx
src/__tests__/JarvisOrb.test.tsx
src/__tests__/jarvisPersistentRuntime.test.tsx
src/__tests__/JarvisStudioLayout.test.tsx
src/__tests__/MissionControlConversation.test.tsx
src/__tests__/voicePlaybackMute.test.tsx
src/__tests__/voiceVadResilience.test.tsx
--- occurrences of THIS TASK\x27s added test files in that run ---
grep -c "voicePipelineRegression|quietRecoveryRouting" root_test.log  =>  0
```

```
$ cd /d/AgenticOS && npm run lint
exit code: 1
✖ 7588 problems (7521 errors, 67 warnings)
  107 errors and 12 warnings potentially fixable with the `--fix` option.

```

### 6.6 Scope statement on the full suite

The full server suite (`cd server && npx vitest run`, 206 files) was NOT re-run after the final edits on instruction. It was run ONCE early in this task and reported `Test Files 64 failed | 142 passed (206)` / `Tests 148 failed | 2186 passed | 2 skipped (2336)` (Duration 187.20s). See section 7 regarding what that number does and does not prove.

## 7. Baseline failures

**PRE-EXISTING STATUS NOT PROVEN.**

No base-revision baseline was established. Reasons, stated precisely:

1. Establishing a base-revision baseline requires running the suites against `HEAD` with the working tree unchanged. Every available mechanism here was either forbidden by the task constraints or impractical: `git stash` / `git checkout` would modify the working tree (forbidden — "Do not modify any additional source code"), and a separate `git worktree add` at `HEAD` would not carry `node_modules` (root `vitest` resolves from `D:/AgenticOS/node_modules`; the server has its own `server/node_modules`), so its suites could not be executed there without an install.
2. The one full-server-suite number available is **not** a baseline. It was measured on a working tree that already contained BOTH the pre-existing uncommitted branch work AND this task's `jarvisNextAgent.ts` edits (the run started 20:49:21, after those patches were applied). It is a mid-task measurement, not a base-revision measurement.
3. File mtimes were observed (e.g. `voicePipelineRobustness.test.ts` dated 2026-09-25, before this task). **Timestamps are not proof of pre-existing failure status** and are not offered as such.

### 7.1 What is proven, and what it does not mean

Proven — *non-attribution*, by file-scope disjointness:

- This task edited exactly one tracked file: `server/src/domains/jarvisNext/jarvisNextAgent.ts`. It added two untracked files under `server/src/__tests__/`. It edited nothing under `src/`.
- Root `npm run test` (`vitest run src/`) does not include this task's added test files, and does not reach `server/` in that run (grep count for the two added filenames in that run's log: 0).
- Therefore the root suite failures and the root lint failures are **not attributable** to this task.

NOT proven:

- That the root suite / root lint / server-suite failures are PRE-EXISTING. Those trees contain large volumes of pre-existing uncommitted branch work, so pre-existence is plausible but unestablished here.
- The figure `148 failed | 2186 passed` for the server suite: valid only as a measurement of the mid-task working tree described above.

### 7.2 Numbers recorded during this task (context, not baseline)

| Run | Command | Result | Position relative to this task's edits |
|---|---|---|---|
| Server suite (run once, not repeated) | `cd server && npx vitest run` | `Test Files 64 failed / 142 passed (206)`; `Tests 148 failed / 2186 passed / 2 skipped (2336)`; 187.20s | AFTER this task's `jarvisNextAgent.ts` patches; BEFORE this task's new tests existed |
| Root suite | `npm run test` | `Test Files 14 failed / 67 passed (81)`; `Tests 49 failed / 645 passed (694)`; 57.98s | after all edits |
| Root lint | `npm run lint` | `7588 problems (7521 errors, 67 warnings)` | after all edits |

## 8. Architecture map — call path derived from source

Arrows name the file and function actually responsible as read in this pass. Items marked *(not inspected)* were not opened; they are listed because production code calls them.

```text
physical voice input
  -> jarvisNextAgent.processUserAudioFrame()          [jarvisNextAgent.ts ~1000-1130]
       CASE A while isSpeaking: barge-in decision (sustain / reject_echo)
       CASE B while isProcessingUserTurn: frames DROPPED, droppedFramesWhileLatched++
             (MIC_GATED_FOR_HELD_TURN)  [~1066-1073]
       CASE B idle: speech onset -> isAccumulatingSpeech, USER_SPEAKING, pre-roll buffer
  -> VAD silence timer setTimeout(SILENCE_DURATION_MS) -> this.commitUserTurn()   [~1121]

transcription
  -> JarvisNextAgent.commitUserTurn()                 [jarvisNextAgent.ts 1207]
       turn latch acquired: isProcessingUserTurn = true, turnLatchAcquiredAt = Date.now()  [~1216-1219]
       armTurnWatchdog(turnId, voiceConversationId)   [~1226 -> 448; TURN_WATCHDOG_MS = 15_000 @421]
       transcribeLocally(wavBuffer, ".wav", "en")     [services/voice/localTranscribe.ts]
       stripWakeWord(); isSelfHearingEcho() echo gate -> releaseTurnLatch("echo_rejected")  [~1402-1416]
       TURN ID ALLOCATION: const acceptedTurnId = ++this.currentUserTurnId   [~1432]
       interruptAssistantPlayout("accepted_user_turn" | "real_user_barge_in")  [~1438-1440]
  -> await this.handleUserText(text, acceptedTurnId, confidence, isBargeIn, turnMeta)  [~1463]

handleUserText                                        [jarvisNextAgent.ts 1490]
  -> const activeTurnId = turnId ?? ++this.currentUserTurnId        [1509]
  -> isProcessingUserTurn = true; foregroundTurnActive = true       [1510-1511]
  -> detectControlIntent() STOP -> handleStopCommand("local_control_detector")   [1532-1540]
  -> supersession regex -> interruptAssistantPlayout("user_superseded")          [1542-1580]
  -> deterministic local routes (engineering delegation / TTS provider / language switch /
     time-of-day / active voice / trivial conversational intents) -> speak() + return  [1595-1700]
  -> grounding gate: isProjectStateRequest() / GROUNDING_REFUSAL                  [~1706+]

acknowledgement scheduling
  -> if (!isConversationalAck) setTimeout(..., ackDelayMs)   [~1735-1775]
       ackDelayMs = 650ms (visual op) / 2000ms (other)
       guard: currentUserTurnId === activeTurnId && isProcessingUserTurn && !isSpeaking
       broadcastData({ type: "assistant_text", text: ack })
       void this.speak(ack, activeTurnId, { preliminaryAck: true })    [~1774]

routing
  -> const { routeTurn } = await import("./turnRouter.js")                        [~1778]
  -> routeTurn({ prompt, conversationId, turnId: activeTurnId, rawStt, confidence,
                 isBargeIn, isStale: () => this.currentUserTurnId !== activeTurnId,
                 onActionProgress })                                             [~1779-1793]
       turnRouter.routeTurn()                         [turnRouter.ts 848]
         -> stripWakeWord / self-correction normalisation            [~871-885]
         -> finish() non-silence invariant + quiet_recovery gate     [887-893]
         -> STOP / CANCEL routes (silent: true, goalId stop/cancel)  [~983-1060]
         -> explicit engineering delegation (highest precedence)     [~1102]
         -> controlPlaneTurnHandler.handleTurn({...})                [~1135-1136]
         -> system introspection / supervisor tools / LLM            [~1208, ~1257, ~1302]
         -> isDeclarativeStatement(prompt) -> finish({ text: "Understood." })  [1528]
         -> terminal returns: refusal (stale_turn), deep_supervisor  [~2370, ~2393]
       NOTE: the route value "investigate" observed in test output does NOT originate in
             turnRouter.ts. It comes from server/src/domains/jarvis/intentRouter.ts:687 and
             server/src/domains/jarvis/investigation.ts:112 (supervisor / grounded path).

post-router (still inside handleUserText)
  -> clear currentAckTimer                                                  [~1795]
  -> if (isSpeaking && speechOwnerTurnId === activeTurnId)
       interruptAssistantPlayout("router_result_ready")                     [~1800]
  -> STALE DETECTION: if (currentUserTurnId !== activeTurnId)
       releaseTurnLatch("stale_check_routed"); return                       [~1818]
  -> if (routed.handled):
       empty text -> lat.immediateAckSpoken ? speak(fallbackCompletion)
                                            : releaseTurnLatch("quiet_recovery")  [~1824-1837]
       else       -> await this.speak(routed.text, activeTurnId)             [~1928]
  -> else (not handled) -> LLM / supervisor path via llmGateway.llmChat()
  -> finally { if (!isSpeaking && !isSynthesizing) releaseTurnLatch("turn_finished_idle") }  [~2037-2039]

executor / reasoning
  -> delegated inside routeTurn: ControlPlaneTurnHandler.handleTurn
       (controlPlane/ControlPlaneTurnHandler.ts),
     executors under jarvis/execution/executors/* (desktopExecutor, browserExecutor,
       terminalExecutor, filesystemExecutor, gitExecutor, engineeringExecutor,
       internalAgenticOSExecutor),
     jarvis/supervisorTools.js, services/llmGateway.llmChat()

final response
  -> TurnResult.text -> handleUserText -> this.speak(text, activeTurnId)

speak()                                               [jarvisNextAgent.ts 2066]
  -> isSuspended -> drop; isProcessingUserTurn = false                       [~2072]
  -> !audioSource || !room.isConnected -> HEADLESS synthesis path            [~2078]
  -> STALE GUARD: turnId !== undefined && turnId !== currentUserTurnId
       -> STALE_SPEECH_DROP; isProcessingUserTurn = false; return            [~2110]
  -> OWNERSHIP GATE: speechOwnerTurnId === activeTurnId && (isSynthesizing || isSpeaking)
       -> pendingCoalesced.push(...); return   (SPEAK_COALESCED)             [~2130]
     other-owner branch -> drop if older turn, else coalesce                 [~2138-2150]
  -> take ownership: const playoutId = ++this.currentAssistantPlayoutId
       if (opts?.preliminaryAck) preliminaryAckPlayoutIds.add(playoutId)     [~2167-2172]
       this.speechOwnerTurnId = activeTurnId                                 [~2170]
  -> synthesizeLocally() / mp3ToPcmFrames() / playFrames() -> audioSource.captureFrame()

speech arbiter / playout completion                    [speak() finally, ~2460-2515]
  -> if (currentAssistantPlayoutId === playoutId):
       const isPreliminaryAck = preliminaryAckPlayoutIds.delete(playoutId)   [~2468]
       isSynthesizing = false; isSpeaking = false; speechOwnerTurnId = null
       if (!isPreliminaryAck) { foregroundTurnActive = false;
                                setMicState("LISTENING", "playout_complete") }
       if (!isPreliminaryAck) setTimeout(400) { isProcessingUserTurn = false;
             turnLatchAcquiredAt = null; clear turnWatchdog;
             drainFollowUpSpeech().then(speechArbiter.onUserTurnComplete()) }
     else: preliminaryAckPlayoutIds.delete(playoutId);
           releaseTurnLatch("playout_aborted")                               [~2494-2500]
  -> speechArbiter: speechArbiter.flush() (handleUserText) /
     speechArbiter.onUserTurnComplete()   [server/src/domains/jarvisNext/speechArbiter.ts]  (not inspected)

turn completion
  -> JarvisNextAgent.releaseTurnLatch(reason)         [jarvisNextAgent.ts 432]
       clears turnWatchdog; isProcessingUserTurn = false; foregroundTurnActive = false;
       turnLatchAcquiredAt = null; droppedFramesWhileLatched = 0;
       speechArbiter.onUserTurnComplete()
  -> backstop: onTurnWatchdogExpired(turnId, conversationId)  [463], fires after 15_000 ms [421]
  -> cancellation: interrupt(reason) [1137] -> currentUserTurnId++ then
       interruptAssistantPlayout() [1144]
```

### 8.1 Divergent entry points (the audit report's RC3 "path mismatch")

| Path | Entry | Router |
|---|---|---|
| Voice | `jarvisNextAgent.handleUserText()` -> `turnRouter.routeTurn()` | `server/src/domains/jarvisNext/turnRouter.ts` |
| HTTP / tests | `server/src/routers/jarvis.ts` -> `canonicalTurnExecutionService` | `server/src/domains/jarvis/canonicalTurnExecutionService.ts` |
| External text entry | `server/src/routers/jarvisNext.ts:157` -> `jarvisNextAgent.handleUserText(text, undefined, confidence)` | `server/src/domains/jarvisNext/turnRouter.ts` |
| LiveKit data channel | `jarvisNextAgent.ts:838` (`data.type === "user_text"`) -> `handleUserText(data.text)` | `server/src/domains/jarvisNext/turnRouter.ts` |

---

END OF BUNDLE. Prepared read-only for independent review. No PASS/FAIL verdict is offered. No deployment, commit, or push was performed.
