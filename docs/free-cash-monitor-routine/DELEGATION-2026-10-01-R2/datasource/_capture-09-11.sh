#!/usr/bin/env bash
set -u
EV="/d/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/datasource"
FC="/d/AgenticOS/monitoring/freecash"
TMP="C:/Users/cd-pr/AppData/Local/Temp"

# ---------- 09 metrics_http attempt (reachability of a local read source) ----------
export FREECASH_DATA_ROOT="$TMP/fc-r2-metrics"
rm -rf "$FREECASH_DATA_ROOT"
cd "$FC" || exit 1
{
  echo "\$ export FREECASH_DATA_ROOT=$TMP/fc-r2-metrics"
  echo "\$ cd D:/AgenticOS/monitoring/freecash && FREECASH_TOAST_STUB=1 python run_daily_check.py --source metrics_http --base-url http://localhost:4600"
  FREECASH_TOAST_STUB=1 python run_daily_check.py --source metrics_http --base-url http://localhost:4600
  echo "exit=$?"
  echo
  echo "\$ cat snapshots/2026-10-01.json   # written BEFORE the read? no: RUN_FAILED returns before snapshot"
  ls -la "$FREECASH_DATA_ROOT/snapshots" 2>&1
  echo "exit=$?"
  echo
  echo "\$ cat alerts/alerts.jsonl"
  cat "$FREECASH_DATA_ROOT/alerts/alerts.jsonl"
  echo "exit=$?"
  echo
  echo "\$ cat state/last-run.json"
  cat "$FREECASH_DATA_ROOT/state/last-run.json"
  echo "exit=$?"
} > "$EV/evidence-09-run-metrics-http-4600.txt" 2>&1

export FREECASH_DATA_ROOT="$TMP/fc-r2-metrics-3001"
rm -rf "$FREECASH_DATA_ROOT"
{
  echo "\$ export FREECASH_DATA_ROOT=$TMP/fc-r2-metrics-3001"
  echo "\$ cd D:/AgenticOS/monitoring/freecash && FREECASH_TOAST_STUB=1 python run_daily_check.py --source metrics_http"
  echo "  # no --base-url => readonly_client.DEFAULT_BASE_URL = http://localhost:3001"
  FREECASH_TOAST_STUB=1 python run_daily_check.py --source metrics_http
  echo "exit=$?"
  echo
  echo "\$ cat alerts/alerts.jsonl"
  cat "$FREECASH_DATA_ROOT/alerts/alerts.jsonl"
  echo "exit=$?"
} > "$EV/evidence-09b-run-metrics-http-default-3001.txt" 2>&1

# ---------- 10 R2 allowlist positive proof (non-allowlisted host/path refused) ----------
cd "$FC" || exit 1
{
  echo "\$ cd D:/AgenticOS/monitoring/freecash && python -c \"import readonly_client as rc; ...\""
  python - <<'PY'
import readonly_client as rc, traceback
for label, method, url in (
    ("provider host", "GET", "https://hg.cash/api/v1/accounts"),
    ("provider path on loopback", "GET", "http://localhost:4600/api/v1/accounts"),
    ("write verb", "POST", "http://localhost:4600/api/v1/status/metrics"),
):
    try:
        rc.request(method, url)
        print("%-28s %-4s %-45s -> NO EXCEPTION (allowed!)" % (label, method, url))
    except Exception as exc:
        print("%-28s %-4s %-45s -> %s: %s" % (label, method, url, type(exc).__name__, exc))
PY
  echo "exit=$?"
  echo
  echo "\$ grep -n ALLOWED_HOSTS\\|ALLOWED_PATHS\\|PROVIDER_ENDPOINT_UNKNOWN monitoring/freecash/readonly_client.py"
  grep -n "ALLOWED_HOSTS\|ALLOWED_PATHS\|PROVIDER_ENDPOINT_UNKNOWN" readonly_client.py
  echo "exit=$?"
} > "$EV/evidence-10-r2-allowlist-proof.txt" 2>&1

# ---------- 11 AgenticOS :4600 route inventory ----------
cd /d/AgenticOS || exit 1
{
  echo "\$ curl -s -m 5 -o /dev/null -w '%{http_code}\\n' http://localhost:4600/api/health"
  curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://localhost:4600/api/health
  echo "exit=$?"
  echo
  echo "\$ curl -s -m 5 http://localhost:4600/api/health"
  curl -s -m 5 http://localhost:4600/api/health
  echo; echo "exit=$?"
  echo
  echo "\$ for p in /api/v1/status/metrics /api/v1/status /api/freecash/status /api/freecash/monitor; do curl -s -m 4 -o /dev/null -w \"\$p %{http_code}\\n\" http://localhost:4600\$p; done"
  for p in /api/v1/status/metrics /api/v1/status /api/freecash/status /api/freecash/monitor; do curl -s -m 4 -o /dev/null -w "$p %{http_code}\n" "http://localhost:4600$p"; done
  echo "exit=$?"
  echo
  echo "\$ curl -s -m 3 -o /dev/null -w 'localhost:3001 %{http_code}\\n' http://localhost:3001/api/v1/status"
  curl -s -m 3 -o /dev/null -w "localhost:3001 %{http_code}\n" http://localhost:3001/api/v1/status
  echo "exit=$?"
  echo
  echo "\$ netstat -ano | grep LISTENING | grep -E ':(3001|4600)'"
  netstat -ano | grep LISTENING | grep -E ":(3001|4600)" || echo "(no match)"
  echo "exit=$?"
  echo
  echo "\$ grep -rniE \"\\.(get|post|put)\\(['\\\"]/api\" server/src/index.ts | wc -l"
  grep -rniE "\.(get|post|put)\(['\"]/api" server/src/index.ts | wc -l
  echo "exit=$?"
  echo
  echo "\$ grep -rniE \"(balance|earnings|payout|account_?status)\" server/src/index.ts | head -20"
  grep -rniE "(balance|earnings|payout|account_?status)" server/src/index.ts | head -20
  echo "exit=$?"
  echo
  echo "\$ grep -rniE \"freecash|free-cash|free_cash\" server/src/index.ts"
  grep -rniE "freecash|free-cash|free_cash" server/src/index.ts
  echo "exit=$?"
  echo
  echo "\$ grep -rn 'freecashMonitorAdapter\\|freeCashAdapter' server/src --include=*.ts | grep -v __tests__"
  grep -rn "freecashMonitorAdapter\|freeCashAdapter" server/src --include=*.ts | grep -v __tests__
  echo "exit=$?"
  echo
  echo "\$ grep -rniE '(router|app)\\.get\\(.*(balance|earnings)' server/src --include=*.ts | grep -v __tests__"
  grep -rniE "(router|app)\.get\(.*(balance|earnings)" server/src --include=*.ts | grep -v __tests__
  echo "exit=$?"
} > "$EV/evidence-11-agenticos-4600-routes.txt" 2>&1

echo "capture 09-11 done"
