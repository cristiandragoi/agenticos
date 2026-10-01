"""drive_trace.py -- item 2: prove the prior snapshot is loaded BEFORE today's is written.

Monkeypatches ONLY the two function objects in the changedetect namespace that
run_daily_check looks up at call time, records the order, and lets the real
implementation run.  Nothing in monitoring/ is modified.
"""

import json
import os
import sys
import traceback
from datetime import datetime, timezone

SCRATCH = os.environ["FREECASH_DATA_ROOT"]
sys.path.insert(0, "D:/AgenticOS/monitoring/freecash")

import paths  # noqa: E402
import changedetect  # noqa: E402
import gate  # noqa: E402
import run_daily_check  # noqa: E402


def utc(y, m, d, h=12):
    return datetime(y, m, d, h, 0, 0, tzinfo=timezone.utc)


def banner(t):
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)


os.environ["FREECASH_DATA_ROOT"] = os.path.join(SCRATCH, "trace")
paths.ensure_layout()

CALLS = []

_orig_load = changedetect.load_prior_snapshot
_orig_save = changedetect.save_snapshot


def traced_load(day):
    result = _orig_load(day)
    CALLS.append(("load_prior_snapshot", day, (result or {}).get("day_key")))
    return result


def traced_save(snapshot, now=None):
    path, written = _orig_save(snapshot, now=now)
    CALLS.append(("save_snapshot", snapshot.get("day_key"), "written=%s" % written))
    return path, written


changedetect.load_prior_snapshot = traced_load
changedetect.save_snapshot = traced_save


def write_record(day, status, earnings, balance, pending, currency="USD"):
    doc = paths.read_json(paths.operator_state_path(), default=None)
    import operator_state
    if not isinstance(doc, dict):
        doc = operator_state.template_document()
    doc.setdefault("records", [])
    doc["records"] = [r for r in doc["records"] if r.get("day_key") != day]
    doc["records"].append({
        "day_key": day, "entered_at_utc": "2026-09-24T07:00:00Z", "account_status": status,
        "earnings_total_cents": earnings, "balance_cents": balance,
        "pending_cents": pending, "currency": currency,
    })
    paths.write_json_atomic(paths.operator_state_path(), doc)


banner("ORDER PROOF -- day 1 (2026-09-24) on an empty root: no prior exists")
write_record("2026-09-24", "ACTIVE", 500, 500, 0)
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 24))
print("exit_code=%s" % rc)
print("recorded call order: %s" % json.dumps(CALLS, indent=2))
order = [c[0] for c in CALLS]
print("load_prior_snapshot called before save_snapshot? %s" % (order.index("load_prior_snapshot") < order.index("save_snapshot")))

banner("ORDER PROOF -- day 2 (2026-09-25) with a change present")
CALLS.clear()
write_record("2026-09-25", "ACTIVE", 900, 500, 0)
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 25))
print("exit_code=%s" % rc)
print("recorded call order: %s" % json.dumps(CALLS, indent=2))
print("prior snapshot the compare used: %s" % CALLS[0][2])

banner("SELF-COMPARISON IMPOSSIBLE -- load_prior_snapshot never returns today")
print("snapshots on disk before the probe: %s" %
      sorted(p.name for p in paths.snapshots_dir().glob("*.json")))
probe = changedetect.load_prior_snapshot("2026-09-25")
print("changedetect.load_prior_snapshot('2026-09-25') -> day_key=%s" % (probe or {}).get("day_key"))
today_snap = changedetect.load_snapshot("2026-09-25")
print("changedetect.load_snapshot('2026-09-25')     -> day_key=%s earnings=%s"
      % (today_snap.get("day_key"), today_snap.get("earnings_total_cents")))
print("-> the loader skips every key >= day (changedetect.py lines 202-208), so today's own "
      "figures can never be the comparison baseline.")

banner("FIRST DAY AFTER A GAP -- prior is stale, does R3 still fire?")
print("snapshots on disk: %s" % sorted(p.name for p in paths.snapshots_dir().glob("*.json")))
print("ledger: %s" % json.dumps(gate.load_ledger(), sort_keys=True))
print("gate.missed_days('2026-09-30', ledger) = %s" % gate.missed_days("2026-09-30", gate.load_ledger()))
CALLS.clear()
write_record("2026-09-30", "ACTIVE", 100, 500, 0)   # a LARGE drop across a 5-day gap
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 30))
print("exit_code=%s" % rc)
print("recorded call order: %s" % json.dumps(CALLS, indent=2))
recs = paths.read_jsonl(paths.alerts_path())
print("alert lines produced on the return day:")
for r in recs:
    if r.get("day_key") == "2026-09-30" and r.get("event_type") in ("EARNINGS_CHANGED", "BALANCE_CHANGED", "STATUS_CHANGED", "OK_NO_CHANGE", "INITIAL_BASELINE"):
        print("  %s dedupe16=%s observed=%s" % (r.get("event_type"), (r.get("dedupe_key") or "")[:16],
                                                json.dumps(r.get("observed"), sort_keys=True)))

banner("SECOND-DAY-AFTER-GAP WITH NO PRIOR SNAPSHOT AT ALL (fresh root) -- baseline must be silent")
os.environ["FREECASH_DATA_ROOT"] = os.path.join(SCRATCH, "trace-fresh")
paths.ensure_layout()
CALLS.clear()
write_record("2026-10-05", "ACTIVE", 4242, 4242, 0)
rc = run_daily_check.run(argv=[], now=utc(2026, 10, 5))
print("exit_code=%s" % rc)
print("recorded call order: %s" % json.dumps(CALLS, indent=2))
for r in paths.read_jsonl(paths.alerts_path()):
    print("  %s severity=%s msg=%r" % (r.get("event_type"), r.get("severity"),
                                       (r.get("message") or "").splitlines()[0][:80]))
print("notifications dispatched (stub log lines): %d" % (
    len((paths.logs_dir() / "toast-stub.log").read_text().splitlines())
    if (paths.logs_dir() / "toast-stub.log").exists() else 0))
