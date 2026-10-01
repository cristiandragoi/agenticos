#!/usr/bin/env bash
set -u
EV="/d/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/datasource"
FC="/d/AgenticOS/monitoring/freecash"

cd "$FC" || exit 1
{
  echo "\$ env | grep -i '^FREECASH'   # ambient/inherited environment of this shell"
  env | grep -i "^FREECASH" || echo "(none)"
  echo "exit=$?"
  echo
  echo "\$ python -c \"import gate; print(gate.timezone_report())\"   # FREECASH_TZ as inherited"
  python -c "import gate; print(gate.timezone_report())"
  echo "exit=$?"
  echo
  echo "\$ FREECASH_TZ=Europe/Berlin python -c \"import gate; print(gate.timezone_report()); print('day_key=', gate.day_key())\""
  FREECASH_TZ=Europe/Berlin python -c "import gate; print(gate.timezone_report()); print('day_key=', gate.day_key())"
  echo "exit=$?"
  echo
  echo "\$ FREECASH_TZ=UTC python -c \"import gate; print(gate.timezone_report()); print('day_key=', gate.day_key())\""
  FREECASH_TZ=UTC python -c "import gate; print(gate.timezone_report()); print('day_key=', gate.day_key())"
  echo "exit=$?"
  echo
  echo "\$ python -c \"import zoneinfo, zoneinfo._common; print('tzdata module:', __import__('importlib.util', fromlist=['x']).find_spec('tzdata'))\""
  python -c "import importlib.util; print('tzdata module spec:', importlib.util.find_spec('tzdata'))"
  echo "exit=$?"
} > "$EV/evidence-19-clock-timezone-and-env.txt" 2>&1

cd /d/AgenticOS || exit 1
{
  echo "# the LEGACY/second FreeCash monitor that already exists in the repo (documented, NOT run, NOT forked)"
  echo "\$ ls -la server/scripts/freecash-daily-monitor.mjs server/scripts/verify-freecash-rules.mjs"
  ls -la server/scripts/freecash-daily-monitor.mjs server/scripts/verify-freecash-rules.mjs
  echo "exit=$?"
  echo
  echo "\$ grep -n 'STATUS_API_URL' server/scripts/freecash-daily-monitor.mjs"
  grep -n "STATUS_API_URL" server/scripts/freecash-daily-monitor.mjs
  echo "exit=$?"
  echo
  echo "\$ ls -la server/scripts/inspect_freecash_*.ts server/scripts/check_freecash_session.ts"
  ls -la server/scripts/inspect_freecash_*.ts server/scripts/check_freecash_session.ts
  echo "exit=$?"
  echo
  echo "\$ grep -n \"goto('https://freecash\\|connectOverCDP\" server/scripts/inspect_freecash_dashboard.ts"
  grep -n "goto('https://freecash\|connectOverCDP" server/scripts/inspect_freecash_dashboard.ts
  echo "exit=$?"
  echo
  echo "\$ curl -s -m 3 -o /dev/null -w 'CDP 9223 HTTP %{http_code}\\n' http://127.0.0.1:9223/json/version"
  curl -s -m 3 -o /dev/null -w "CDP 9223 HTTP %{http_code}\n" http://127.0.0.1:9223/json/version
  echo "exit=$?"
  echo
  echo "\$ find . -name storage_state.json   # managed-browser sign-in state"
  find . -name "storage_state.json" 2>/dev/null | head
  echo "exit=$?"
  echo
  echo "\$ grep -rniE 'freecash|free-cash' .env server/.env 2>/dev/null | sed -E 's/=.*/=[REDACTED]/'"
  grep -rniE "freecash|free-cash" .env server/.env 2>/dev/null | sed -E "s/=.*/=[REDACTED]/" || echo "(no .env freecash keys)"
  echo "exit=$?"
  echo
  echo "\$ sed -n '430,440p' server/src/index.ts"
  sed -n '430,440p' server/src/index.ts
  echo "exit=$?"
} > "$EV/evidence-20-legacy-monitor-and-browser-read.txt" 2>&1

echo "capture 19-20 done"
