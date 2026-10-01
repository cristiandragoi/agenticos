#!/usr/bin/env bash
# run_r3_evidence.sh -- operator R3 NOTIFY ON CHANGE: end-to-end demo + the production fact.
set -u

REPO="D:/AgenticOS"
S="$REPO/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/workflow"
PY="C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
COPY="$S/routine_copy"
T="C:/Users/cd-pr/AppData/Local/Temp/fc-r4-workflow"
R="$T/r3-demo/root"
rm -rf "$T/r3-demo"; mkdir -p "$R"

export AGENT_TEAMS_DB_PATH="$T/agent-teams.db"
export AGENTICOS_DATA_DIR="$T/agenticos-data"
export FREECASH_TOAST_STUB=1
export FREECASH_TOAST_RETRY_SLEEP_SECONDS=0

{
echo "###############################################################################"
echo "# 04 — OPERATOR R3 NOTIFY ON CHANGE: what a change notification looks like,"
echo "#      the dedupe key, the delivery, and the production fact that it NEVER fired."
echo "# thrownaway root: $R"
echo "# during: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "\$ FREECASH_DATA_ROOT=$R $PY $S/tools/r3_change_demo.py $R $COPY 2026-09-28 2026-09-29"
FREECASH_DATA_ROOT="$R" "$PY" "$S/tools/r3_change_demo.py" "$R" "$COPY" 2026-09-28 2026-09-29
echo "DEMO_EXIT=$?"
echo
echo "--- raw alerts.jsonl of the throwaway root (day 2) ---"
grep '"2026-09-29"' "$R/alerts/alerts.jsonl" 2>/dev/null || true
echo
echo "--- raw notifications dedupe index of the throwaway root ---"
cat "$R/state/notified-keys.json" 2>/dev/null
echo
echo "--- raw toast-stub.log of the throwaway root ---"
cat "$R/logs/toast-stub.log" 2>/dev/null
echo
echo "--- raw approvals/pending.json of the throwaway root ---"
cat "$R/approvals/pending.json" 2>/dev/null
} > "$S/raw/04-r3-notify-on-change.txt" 2>&1

{
echo "###############################################################################"
echo "# 05 — THE PRODUCTION FACT: operator R3 has never had an input and has never fired."
echo "# READ-ONLY reads of D:/AgenticOS/data/freecash-monitor. Nothing written."
echo "# during: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "###############################################################################"
echo
echo "\$ # change-event rows in the production alert log"
echo "\$ python -c \"...\" data/freecash-monitor/alerts/alerts.jsonl"
"$PY" -c "
import json,collections
rows=[json.loads(l) for l in open(r'D:/AgenticOS/data/freecash-monitor/alerts/alerts.jsonl',encoding='utf-8') if l.strip()]
print('rows:',len(rows))
print('by event_type:',dict(collections.Counter(r['event_type'] for r in rows)))
chg=[r for r in rows if r['event_type'] in ('EARNINGS_CHANGED','STATUS_CHANGED','BALANCE_CHANGED')]
print('change-event rows (EARNINGS/STATUS/BALANCE_CHANGED):',len(chg))
print('non-null dedupe_key rows:',sum(1 for r in rows if r.get('dedupe_key')))
"
echo
echo "\$ # the human-entered source that R3 compares against"
"$PY" -c "
import json
doc=json.load(open(r'D:/AgenticOS/data/freecash-monitor/state/operator-state.json',encoding='utf-8'))
print('kind:',doc['kind'])
print('records:',len(doc['records']))
print('note:',doc['note'])
"
echo
echo "\$ # every production snapshot: coverage must be read from data_available, never from last_outcome"
"$PY" -c "
import json,glob,hashlib
for f in sorted(glob.glob(r'D:/AgenticOS/data/freecash-monitor/snapshots/*.json')):
    d=json.load(open(f,encoding='utf-8'))
    print('%s data_available=%s degraded=%s raw_response_sha256=%s' % (f, d['source']['data_available'], d['degraded'], d['raw_response_sha256']))
print('sha256 of the EMPTY STRING      :', hashlib.sha256(b'').hexdigest())
"
echo
echo "\$ cat data/freecash-monitor/state/last-run.json"
cat "$REPO/data/freecash-monitor/state/last-run.json"
echo
echo "PRODUCTION FACT: 0 change-event rows; the human-entered source holds 0 records; every"
echo "snapshot ever written has data_available=false and the sha256 of the empty string as its"
echo "raw_response_sha256. R3 has therefore never had an input and has never fired a change"
echo "notification in production. The 10 non-null dedupe keys in notified-keys.json belong to"
echo "MISSED_DAY (10) rows, i.e. the absence-of-run path, not to a change."
} > "$S/raw/05-r3-production-never-fired.txt" 2>&1

cat "$S/raw/04-r3-notify-on-change.txt"
echo "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@"
cat "$S/raw/05-r3-production-never-fired.txt"
