"""drive_r3_counts.py -- per-phase DISPATCH COUNTS (supplement to drive_r3.py).

Distinguishes a log line from a notification: the sink (stub log) only receives a
line when dispatch()/notify_change() actually notifies.
"""

import json
import os
import shutil
import sys
from datetime import datetime, timezone

SCRATCH = os.environ["FREECASH_DATA_ROOT"]
sys.path.insert(0, "D:/AgenticOS/monitoring/freecash")
import paths  # noqa: E402
import notify  # noqa: E402
import changedetect  # noqa: E402
import gate  # noqa: E402
import run_daily_check  # noqa: E402

os.environ["FREECASH_DATA_ROOT"] = os.path.join(SCRATCH, "counts")
shutil.rmtree(os.path.join(SCRATCH, "counts"), ignore_errors=True)
paths.ensure_layout()


def utc(d, h=12):
    y, m, dd = (int(x) for x in d.split("-"))
    return datetime(y, m, dd, h, 0, 0, tzinfo=timezone.utc)


def stub_count():
    p = paths.logs_dir() / "toast-stub.log"
    return len(p.read_text().splitlines()) if p.exists() else 0


def alert_count():
    return len(paths.read_jsonl(paths.alerts_path()))


def write_record(day, status, earnings, balance, pending):
    import operator_state
    doc = paths.read_json(paths.operator_state_path(), default=None)
    if not isinstance(doc, dict):
        doc = operator_state.template_document()
    doc.setdefault("records", [])
    doc["records"] = [r for r in doc["records"] if r.get("day_key") != day]
    doc["records"].append({"day_key": day, "entered_at_utc": "2026-09-19T06:00:00Z",
                           "account_status": status, "earnings_total_cents": earnings,
                           "balance_cents": balance, "pending_cents": pending, "currency": "USD"})
    paths.write_json_atomic(paths.operator_state_path(), doc)


print("%-6s %-30s %12s %12s %12s %s" % ("DAY", "SCENARIO", "NEW_ALERTS", "NEW_DISPATCH", "CHANGES", "OUTCOME"))
plan = [
    ("2026-09-19", "first run (no prior)", "ACTIVE", 1000, 1000, 0),
    ("2026-09-20", "identical reading", "ACTIVE", 1000, 1000, 0),
    ("2026-09-21", "earnings 1000->1500", "ACTIVE", 1500, 1000, 0),
    ("2026-09-22", "status ACTIVE->REVIEW", "REVIEW_REQUIRED", 1500, 1000, 0),
    ("2026-09-23", "identical again", "REVIEW_REQUIRED", 1500, 1000, 0),
]
for day, label, status, earnings, balance, pending in plan:
    write_record(day, status, earnings, balance, pending)
    a0, s0 = alert_count(), stub_count()
    rc = run_daily_check.run(argv=[], now=utc(day))
    recs = paths.read_jsonl(paths.alerts_path())
    outcome = recs[-1].get("event_type") if recs else "-"
    print("%-6s %-30s %12d %12d %12s %s"
          % (day, label, alert_count() - a0, stub_count() - s0, "", outcome))

print()
print("RE-RUN 2026-09-22 (R1 gate):")
a0, s0 = alert_count(), stub_count()
rc = run_daily_check.run(argv=[], now=utc("2026-09-22"))
print("  new alerts=%d  new dispatches=%d  printed=%s"
      % (alert_count() - a0, stub_count() - s0, ""))
recs = paths.read_jsonl(paths.alerts_path())
print("  last event_type=%s" % recs[-1].get("event_type"))

print()
print("RE-DISPATCH the SAME change object twice more (dedupe gate, fresh key):")
fresh_day = "2026-09-24"
key = changedetect.dedupe_key(fresh_day, "EARNINGS_CHANGED", "earnings_total_cents", 1500, 1700)
ch = {"change_type": "EARNINGS_CHANGED", "field": "earnings_total_cents",
      "old_value": 1500, "new_value": 1700, "prior_day_key": "2026-09-23"}
snap = changedetect.load_snapshot("2026-09-23")
src = {"kind": "operator_entered", "note": "operator-entered record for 2026-09-24"}
for i in (1, 2, 3):
    s0 = stub_count()
    res = run_daily_check.dispatch_change(fresh_day, ch, snap, snap, src, None, 0,
                                          now=utc(fresh_day), enqueue=False)
    print("  attempt %d -> %-9s new dispatches=%d" % (i, res, stub_count() - s0))
print("  total stub lines for this key: %d" % len(
    [l for l in (paths.logs_dir() / "toast-stub.log").read_text().splitlines() if "EARNINGS CHANGE 2026-09-24" in l]))
print("  notified-keys entry: %s" % json.dumps(notify.load_notified_keys()["keys"].get(key)))
