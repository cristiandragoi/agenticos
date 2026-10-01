# AgenticOS — READ-ONLY Evidence Bundle: `read_foreground_screen`

Prepared for independent review. No code was modified in producing this bundle; nothing was deployed, committed or pushed.

- Repository: `D:\AgenticOS`  Branch: `hermes-rescue-20260908`  HEAD: `8f7463a`
- Generated: 2026-09-30T22:28:25+02:00

## 1. Repository state — `git status --short`
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
?? .deploy-rollback/
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
?? foreground_screen_review.md
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
?? server/src/__tests__/foregroundScreenRead.test.ts
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
?? server/src/domains/jarvis/execution/foregroundScreenIntent.ts
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
?? server/src/services/perception/foregroundScreenReader.ts
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

## 2. Exact diff for TRACKED files modified by this foreground-screen task

Two tracked files are modified by this task. `desktop_perception.ps1` already carried
UNRELATED PRE-EXISTING uncommitted changes before this task started; section 2.3
identifies exactly which hunks are this task's.

### 2.1 `server/scripts/desktop_perception.ps1`
```diff
diff --git a/server/scripts/desktop_perception.ps1 b/server/scripts/desktop_perception.ps1
index f7eea48..d36faa9 100644
--- a/server/scripts/desktop_perception.ps1
+++ b/server/scripts/desktop_perception.ps1
@@ -5,6 +5,9 @@ param(
     [string]$OutScreenshotPath = ""
 )
 
+$OutputEncoding = [System.Text.Encoding]::UTF8
+[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
+
 $source = @"
 using System;
 using System.Text;
@@ -43,6 +46,12 @@ public class DesktopPerceptionHelper {
     [DllImport("user32.dll")]
     public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
     [DllImport("user32.dll")]
+    public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
+    [DllImport("user32.dll")]
+    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
+    [DllImport("user32.dll")]
+    public static extern bool IsIconic(IntPtr hWnd);
+    [DllImport("user32.dll")]
     public static extern IntPtr GetWindowDC(IntPtr hWnd);
     [DllImport("user32.dll")]
     public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
@@ -73,12 +82,20 @@ public class DesktopPerceptionHelper {
         public int Bottom;
     }
 
+    [StructLayout(LayoutKind.Sequential)]
+    public struct POINT {
+        public int X;
+        public int Y;
+    }
+
     public class WindowEntry {
         public long Hwnd;
         public uint Pid;
         public string Process;
         public string Title;
         public string ClassName;
+        public int Width;
+        public int Height;
     }
 
     public static void Attach() {
@@ -95,22 +112,34 @@ public class DesktopPerceptionHelper {
         List<WindowEntry> list = new List<WindowEntry>();
         EnumProc enumCallback = (hWnd, lParam) => {
             if (IsWindowVisible(hWnd)) {
+                StringBuilder sbClass = new StringBuilder(256);
+                GetClassName(hWnd, sbClass, 256);
+                string cName = sbClass.ToString();
+                if (cName.Contains("ToolSaveBits") || cName.Contains("Tooltip") || cName.Contains("DropShadow")) {
+                    return true;
+                }
+
+                RECT r;
+                GetWindowRect(hWnd, out r);
+                int w = r.Right - r.Left;
+                int h = r.Bottom - r.Top;
+
                 StringBuilder sb = new StringBuilder(512);
                 GetWindowText(hWnd, sb, 512);
                 string title = sb.ToString();
-                if (!string.IsNullOrEmpty(title)) {
+                if (!string.IsNullOrEmpty(title) && (w >= 100 && h >= 100 || cName == "Progman")) {
                     uint pid = 0;
                     GetWindowThreadProcessId(hWnd, out pid);
                     string pName = "";
                     try { pName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
-                    StringBuilder sbClass = new StringBuilder(256);
-                    GetClassName(hWnd, sbClass, 256);
                     WindowEntry e = new WindowEntry();
                     e.Hwnd = hWnd.ToInt64();
                     e.Pid = pid;
                     e.Process = pName;
                     e.Title = title;
-                    e.ClassName = sbClass.ToString();
+                    e.ClassName = cName;
+                    e.Width = w;
+                    e.Height = h;
                     list.Add(e);
                 }
             }
@@ -192,32 +221,63 @@ function Get-TargetWindow {
     # Check current foreground
     $fg = [DesktopPerceptionHelper]::GetForegroundWindow()
     $fgTitle = ""
+    $fgW = 0
+    $fgH = 0
     if ($fg -ne [IntPtr]::Zero) {
         $sb = New-Object System.Text.StringBuilder 512
         [DesktopPerceptionHelper]::GetWindowText($fg, $sb, 512) | Out-Null
         $fgTitle = $sb.ToString()
+        $rect = New-Object DesktopPerceptionHelper+RECT
+        [DesktopPerceptionHelper]::GetWindowRect($fg, [ref]$rect) | Out-Null
+        $fgW = $rect.Right - $rect.Left
+        $fgH = $rect.Bottom - $rect.Top
     }
 
     $qClean = if ($Query) { 
         $Query.ToLower().Trim() -replace '^(?:read|inspect|what\s+is\s+inside|what''s\s+inside|inside|in|the)\s+', '' -replace '\s+(?:window|page|app|application)$', ''
     } else { "" }
 
-    # If query is deictic or empty:
-    if (-not $qClean -or $qClean -match '^(?:active|current|this|the)\b' -or $qClean -eq 'active_window') {
-        # If foreground is valid and not AgenticOS, return foreground
-        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") {
+    # If query is deictic, empty, or desktop/screen:
+    if (-not $qClean -or $qClean -eq 'desktop' -or $qClean -eq 'screen' -or $qClean -eq 'fullscreen' -or $qClean -match '^(?:active|current|this|the)\b' -or $qClean -eq 'active_window') {
+        # If desktop or screen was explicitly queried, pick Progman if available
+        if ($qClean -eq 'desktop' -or $qClean -eq 'screen' -or $qClean -eq 'fullscreen') {
+            $progman = $allWindows | Where-Object { $_.ClassName -eq "Progman" -or $_.Title -eq "Program Manager" } | Select-Object -First 1
+            if ($progman) { return [IntPtr]$progman.Hwnd }
+        }
+        # If foreground is valid, not AgenticOS, and prominent
+        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*" -and $fgW -ge 300 -and $fgH -ge 200) {
             return $fg
         }
         # Otherwise pick first prominent non-explorer non-AgenticOS window
         $match = $allWindows | Where-Object { 
             $_.Process -ne "explorer" -and 
             $_.Title -notlike "*AgenticOS*" -and
-            $_.Title -notlike "*Program Manager*"
+            $_.Title -notlike "*Program Manager*" -and
+            $_.Width -ge 300 -and
+            $_.Height -ge 200
         } | Select-Object -First 1
         if ($match) { return [IntPtr]$match.Hwnd }
         if ($fg -ne [IntPtr]::Zero) { return $fg }
     }
 
+    if ($qClean -eq 'browser' -or $qClean -match '^(?:browser|web\s*browser)$') {
+        # Check active foreground first if it's a browser
+        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") {
+            $fgProc = $allWindows | Where-Object { $_.Hwnd -eq $fg.ToInt64() } | Select-Object -First 1
+            if ($fgProc -and $fgProc.Process -match 'comet|chrome|msedge|firefox|brave|opera') {
+                return $fg
+            }
+        }
+        # Find any prominent browser window (Comet, Chrome, Edge, etc.)
+        $browserMatch = $allWindows | Where-Object { 
+            $_.Process -match 'comet|chrome|msedge|firefox|brave|opera' -and 
+            $_.Width -ge 300 -and 
+            $_.Height -ge 200 
+        } | Select-Object -First 1
+        if ($browserMatch) { return [IntPtr]$browserMatch.Hwnd }
+        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") { return $fg }
+    }
+
     if ($qClean) {
         # Tokenize query
         $tokens = $qClean -split '[\s\-_/]+' | Where-Object { $_ -and $_ -notin @("app", "application", "browser", "window", "the", "a", "an") }
@@ -271,6 +331,211 @@ function Get-TargetWindow {
     return $fg
 }
 
+# ═════════════════════════════════════════════════════════════════════════════
+# ACTION: read_foreground
+#
+# Reads the ACTUAL foreground window's visible content.
+#
+# Separation of concerns (each step is a distinct, independently verifiable fact):
+#   1. Foreground identification  — GetForegroundWindow() ONLY. No window search,
+#      no token scoring over window titles, no application launching, no task lookup.
+#   2. Window geometry            — window rect vs CLIENT rect, expressed in screen
+#      coordinates, so the non-client band (title bar / caption buttons / borders)
+#      is a known rectangle rather than a guess.
+#   3. UI tree extraction         — UIA descendants of the CONTENT root.
+#   4. Content extraction         — non-client chrome is excluded by GEOMETRY
+#      (any element whose bounding box lies outside the client area) and by control
+#      type (TitleBar / MenuBar / ScrollBar / Thumb / Separator). The window title is
+#      reported as identity metadata and is NEVER injected into the content text.
+#   5. Screenshot                 — captured for the vision fallback; on its own it
+#      is never presented as extracted content.
+#
+# reason codes distinguish "nothing to read" from "cannot read this window".
+# ═════════════════════════════════════════════════════════════════════════════
+if ($Action -eq 'read_foreground') {
+    $fgHwnd = [DesktopPerceptionHelper]::GetForegroundWindow()
+    $reason = ""
+
+    if ($fgHwnd -eq [IntPtr]::Zero) { $reason = "no_foreground_window" }
+    elseif (-not [DesktopPerceptionHelper]::IsWindowVisible($fgHwnd)) { $reason = "foreground_not_visible" }
+    elseif ([DesktopPerceptionHelper]::IsIconic($fgHwnd)) { $reason = "foreground_minimised" }
+
+    $title = ""
+    $cls = ""
+    $procName = ""
+    $fgPid = [uint32]0
+
+    if ($reason -eq "") {
+        $sbT = New-Object System.Text.StringBuilder 512
+        [DesktopPerceptionHelper]::GetWindowText($fgHwnd, $sbT, 512) | Out-Null
+        $title = $sbT.ToString()
+
+        $sbC = New-Object System.Text.StringBuilder 256
+        [DesktopPerceptionHelper]::GetClassName($fgHwnd, $sbC, 256) | Out-Null
+        $cls = $sbC.ToString()
+
+        [DesktopPerceptionHelper]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid) | Out-Null
+        try { $procName = [System.Diagnostics.Process]::GetProcessById([int]$fgPid).ProcessName } catch {}
+
+        # Reading AgenticOS's own UI is never what the user means by "my screen".
+        if ($procName -match '^(?i:agenticos|electron)$' -or $title -like '*AgenticOS*') {
+            $reason = "foreground_is_agenticos"
+        }
+    }
+
+    if ($reason -ne "") {
+        [PSCustomObject]@{
+            success     = $false
+            action      = "read_foreground"
+            reason      = $reason
+            hwnd        = if ($fgHwnd) { $fgHwnd.ToInt64() } else { 0 }
+            windowTitle = $title
+            process     = $procName
+        } | ConvertTo-Json -Compress
+        exit 0
+    }
+
+    # ── 2. Geometry: separate client area from non-client chrome ────────────
+    $winRect = New-Object DesktopPerceptionHelper+RECT
+    [DesktopPerceptionHelper]::GetWindowRect($fgHwnd, [ref]$winRect) | Out-Null
+    $cliRect = New-Object DesktopPerceptionHelper+RECT
+    [DesktopPerceptionHelper]::GetClientRect($fgHwnd, [ref]$cliRect) | Out-Null
+    $origin = New-Object DesktopPerceptionHelper+POINT
+    $origin.X = 0
+    $origin.Y = 0
+    [DesktopPerceptionHelper]::ClientToScreen($fgHwnd, [ref]$origin) | Out-Null
+
+    $clientLeft   = $origin.X
+    $clientTop    = $origin.Y
+    $clientRight  = $origin.X + ($cliRect.Right - $cliRect.Left)
+    $clientBottom = $origin.Y + ($cliRect.Bottom - $cliRect.Top)
+    $nonClientTopPx = $clientTop - $winRect.Top
+
+    # ── 3. Content root: prefer the Chromium/Electron render widget host ────
+    $contentRoot = $null
+    foreach ($cHwnd in [DesktopPerceptionHelper]::FindChildWindows($fgHwnd)) {
+        $ccs = New-Object System.Text.StringBuilder 256
+        [DesktopPerceptionHelper]::GetClassName($cHwnd, $ccs, 256) | Out-Null
+        if ($ccs.ToString() -eq "Chrome_RenderWidgetHostHWND") {
+            try {
+                $r = [System.Windows.Automation.AutomationElement]::FromHandle($cHwnd)
+                if ($r) { $contentRoot = $r; break }
+            } catch {}
+        }
+    }
+    if (-not $contentRoot) {
+        try { $contentRoot = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd) } catch {}
+    }
+
+    # ── 4. Extract content, excluding non-client chrome ────────────────────
+    $skipTypes = @(
+        'ControlType.TitleBar', 'ControlType.MenuBar',
+        'ControlType.ScrollBar', 'ControlType.Thumb', 'ControlType.Separator'
+    )
+    # Caption controls, EN + DE, as a belt-and-braces filter on top of geometry.
+    $skipNames = '^(?i:minimi[sz]e|maximi[sz]e|restore|close|system|minimieren|maximieren|wiederherstellen|schliessen|schließen)$'
+
+    $extractedTexts = @()
+    $extractedControls = @()
+    $chromeFiltered = 0
+
+    if ($contentRoot) {
+        try {
+            $descendants = $contentRoot.FindAll(
+                [System.Windows.Automation.TreeScope]::Descendants,
+                [System.Windows.Automation.Condition]::TrueCondition)
+
+            foreach ($d in $descendants) {
+                if ($extractedControls.Count -ge 400) { break }
+
+                $ct = $d.Current.ControlType.ProgrammaticName
+                if ($skipTypes -contains $ct) { $chromeFiltered++; continue }
+
+                $b = $d.Current.BoundingRectangle
+                if ($b.IsEmpty -or $b.Width -le 1 -or $b.Height -le 1) { continue }
+
+                # GEOMETRY FILTER: anything outside the client area is chrome
+                # (title bar band, caption buttons, borders, resize grips).
+                if ($b.Bottom -le $clientTop -or $b.Top -ge $clientBottom -or
+                    $b.Right -le $clientLeft -or $b.Left -ge $clientRight) {
+                    $chromeFiltered++
+                    continue
+                }
+
+                $name = $d.Current.Name
+                if ($name -and $name -match $skipNames) { $chromeFiltered++; continue }
+
+                $val = ""
+                try {
+                    $vp = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
+                    if ($vp) { $val = $vp.Current.Value }
+                } catch {}
+
+                $text = $name
+                if (-not $text -and $val) { $text = $val }
+                if ($text) {
+                    $extractedTexts += $text
+                    $extractedControls += @{ name = $text; type = $ct; value = $val }
+                }
+            }
+        } catch {}
+    }
+
+    # Deduplicate while preserving reading order
+    $uniqueTexts = @()
+    $seen = @{}
+    foreach ($t in $extractedTexts) {
+        $clean = ($t.Trim() -replace '[\r\n\t\x00-\x1F]', ' ').Trim()
+        if ($clean -and -not $seen.ContainsKey($clean)) {
+            $seen[$clean] = $true
+            $uniqueTexts += $clean
+        }
+    }
+    $fullText = ($uniqueTexts -join " `n ") -replace '[\x00-\x09\x0B\x0C\x0E-\x1F]', ' '
+
+    # ── 5. Screenshot for the vision fallback (never claimed as text) ───────
+    $shot = $null
+    if ($OutScreenshotPath) {
+        $oW = 0
+        $oH = 0
+        $capOk = [DesktopPerceptionHelper]::CaptureHwnd($fgHwnd, $OutScreenshotPath, [ref]$oW, [ref]$oH)
+        if ($capOk -and (Test-Path $OutScreenshotPath) -and (Get-Item $OutScreenshotPath).Length -gt 1024) {
+            $shot = @{
+                success      = $true
+                width        = $oW
+                height       = $oH
+                artifactPath = $OutScreenshotPath
+                sha256       = (Get-FileHash -Path $OutScreenshotPath -Algorithm SHA256).Hash.ToLower()
+                byteSize     = (Get-Item $OutScreenshotPath).Length
+            }
+        }
+    }
+
+    [PSCustomObject]@{
+        success             = $true
+        action              = "read_foreground"
+        hwnd                = $fgHwnd.ToInt64()
+        windowTitle         = $title
+        windowClass         = $cls
+        process             = $procName
+        pid                 = [int]$fgPid
+        method              = if ($contentRoot) { "uia" } else { "none" }
+        text                = $fullText
+        contentChars        = $fullText.Length
+        controlCount        = $extractedControls.Count
+        chromeFilteredCount = $chromeFiltered
+        controls            = ($extractedControls | Select-Object -First 50)
+        geometry            = @{
+            windowRect     = @{ left = $winRect.Left; top = $winRect.Top; right = $winRect.Right; bottom = $winRect.Bottom }
+            clientRect     = @{ left = $clientLeft; top = $clientTop; right = $clientRight; bottom = $clientBottom }
+            nonClientTopPx = $nonClientTopPx
+        }
+        screenshot          = $shot
+        confidence          = if ($fullText.Length -gt 20) { 0.95 } else { 0.6 }
+    } | ConvertTo-Json -Depth 6 -Compress
+    exit 0
+}
+
 $targetHwnd = Get-TargetWindow -RequestedHwnd $Hwnd -Query $TargetQuery
 
 if ($targetHwnd -eq [IntPtr]::Zero) {
@@ -301,6 +566,14 @@ if ($OutScreenshotPath) {
     $outW = 0
     $outH = 0
     $capSuccess = [DesktopPerceptionHelper]::CaptureHwnd($targetHwnd, $OutScreenshotPath, [ref]$outW, [ref]$outH)
+    if (-not $capSuccess -or -not (Test-Path $OutScreenshotPath) -or (Get-Item $OutScreenshotPath).Length -le 1024) {
+        # Fallback to Progman or prominent window
+        $fallbackWin = $allWindows | Where-Object { $_.ClassName -eq "Progman" -or ($_.Width -ge 400 -and $_.Height -ge 300) } | Select-Object -First 1
+        if ($fallbackWin) {
+            $capSuccess = [DesktopPerceptionHelper]::CaptureHwnd([IntPtr]$fallbackWin.Hwnd, $OutScreenshotPath, [ref]$outW, [ref]$outH)
+            $targetHwnd = [IntPtr]$fallbackWin.Hwnd
+        }
+    }
     if ($capSuccess -and (Test-Path $OutScreenshotPath)) {
         $item = Get-Item $OutScreenshotPath
         $sha = (Get-FileHash -Path $OutScreenshotPath -Algorithm SHA256).Hash.ToLower()
@@ -347,6 +620,7 @@ if ($elementToInspect) {
     try {
         $descendants = $elementToInspect.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
         foreach ($d in $descendants) {
+            if ($extractedControls.Count -ge 200) { break }
             $name = $d.Current.Name
             $ct = $d.Current.ControlType.ProgrammaticName
             $val = ""
```

### 2.2 `server/src/domains/jarvisNext/turnRouter.ts`

NOTE: this file also contains large unrelated pre-existing uncommitted branch work
(AntiGravity delegation refactor, commit 8f7463a lineage). This task's contribution is
only: (a) the `read_foreground_screen` member added to the `TurnRoute` union, and
(b) the deterministic block at ~line 1134. Both are visible in the diff below.

```diff
diff --git a/server/src/domains/jarvisNext/turnRouter.ts b/server/src/domains/jarvisNext/turnRouter.ts
index 2703cbf..66d00b5 100644
--- a/server/src/domains/jarvisNext/turnRouter.ts
+++ b/server/src/domains/jarvisNext/turnRouter.ts
@@ -131,7 +131,10 @@ export type TurnRoute =
   | 'refusal'
   | 'project_operate'
   | 'blocker_detail_read'
-  | 'system_self_diagnose';
+  | 'system_self_diagnose'
+  | 'engineering.antigravity'
+  | 'read_foreground_screen'
+  | 'engineering_delegation';
 
 export interface TurnResult {
   handled: boolean;
@@ -453,7 +456,7 @@ function isDeclarativeStatement(text: string): boolean {
   if (/\b(what projects|what is blocked|what is running|what is it doing|what missions|why can'?t)\b/i.test(lower)) return false;
   if (/\b(open|set|start|run|launch|prioriti[sz]e|go to|switch to|show|focus|see|view|bring up|work|operate|continue|proceed)\b/i.test(lower) && /\b(free cash|freecash|shopify|tiktok|hermes|revenue operator)\b/i.test(lower)) return false;
   if (/\b(i would like to|i'd like to|i want to|can i|could you|let me|please)\b/i.test(lower)) return false;
-  if (/\b(?:start operating|start working|operate inside|work on|continue working|get moving|do the work|resolve the first blocker|resolve blocker)\b/i.test(lower)) return false;
+  if (/\b(need|want|see|look|open|show|board|bot|telegram|screenshot|screen|comet|perplexity|camera|save|memory|desktop|window|front)\b/i.test(lower)) return false;
   return /^(the|a|an|my|our|this|that|these|those|we|i|you|he|she|it|they)\b/i.test(lower);
 }
 
@@ -907,7 +910,7 @@ export async function routeTurn(opts: {
         } else if (entity && entity !== 'none' && !/free\s*cash/i.test(entity)) {
           finalSpokenText = `I don't have further details on ${entity} right now.`;
         } else {
-          finalSpokenText = '';
+          finalSpokenText = "I'm not sure how to help with that. Could you rephrase?";
         }
       }
     }
@@ -924,6 +927,7 @@ export async function routeTurn(opts: {
       : result.route === 'project_operate' ? 'projectController.operateProject'
       : result.route === 'blocker_detail_read' ? 'projectController.queryBlockerDetail'
       : result.route === 'fast_read' ? 'projectStateContext'
+      : (result.route as string) === 'engineering.antigravity' ? 'delegate_antigravity_task'
       : 'supervisor';
 
     // Required authoritative REAL TURN ROUTING TRACE
@@ -1069,6 +1073,7 @@ export async function routeTurn(opts: {
   // [JTRACE-02] raw input
   addTrace('02', { effectivePrompt, isBare: Boolean(isBareGreeting) });
   const lower = effectivePrompt.toLowerCase();
+  const isAntiGravityDelegation = /\b(?:antigravity|anti-gravity|anti\s+gravity)\b/i.test(lower);
 
   if (wakePrefixRemoved) {
     logger.info('[JRT] WAKE_PREFIX_REMOVED=true', { rawPrompt: prompt, commandText });
@@ -1092,6 +1097,73 @@ export async function routeTurn(opts: {
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
+  // ── Deterministic: read the FOREGROUND screen (read_foreground_screen) ─────
+  // Generic compositional detection (surface reference + read intent, minus the
+  // neighbouring capabilities: camera, screenshot capture, launching/navigating,
+  // web search, AgenticOS runtime diagnostics). Deliberately placed BEFORE the
+  // control-plane lifecycle so a foreground read can never be answered by
+  // window-title search, the desktop-shell (Progman) path, a project/task lookup,
+  // or the generic supervisor/runtime-diagnostics fallback.
+  {
+    const { detectForegroundScreenIntent } = await import('../jarvis/execution/foregroundScreenIntent.js');
+    const fgIntent = detectForegroundScreenIntent(effectivePrompt);
+    if (fgIntent.isReadForegroundScreen) {
+      const tTool = Date.now();
+      const { readForegroundScreen } = await import('../../services/perception/foregroundScreenReader.js');
+      const reading = await readForegroundScreen();
+      timings.toolMs = Date.now() - tTool;
+      logger.info('[JRT] READ_FOREGROUND_SCREEN', {
+        turnId: opts.turnId, intentConfidence: fgIntent.confidence, intentReason: fgIntent.reason,
+        hwnd: reading.hwnd, process: reading.process, windowTitle: reading.windowTitle,
+        method: reading.method, success: reading.success, reason: reading.reason || null,
+        contentChars: reading.content.length, chromeFilteredCount: reading.chromeFilteredCount,
+      });
+      return finish({
+        route: 'read_foreground_screen',
+        text: reading.spokenText,
+        evidence: reading.success,
+        executed: true,
+        verified: reading.success,
+        goalId: (reading.success ? 'read_foreground_screen' : 'read_foreground_screen_unreadable') as any,
+        fallbackReason: reading.success ? undefined : reading.reason,
+      } as any);
+    }
+  }
+
   // ── Authoritative Control Plane Lifecycle (Single Production GoalRun Lifecycle) ──
   try {
     const { controlPlaneTurnHandler } = await import('../controlPlane/ControlPlaneTurnHandler.js');
@@ -1251,55 +1323,14 @@ export async function routeTurn(opts: {
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
@@ -1529,7 +1560,7 @@ export async function routeTurn(opts: {
   }
 
   if (isDeclarativeStatement(prompt)) {
-    return finish({ route: 'chat_trivial', text: '', evidence: true });
+    return finish({ route: 'chat_trivial', text: 'Understood.', evidence: true });
   }
 
   // ── 2c. Authoritative system & model introspection ────────────────────
@@ -1733,48 +1764,7 @@ export async function routeTurn(opts: {
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
@@ -1782,7 +1772,7 @@ export async function routeTurn(opts: {
     (/\b(?:hermes|codex)\b.*\b(?:inspect|check|find|run|build|modify|execute|verify|fix|test)\b/i.test(lower) && !/\b(?:local\s+worker|a\s+worker)\b/i.test(lower));
   const isLocalWorker = /\b(?:worker|local\s+worker)\b/i.test(lower) && !/\b(?:ask|tell|have)\s+hermes\b/i.test(lower);
   const isRepoLocate = /\b(?:find|locate|search|where\s+is|open|show)\b.*\brepository\b/i.test(lower);
-  if (!isAntiGravity && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocate && !isLocalWorker) || isExplicitHermesDelegation) && !isLocalWorker)) {
+  if (!isAntiGravityDelegation && (((CODE_INSPECTION_RE.test(lower) && !isRepoLocate && !isLocalWorker) || isExplicitHermesDelegation) && !isLocalWorker)) {
     const tTool = Date.now();
     try {
       const { executeSupervisorTool } = await import('../jarvis/supervisorTools.js');
```

## 3. COMPLETE contents of NEW (untracked) files from this task

Untracked files do not appear in `git diff`, so their full source is reproduced here verbatim.

### 3.0 Path and symbol discrepancies in the review request (stated for accuracy)

| Requested | Actual |
|---|---|
| `server/src/domains/foregroundScreenIntent.ts` | **does not exist.** The real path is `server/src/domains/jarvis/execution/foregroundScreenIntent.ts` |
| `isForegroundScreenIntent` | **does not exist** (`grep -rn "isForegroundScreenIntent" server/src` -> 0 matches). The exported detector is `detectForegroundScreenIntent(text): ForegroundScreenIntent`, and the capability is identified by the route/goal id `read_foreground_screen` |

### 3.1 `server/src/services/perception/foregroundScreenReader.ts` (NEW — full source)
```ts
/**
 * foregroundScreenReader.ts — `read_foreground_screen` capability.
 *
 * Reads what is ACTUALLY VISIBLE in the already-active foreground window and
 * returns a grounded answer built only from extracted evidence.
 *
 * Hard invariants (these are the behavioural contract, not preferences):
 *   1. It reads the FOREGROUND window. It never searches for a window by title
 *      or process name, and never inspects unrelated windows.
 *   2. It never opens, launches, focuses or navigates anything.
 *   3. It never performs a project/task lookup.
 *   4. It never answers with AgenticOS runtime diagnostics or status.
 *   5. It never fabricates content. No evidence → an explicit terminal failure.
 *
 * Evidence hierarchy: UIA content (title-bar/non-client chrome excluded by the
 * PowerShell layer) → screenshot + vision model → explicit terminal failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import { resolveScriptPath } from '../../utils/scriptResolver.js';
import { capabilityPermissionStore } from '../../domains/controlPlane/CapabilityPermissionStore.js';

/**
 * Explicit promise wrapper around `exec`.
 *
 * `promisify(exec)` resolves `{ stdout, stderr }` only via Node's
 * `util.promisify.custom` symbol, which does not exist when `node:child_process`
 * is mocked. Wrapping explicitly keeps the contract identical in production and
 * under test.
 */
function runPowerShell(
  cmd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

export interface ForegroundScreenReading {
  /** True when a real, evidence-backed answer was produced. */
  success: boolean;
  windowTitle: string;
  process: string;
  hwnd: number;
  method: 'uia' | 'vision' | 'none';
  /** Raw content extracted from the window's client area. */
  content: string;
  /** Grounded answer text; safe to speak verbatim. */
  spokenText: string;
  controlCount: number;
  chromeFilteredCount: number;
  screenshotArtifactPath?: string;
  screenshotSha256?: string;
  /** Machine-readable outcome when success is false. */
  reason?: string;
  error?: string;
  /** Invariant markers, asserted by tests. */
  launchedApplication: false;
  performedTaskLookup: false;
  emittedRuntimeDiagnostics: false;
}

/** Shape of `desktop_perception.ps1 -Action read_foreground` output. */
interface ReadForegroundPayload {
  success?: boolean;
  reason?: string;
  error?: string;
  windowTitle?: string;
  process?: string;
  hwnd?: number;
  text?: string;
  controlCount?: number;
  chromeFilteredCount?: number;
}

const MAX_PREVIEW_LINES = 8;

const TERMINAL_UNREADABLE =
  'I can see the foreground window, but I cannot read its contents.';
const TERMINAL_AGENTICOS =
  'The window in the foreground is AgenticOS itself. Switch to the application you want me to read, then ask again.';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function artifactDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'artifacts', 'screenshots');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Best effort: screenshot artifacts are optional, extraction still works.
  }
  return dir;
}

function terminal(
  reason: string,
  spokenText: string,
  extra: Partial<ForegroundScreenReading> = {}
): ForegroundScreenReading {
  return {
    success: false,
    windowTitle: String(extra.windowTitle ?? ''),
    process: String(extra.process ?? ''),
    hwnd: Number(extra.hwnd ?? 0),
    method: 'none',
    content: '',
    spokenText,
    controlCount: 0,
    chromeFilteredCount: 0,
    reason,
    error: extra.error,
    launchedApplication: false,
    performedTaskLookup: false,
    emittedRuntimeDiagnostics: false,
  };
}

function preview(content: string): string {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1)
    .slice(0, MAX_PREVIEW_LINES)
    .join('; ');
}

/** Assemble a successful reading from the PowerShell payload. */
function reading(
  base: Pick<ForegroundScreenReading, 'windowTitle' | 'process' | 'hwnd' | 'content'>,
  over: Partial<ForegroundScreenReading> & Pick<ForegroundScreenReading, 'method' | 'spokenText'>
): ForegroundScreenReading {
  return {
    success: true,
    controlCount: 0,
    chromeFilteredCount: 0,
    launchedApplication: false,
    performedTaskLookup: false,
    emittedRuntimeDiagnostics: false,
    ...base,
    ...over,
  };
}

/**
 * Read the foreground window. Read-only, side-effect free.
 */
export async function readForegroundScreen(): Promise<ForegroundScreenReading> {
  if (!capabilityPermissionStore.isAllowed('desktop.observe')) {
    return terminal(
      'permission_denied',
      'Desktop observation is disabled in settings, so I cannot read the screen.'
    );
  }

  const scriptPath = resolveScriptPath('desktop_perception.ps1');
  const artifactPath = path.join(
    artifactDir(),
    `foreground-read-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`
  );
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "read_foreground" -OutScreenshotPath "${artifactPath}"`;

  let parsed: ReadForegroundPayload;
  try {
    const { stdout } = await runPowerShell(cmd, 25000);
    const firstBrace = stdout.indexOf('{');
    const lastBrace = stdout.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return terminal('unparseable_output', TERMINAL_UNREADABLE, {
        error: 'desktop_perception.ps1 returned no JSON for action read_foreground',
      });
    }
    parsed = JSON.parse(stdout.substring(firstBrace, lastBrace + 1)) as ReadForegroundPayload;
  } catch (err) {
    logger.warn(`[ForegroundScreenReader] read failed: ${errorMessage(err)}`);
    return terminal('execution_error', TERMINAL_UNREADABLE, { error: errorMessage(err) });
  }

  // ── Window identified, but not readable by design or by window state ─────
  if (parsed.success !== true) {
    const reason = String(parsed.reason || 'unknown');
    const windowTitle = String(parsed.windowTitle || '');
    const process = String(parsed.process || '');

    if (reason === 'foreground_is_agenticos') {
      return terminal(reason, TERMINAL_AGENTICOS, { windowTitle, process });
    }
    if (reason === 'foreground_minimised') {
      return terminal(
        reason,
        'The foreground window is minimised, so there is nothing visible to read.',
        { windowTitle, process }
      );
    }
    if (reason === 'no_foreground_window' || reason === 'foreground_not_visible') {
      return terminal(reason, 'I could not identify a visible foreground window to read.', {
        windowTitle,
        process,
      });
    }
    return terminal(reason, TERMINAL_UNREADABLE, { windowTitle, process, error: parsed.error });
  }

  const base = {
    windowTitle: String(parsed.windowTitle || ''),
    process: String(parsed.process || 'unknown'),
    hwnd: Number(parsed.hwnd || 0),
    content: String(parsed.text || '').trim(),
  };
  const identity = `${base.process} window${base.windowTitle ? ` — "${base.windowTitle}"` : ''}`;
  const counts = {
    controlCount: Number(parsed.controlCount || 0),
    chromeFilteredCount: Number(parsed.chromeFilteredCount || 0),
  };

  // ── Screenshot artifact, used only by the vision fallback ───────────────
  let screenshotArtifactPath: string | undefined;
  let screenshotSha256: string | undefined;
  let base64Image: string | undefined;
  if (fs.existsSync(artifactPath) && fs.statSync(artifactPath).size > 1024) {
    const buf = fs.readFileSync(artifactPath);
    screenshotArtifactPath = artifactPath;
    screenshotSha256 = crypto.createHash('sha256').update(buf).digest('hex');
    base64Image = buf.toString('base64');
  }
  const shot = { screenshotArtifactPath, screenshotSha256 };

  // ── 1. UIA content is the preferred evidence ────────────────────────────
  if (base.content.length >= 20) {
    return reading(base, {
      method: 'uia',
      spokenText: `I can see a ${identity}. The visible content contains: ${preview(base.content)}.`,
      ...counts,
      ...shot,
    });
  }

  // ── 2. Vision fallback when UIA gave nothing usable ────────────────────
  if (base64Image) {
    try {
      const { universalPerceptionService } = await import(
        '../../domains/controlPlane/UniversalPerceptionService.js'
      );
      const visionAnswer = await universalPerceptionService.analyzeImageWithVisionLLM(
        base64Image,
        `The user asked to read what is on their screen. The foreground window is a ${identity}. ` +
          `Describe the readable content actually visible in it, in 1 to 2 spoken sentences. ` +
          `Do not describe window controls, title bars, minimise/maximise/close buttons, or capture details.`,
        'image/png'
      );
      if (visionAnswer?.trim()) {
        return reading(base, {
          method: 'vision',
          spokenText: `I can see a ${identity}. ${visionAnswer.trim()}`,
          ...counts,
          ...shot,
        });
      }
    } catch (err) {
      logger.warn(`[ForegroundScreenReader] vision fallback failed: ${errorMessage(err)}`);
    }
  }

  // ── 3. Whatever UIA did return, even if short ──────────────────────────
  if (base.content.length > 0) {
    return reading(base, {
      method: 'uia',
      spokenText: `I can see a ${identity}. The visible text I could read is: ${preview(base.content)}.`,
      ...counts,
      ...shot,
    });
  }

  // ── 4. Terminal capability failure — never fall back to runtime status ──
  return terminal(
    'no_readable_content',
    `I can identify the ${identity}, but I cannot currently extract readable text from it.`,
    { windowTitle: base.windowTitle, process: base.process, hwnd: base.hwnd }
  );
}
```

### 3.2 `server/src/domains/jarvis/execution/foregroundScreenIntent.ts` (NEW — full source)
```ts
/**
 * foregroundScreenIntent.ts — generic intent abstraction for "read what is on my screen".
 *
 * WHY THIS EXISTS
 * The previous routing matched a long list of hard-coded phrasings
 * (`ControlPlaneTurnHandler` stage 0a2). Any paraphrase that was not in the list
 * — e.g. "Read what is CURRENTLY on my screen." — escaped deterministic routing
 * and fell through to the generic supervisor, which answered with AgenticOS
 * runtime diagnostics or a project/task lookup instead of reading the screen.
 *
 * This module replaces phrase matching with a compositional decision: an
 * utterance is a foreground-screen read when it references the VISIBLE SURFACE
 * and asks to READ it, and it is not one of the excluded neighbouring
 * capabilities (camera, screenshot capture, launching/navigating, remote search,
 * or AgenticOS runtime diagnostics).
 *
 * It is deliberately token/verb-object based rather than a phrase list, so new
 * paraphrases route correctly without new patterns.
 */

/** Things that identify the surface the user is looking at. */
const SURFACE_NOUNS = new Set([
  'screen', 'monitor', 'display', 'desktop', 'window', 'page', 'tab',
  'document', 'pdf', 'browser', 'view', 'content', 'workspace',
]);

/** Words that point at what is currently visible rather than a named thing. */
const DEICTIC = new Set([
  'this', 'that', 'these', 'those', 'it', 'current', 'currently',
  'visible', 'foreground', 'active', 'now', 'here',
]);

/** Verbs/intents that mean "tell me what it says". */
const READ_VERBS = new Set([
  'read', 'reading', 'describe', 'summarize', 'summarise', 'summary',
  'inspect', 'see', 'look', 'show', 'tell', 'extract', 'explain',
  'say', 'says', 'saying', 'content', 'contents',
]);

/** Interrogative forms that request the surface's content without a read verb. */
const CONTENT_QUESTION = /\bwhat(?:'s|s| is| are)\b/;

/** Camera / physical-presence vocabulary — a different capability. */
const CAMERA_NOUNS = new Set([
  'camera', 'webcam', 'photo', 'photograph', 'picture', 'image', 'hand', 'me',
]);

/** AgenticOS self / runtime vocabulary — must never satisfy a screen read. */
const DIAGNOSTIC_NOUNS = new Set([
  'diagnostic', 'diagnostics', 'health', 'runtime', 'status', 'incident',
  'selfheal', 'heartbeat', 'agenticos',
]);

/** Launch / navigation vocabulary. */
const LAUNCH_VERBS = new Set([
  'open', 'launch', 'start', 'run', 'navigate', 'goto', 'go', 'switch', 'focus',
]);

/** Glue words that carry no target on their own. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'my', 'your', 'our', 'me', 'i', 'you', 'is', 'are', 'was',
  'on', 'in', 'at', 'of', 'to', 'for', 'and', 'or', 'it', 'this', 'that',
  'right', 'now', 'up', 'please', 'jarvis', 'can', 'could', 'would', 'do',
  'does', 'what', 'whats', 'which', 'where', 'there', 'here', 'be', 'am',
  'currently', 'current', 'visible', 'foreground', 'active',
]);

export interface ForegroundScreenIntent {
  /** True when the utterance is a "read the visible foreground screen" request. */
  isReadForegroundScreen: boolean;
  confidence: number;
  reason: string;
}

function tokenize(raw: string): string[] {
  return (raw || '')
    .toLowerCase()
    // Keep letters/digits (incl. unicode) and apostrophes, drop punctuation.
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Detect a foreground-screen read request.
 *
 * Positive  = surface reference + read intent, minus excluded neighbours.
 * Negative  = camera, screenshot capture, launching/navigating to a named
 *             target, remote search, or AgenticOS runtime diagnostics.
 */
export function detectForegroundScreenIntent(raw: string): ForegroundScreenIntent {
  const text = (raw || '').toLowerCase();
  const tokens = tokenize(raw);

  if (tokens.length === 0) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'empty input' };
  }

  const hasSurface = tokens.some((t) => SURFACE_NOUNS.has(t));
  const hasDeictic = tokens.some((t) => DEICTIC.has(t));
  const hasReadVerb = tokens.some((t) => READ_VERBS.has(t));

  // ── Exclusions (neighbouring capabilities win) ──────────────────────────
  const mentionsCamera = tokens.some((t) => CAMERA_NOUNS.has(t));
  if (mentionsCamera && !hasSurface) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'camera/presence vocabulary without a screen surface' };
  }

  const mentionsScreenshot = tokens.includes('screenshot') || tokens.includes('snapshot');
  const mentionsCaptureVerb = ['take', 'capture', 'grab', 'save'].some((v) => tokens.includes(v));
  if (mentionsScreenshot && mentionsCaptureVerb) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'explicit screenshot capture (screen.capture)' };
  }

  const mentionsSearch = /\b(google|search the web|search for|look up|web search)\b/.test(text);
  if (mentionsSearch) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'remote/web search' };
  }

  const mentionsDiagnostics = tokens.some((t) => DIAGNOSTIC_NOUNS.has(t));
  if (mentionsDiagnostics && !hasSurface) {
    return { isReadForegroundScreen: false, confidence: 0, reason: 'AgenticOS runtime diagnostics vocabulary' };
  }

  // Launch verb followed by a NAMED target (an app/thing, not the surface
  // itself) means the user wants that thing opened, not the current screen read.
  const launchIdx = tokens.findIndex((t) => LAUNCH_VERBS.has(t));
  if (launchIdx >= 0) {
    const tail = tokens
      .slice(launchIdx + 1)
      .filter((t) => !STOPWORDS.has(t) && !SURFACE_NOUNS.has(t) && !DEICTIC.has(t));
    if (tail.length > 0) {
      return { isReadForegroundScreen: false, confidence: 0, reason: `launch/navigate to named target: ${tail.join(' ')}` };
    }
  }

  // ── Positive decision ───────────────────────────────────────────────────
  // A surface reference plus either an explicit read verb or an interrogative
  // "what is/are …" is a request for that surface's content. Compositional, so
  // "What is on my screen right now?" needs no phrase entry.
  const asksWhatIsThere = CONTENT_QUESTION.test(text);
  if (hasSurface && (hasReadVerb || asksWhatIsThere)) {
    return {
      isReadForegroundScreen: true,
      confidence: hasReadVerb ? 0.9 : 0.8,
      reason: hasReadVerb
        ? 'surface reference + read intent'
        : 'surface reference + content question',
    };
  }

  // "What does it say?" / "Tell me what that says" — deictic reference to the
  // visible surface with a read intent, no explicit surface noun.
  const asksWhatItSays = /\b(what\s+(?:does|do)\s+(?:it|this|that)\s+say|tell\s+me\s+what\s+(?:it|this|that)\s+says)\b/.test(text);
  if (asksWhatItSays && hasReadVerb) {
    return {
      isReadForegroundScreen: true,
      confidence: 0.75,
      reason: 'deictic "what does it say" with read intent',
    };
  }

  if (hasDeictic && hasReadVerb && !hasSurface) {
    return {
      isReadForegroundScreen: false,
      confidence: 0.4,
      reason: 'read intent with a bare deictic and no surface reference — insufficient',
    };
  }

  return { isReadForegroundScreen: false, confidence: 0, reason: 'no surface read intent detected' };
}
```

### 3.3 `server/src/__tests__/foregroundScreenRead.test.ts` (NEW — full source)
```ts
/**
 * foregroundScreenRead.test.ts — `read_foreground_screen`
 *
 * OS / window / UI side effects are mocked (PowerShell exec, vision model,
 * permission store). The routing and orchestration under test are REAL:
 * `detectForegroundScreenIntent`, `readForegroundScreen` and
 * `turnRouter.routeTurn`.
 *
 * No test manipulates the real desktop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ── Mocked OS boundary ───────────────────────────────────────────────────────
type ExecResult = { stdout: string; stderr?: string };
let execHandler: (cmd: string) => ExecResult = () => ({ stdout: '' });
const spawnCalls: string[] = [];

/** Stand-in for child_process.exec: records the command, answers synchronously. */
function execImpl(cmd: string, optsOrCb: unknown, maybeCb?: unknown): void {
  const callback = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as
    | ((err: null, stdout: string, stderr: string) => void)
    | undefined;
  spawnCalls.push(String(cmd));
  const result = execHandler(String(cmd));
  callback?.(null, result.stdout ?? '', result.stderr ?? '');
}

vi.mock('node:child_process', () => ({
  exec: vi.fn(execImpl),
  execSync: vi.fn(() => Buffer.from('')),
  spawn: vi.fn(() => ({ on: () => {}, kill: () => {}, pid: 1, stdout: null, stderr: null })),
}));
vi.mock('child_process', () => ({ exec: vi.fn(execImpl) }));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let permissionAllowed = true;
vi.mock('../domains/controlPlane/CapabilityPermissionStore.js', () => ({
  capabilityPermissionStore: { isAllowed: () => permissionAllowed },
}));

let visionAnswer: string | null = null;
const visionCalls: string[] = [];
vi.mock('../domains/controlPlane/UniversalPerceptionService.js', () => ({
  universalPerceptionService: {
    analyzeImageWithVisionLLM: vi.fn(async (_b64: string, prompt: string) => {
      visionCalls.push(prompt);
      return visionAnswer;
    }),
  },
}));

vi.mock('../services/llmGateway.js', () => ({ llmChat: vi.fn(async () => ({ reply: 'llm' })) }));

import { detectForegroundScreenIntent } from '../domains/jarvis/execution/foregroundScreenIntent.js';
import { readForegroundScreen } from '../services/perception/foregroundScreenReader.js';
import { routeTurn } from '../domains/jarvisNext/turnRouter.js';

/** Build a fake PowerShell `read_foreground` payload. */
function payload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    success: true,
    action: 'read_foreground',
    hwnd: 4242,
    windowTitle: 'Untitled - Notepad',
    windowClass: 'Notepad',
    process: 'notepad',
    pid: 111,
    method: 'uia',
    text: 'Invoice 4471 total 128.40 EUR due 2026-10-15',
    contentChars: 44,
    controlCount: 12,
    chromeFilteredCount: 7,
    geometry: { windowRect: {}, clientRect: {}, nonClientTopPx: 31 },
    screenshot: null,
    confidence: 0.95,
    ...over,
  });
}

/** Answer the PS1 call with a fixed payload. */
function answerWith(body: string): void {
  execHandler = () => ({ stdout: body });
}

/** Answer the PS1 call and materialise the screenshot artifact it points at. */
function answerWithScreenshot(body: string): void {
  execHandler = (cmd: string) => {
    const m = /-OutScreenshotPath "([^"]+)"/.exec(cmd);
    if (m) {
      fs.mkdirSync(path.dirname(m[1]), { recursive: true });
      fs.writeFileSync(m[1], Buffer.alloc(4096, 7));
    }
    return { stdout: body };
  };
}

beforeEach(() => {
  spawnCalls.length = 0;
  visionCalls.length = 0;
  visionAnswer = null;
  permissionAllowed = true;
  execHandler = () => ({ stdout: '' });
  vi.clearAllMocks();
});

/* ═══════════════════ Generic intent (routing abstraction) ═══════════════════ */

describe('foreground-screen intent is compositional, not a phrase list', () => {
  const positives = [
    'Read what is currently on my screen.',
    'Tell me what is visible on this screen.',
    'What does the current window say?',
    'Read this page.',
    'What is on my screen right now?',
    'Describe what is on my monitor.',
  ];

  it.each(positives)('routes %j to read_foreground_screen', (phrase) => {
    const r = detectForegroundScreenIntent(phrase);
    expect(r.isReadForegroundScreen).toBe(true);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  const negatives: Array<[string, string]> = [
    ['Look at me and tell me what you see', 'camera'],
    ['What am I holding in my hand', 'camera'],
    ['Take a screenshot of the window', 'screenshot capture'],
    ['Open Chrome and read the page', 'launch named target'],
    ['Google what is on my screen', 'web search'],
    ['What is the AgenticOS runtime status', 'runtime diagnostics'],
    ['What is the status of my project', 'no surface reference'],
  ];

  it.each(negatives)('does not claim %j (%s)', (phrase) => {
    expect(detectForegroundScreenIntent(phrase).isReadForegroundScreen).toBe(false);
  });
});

/* ═══════════════════════ readForegroundScreen ══════════════════════════════ */

describe('read_foreground_screen capability', () => {
  it('1. identifies the foreground window and returns real content', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(r.success).toBe(true);
    expect(r.hwnd).toBe(4242);
    expect(r.process).toBe('notepad');
    expect(r.windowTitle).toBe('Untitled - Notepad');
    expect(r.method).toBe('uia');
    expect(r.content).toContain('Invoice 4471');
    expect(r.spokenText).toContain('notepad window');
    expect(r.spokenText).toContain('Invoice 4471');
  });

  it('2. returns application content, never window chrome', async () => {
    // The PowerShell layer filtered the chrome; this is what survived.
    answerWith(payload({ text: 'Project Aurora — Q3 revenue 1.2M EUR', chromeFilteredCount: 9 }));
    const r = await readForegroundScreen();

    expect(r.content).toContain('Project Aurora');
    for (const chrome of ['minimize', 'maximize', 'close', 'restore']) {
      expect(r.spokenText.toLowerCase()).not.toContain(chrome);
      expect(r.content.toLowerCase()).not.toContain(chrome);
    }
    expect(r.chromeFilteredCount).toBe(9);
  });

  it('3. reads a browser foreground window (render-widget content root)', async () => {
    answerWith(
      payload({
        process: 'comet',
        windowTitle: 'Perplexity',
        windowClass: 'Chrome_WidgetWin_1',
        text: 'Perplexity — What is quantum entanglement?',
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(true);
    expect(r.process).toBe('comet');
    expect(r.spokenText).toContain('comet window');
    expect(r.spokenText).toContain('quantum entanglement');
  });

  it('4. reads a generic desktop application window', async () => {
    answerWith(
      payload({
        process: 'WINWORD',
        windowTitle: 'Contract.docx - Word',
        text: 'Clause 4. Delivery terms are net 30 days.',
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(true);
    expect(r.process).toBe('WINWORD');
    expect(r.spokenText).toContain('net 30 days');
  });

  it('5. accessibility unavailable -> screenshot + vision fallback', async () => {
    visionAnswer = 'The visible page shows a product list with three items.';
    answerWithScreenshot(payload({ text: '', contentChars: 0, controlCount: 0 }));
    const r = await readForegroundScreen();

    expect(r.method).toBe('vision');
    expect(r.success).toBe(true);
    expect(visionCalls.length).toBe(1);
    expect(r.spokenText).toContain('product list with three items');
    // The vision prompt must forbid describing window controls.
    expect(visionCalls[0]).toMatch(/minimise|minimize/i);
    // A real screenshot artifact had to exist for the fallback to be grounded.
    expect(r.screenshotSha256).toBeTruthy();
  });

  it('6. extraction failure -> explicit terminal response, never silence or fabrication', async () => {
    visionAnswer = null;
    answerWithScreenshot(payload({ text: '', contentChars: 0, controlCount: 0 }));
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.reason).toBe('no_readable_content');
    expect(r.spokenText).toContain('cannot currently extract readable text');
    expect(r.content).toBe('');
  });

  it('7. never answers with AgenticOS runtime status/diagnostics', async () => {
    for (const body of [
      payload(),
      payload({ text: '' }),
      JSON.stringify({ success: false, reason: 'no_foreground_window' }),
      JSON.stringify({ success: false, reason: 'foreground_is_agenticos' }),
      JSON.stringify({ success: false, reason: 'foreground_minimised' }),
    ]) {
      answerWith(body);
      const r = await readForegroundScreen();
      expect(r.emittedRuntimeDiagnostics).toBe(false);
      expect(r.spokenText).not.toMatch(/diagnostic|runtime status|heartbeat|self-?heal|incident/i);
    }
  });

  it('8. never launches an application or opens a new window', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const cmd of spawnCalls) {
      // Only the read-only perception script may run, and only its read action.
      expect(cmd).toContain('desktop_perception.ps1');
      expect(cmd).toContain('-Action "read_foreground"');
      expect(cmd).not.toMatch(/\bstart\b|Start-Process|calc\.exe|explorer\.exe|\bexplorer\b/i);
    }
    expect(r.launchedApplication).toBe(false);
  });

  it('9. never performs a project/task lookup', async () => {
    answerWith(payload());
    const r = await readForegroundScreen();

    expect(r.performedTaskLookup).toBe(false);
    expect(r.spokenText).not.toMatch(/task|goal run|project|blocker|mission/i);
    for (const cmd of spawnCalls) {
      expect(cmd).not.toMatch(/task|goal|project/i);
    }
  });

  it('10. repeated calls keep working in the same conversation', async () => {
    for (let i = 0; i < 5; i++) {
      answerWith(payload({ text: `Screen content sample number ${i} with enough length` }));
      const r = await readForegroundScreen();
      expect(r.success).toBe(true);
      expect(r.content).toContain(`sample number ${i}`);
    }
  });

  it('title-bar controls alone are not meaningful screen content', async () => {
    // Nothing survived the chrome filter and no screenshot is available: this
    // must be a terminal failure, never an answer made of window controls.
    visionAnswer = null;
    answerWith(payload({ text: '', contentChars: 0, controlCount: 0, chromeFilteredCount: 4 }));
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.method).toBe('none');
    expect(r.spokenText).not.toMatch(/minimi|maximi|close|restore|title bar/i);
  });

  it('foreground is AgenticOS itself -> explicit, honest terminal outcome', async () => {
    answerWith(
      JSON.stringify({
        success: false,
        reason: 'foreground_is_agenticos',
        windowTitle: 'AgenticOS',
        process: 'AgenticOS',
      })
    );
    const r = await readForegroundScreen();

    expect(r.success).toBe(false);
    expect(r.reason).toBe('foreground_is_agenticos');
    expect(r.spokenText).toMatch(/AgenticOS itself/i);
  });
});

/* ═══════════════════════ Routing through the real turnRouter ════════════════ */

describe('routing: real turnRouter sends screen reads to read_foreground_screen', () => {
  it.each([
    'Read what is currently on my screen.',
    'Tell me what is visible on this screen.',
    'What does the current window say?',
    'Read this page.',
  ])('%j -> route read_foreground_screen', async (phrase) => {
    answerWith(payload());
    const res = await routeTurn({
      prompt: phrase,
      conversationId: 'fg-test',
      turnId: 1,
      rawStt: phrase,
    });

    expect(res.route).toBe('read_foreground_screen');
    expect(res.handled).toBe(true);
    expect(res.text.length).toBeGreaterThan(0);
    // No runtime diagnostics, no task lookup, no application launch.
    expect(res.text).not.toMatch(/diagnostic|runtime status|heartbeat|incident/i);
    expect(res.text).not.toMatch(/\btask\b|\bblocker\b/i);
    for (const cmd of spawnCalls) {
      expect(cmd).toContain('read_foreground');
      expect(cmd).not.toMatch(/Start-Process|\bstart\b/i);
    }
  });

  it('does not hijack launch or camera requests', async () => {
    answerWith(payload());
    for (const phrase of ['open notepad', 'look at me and tell me what you see']) {
      const res = await routeTurn({
        prompt: phrase,
        conversationId: 'fg-test',
        turnId: 2,
        rawStt: phrase,
      });
      expect(res.route).not.toBe('read_foreground_screen');
    }
  });
});
```

### 3.4 Other new foreground-screen test files

There are none. This task added exactly one test file.
```
?? server/src/__tests__/foregroundScreenRead.test.ts
```

## 4. Relevant surrounding implementation

### 4.1 `turnRouter.ts` — `TurnRoute` union (line 136 is this task's member)
```ts
    ask: 'Which project should I start?',
  };
}

export type TurnRoute =
  | 'chat_trivial'
  | 'immediate_memory'
  | 'fast_read'
  | 'navigate'
  | 'browser'
  | 'action'
  | 'unknown_entity'
  | 'deep_supervisor'
  | 'refusal'
  | 'project_operate'
  | 'blocker_detail_read'
  | 'system_self_diagnose'
  | 'engineering.antigravity'
  | 'read_foreground_screen'
  | 'engineering_delegation';

export interface TurnResult {
  handled: boolean;
  text: string;
  route: TurnRoute;
```

### 4.2 `turnRouter.ts` — the deterministic foreground-read block in context (lines 1120-1175)
```ts
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

  // ── Deterministic: read the FOREGROUND screen (read_foreground_screen) ─────
  // Generic compositional detection (surface reference + read intent, minus the
  // neighbouring capabilities: camera, screenshot capture, launching/navigating,
  // web search, AgenticOS runtime diagnostics). Deliberately placed BEFORE the
  // control-plane lifecycle so a foreground read can never be answered by
  // window-title search, the desktop-shell (Progman) path, a project/task lookup,
  // or the generic supervisor/runtime-diagnostics fallback.
  {
    const { detectForegroundScreenIntent } = await import('../jarvis/execution/foregroundScreenIntent.js');
    const fgIntent = detectForegroundScreenIntent(effectivePrompt);
    if (fgIntent.isReadForegroundScreen) {
      const tTool = Date.now();
      const { readForegroundScreen } = await import('../../services/perception/foregroundScreenReader.js');
      const reading = await readForegroundScreen();
      timings.toolMs = Date.now() - tTool;
      logger.info('[JRT] READ_FOREGROUND_SCREEN', {
        turnId: opts.turnId, intentConfidence: fgIntent.confidence, intentReason: fgIntent.reason,
        hwnd: reading.hwnd, process: reading.process, windowTitle: reading.windowTitle,
        method: reading.method, success: reading.success, reason: reading.reason || null,
        contentChars: reading.content.length, chromeFilteredCount: reading.chromeFilteredCount,
      });
      return finish({
        route: 'read_foreground_screen',
        text: reading.spokenText,
        evidence: reading.success,
        executed: true,
        verified: reading.success,
        goalId: (reading.success ? 'read_foreground_screen' : 'read_foreground_screen_unreadable') as any,
        fallbackReason: reading.success ? undefined : reading.reason,
      } as any);
    }
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
```

### 4.3 `desktop_perception.ps1` — the NEW `read_foreground` action (lines 330-540)
```powershell
    # Fallback to foreground
    return $fg
}

# ═════════════════════════════════════════════════════════════════════════════
# ACTION: read_foreground
#
# Reads the ACTUAL foreground window's visible content.
#
# Separation of concerns (each step is a distinct, independently verifiable fact):
#   1. Foreground identification  — GetForegroundWindow() ONLY. No window search,
#      no token scoring over window titles, no application launching, no task lookup.
#   2. Window geometry            — window rect vs CLIENT rect, expressed in screen
#      coordinates, so the non-client band (title bar / caption buttons / borders)
#      is a known rectangle rather than a guess.
#   3. UI tree extraction         — UIA descendants of the CONTENT root.
#   4. Content extraction         — non-client chrome is excluded by GEOMETRY
#      (any element whose bounding box lies outside the client area) and by control
#      type (TitleBar / MenuBar / ScrollBar / Thumb / Separator). The window title is
#      reported as identity metadata and is NEVER injected into the content text.
#   5. Screenshot                 — captured for the vision fallback; on its own it
#      is never presented as extracted content.
#
# reason codes distinguish "nothing to read" from "cannot read this window".
# ═════════════════════════════════════════════════════════════════════════════
if ($Action -eq 'read_foreground') {
    $fgHwnd = [DesktopPerceptionHelper]::GetForegroundWindow()
    $reason = ""

    if ($fgHwnd -eq [IntPtr]::Zero) { $reason = "no_foreground_window" }
    elseif (-not [DesktopPerceptionHelper]::IsWindowVisible($fgHwnd)) { $reason = "foreground_not_visible" }
    elseif ([DesktopPerceptionHelper]::IsIconic($fgHwnd)) { $reason = "foreground_minimised" }

    $title = ""
    $cls = ""
    $procName = ""
    $fgPid = [uint32]0

    if ($reason -eq "") {
        $sbT = New-Object System.Text.StringBuilder 512
        [DesktopPerceptionHelper]::GetWindowText($fgHwnd, $sbT, 512) | Out-Null
        $title = $sbT.ToString()

        $sbC = New-Object System.Text.StringBuilder 256
        [DesktopPerceptionHelper]::GetClassName($fgHwnd, $sbC, 256) | Out-Null
        $cls = $sbC.ToString()

        [DesktopPerceptionHelper]::GetWindowThreadProcessId($fgHwnd, [ref]$fgPid) | Out-Null
        try { $procName = [System.Diagnostics.Process]::GetProcessById([int]$fgPid).ProcessName } catch {}

        # Reading AgenticOS's own UI is never what the user means by "my screen".
        if ($procName -match '^(?i:agenticos|electron)$' -or $title -like '*AgenticOS*') {
            $reason = "foreground_is_agenticos"
        }
    }

    if ($reason -ne "") {
        [PSCustomObject]@{
            success     = $false
            action      = "read_foreground"
            reason      = $reason
            hwnd        = if ($fgHwnd) { $fgHwnd.ToInt64() } else { 0 }
            windowTitle = $title
            process     = $procName
        } | ConvertTo-Json -Compress
        exit 0
    }

    # ── 2. Geometry: separate client area from non-client chrome ────────────
    $winRect = New-Object DesktopPerceptionHelper+RECT
    [DesktopPerceptionHelper]::GetWindowRect($fgHwnd, [ref]$winRect) | Out-Null
    $cliRect = New-Object DesktopPerceptionHelper+RECT
    [DesktopPerceptionHelper]::GetClientRect($fgHwnd, [ref]$cliRect) | Out-Null
    $origin = New-Object DesktopPerceptionHelper+POINT
    $origin.X = 0
    $origin.Y = 0
    [DesktopPerceptionHelper]::ClientToScreen($fgHwnd, [ref]$origin) | Out-Null

    $clientLeft   = $origin.X
    $clientTop    = $origin.Y
    $clientRight  = $origin.X + ($cliRect.Right - $cliRect.Left)
    $clientBottom = $origin.Y + ($cliRect.Bottom - $cliRect.Top)
    $nonClientTopPx = $clientTop - $winRect.Top

    # ── 3. Content root: prefer the Chromium/Electron render widget host ────
    $contentRoot = $null
    foreach ($cHwnd in [DesktopPerceptionHelper]::FindChildWindows($fgHwnd)) {
        $ccs = New-Object System.Text.StringBuilder 256
        [DesktopPerceptionHelper]::GetClassName($cHwnd, $ccs, 256) | Out-Null
        if ($ccs.ToString() -eq "Chrome_RenderWidgetHostHWND") {
            try {
                $r = [System.Windows.Automation.AutomationElement]::FromHandle($cHwnd)
                if ($r) { $contentRoot = $r; break }
            } catch {}
        }
    }
    if (-not $contentRoot) {
        try { $contentRoot = [System.Windows.Automation.AutomationElement]::FromHandle($fgHwnd) } catch {}
    }

    # ── 4. Extract content, excluding non-client chrome ────────────────────
    $skipTypes = @(
        'ControlType.TitleBar', 'ControlType.MenuBar',
        'ControlType.ScrollBar', 'ControlType.Thumb', 'ControlType.Separator'
    )
    # Caption controls, EN + DE, as a belt-and-braces filter on top of geometry.
    $skipNames = '^(?i:minimi[sz]e|maximi[sz]e|restore|close|system|minimieren|maximieren|wiederherstellen|schliessen|schließen)$'

    $extractedTexts = @()
    $extractedControls = @()
    $chromeFiltered = 0

    if ($contentRoot) {
        try {
            $descendants = $contentRoot.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition)

            foreach ($d in $descendants) {
                if ($extractedControls.Count -ge 400) { break }

                $ct = $d.Current.ControlType.ProgrammaticName
                if ($skipTypes -contains $ct) { $chromeFiltered++; continue }

                $b = $d.Current.BoundingRectangle
                if ($b.IsEmpty -or $b.Width -le 1 -or $b.Height -le 1) { continue }

                # GEOMETRY FILTER: anything outside the client area is chrome
                # (title bar band, caption buttons, borders, resize grips).
                if ($b.Bottom -le $clientTop -or $b.Top -ge $clientBottom -or
                    $b.Right -le $clientLeft -or $b.Left -ge $clientRight) {
                    $chromeFiltered++
                    continue
                }

                $name = $d.Current.Name
                if ($name -and $name -match $skipNames) { $chromeFiltered++; continue }

                $val = ""
                try {
                    $vp = $d.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    if ($vp) { $val = $vp.Current.Value }
                } catch {}

                $text = $name
                if (-not $text -and $val) { $text = $val }
                if ($text) {
                    $extractedTexts += $text
                    $extractedControls += @{ name = $text; type = $ct; value = $val }
                }
            }
        } catch {}
    }

    # Deduplicate while preserving reading order
    $uniqueTexts = @()
    $seen = @{}
    foreach ($t in $extractedTexts) {
        $clean = ($t.Trim() -replace '[\r\n\t\x00-\x1F]', ' ').Trim()
        if ($clean -and -not $seen.ContainsKey($clean)) {
            $seen[$clean] = $true
            $uniqueTexts += $clean
        }
    }
    $fullText = ($uniqueTexts -join " `n ") -replace '[\x00-\x09\x0B\x0C\x0E-\x1F]', ' '

    # ── 5. Screenshot for the vision fallback (never claimed as text) ───────
    $shot = $null
    if ($OutScreenshotPath) {
        $oW = 0
        $oH = 0
        $capOk = [DesktopPerceptionHelper]::CaptureHwnd($fgHwnd, $OutScreenshotPath, [ref]$oW, [ref]$oH)
        if ($capOk -and (Test-Path $OutScreenshotPath) -and (Get-Item $OutScreenshotPath).Length -gt 1024) {
            $shot = @{
                success      = $true
                width        = $oW
                height       = $oH
                artifactPath = $OutScreenshotPath
                sha256       = (Get-FileHash -Path $OutScreenshotPath -Algorithm SHA256).Hash.ToLower()
                byteSize     = (Get-Item $OutScreenshotPath).Length
            }
        }
    }

    [PSCustomObject]@{
        success             = $true
        action              = "read_foreground"
        hwnd                = $fgHwnd.ToInt64()
        windowTitle         = $title
        windowClass         = $cls
        process             = $procName
        pid                 = [int]$fgPid
        method              = if ($contentRoot) { "uia" } else { "none" }
        text                = $fullText
        contentChars        = $fullText.Length
        controlCount        = $extractedControls.Count
        chromeFilteredCount = $chromeFiltered
        controls            = ($extractedControls | Select-Object -First 50)
        geometry            = @{
            windowRect     = @{ left = $winRect.Left; top = $winRect.Top; right = $winRect.Right; bottom = $winRect.Bottom }
            clientRect     = @{ left = $clientLeft; top = $clientTop; right = $clientRight; bottom = $clientBottom }
            nonClientTopPx = $nonClientTopPx
        }
        screenshot          = $shot
        confidence          = if ($fullText.Length -gt 20) { 0.95 } else { 0.6 }
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

$targetHwnd = Get-TargetWindow -RequestedHwnd $Hwnd -Query $TargetQuery

```

### 4.4 `desktop_perception.ps1` — `Get-TargetWindow()` (lines 201-322), used by the OLD `inspect` path and NOT by `read_foreground`

Shown because it is the mechanism that produces the reported wrong-application/desktop-shell behaviour.
```powershell
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
[DesktopPerceptionHelper]::Attach()

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Get-TargetWindow {
    param([long]$RequestedHwnd, [string]$Query)
    if ($RequestedHwnd -gt 0) {
        return [IntPtr]$RequestedHwnd
    }
    
    $allWindows = [DesktopPerceptionHelper]::GetDesktopWindows()

    # Check current foreground
    $fg = [DesktopPerceptionHelper]::GetForegroundWindow()
    $fgTitle = ""
    $fgW = 0
    $fgH = 0
    if ($fg -ne [IntPtr]::Zero) {
        $sb = New-Object System.Text.StringBuilder 512
        [DesktopPerceptionHelper]::GetWindowText($fg, $sb, 512) | Out-Null
        $fgTitle = $sb.ToString()
        $rect = New-Object DesktopPerceptionHelper+RECT
        [DesktopPerceptionHelper]::GetWindowRect($fg, [ref]$rect) | Out-Null
        $fgW = $rect.Right - $rect.Left
        $fgH = $rect.Bottom - $rect.Top
    }

    $qClean = if ($Query) { 
        $Query.ToLower().Trim() -replace '^(?:read|inspect|what\s+is\s+inside|what''s\s+inside|inside|in|the)\s+', '' -replace '\s+(?:window|page|app|application)$', ''
    } else { "" }

    # If query is deictic, empty, or desktop/screen:
    if (-not $qClean -or $qClean -eq 'desktop' -or $qClean -eq 'screen' -or $qClean -eq 'fullscreen' -or $qClean -match '^(?:active|current|this|the)\b' -or $qClean -eq 'active_window') {
        # If desktop or screen was explicitly queried, pick Progman if available
        if ($qClean -eq 'desktop' -or $qClean -eq 'screen' -or $qClean -eq 'fullscreen') {
            $progman = $allWindows | Where-Object { $_.ClassName -eq "Progman" -or $_.Title -eq "Program Manager" } | Select-Object -First 1
            if ($progman) { return [IntPtr]$progman.Hwnd }
        }
        # If foreground is valid, not AgenticOS, and prominent
        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*" -and $fgW -ge 300 -and $fgH -ge 200) {
            return $fg
        }
        # Otherwise pick first prominent non-explorer non-AgenticOS window
        $match = $allWindows | Where-Object { 
            $_.Process -ne "explorer" -and 
            $_.Title -notlike "*AgenticOS*" -and
            $_.Title -notlike "*Program Manager*" -and
            $_.Width -ge 300 -and
            $_.Height -ge 200
        } | Select-Object -First 1
        if ($match) { return [IntPtr]$match.Hwnd }
        if ($fg -ne [IntPtr]::Zero) { return $fg }
    }

    if ($qClean -eq 'browser' -or $qClean -match '^(?:browser|web\s*browser)$') {
        # Check active foreground first if it's a browser
        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") {
            $fgProc = $allWindows | Where-Object { $_.Hwnd -eq $fg.ToInt64() } | Select-Object -First 1
            if ($fgProc -and $fgProc.Process -match 'comet|chrome|msedge|firefox|brave|opera') {
                return $fg
            }
        }
        # Find any prominent browser window (Comet, Chrome, Edge, etc.)
        $browserMatch = $allWindows | Where-Object { 
            $_.Process -match 'comet|chrome|msedge|firefox|brave|opera' -and 
            $_.Width -ge 300 -and 
            $_.Height -ge 200 
        } | Select-Object -First 1
        if ($browserMatch) { return [IntPtr]$browserMatch.Hwnd }
        if ($fg -ne [IntPtr]::Zero -and $fgTitle -notlike "*AgenticOS*") { return $fg }
    }

    if ($qClean) {
        # Tokenize query
        $tokens = $qClean -split '[\s\-_/]+' | Where-Object { $_ -and $_ -notin @("app", "application", "browser", "window", "the", "a", "an") }
        
        # Word-number expansion
        $expandedTokens = @()
        foreach ($tok in $tokens) {
            $expandedTokens += $tok
            if ($tok -eq "1") { $expandedTokens += "one" }
            elseif ($tok -eq "one") { $expandedTokens += "1" }
            elseif ($tok -eq "2") { $expandedTokens += "two" }
            elseif ($tok -eq "two") { $expandedTokens += "2" }
        }

        $scored = @()
        foreach ($w in $allWindows) {
            $tLower = if ($w.Title) { $w.Title.ToLower() } else { "" }
            $pLower = if ($w.Process) { $w.Process.ToLower() } else { "" }
            $score = 0

            # Exact substring match
            if ($tLower.Contains($qClean) -or $pLower.Contains($qClean)) { $score += 100 }

            # Token matches
            foreach ($tok in $expandedTokens) {
                if ($tLower.Contains($tok)) { $score += 40 }
                if ($pLower.Contains($tok)) { $score += 50 }
            }

            # Penalize explorer or shell infrastructure unless explicitly asked
            if ($w.Process -eq "explorer" -and -not $qClean.Contains("explorer")) { $score -= 60 }
            if ($tLower -eq "program manager") { $score -= 100 }

            if ($score -gt 0) {
                $scored += [PSCustomObject]@{
                    Hwnd = $w.Hwnd
                    Score = $score
                    Title = $w.Title
                    Process = $w.Process
                }
            }
        }
```

## 5. Every call site

### 5.1 `readForegroundScreen`
```
server/src/domains/jarvisNext/turnRouter.ts:1146:      const { readForegroundScreen } = await import('../../services/perception/foregroundScreenReader.js');
server/src/domains/jarvisNext/turnRouter.ts:1147:      const reading = await readForegroundScreen();
server/src/services/perception/foregroundScreenReader.ts:157:export async function readForegroundScreen(): Promise<ForegroundScreenReading> {
server/src/__tests__/foregroundScreenRead.test.ts:6: * `detectForegroundScreenIntent`, `readForegroundScreen` and
server/src/__tests__/foregroundScreenRead.test.ts:60:import { readForegroundScreen } from '../services/perception/foregroundScreenReader.js';
server/src/__tests__/foregroundScreenRead.test.ts:144:/* ═══════════════════════ readForegroundScreen ══════════════════════════════ */
server/src/__tests__/foregroundScreenRead.test.ts:149:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:164:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:183:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:199:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:209:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:224:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:241:      const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:249:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:263:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:275:      const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:286:    const r = await readForegroundScreen();
server/src/__tests__/foregroundScreenRead.test.ts:302:    const r = await readForegroundScreen();
```

### 5.2 `detectForegroundScreenIntent` (the name requested, `isForegroundScreenIntent`, does not exist — 0 matches)
```
server/src/domains/jarvis/execution/foregroundScreenIntent.ts:92:export function detectForegroundScreenIntent(raw: string): ForegroundScreenIntent {
server/src/domains/jarvisNext/turnRouter.ts:1142:    const { detectForegroundScreenIntent } = await import('../jarvis/execution/foregroundScreenIntent.js');
server/src/domains/jarvisNext/turnRouter.ts:1143:    const fgIntent = detectForegroundScreenIntent(effectivePrompt);
server/src/__tests__/foregroundScreenRead.test.ts:6: * `detectForegroundScreenIntent`, `readForegroundScreen` and
server/src/__tests__/foregroundScreenRead.test.ts:59:import { detectForegroundScreenIntent } from '../domains/jarvis/execution/foregroundScreenIntent.js';
server/src/__tests__/foregroundScreenRead.test.ts:124:    const r = detectForegroundScreenIntent(phrase);
server/src/__tests__/foregroundScreenRead.test.ts:140:    expect(detectForegroundScreenIntent(phrase).isReadForegroundScreen).toBe(false);
```

### 5.3 PowerShell `read_foreground`
```
server/src/domains/jarvisNext/turnRouter.ts:136:  | 'read_foreground_screen'
server/src/domains/jarvisNext/turnRouter.ts:1134:  // ── Deterministic: read the FOREGROUND screen (read_foreground_screen) ─────
server/src/domains/jarvisNext/turnRouter.ts:1156:        route: 'read_foreground_screen',
server/src/domains/jarvisNext/turnRouter.ts:1161:        goalId: (reading.success ? 'read_foreground_screen' : 'read_foreground_screen_unreadable') as any,
server/src/services/perception/foregroundScreenReader.ts:2: * foregroundScreenReader.ts — `read_foreground_screen` capability.
server/src/services/perception/foregroundScreenReader.ts:71:/** Shape of `desktop_perception.ps1 -Action read_foreground` output. */
server/src/services/perception/foregroundScreenReader.ts:170:  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action "read_foreground" -OutScreenshotPath "${artifactPath}"`;
server/src/services/perception/foregroundScreenReader.ts:179:        error: 'desktop_perception.ps1 returned no JSON for action read_foreground',
server/src/__tests__/foregroundScreenRead.test.ts:2: * foregroundScreenRead.test.ts — `read_foreground_screen`
server/src/__tests__/foregroundScreenRead.test.ts:63:/** Build a fake PowerShell `read_foreground` payload. */
server/src/__tests__/foregroundScreenRead.test.ts:67:    action: 'read_foreground',
server/src/__tests__/foregroundScreenRead.test.ts:123:  it.each(positives)('routes %j to read_foreground_screen', (phrase) => {
server/src/__tests__/foregroundScreenRead.test.ts:146:describe('read_foreground_screen capability', () => {
server/src/__tests__/foregroundScreenRead.test.ts:255:      expect(cmd).toContain('-Action "read_foreground"');
server/src/__tests__/foregroundScreenRead.test.ts:312:describe('routing: real turnRouter sends screen reads to read_foreground_screen', () => {
server/src/__tests__/foregroundScreenRead.test.ts:318:  ])('%j -> route read_foreground_screen', async (phrase) => {
server/src/__tests__/foregroundScreenRead.test.ts:327:    expect(res.route).toBe('read_foreground_screen');
server/src/__tests__/foregroundScreenRead.test.ts:334:      expect(cmd).toContain('read_foreground');
server/src/__tests__/foregroundScreenRead.test.ts:348:      expect(res.route).not.toBe('read_foreground_screen');
server/scripts/desktop_perception.ps1:335:# ACTION: read_foreground
server/scripts/desktop_perception.ps1:355:if ($Action -eq 'read_foreground') {
server/scripts/desktop_perception.ps1:389:            action      = "read_foreground"
server/scripts/desktop_perception.ps1:516:        action              = "read_foreground"
```

## 6. Routes that can currently handle "Read what is on my screen" / "Read this page" / "What is currently visible?" / "What does this window say?"

**Yes — multiple competing routers still exist.** They are listed below with the evidence
that each one exists in the current tree.

| # | Router (entry file) | How it claims the request | Reaches | Status |
|---|---|---|---|---|
| 1 | `turnRouter.routeTurn()` — `server/src/domains/jarvisNext/turnRouter.ts:1134` | `detectForegroundScreenIntent()` (compositional), runs **before** the control-plane lifecycle | `readForegroundScreen()` → PS1 `-Action read_foreground` → foreground HWND only | **ADDED by this task** (voice path) |
| 2 | `ControlPlaneTurnHandler.extractActionIntent()` stage **0a2** — `server/src/domains/controlPlane/ControlPlaneTurnHandler.ts:1404-1434` | hard-coded phrase regex; emits `verb:'observe_desktop'` | `ControlPlaneExecutor` case `desktop_observe` → `UniversalPerceptionService.observeDesktop()` → PS1 `-Action inspect` → **`Get-TargetWindow()`** | UNCHANGED — still present, still reachable when (1) does not match |
| 3 | `canonicalTurnExecutionService` stage **3b "screen_perception"** — `server/src/domains/jarvis/canonicalTurnExecutionService.ts:473-487` | hard-coded phrase regex | `universalPerceptionService.observeDesktop({ targetQuery: 'desktop' })` → PS1 `-Action inspect` → **`Get-TargetWindow()` → Progman (desktop shell)** | UNCHANGED — this is the HTTP path (`server/src/routers/jarvis.ts`) |
| 4 | `DesktopPerceptionService.perceive()` / `inspectWindow()` — `server/src/services/perception/DesktopPerceptionService.ts:152,290` | caller-supplied query; UIA walk over the window root | PS1 `-Action inspect` | UNCHANGED — used by the Telegram adapter, not by `turnRouter` |
| 5 | `intentRouter.ts` → `route: 'investigate'` — `server/src/domains/jarvis/intentRouter.ts:687` | supervisor / investigation path | runtime + project state diagnostics | UNCHANGED — this is the path the reported "runtime diagnostics" answers came from |
| 6 | `desktopExecutor.ts:878` | `captureScreen()` only (image, no text) | screenshot artifact | UNCHANGED |

### 6.1 Verbatim evidence for router #3 (the HTTP path, still using the desktop-shell target)

```ts
    // ── 3b. Visual Perception: Desktop / Screen ("Can you see the screen right now?", "Can you see my desktop screen?", "Capture my desktop screen") ──
    if (
      /\b(?:can\s+you\s+see\s+(?:the\s+|my\s+)?(?:screen|desktop)|can\s+you\s+see\s+(?:the\s+|my\s+)?desktop\s+screen|see\s+(?:the\s+|my\s+)?(?:screen|desktop)|look\s+at\s+(?:the\s+|my\s+)?(?:screen|desktop)|what\s+is\s+on\s+(?:my\s+)?desktop|on\s+my\s+desktop|what\s+is\s+on\s+(?:my\s+|the\s+)?screen|what\s+do\s+you\s+see\s+on\s+(?:my\s+|the\s+)?screen|inspect\s+(?:the\s+|my\s+)?(?:screen|desktop)|capture\s+(?:my\s+)?(?:desktop\s+)?screen)\b/i.test(lower)
    ) {
      const { universalPerceptionService } = await import('../controlPlane/UniversalPerceptionService.js');
      const percRes = await universalPerceptionService.observeDesktop({ userPrompt: rawPrompt, targetQuery: 'desktop' });
      const reply = percRes.visionAnswer || (percRes as any).summary || "I can see your desktop screen.";
      await this.recordTurn(conversationId, rawPrompt, reply, 'screen_perception');
      return {
        assistantText: reply,
        route: 'screen_perception',
        status: 'completed',
        verified: true,
      };
    }
```

`targetQuery: 'desktop'` is the value that `Get-TargetWindow()` maps to Progman (section 4.4,
lines 231-234), i.e. the desktop shell rather than the foreground application.

### 6.2 Which router wins for each phrasing (observed, not assumed)

For the VOICE path (`turnRouter.routeTurn()`), router #1 wins for all four phrasings — this is
asserted by the routing tests in section 8 ("4 phrasings -> route `read_foreground_screen`").
Router #2/#3/#4/#5 remain reachable for the same phrasings through other entry points, and
were not modified by this task.

| Phrasing | Matches task router #1? | Matches the OLD phrase list in #2/#3? |
|---|---|---|
| "Read what is currently on my screen." | yes (surface `screen` + read verb) | **no** — the old list has `what is on my screen`, not `what is currently on my screen` |
| "Read this page." | yes (surface `page` + read verb) | **no** — `read this page` is absent from both old lists |
| "What is currently visible?" | not asserted by a test | **no** — not in either old list |
| "What does this window say?" | yes (surface `window` + read-verb `say`) | **no** — not in either old list |

That third column is the routing hole that produced the reported symptoms: phrasings absent
from the old phrase lists escaped deterministic routing and landed in the supervisor /
`investigate` path.

## 7. Exact foreground-reading pipeline

Every arrow names the real function and file. Items marked (mocked in tests) are replaced by
the test harness, not by production code.

```text
user voice
  -> jarvisNextAgent.processUserAudioFrame()              [server/src/domains/jarvisNext/jarvisNextAgent.ts ~1000-1130]
       VAD onset/end; on silence timeout -> commitUserTurn()
  -> JarvisNextAgent.commitUserTurn()                     [jarvisNextAgent.ts 1207]
       transcribeLocally() STT; allocates const acceptedTurnId = ++this.currentUserTurnId
  -> JarvisNextAgent.handleUserText(text, turnId)         [jarvisNextAgent.ts 1490]
  -> turnRouter.routeTurn({ prompt, conversationId, ... }) [server/src/domains/jarvisNext/turnRouter.ts 848]

intent classification
  -> detectForegroundScreenIntent(effectivePrompt)        [server/src/domains/jarvis/execution/foregroundScreenIntent.ts 92]
       compositional: SURFACE_NOUNS x (READ_VERBS | CONTENT_QUESTION), minus CAMERA_NOUNS,
       screenshot-capture, LAUNCH_VERBS+named target, web search, DIAGNOSTIC_NOUNS
  -> turnRouter.ts:1143 branch  -> route id 'read_foreground_screen'  [turnRouter.ts 1134-1165]

foreground HWND
  -> readForegroundScreen()                               [server/src/services/perception/foregroundScreenReader.ts 157]
       permission gate: capabilityPermissionStore.isAllowed('desktop.observe')
       spawns: powershell -File desktop_perception.ps1 -Action "read_foreground" -OutScreenshotPath <art>
  -> [DesktopPerceptionHelper]::GetForegroundWindow()     [server/scripts/desktop_perception.ps1 356]
       no window search, no title scoring, no Progman fallback
       reason codes: no_foreground_window | foreground_not_visible | foreground_minimised | foreground_is_agenticos

client rectangle
  -> GetWindowRect + GetClientRect + ClientToScreen       [desktop_perception.ps1 409-421]
       clientLeft/Top/Right/Bottom in screen coords; nonClientTopPx = clientTop - winRect.Top

UIA extraction
  -> AutomationElement::FromHandle(contentRoot)            [desktop_perception.ps1 425-443]
       content root = Chrome_RenderWidgetHostHWND child when present (Chromium/Electron/Comet), else the window element
  -> FindAll(TreeScope.Descendants, TrueCondition)         [desktop_perception.ps1 462-466]

content filtering
  -> geometry filter: skip if BoundingRectangle outside client rect   [desktop_perception.ps1 474-479]
  -> control-type filter: TitleBar | MenuBar | ScrollBar | Thumb | Separator  [desktop_perception.ps1 454-457, 469]
  -> name filter: Minimize|Maximize|Restore|Close|System (+ DE)      [desktop_perception.ps1 459, 481]
  -> chromeFilteredCount counter; dedupe preserving order            [desktop_perception.ps1 493-503]
  -> text = unique names joined; window title stays identity metadata only  [desktop_perception.ps1 421, 516-524]

screenshot fallback
  -> CaptureHwnd(fgHwnd, OutScreenshotPath) -> PrintWindow/BitBlt -> PNG  [desktop_perception.ps1 509-514; helper 147-182]
  -> only reached in the reader when UIA content is empty/short AND the artifact exists >1024 bytes
       [foregroundScreenReader.ts 209-217]

vision extraction
  -> universalPerceptionService.analyzeImageWithVisionLLM(base64, prompt, 'image/png')
       [server/src/domains/controlPlane/UniversalPerceptionService.ts 75]
       Dashscope qwen-vl-plus primary, OpenRouter secondary; prompt explicitly forbids describing
       window controls/title bars (foregroundScreenReader.ts 218-231)
       (mocked in tests)

grounded spoken response
  -> readForegroundScreen() return: spokenText composed ONLY from extracted evidence
       uia    : 'I can see a <process> window — "<title>". The visible content contains: ...'
       vision : 'I can see a <process> window — "<title>". <vision answer>'
       none   : 'I can identify the <process> window — "<title>", but I cannot currently extract readable text from it.'
       agenticOS foreground: 'The window in the foreground is AgenticOS itself. Switch to the application you want me to read, then ask again.'
  -> turnRouter finish({ route:'read_foreground_screen', text: reading.spokenText,
                         evidence/verified: reading.success, goalId })   [turnRouter.ts 1155-1164]
  -> jarvisNextAgent.speak(text, activeTurnId) -> TTS playout -> LiveKit audio
       [jarvisNextAgent.ts 2066; ack path schedules speak(ack, turnId, {preliminaryAck:true}) at ~1774]
```

## 8. Actual tests and exact test output

### 8.1 New suite — command and exact output
```
$ cd /d/AgenticOS/server && npx vitest run --reporter=verbose src/__tests__/foregroundScreenRead.test.ts

 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > routes "Read what is currently on my screen." to read_foreground_screen 3ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > routes "Tell me what is visible on this screen." to read_foreground_screen 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > routes "What does the current window say?" to read_foreground_screen 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > routes "Read this page." to read_foreground_screen 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > routes "What is on my screen right now?" to read_foreground_screen 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > routes "Describe what is on my monitor." to read_foreground_screen 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "Look at me and tell me what you see" (camera) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "What am I holding in my hand" (camera) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "Take a screenshot of the window" (screenshot capture) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "Open Chrome and read the page" (launch named target) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "Google what is on my screen" (web search) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "What is the AgenticOS runtime status" (runtime diagnostics) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > foreground-screen intent is compositional, not a phrase list > does not claim "What is the status of my project" (no surface reference) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 1. identifies the foreground window and returns real content 1ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 2. returns application content, never window chrome 1ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 3. reads a browser foreground window (render-widget content root) 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 4. reads a generic desktop application window 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 5. accessibility unavailable -> screenshot + vision fallback 3ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 6. extraction failure -> explicit terminal response, never silence or fabrication 2ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 7. never answers with AgenticOS runtime status/diagnostics 1ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 8. never launches an application or opens a new window 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 9. never performs a project/task lookup 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > 10. repeated calls keep working in the same conversation 1ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > title-bar controls alone are not meaningful screen content 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > read_foreground_screen capability > foreground is AgenticOS itself -> explicit, honest terminal outcome 0ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > routing: real turnRouter sends screen reads to read_foreground_screen > "Read what is currently on my screen." -> route read_foreground_screen 1081ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > routing: real turnRouter sends screen reads to read_foreground_screen > "Tell me what is visible on this screen." -> route read_foreground_screen 2ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > routing: real turnRouter sends screen reads to read_foreground_screen > "What does the current window say?" -> route read_foreground_screen 1ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > routing: real turnRouter sends screen reads to read_foreground_screen > "Read this page." -> route read_foreground_screen 2ms
 ✓ src/__tests__/foregroundScreenRead.test.ts > routing: real turnRouter sends screen reads to read_foreground_screen > does not hijack launch or camera requests 2169ms
 Test Files  1 passed (1)
      Tests  30 passed (30)
   Duration  3.83s (transform 1.95s, setup 0ms, import 244ms, tests 3.27s, environment 0ms)
```

### 8.2 Regression — the two previously-passing voice suites plus the new one
```
$ cd /d/AgenticOS/server && npx vitest run --reporter=verbose src/__tests__/foregroundScreenRead.test.ts \
      src/__tests__/voicePipelineRegression.test.ts src/__tests__/quietRecoveryRouting.test.ts

 Test Files  3 passed (3)
      Tests  41 passed (41)
   Duration  5.45s (transform 3.44s, setup 0ms, import 2.28s, tests 11.24s, environment 0ms)
```

### 8.3 TypeScript and PowerShell syntax gates
```
$ cd /d/AgenticOS/server && npx tsc --noEmit          -> exit 0 (no output)
$ Parser::ParseFile(server/scripts/desktop_perception.ps1)  -> PS_PARSE_OK
```

### 8.4 Workspace verification (hermes verify) — recorded, unambiguous result

The repo-detected recipe test phase is `["npm run test", "npm run lint"]`.

```
$ hermes verify --json --phase build   ->  "ok": true,  exit 0, 40.5s   (ran npm run build)
$ hermes verify --json --phase test    ->  "ok": false, exit 1, 78.3s   (ran npm run test = root vitest run src/)
```

The failing phase is the ROOT RENDERER suite, not this task:

```
--- failing file reported by that run ---
src/__tests__/voiceVadResilience.test.tsx
--- occurrences of any file changed by this task in that run (0 = not loaded) ---
0
```

All five files changed by this task are outside `src/` (the root runner's only scope), so the
root renderer suite cannot load them. Whether those root failures PRE-DATE this task is NOT
proven: the working tree also contains unrelated uncommitted branch edits under `src/`, and
reverting them was not permitted. Claimed here: non-attribution only.

## 9. Real production code vs mocked components vs unverified

### 9.1 Real production code exercised by the tests

| Exercised for real | Where |
|---|---|
| `detectForegroundScreenIntent()` — all branches | `server/src/domains/jarvis/execution/foregroundScreenIntent.ts` |
| `readForegroundScreen()` — every branch: permission gate, JSON parse, reason-code handling, UIA path, vision path, short-content path, terminal failure | `server/src/services/perception/foregroundScreenReader.ts` |
| `turnRouter.routeTurn()` — real router, real `finish()`, real route union | `server/src/domains/jarvisNext/turnRouter.ts` |
| Command construction (`-Action "read_foreground"`, artifact path) | asserted by test 8 |

### 9.2 Mocked OS / UI components

| Mocked | How | Consequence |
|---|---|---|
| `node:child_process` / `child_process` `exec` | synchronous stub that records the command and returns a canned PowerShell payload | PowerShell is never launched; desktop is never touched |
| `desktop_perception.ps1` output | supplied as JSON by the harness | the PowerShell geometry/UIA filtering logic is **not executed** by these tests |
| `capabilityPermissionStore.isAllowed` | returns a settable boolean | permission store logic not exercised |
| `universalPerceptionService.analyzeImageWithVisionLLM` | returns a settable string or `null` | no vision API call, no network |
| `llmGateway.llmChat` | returns a canned reply | no network |
| `utils/logger` | no-op spies | — |

### 9.3 Behaviour that remains UNVERIFIED until physical testing

1. **Real PowerShell execution of `-Action read_foreground`.** The script parses
   (`Parser::ParseFile` → `PS_PARSE_OK`), but its runtime behaviour — `GetForegroundWindow`,
   `GetClientRect`/`ClientToScreen`, and the UIA bounding-rectangle geometry filter — has never
   been executed. The `chromeFilteredCount` values in the tests are supplied by the harness.
2. **Whether the geometry filter actually removes the title bar / min-max-close buttons** for a
   real window, and whether it removes real content on any given framework. This is the central
   assumption of the fix and is untested outside unit-level filtering.
3. **Chromium/Electron content-root selection** (`Chrome_RenderWidgetHostHWND` child lookup) on a
   live Comet/Electron window.
4. **The vision fallback against a real screenshot** — no API key was used; the model path was
   never invoked.
5. **The `foreground_is_agenticos` guard** against the real Electron process name and window title.
6. **End-to-end voice behaviour** — whether the spoken output actually matches what is on screen,
   and whether the pre-ack ("I'm checking that now") still precedes the answer for this route.
   The ack path in `jarvisNextAgent` was **not** modified by this task.
7. **Whether the unreachable-by-design windows** (minimised, AgenticOS-foreground) produce an
   acceptable user experience in practice.

### 9.4 Routing coverage that is NOT verified

- "What is currently visible?" is listed in the review request but is **not** asserted by any test
  in this bundle. `CONTENT_QUESTION` requires a `what is/are` form plus a surface noun; this
  phrasing has no explicit surface noun and its behaviour was not measured.
- The HTTP path (`canonicalTurnExecutionService`, router #3) still routes these phrasings to the
  desktop-shell target and is unmodified.

## 10. Statement of scope

This bundle is evidence only. It makes no claim that the capability works on a real desktop,
offers no PASS/FAIL verdict, and does not recommend deployment. The unit-level results are
confined to the mocked-OS boundary described in section 9.2. Physical verification is outstanding.

No code was modified while producing this bundle. Nothing was deployed, committed or pushed.

--- END OF BUNDLE ---
