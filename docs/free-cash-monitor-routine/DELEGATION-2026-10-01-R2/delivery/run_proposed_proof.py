"""run_proposed_proof.py -- run the STAGED (not applied) hardening in a throwaway copy.

Copies monitoring/freecash to %LOCALAPPDATA%/Temp/fc-r2-proposed-pkg, drops the
staged notify.py / run_daily_check.py over the copies, and re-runs the exact
multi-day catch-up scenario.  monitoring/freecash is only read.
"""

import os
import shutil
import sys
from datetime import datetime, timezone

SCRATCH = os.path.join(os.environ["LOCALAPPDATA"], "Temp", "fc-r2-proof")
PKG = os.path.join(os.environ["LOCALAPPDATA"], "Temp", "fc-r2-proposed-pkg")
SRC = "D:/AgenticOS/monitoring/freecash"
PROPOSED = os.path.join(os.environ["LOCALAPPDATA"], "Temp", "fc-r2-proposed")

shutil.rmtree(PKG, ignore_errors=True)
shutil.rmtree(SCRATCH, ignore_errors=True)
shutil.copytree(SRC, PKG, ignore=shutil.ignore_patterns("__pycache__"))
for name in ("notify.py", "run_daily_check.py"):
    shutil.copy(os.path.join(PROPOSED, name), os.path.join(PKG, name))
print("proposed package built at %s (copies only; monitoring/ untouched)" % PKG)

os.environ["FREECASH_DATA_ROOT"] = SCRATCH
os.environ["FREECASH_TOAST_STUB"] = "1"
os.environ["FREECASH_TZ"] = "UTC"
sys.path.insert(0, PKG)

import paths  # noqa: E402
import notify  # noqa: E402
import gate  # noqa: E402
import run_daily_check  # noqa: E402

print("notify loaded from:         %s" % notify.__file__)
print("run_daily_check loaded from: %s" % run_daily_check.__file__)
assert notify.__file__.startswith(PKG) and run_daily_check.__file__.startswith(PKG)

paths.ensure_layout()
gate.save_ledger({
    "schema_version": 1, "last_attempt_day": "2026-09-19", "last_success_day": "2026-09-19",
    "last_attempt_at_utc": "2026-09-19T12:00:00Z", "last_success_at_utc": "2026-09-19T12:00:00Z",
    "last_outcome": "INITIAL_BASELINE", "consecutive_missed_days": 0, "timezone": "UTC",
    "updated_at_utc": None,
})
import operator_state  # noqa: E402
doc = operator_state.template_document()
doc["records"].append({"day_key": "2026-09-30", "entered_at_utc": "2026-09-30T12:00:00Z",
                       "account_status": "ACTIVE", "earnings_total_cents": 1500,
                       "balance_cents": 1000, "pending_cents": 0, "currency": "USD"})
paths.write_json_atomic(paths.operator_state_path(), doc)

missed = gate.missed_days("2026-09-30", gate.load_ledger())
print("\nmissed days (%d): %s" % (len(missed), missed))
rc = run_daily_check.run(argv=[], now=datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc))
print("exit_code=%s" % rc)

stub = paths.logs_dir() / "toast-stub.log"
lines = stub.read_text().splitlines() if stub.exists() else []
print("\nDISPATCHES SENT TO THE SINK: %d   (was 10 before the change)" % len(lines))
for l in lines:
    print("---")
    print(l.replace(" | ", "\n"))

recs = paths.read_jsonl(paths.alerts_path())
print("\nalerts.jsonl lines written: %d" % len(recs))
print("every line now carries a writer object:")
for r in recs:
    print("  %-20s writer=%s" % (r.get("event_type"), r.get("writer")))
print("\nMISSED_DAY log lines still one-per-day: %d"
      % len([r for r in recs if r.get("event_type") == "MISSED_DAY"]))
print("coalesced summary dispatched once: %s"
      % any("MISSED DAYS" in l for l in lines))
