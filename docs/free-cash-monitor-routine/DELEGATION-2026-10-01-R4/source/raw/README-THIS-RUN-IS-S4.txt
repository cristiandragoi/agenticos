S4 STREAM MANIFEST — WHO WROTE WHAT IN THIS DIRECTORY
=====================================================

This stream dir is SHARED: the parent session and at least one sibling stream
("R4 Stream S") have also written into it during the same window (see
raw/00-parent-pass-2026-10-01-1142.txt, whose own header says
"Author: parent session (DELEGATION-2026-10-01-R4)", and e2e_r3_two_day.py,
whose docstring says "R4 Stream S").  Those files are NOT this stream's and were
neither modified nor deleted.  Everyone's numbering overlaps.

FILES AUTHORED BY THIS S4 RUN (task: read-only enforcement audit + bridge design)
-------------------------------------------------------------------------------
artifact : READONLY-AUDIT.md

raw evidence (sha256 of each, so the parent can re-verify independently):
52de3ca3225c15ea8d748046ee7fa946db863e9c10d8dc20f4c955cc4c82c990  raw/01-isolation-before.txt
4b30a16323a934aa818fd2e3c6f9fd4658c6fdc15793630da14938d11ad922c4  raw/02-enforcement-probe.txt
8592cac23bfa858ccf405a4a624a21cfc54f2dfc3498b5497b65c4c0072c8e34  raw/03-acceptance-bar.txt
d8680de27a8cb2c838939a39282be1fe39f9a1e8cb322058501079c7c11db00e  raw/04-production-state-snapshots.txt
3d0566c22b8f1f8a1ae8e87685eb467affe4516c822339ee01e7681caef5beca  raw/05-shipped-guard-tests.txt
9697398e197f1fa35a25fe718b2fc3370a2ec20da892129fdfb1fe93631baee6  raw/06-bridge-proof.txt
a5d349f10a04a870505b1cdf404157c4994c6287bb54d147f45ccbe34c0816b2  raw/07-operator-session-evidence.txt
ecb56fe397f5077a6af18172b976d5ec55b4e2780f10a6292dbdd01ef80a4282  raw/99-isolation-after.txt

code (all under this stream dir; NOTHING installed anywhere):
probe/probe_guard.py            empirical violation attempts + positive control
probe/gate_allowlists.py        RED/GREEN allowlist-integrity verifier
probe/check_audit_hook.py       layer-B detector (RED on shipped = OPEN DEFECT)
probe/build_variants.py         builds the mutant + repaired copies
probe/bridge_proof.py           end-to-end proof of the bridge SHAPE
probe/readonly_client.py        byte-identical copy of the shipped module
probe/routine_copy/             copy of monitoring/freecash/ (tests run from here)
probe/mutants/allowlist_widened.py          negative control
probe/repaired/readonly_client_hook_fixed.py  repaired layer-B copy

ISOLATION (the two digests the parent re-verifies)
-------------------------------------------------
before (raw/01-isolation-before.txt) and after (raw/99-isolation-after.txt) are
byte-identical on both required files:
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl
raw/99- additionally records the shipped module's own sha256 (unchanged) and the
`find -newermt` accounting (4 lines, all pre-existing 06:53Z baseline files).
