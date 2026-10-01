#!/usr/bin/env bash
# Additive evidence script for DELEGATION-2026-10-01 / delivery track.
# Drives the REAL run entry point (run_daily_check.py) against THROWAWAY roots.
#   A) baseline day (no prior snapshot)        -> expect notifications=0
#   B) no-change day (prior == today)          -> expect notifications=0
#   C) EARNINGS_CHANGED day                    -> expect notifications=1
#   C) same-day duplicate run (R1 lock)        -> expect SKIP_DUPLICATE_DAY
#   C) same change replayed (dedupe key)       -> expect notifications=0, no 2nd notify
# FREECASH_TOAST_STUB=1 routes every dispatch to the offline stub sender.
set -u
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
THROW="C:/Users/cd-pr/AppData/Local/Temp/freecash-deleg-2026-10-01"
cd "D:/AgenticOS/monitoring/freecash" || exit 99
export FREECASH_TOAST_STUB=1
export FREECASH_TZ="Europe/Berlin"

echo "== timestamp (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== interpreter: $PY"
echo "== cwd: $(pwd)"
echo "== \$FREECASH_TOAST_STUB = [$FREECASH_TOAST_STUB]  (no real desktop toast)"

make_prior_snapshot () {   # $1 = root, $2 = prior earnings cents
  FREECASH_DATA_ROOT="$1" "$PY" -c "
import paths
snap = {
  'schema_version': 1, 'day_key': '2026-09-30', 'captured_at_utc': '2026-09-30T05:00:00Z',
  'source': {'kind': 'operator_entered', 'read_ops': [], 'data_available': True, 'note': 'prior-day fixture'},
  'degraded': True, 'account_status': 'ACTIVE',
  'earnings_total_cents': $2, 'balance_cents': $2, 'pending_cents': 0, 'currency': 'USD',
  'raw_response_sha256': ''
}
paths.write_json_atomic(paths.snapshots_dir() / '2026-09-30.json', snap)
print('   [fixture] prior snapshot 2026-09-30 earnings=%d -> %s' % ($2, paths.snapshots_dir() / '2026-09-30.json'))
"
}

make_operator_record () {  # $1 = root, $2 = today's earnings cents
  FREECASH_DATA_ROOT="$1" "$PY" -c "
import paths
doc = {'schema_version': 1, 'kind': 'operator_entered_daily_status', 'note': 'probe fixture',
       'records': [{'day_key': '2026-10-01', 'entered_at_utc': '2026-10-01T05:00:00Z',
                    'account_status': 'ACTIVE', 'earnings_total_cents': $2,
                    'balance_cents': $2, 'pending_cents': 0, 'currency': 'USD'}],
       'template_record': {}}
paths.write_json_atomic(paths.operator_state_path(), doc)
print('   [fixture] operator-state 2026-10-01 earnings=%d -> %s' % ($2, paths.operator_state_path()))
"
}

run_case () {              # $1 = root, $2 = label
  export FREECASH_DATA_ROOT="$1"
  echo ""
  echo "=============================================================="
  echo "CASE: $2"
  echo "\$ FREECASH_DATA_ROOT=$FREECASH_DATA_ROOT"
  echo "\$ python run_daily_check.py"
  "$PY" run_daily_check.py
  echo "exit_code = $?"
}

# ---------------------------------------------------------------- A: baseline day
A="$THROW/notify-A"; rm -rf "$A"; mkdir -p "$A"
export FREECASH_DATA_ROOT="$A"; "$PY" -c "import paths; paths.ensure_layout()"
make_operator_record "$A" 1340
run_case "$A" "A  baseline day (no prior snapshot) -> expect notifications=0"

# ---------------------------------------------------------------- B: no-change day
B="$THROW/notify-B"; rm -rf "$B"; mkdir -p "$B"
FREECASH_DATA_ROOT="$B" "$PY" -c "import paths; paths.ensure_layout()"
make_prior_snapshot "$B" 1340
make_operator_record "$B" 1340
run_case "$B" "B  no-change day (prior 1340 == today 1340) -> expect notifications=0"

# ---------------------------------------------------------------- C: EARNINGS_CHANGED day
C="$THROW/notify-C"; rm -rf "$C"; mkdir -p "$C"
FREECASH_DATA_ROOT="$C" "$PY" -c "import paths; paths.ensure_layout()"
make_prior_snapshot "$C" 1340
make_operator_record "$C" 1500
run_case "$C" "C  EARNINGS_CHANGED day (prior 1340, today 1500) -> expect notifications=1"

# ---------------------------------------------------------------- C: duplicate same-day run (R1)
run_case "$C" "C  duplicate same-day run, lock still present (R1) -> expect SKIP_DUPLICATE_DAY"

echo ""
echo "--- C alerts.jsonl after the two runs (line-numbered):"
C="$C" FREECASH_DATA_ROOT="$C" "$PY" -c "
import os, paths
for i, line in enumerate(paths.read_jsonl(paths.alerts_path()), 1):
    print('%2d  event_type=%-16s dedupe=%s' % (i, line.get('event_type'), (line.get('dedupe_key') or '-')[:16]))
print('alerts.jsonl total lines =', len(paths.read_jsonl(paths.alerts_path())))
"
echo "--- toast-stub.log line count AFTER run 1+2 (expect 1 = one real dispatch only):"
wc -l "$C/logs/toast-stub.log"

# ---------------------------------------------------------------- C: replay same change (dedupe key)
echo ""
echo "--- isolating the DEDUPE layer: removing today's R1 day-lock so a second processing"
echo "    of the SAME change can reach the dedupe check (R1 removal is deliberate here)."
rm -f "$C/state/day-locks/2026-10-01.lock"
run_case "$C" "C  SAME change replayed (day-lock removed) -> expect notifications=0 (deduped)"

echo ""
echo "--- C alerts.jsonl after the replay:"
C="$C" FREECASH_DATA_ROOT="$C" "$PY" -c "
import paths, collections
rows = paths.read_jsonl(paths.alerts_path())
for i, line in enumerate(rows, 1):
    print('%2d  event_type=%-16s dedupe=%s observed_keys=%s' % (i, line.get('event_type'), (line.get('dedupe_key') or '-')[:16], ','.join(sorted((line.get('observed') or {}).keys()))))
c = collections.Counter(r.get('event_type') for r in rows)
print('counts by event_type:', dict(c))
print('EARNINGS_CHANGED lines =', c.get('EARNINGS_CHANGED'))
"
echo "--- toast-stub.log line count AFTER the replay (expect STILL 1 -> no re-notify):"
wc -l "$C/logs/toast-stub.log"
echo "--- notified-keys.json (dedupe key -> delivery label):"
FREECASH_DATA_ROOT="$C" "$PY" -c "import json,paths; print(json.dumps(paths.read_json(paths.notified_keys_path()), indent=2))"

echo ""
echo "== done."
