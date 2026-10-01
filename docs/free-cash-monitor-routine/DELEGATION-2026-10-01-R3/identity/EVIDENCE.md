# EVIDENCE — Stream I (R4 identity), DELEGATION-2026-10-01-R3

Every claim below is a command executed **in this session** against the working tree, with its exit code
and raw output. No PASS is quoted from an earlier document. Raw captures live in `raw/`.

## 0. Environment (this session)

```
$ date ; "$PY" -V ; git rev-parse --abbrev-ref HEAD ; git rev-parse --short HEAD
Do,  1. Okt 2026 09:31:33
Python 3.11.9
hermes-rescue-20260908
8f7463a
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"   # interpreter of record
```
`git status --porcelain docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/ monitoring/`
→ `?? docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/` and `?? monitoring/` — the whole package
and this delivery directory are **untracked**; no tracked file was edited.

---

## E1. THE ONE TEST — both directions in a single run

```
$ bash run-identity-proof.sh
TEST_EXIT=0
```

Raw: `raw/01-identity-test-transcript.txt` (240+ lines). Result line:

```
#   refusal cases : 11 (11 passed)
#   accept  cases : 3 (3 passed)
#   throwaway root: C:\Users\cd-pr\AppData\Local/Temp/fc-r3-identity-23716
#   production root D:/AgenticOS/data/freecash-monitor was never referenced.
# RESUMEN: cases=14 failures=0 -> ALL PASS
```

### DIRECTION 1 — REFUSAL (raw output, one run)

```
CASE REF-1 hermes-agent
  exit_code = 4
  stderr    : REFUSED: refused: 'hermes-agent' matches a machine-label pattern
  item      : status=PENDING decided_by=None expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed=False
  trail     : approvals/decided.jsonl lines=0
  VERDICT   : PASS

CASE REF-10 unlisted Claude
  exit_code = 4
  stderr    : REFUSED: refused: 'Claude' is not in the operator allowlist at
              C:\Users\cd-pr\AppData\Local\Temp\fc-r3-identity-23716\REF-10\state\human-deciders.json
              (1 identity/ies configured); only a configured human may sign
  item      : status=PENDING decided_by=None expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed=False
  VERDICT   : PASS

CASE REF-11 unlisted op-1
  exit_code = 4
  stderr    : REFUSED: refused: 'operator-1' is not in the operator allowlist at …\REF-11\state\human-deciders.json
              (1 identity/ies configured); only a configured human may sign
  VERDICT   : PASS

CASE REF-4 unconfigured          (allowlist file absent, env unset)
  exit_code = 4
  stderr    : REFUSED: refused: no operator identity is configured. Create …\REF-4\state\human-deciders.json
              as {"schema_version": 1, "operators": ["<your name>"]} or set FREECASH_OPERATOR_IDENTITY="<your name>";
              an unconfigured allowlist refuses every decider (fail-closed).
  item      : status=PENDING decided_by=None … execution_state=NOT_EXECUTED
  trail     : approvals/decided.jsonl lines=0
  VERDICT   : PASS

CASE REF-5 corrupt               (file content: "{ this is not valid json ")
  exit_code = 4
  stderr    : REFUSED: refused: the operator allowlist at …\REF-5\state\human-deciders.json is not valid JSON
              (Expecting property name enclosed in double quotes: line 1 column 3 (char 2)); refusing every decider (fail-closed)
  trail     : approvals/decided.jsonl lines=0
  VERDICT   : PASS

CASE REF-7 tampered              (allowlist entry is "hermes-agent")
  exit_code = 4
  stderr    : REFUSED: refused: the operator allowlist (…\REF-7\state\human-deciders.json) lists a machine-looking
              identity 'hermes-agent'; a machine may not be allowlisted; refusing every decider (fail-closed)
  VERDICT   : PASS

CASE REF-6 empty list / REF-8 wrong-schema=99 / REF-9 env='hermes-agent'
  exit_code = 4 for each; every one leaves status=PENDING, decided_by=None, decided.jsonl lines=0
```

**Every one of the 11 refusal cases exits 4, records no decider, leaves the item `PENDING`, and writes
nothing to `approvals/decided.jsonl`.** REF-10/REF-11 are refused by *allowlist membership* — they are
names the shipped denylist accepted (see E2).

### DIRECTION 2 — ACCEPTANCE (raw output, same run)

```
CASE ACC-1 file allowlist         (allowlist = ["Alice Operator"], --by "Alice Operator")
  exit_code = 0
  stdout    : recorded APPROVED for 445ce7f3-… by Alice Operator at 2026-10-01T07:32:50Z
  stdout    : execution_state=NOT_EXECUTED (unchanged; this routine executes nothing)
  item      : status=APPROVED decided_by='Alice Operator' expires_at_utc=None execution_state=NOT_EXECUTED execution_allowed=False
  trail     : approvals/decided.jsonl lines=1
  check list_still_NOT_EXECUTED    ok
  VERDICT   : PASS

CASE ACC-2 case-insensitive       (--by "alice operator")
  exit_code = 0 ; item status=APPROVED decided_by='alice operator' ; trail lines=1 ; VERDICT PASS

CASE ACC-3 env override           (no file, FREECASH_OPERATOR_IDENTITY="Alice Operator")
  exit_code = 0 ; item status=APPROVED decided_by='Alice Operator' ; trail lines=1 ; VERDICT PASS
```

"Alice Operator" is an **obviously synthetic** name; no real person's name appears in any artifact.

---

## E2. The defect, reproduced live against the throwaway root (the "before")

```
$ bash repro-live-denylist-defect.sh        # runs the LIVE monitoring/freecash/approval_queue.py
exit 0
55:NON_HUMAN_DECIDERS = frozenset(
153:    if who.lower() in NON_HUMAN_DECIDERS:
== grep for the allowlist control in the LIVE file (expect: absent):
   <none: the allowlist control is absent from the live file>
```
Raw: `raw/02-live-denylist-defect-this-session.txt`. Observed (throwaway root only):

| `--by` | live exit | live outcome |
|---|---|---|
| `hermes-agent` | **0** | `recorded APPROVED … by hermes-agent` |
| `Claude` | **0** | `recorded APPROVED … by Claude` |
| `operator-1` | **0** | `recorded APPROVED … by operator-1` |
| `assistant` | **0** | `recorded APPROVED … by assistant` |
| `agent` | 4 | `REFUSED: refused: 'agent' is not a human identity; …` |

The live file's sha256 after the run is `0a2c982fbcfb9ca4f3371c309e308046f37976ccdb6b54e587912790fd42d506`
— the same value the rule-gate reports as its target, so the live module was read, not written.

## E3. Baseline gate on the unmutated LIVE package (this session)

```
$ "$PY" docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py --package monitoring/freecash
exit 0
SUMMARY: R1=PASS  R2=PASS  R3=PASS  R4=PASS
VERDICT: COMPLIANT -- 4/4 operator rules enforced by an AST layer and a runtime layer
```
`RULE 4: human approval before any external action, never auto-executed   (legacy label R4)` →
`DETECTOR-RESULT: rule=4 PASS (20 checks)`.

## E4. The gate on a COPY with the proposal applied (regression check)

Copy `monitoring/freecash` to a throwaway dir, overwrite `approval_queue.py` with `proposed/approval_queue.py`,
run the gate against the copy. Raw: `raw/05-*.txt`, `raw/06-*.txt`.

**(a) No operator identity configured** — the proposal fails closed, as designed:

```
$ "$PY" …/DELEGATION-2026-09-30/verifier/rule_gate.py --package <tmp>/pkg
exit 1
    FAIL  the detector ran to completion
          evidence: AllowlistError: refused: no operator identity is configured. Create …\rule4\state\human-deciders.json
          as {"schema_version": 1, "operators": ["<your name>"]} … an unconfigured allowlist refuses every decider (fail-closed).
  DETECTOR-RESULT: rule=4 FAIL (1 of 15 checks failed)
SUMMARY: R1=PASS  R2=PASS  R3=PASS  R4=FAIL
```
The only failure is the detector's own assumption that an unconfigured guard accepts a human name — i.e.
the gate detector itself relies on the old defect.

**(b) Operator identity configured** (`FREECASH_OPERATOR_IDENTITY="Alice Operator"` in the gate's env):

```
exit 0
  DETECTOR-RESULT: rule=4 PASS (20 checks)
SUMMARY: R1=PASS  R2=PASS  R3=PASS  R4=PASS
VERDICT: COMPLIANT -- 4/4 operator rules enforced by an AST layer and a runtime layer
```
So the proposal keeps the package gate green (R4 20/20, frozen-field checks included) **provided the
operator identity is configured**. The detector update is left as an explicit open item — see DESIGN §7.3;
the `DELEGATION-2026-09-30/` tree is outside this stream's write scope and was not modified
(`git status --porcelain` on it → `??` untracked, unchanged).

## E5. Isolation by hash — the production root was not touched

```
$ sha256sum data/freecash-monitor/state/last-run.json data/freecash-monitor/alerts/alerts.jsonl   # BEFORE
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl

$ sha256sum …                                                                                     # AFTER  (same files, same command)
a287a902579cb468bb5bf05635fdc882e7d8071bbc9e1d71167bf6ef2a293bf9 *data/freecash-monitor/state/last-run.json
1b9c7c07868b31cb6cc62bb6dcaa943eb5038a9c1f53ce958c9f5c02799399a8 *data/freecash-monitor/alerts/alerts.jsonl
```
**Both pairs identical.** Files: `raw/00-prod-hashes-before.txt`, `raw/03-prod-hashes-after.txt`.

```
$ find data/freecash-monitor -type f -printf '%T+  %10s  %p\n' | sort        # raw/07-*.txt
2026-10-01+08:53:46.7001916000   ...last-run.json          ← newest mtime predates this session (09:31+)
2026-10-01+08:53:46.7047175000   ...alerts/alerts.jsonl   (8956 bytes, 15 lines)
```
No file in the production root has an mtime inside this session; `approvals/` is empty (no `pending.json`).
Every test case ran with its own forced `FREECASH_DATA_ROOT` under
`%LOCALAPPDATA%\Temp\fc-r3-identity-*` (the test overrides any inherited value), and
`D:/AgenticOS/data/freecash-monitor` is never referenced by the test code.

## E6. Live file pin + absence of the control (grep)

```
$ sha256sum monitoring/freecash/approval_queue.py
0a2c982fbcfb9ca4f3371c309e308046f37976ccdb6b54e587912790fd42d506 *monitoring/freecash/approval_queue.py
$ grep -c "OPERATOR_IDENTITY_ENV\|load_operator_allowlist\|human-deciders" monitoring/freecash/approval_queue.py
0
(grep exit=1)
```
`OPERATOR_IDENTITY_ENV` was absent from the live file (as the brief states) and — deliberately — **still
is**: this stream delivers a proposal and edits nothing under `monitoring/`.

## E7. Read-only operator inspection (new `allowlist` verb)

```
$ python proposed/approval_queue.py allowlist          # (a) unconfigured
REFUSED: refused: no operator identity is configured. Create …\state\human-deciders.json … (fail-closed).
exit=4

$ python proposed/approval_queue.py allowlist          # (b) after the operator writes the file
operator allowlist : C:\Users\cd-pr\AppData\Local\Temp\fc-r3-identity-allowlist-cmd\state\human-deciders.json
override env var   : FREECASH_OPERATOR_IDENTITY (unset)
state              : CONFIGURED (1 identity/ies)
  - Alice Operator
exit=0
```
Raw: `raw/08-allowlist-subcommand.txt`. This verb reads only; it creates nothing.

## E8. Delivery inventory

`raw/09-delivery-manifest.txt` (sha256 snapshot at 07:34:46Z) lists every file except `EVIDENCE.md`
(written after the snapshot) and the manifest itself:

```
proposed/approval_queue.py            38e00fe44d87d1fa925766d73ddc290180436ec85c314282bab19bcda995937d
proposed/approval-allowlist.patch     f0db577e73455094a3e1f5b3b313e55ce36a7ebcd0f28f47dc10d42ad3f403a5
proposed/human-deciders.example.json  c712103a7d4f72af321210589a56a81a9b6034ed60b2edc312dc36c84cf2f89f
test_identity_allowlist.py            0089abfa25351b700da63ffd546d92dd2e80f25302d7da4d888cbb0ec49f425f
run-identity-proof.sh                 fcdfa00f20e7e95d738300336b349ae5ee8141b444fc237742a415f07ec76fff
repro-live-denylist-defect.sh         a7d63ca1d0b37ed2908a8b4944d6db7efd4a9ccd588d9f2c6e969c9e8c9ef83a
DESIGN.md                             604b4f34c2fe8d51d19c93fd8b250974ecb635bd420e797cb4945e21d97b4f18
raw/00 .. raw/09                     (listed in the manifest)
```

```
$ git status --porcelain docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/
?? docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/
$ git ls-files docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/      # → empty: nothing tracked
```

## E9. Prohibitions honoured

No tracked file edited. Nothing under `monitoring/` edited (live sha pinned in E6). No
`git add/commit/stash/reset/restore/checkout/clean`. No scheduled task registered. No non-loopback
socket. No credential or secret (nothing redacted was ever present). No real person's name written — the
synthetic "Alice Operator" is used throughout. No write to `D:/AgenticOS/data/freecash-monitor/`
(hash-identical, E5).

---

## E10. Second verification pass — on-demand, targeted at the changed paths

### (a) Why not a full `hermes verify --json`

```
$ hermes verify --detect-only --json .
{"source":"manifest","recipe":{"name":"Vite","kind":"vite","bootstrap":["npm install"],
 "build":["npm run build"],"test":["npm run test","npm run lint"],"start":"npm run dev",
 "port":5173,"readinessPath":"/"}}
```
A full `hermes verify` would run `npm install`, the Electron/Vite build (`tsc -b`, `vite build`) and
start a dev server — writing `node_modules/` and build output **outside this stream's permitted
directory**, and exercising the React/Electron app, **none of which loads this deliverable**. Concrete
blocker: the harness's recipe targets the Vite app; the artifact under review is Python under `docs/`.
(`--detect-only` runs nothing.)

### (b) The repo's own JS suite — red, and unrelated

```
$ npm run test        # = vitest run src/
exit 1
Test Files  14 failed | 67 passed (81)
Tests       49 failed | 645 passed (694)
```
All 14 failing files are under `src/__tests__/` (Jarvis voice/LiveKit, Mission Control, CodeXStudio,
JarvisOrb colour contract, …): `JarvisOrb.test.tsx`, `voiceVadResilience.test.tsx`,
`voicePlaybackMute.test.tsx`, `MissionControlConversation.test.tsx`, `JarvisNavigationEvents.test.tsx`,
`JarvisNavigation.test.tsx`, `JarvisLayout.test.tsx`, `JarvisStudioLayout.test.tsx`,
`jarvisPersistentRuntime.test.tsx`, `CodeXStudio.test.tsx`, `CodeX.test.tsx`, `AppShell.test.tsx`,
`ApiClientHelper.test.ts`, `JarvisConversationOwnership.test.tsx`. Occurrences of this delivery's path in
the suite output: **0**. `vitest run src/` collects `src/` only, so these pre-existing failures cannot be
caused by — and were not repaired by — a docs/Python proposal. Raw: `raw/10-verification.txt`.

### (c) Targeted checks, per changed file

```
py_compile proposed/approval_queue.py test_identity_allowlist.py      -> exit 0
json.tool  proposed/human-deciders.example.json                       -> valid JSON, exit 0
bash -n    run-identity-proof.sh                                      -> exit 0
bash -n    repro-live-denylist-defect.sh                              -> exit 0
bash       run-identity-proof.sh                                      -> exit 0
           refusal cases: 11 (11 passed) ; accept cases: 3 (3 passed) ; cases=14 failures=0
```

### (d) In-process corroboration (and a lesson)

A direct-import probe first came back `UNEXPECTED ACCEPT (unconfigured): hermes-agent`. Cause: the probe
put an MSYS `$PWD` (`/d/AgenticOS/...`) on `PYTHONPATH`, which native Python cannot resolve, so
`import approval_queue` silently fell through to the **live** `monitoring/freecash/approval_queue.py` —
i.e. the probe accidentally re-demonstrated the denylist defect in-process. Re-run with native paths and
an explicit `aq.__file__` assertion:

```
  module under test : D:\AgenticOS\docs\...\identity\proposed\approval_queue.py
  unconfigured  -> REFUSED  'hermes-agent' / 'Claude' / 'operator-1' / 'Alice Operator'
  tampered      -> REFUSED  'hermes-agent'
  configured    -> ACCEPTED 'Alice Operator'
  unlisted      -> REFUSED  'Claude' , 'operator-1' , 'hermes-agent' , 'the monitor'
  IN-PROCESS BOTH-DIRECTIONS: PASS
```
Lesson recorded: this project's tooling must pass **native** `C:/...` paths to native Python; an MSYS
path in `PYTHONPATH` fails open onto whatever module shadows it. `test_identity_allowlist.py` already uses
native paths, and the REF-10/REF-11 allowlist refusals prove it loads the proposed module.
