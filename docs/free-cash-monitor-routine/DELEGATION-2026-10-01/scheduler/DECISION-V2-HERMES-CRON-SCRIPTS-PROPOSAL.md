# Route H (Hermes cron) — PROPOSAL ONLY script content

**Nothing here is deployed.** `C:\Users\cd-pr\AppData\Local\hermes\scripts\` does **not** exist
(evidence-01, CMD4: `ls: cannot access ...: No such file or directory`), and neither creating that
directory nor running `hermes cron create` is permitted to a track (rules R4 and this delegation's
hard constraints — creating a cron job *is* an external, state-changing action).

The files below are the exact content the operator would deploy **as part of the approved action**.
Both are deliberately kept as quoted proposal text rather than as runnable `*.sh` files in this
directory: per this delegation's hard constraint, any wrapper script written here must refuse to run
against the production root, and a *production* wrapper is by definition the opposite of that. The
one wrapper script this track actually wrote and ran is `freecash-guarded-run.sh` (sandbox-only, guard
proven to fire — evidence-02).

---

## Deployment (part of the approved action, do not run without approval)

```bash
mkdir -p "C:/Users/cd-pr/AppData/Local/hermes/scripts"
# copy the two scripts below to:
#   C:/Users/cd-pr/AppData/Local/hermes/scripts/freecash-daily.sh
#   C:/Users/cd-pr/AppData/Local/hermes/scripts/freecash-watchdog.sh
```

`hermes cron create --help` states the script must be **under `~/.hermes/scripts/`**:
`.sh/.bash files run via bash, everything else via Python.` A `.sh` wrapper that invokes the pinned
interpreter is therefore the correct shape — a `.py` file would be run by Hermes's own interpreter,
not the pinned venv one, and its `import paths` would resolve against the scripts dir.

---

## `freecash-daily.sh` (Task A)

```bash
#!/usr/bin/env bash
# FreeCash daily read-only status read. PROPOSAL ONLY (rule R4).
set -u

FC_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"
FC_TZ="Europe/Berlin"
FC_SOURCE="operator_state"
FC_PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
FC_ENTRY="D:/AgenticOS/monitoring/freecash/run_daily_check.py"

# Never inherit an ambient FREECASH_* value: the gateway process that spawns this
# script may carry one (this shell was observed on 2026-09-21 carrying
# FREECASH_DATA_ROOT=<throwaway> and FREECASH_TOAST_STUB=1 from a concurrent e2e
# harness). Clear first, then set exactly what is intended.
unset FREECASH_READ_SOURCE FREECASH_READ_BASE_URL FREECASH_HTTP_TIMEOUT FREECASH_TOAST_STUB
export FREECASH_DATA_ROOT="$FC_DATA_ROOT"
export FREECASH_TZ="$FC_TZ"
export FREECASH_READ_SOURCE="$FC_SOURCE"
export FREECASH_TOAST_STUB=""
export FREECASH_TOAST_RETRY_SLEEP_SECONDS="5"

[ -x "$FC_PY" ]    || { echo "freecash-daily: pinned interpreter missing: $FC_PY"; exit 4; }
[ -f "$FC_ENTRY" ] || { echo "freecash-daily: entry point missing: $FC_ENTRY"; exit 4; }
mkdir -p "$FC_DATA_ROOT/logs"

OUT="$("$FC_PY" "$FC_ENTRY" --source "$FC_SOURCE" 2>&1)"; RC=$?
printf '%s\n' "$OUT"
printf '%s rc=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RC" "$OUT" >> "$FC_DATA_ROOT/logs/task-a.log"
exit "$RC"
```

## `freecash-watchdog.sh` (Task B)

```bash
#!/usr/bin/env bash
# FreeCash same-evening missed-run watchdog. PROPOSAL ONLY (rule R4).
set -u

FC_DATA_ROOT="D:/AgenticOS/data/freecash-monitor"
FC_TZ="Europe/Berlin"
FC_PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
FC_ENTRY="D:/AgenticOS/monitoring/freecash/watchdog.py"

unset FREECASH_READ_SOURCE FREECASH_READ_BASE_URL FREECASH_HTTP_TIMEOUT FREECASH_TOAST_STUB
export FREECASH_DATA_ROOT="$FC_DATA_ROOT"
export FREECASH_TZ="$FC_TZ"
export FREECASH_TOAST_STUB=""
export FREECASH_TOAST_RETRY_SLEEP_SECONDS="0"

[ -x "$FC_PY" ]    || { echo "freecash-watchdog: pinned interpreter missing: $FC_PY"; exit 4; }
[ -f "$FC_ENTRY" ] || { echo "freecash-watchdog: entry point missing: $FC_ENTRY"; exit 4; }
mkdir -p "$FC_DATA_ROOT/logs"

OUT="$("$FC_PY" "$FC_ENTRY" 2>&1)"; RC=$?
printf '%s\n' "$OUT"
printf '%s rc=%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RC" "$OUT" >> "$FC_DATA_ROOT/logs/task-b-watchdog.log"
exit "$RC"
```

---

## Registration (the approval string is in SCHEDULER-DECISION-V2.md section 6)

```bash
hermes cron create "0 9 * * *"   --name "FreeCash-Daily-Monitor"                     --script freecash-daily.sh    --no-agent --deliver local
hermes cron create "30 21 * * *" --name "FreeCash-Daily-Monitor-Missed-Day-Watchdog" --script freecash-watchdog.sh --no-agent --deliver local
```

`--no-agent` is deliberate: the job must be a deterministic script, never an LLM turn. The wrappers
print the entry point's own `RUN_OK …` / `SKIP_DUPLICATE_DAY …` / `WATCHDOG_*` line verbatim and
`--no-agent` delivers that stdout as-is (empty stdout = silent).

Verify / roll back:

```bash
hermes cron list
hermes cron runs "FreeCash-Daily-Monitor"
hermes cron remove "FreeCash-Daily-Monitor"
hermes cron remove "FreeCash-Daily-Monitor-Missed-Day-Watchdog"
```
