#!/usr/bin/env bash
set -u
EV="/d/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/datasource"
FC="/d/AgenticOS/monitoring/freecash"
TMP="C:/Users/cd-pr/AppData/Local/Temp"

# ---------- 16 production root inspection (READ ONLY) + adapter usage ----------
cd /d/AgenticOS || exit 1
{
  echo "\$ ls -la data/freecash-monitor/state/day-locks/"
  ls -la data/freecash-monitor/state/day-locks/
  echo "exit=$?"
  echo
  echo "\$ cat data/freecash-monitor/state/last-run.json"
  cat data/freecash-monitor/state/last-run.json
  echo "exit=$?"
  echo
  echo "\$ cat data/freecash-monitor/state/operator-state.json"
  cat data/freecash-monitor/state/operator-state.json
  echo "exit=$?"
  echo
  echo "\$ cat data/freecash-monitor/snapshots/2026-10-01.json"
  cat data/freecash-monitor/snapshots/2026-10-01.json
  echo "exit=$?"
  echo
  echo "\$ ls -la data/freecash-monitor/snapshots data/freecash-monitor/alerts data/freecash-monitor/approvals"
  ls -la data/freecash-monitor/snapshots data/freecash-monitor/alerts data/freecash-monitor/approvals
  echo "exit=$?"
  echo
  echo "\$ wc -c data/freecash-monitor/snapshots/*.json"
  wc -c data/freecash-monitor/snapshots/*.json
  echo "exit=$?"
  echo
  echo "# NOTE: no routine command is run against the production root in this pass (R2 hermeticity)."
} > "$EV/evidence-16-production-root-readonly.txt" 2>&1

# ---------- 17 adapter usage: is the in-app FreeCash monitor exposed on any HTTP route? ----------
{
  echo "\$ grep -rn 'freeCashMonitorAdapter' server/src --include=*.ts | grep -v __tests__"
  grep -rn "freeCashMonitorAdapter" server/src --include=*.ts | grep -v __tests__
  echo "exit=$?"
  echo
  echo "\$ grep -rn 'fetchStatus' server/src --include=*.ts | grep -v __tests__"
  grep -rn "fetchStatus" server/src --include=*.ts | grep -v __tests__
  echo "exit=$?"
  echo
  echo "\$ grep -rn 'externalConnected' server/src --include=*.ts | grep -v __tests__"
  grep -rn "externalConnected" server/src --include=*.ts | grep -v __tests__
  echo "exit=$?"
  echo
  echo "\$ grep -rnE \"(router|app)\\.(get|post)\\(\" server/src/index.ts server/src/routers/*.ts | wc -l"
  grep -rnE "(router|app)\.(get|post)\(" server/src/index.ts server/src/routers/*.ts | wc -l
  echo "exit=$?"
  echo
  echo "\$ grep -rniE \"(router|app)\\.(get|post)\\(.*(freecash|free-cash|balance|earnings|account.?status)\" server/src/index.ts server/src/routers/*.ts"
  grep -rniE "(router|app)\.(get|post)\(.*(freecash|free-cash|balance|earnings|account.?status)" server/src/index.ts server/src/routers/*.ts
  echo "exit=$?"
} > "$EV/evidence-17-adapter-route-exposure.txt" 2>&1

# ---------- 18 units + status-vocabulary semantics (normalize_metrics, no socket) ----------
cd "$FC" || exit 1
{
  echo "\$ python -c \"import changedetect as cd; print(cd.normalize_metrics({...}))\""
  python - <<'PY'
import changedetect as cd
cases = [
    ("cents fields",       {"account_status": "operativa", "earnings_total_cents": 1340, "balance_cents": 1340, "pending_cents": 0, "currency": "usd"}),
    ("whole-currency",     {"status": "Operativa", "earnings": 13.40, "balance": 13.40, "pending": 0, "currency_code": "ARS"}),
    ("cents-but-euros",    {"account_status": "Operativa", "earnings_total_cents": 13.40, "balance_cents": 13.40, "pending_cents": 0}),
    ("missing field",      {"account_status": "Operativa", "balance_cents": 1340}),
    ("bool rejected",      {"account_status": "Operativa", "earnings_total_cents": True, "balance_cents": 1340, "pending_cents": 0}),
]
for label, payload in cases:
    try:
        print("%-18s -> %s" % (label, cd.normalize_metrics(payload)))
    except Exception as exc:
        print("%-18s -> %s: %s" % (label, type(exc).__name__, exc))
PY
  echo "exit=$?"
  echo
  echo "\$ # status casing is an exact-string comparison on the operator_state path (no normalization)"
  python - <<'PY'
import changedetect as cd
prior   = {"day_key": "2026-10-01", "source": {"data_available": True}, "currency": "USD",
           "account_status": "Operativa", "earnings_total_cents": 1340, "balance_cents": 1340, "pending_cents": 0}
current = dict(prior, day_key="2026-10-02", account_status="OPERATIVA")
print("prior=Operativa current=OPERATIVA ->", cd.compare(prior, current)["changes"])
current2 = dict(prior, day_key="2026-10-02", account_status="Bloqueada")
print("prior=Operativa current=Bloqueada ->", cd.compare(prior, current2)["changes"])
PY
  echo "exit=$?"
} > "$EV/evidence-18-units-and-status-vocab.txt" 2>&1

echo "capture 16-18 done"
