"""drive_r3.py -- R3 (notify on change) driven through the REAL routine code.

Runs entirely inside FREECASH_DATA_ROOT from the environment.  Never touches
D:/AgenticOS/data/freecash-monitor (asserted below).

Every phase calls run_daily_check.run(..., now=<pinned UTC instant>), i.e. the
production entry point with its own test clock seam.  Nothing is re-implemented.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

SCRATCH = os.environ["FREECASH_DATA_ROOT"]
PROD = "D:/AgenticOS/data/freecash-monitor"
assert os.path.abspath(SCRATCH).replace("\\", "/").lower() != PROD.lower(), "refusing prod root"

sys.path.insert(0, "D:/AgenticOS/monitoring/freecash")

import paths  # noqa: E402
import notify  # noqa: E402
import changedetect  # noqa: E402
import gate  # noqa: E402
import run_daily_check  # noqa: E402

assert str(paths.data_root()).replace("\\", "/").lower().startswith(
    os.path.abspath(SCRATCH).replace("\\", "/").lower()
), "paths.data_root() is not the scratch root: %s" % paths.data_root()


def utc(y, m, d, h=12):
    return datetime(y, m, d, h, 0, 0, tzinfo=timezone.utc)


def banner(title):
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def sub(name):
    os.environ["FREECASH_DATA_ROOT"] = os.path.join(SCRATCH, name)


def write_record(day, status, earnings, balance, pending, currency="USD"):
    """Append one operator-entered record (source B) for *day*."""
    paths.ensure_layout()
    doc = paths.read_json(paths.operator_state_path(), default=None)
    if not isinstance(doc, dict):
        import operator_state
        doc = operator_state.template_document()
    doc.setdefault("records", [])
    doc["records"] = [r for r in doc["records"] if r.get("day_key") != day]
    doc["records"].append({
        "day_key": day,
        "entered_at_utc": paths.iso_utc(utc(*[int(x) for x in day.split("-")])),
        "account_status": status,
        "earnings_total_cents": earnings,
        "balance_cents": balance,
        "pending_cents": pending,
        "currency": currency,
    })
    paths.write_json_atomic(paths.operator_state_path(), doc)


def dump_alerts(label):
    recs = paths.read_jsonl(paths.alerts_path())
    print("\n--- %s: alerts.jsonl has %d line(s) ---" % (label, len(recs)))
    for r in recs:
        print(json.dumps({
            "ts_utc": r.get("ts_utc"),
            "event_type": r.get("event_type"),
            "severity": r.get("severity"),
            "dedupe_key": (r.get("dedupe_key") or "")[:16],
            "message": (r.get("message") or "").splitlines()[0][:90],
        }, sort_keys=True))
    return recs


def notif_lines(dedupe_key16):
    """Alert lines whose dedupe_key starts with the given prefix."""
    return [r for r in paths.read_jsonl(paths.alerts_path())
            if (r.get("dedupe_key") or "").startswith(dedupe_key16)]


# =============================================================== PHASE A/B/C
sub("run1")
for name in ("run1", "run2"):
    p = os.path.join(SCRATCH, name)
    if os.path.isdir(p):
        import shutil
        shutil.rmtree(p)
sub("run1")
paths.ensure_layout()

banner("PHASE 1 -- day 2026-09-19, first ever run (no prior snapshot)")
write_record("2026-09-19", "ACTIVE", 1000, 1000, 0)
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 19))
print("exit_code=%s" % rc)
dump_alerts("after 2026-09-19")

banner("PHASE 2 -- day 2026-09-20, IDENTICAL reading (expect NO notification)")
write_record("2026-09-20", "ACTIVE", 1000, 1000, 0)
before = len(paths.read_jsonl(paths.alerts_path()))
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 20))
print("exit_code=%s" % rc)
recs = dump_alerts("after 2026-09-20")
new = recs[before:]
print("\nNEW lines added this run: %d" % len(new))
print("NEW event_types: %s" % [r.get("event_type") for r in new])
print("NEW severities:  %s" % [r.get("severity") for r in new])
print("toast dispatched this run? sends to stub log:")
stub = paths.logs_dir() / "toast-stub.log"
print("  toast-stub.log exists=%s content=%r" % (stub.exists(), stub.read_text() if stub.exists() else ""))

banner("PHASE 3 -- day 2026-09-21, EARNINGS changed 1000 -> 1500 (expect exactly ONE notify)")
write_record("2026-09-21", "ACTIVE", 1500, 1000, 0)
before = len(paths.read_jsonl(paths.alerts_path()))
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 21))
print("exit_code=%s" % rc)
recs = dump_alerts("after 2026-09-21")
new = recs[before:]
print("\nNEW lines added this run: %d" % len(new))
for r in new:
    print("  event_type=%s severity=%s dedupe16=%s" % (
        r.get("event_type"), r.get("severity"), (r.get("dedupe_key") or "")[:16]))
key21 = changedetect.dedupe_key("2026-09-21", "EARNINGS_CHANGED", "earnings_total_cents", 1000, 1500)
print("\nreconstructed dedupe_key(2026-09-21,EARNINGS_CHANGED,earnings_total_cents,1000,1500) = %s" % key21)
print("matching alert lines: %d" % len(notif_lines(key21[:16])))
print("\nFULL PAYLOAD of the notification that was dispatched (from toast-stub.log):")
stub = paths.logs_dir() / "toast-stub.log"
print(stub.read_text() if stub.exists() else "(no stub log)")
print("\napproval queue after this run:")
print(paths.read_json(paths.pending_path(), default="(absent)"))

banner("PHASE 4 -- day 2026-09-22, ACCOUNT STATUS changed ACTIVE -> REVIEW_REQUIRED")
write_record("2026-09-22", "REVIEW_REQUIRED", 1500, 1000, 0)
before = len(paths.read_jsonl(paths.alerts_path()))
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 22))
print("exit_code=%s" % rc)
recs = dump_alerts("after 2026-09-22")
new = recs[before:]
print("\nNEW lines added this run: %d" % len(new))
for r in new:
    print("  event_type=%s severity=%s dedupe16=%s" % (
        r.get("event_type"), r.get("severity"), (r.get("dedupe_key") or "")[:16]))
key22 = changedetect.dedupe_key("2026-09-22", "STATUS_CHANGED", "account_status", "ACTIVE", "REVIEW_REQUIRED")
print("\nreconstructed dedupe_key(2026-09-22,STATUS_CHANGED,account_status,ACTIVE,REVIEW_REQUIRED) = %s" % key22)
print("matching alert lines: %d" % len(notif_lines(key22[:16])))

banner("PHASE 5 -- RE-RUN the same day (R1 gate) and RE-DISPATCH the same change (dedupe gate)")
print("5a. re-run run_daily_check for 2026-09-21 (a second status read on a consumed day):")
dump_before = len(paths.read_jsonl(paths.alerts_path()))
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 21))
print("exit_code=%s" % rc)
dump_alerts("after re-run of 2026-09-21")
print("notifications dispatched by the re-run: %d (no stub lines added)" % (
    len(paths.read_jsonl(paths.alerts_path())) - dump_before))

print("\n5b. call the REAL dispatch path twice with the SAME change object + SAME dedupe key:")
prev = changedetect.load_snapshot("2026-09-22")
cur = changedetect.load_snapshot("2026-09-21")
change = {
    "change_type": "EARNINGS_CHANGED",
    "field": "earnings_total_cents",
    "old_value": 1000,
    "new_value": 1500,
    "prior_day_key": "2026-09-20",
}
source = {"kind": "operator_entered", "note": "operator-entered record for 2026-09-21"}
import approval_queue  # noqa: E402
sig = run_daily_check.dispatch_change.__doc__
for attempt in (1, 2, 3):
    result = run_daily_check.dispatch_change(
        "2026-09-21", change, cur, prev, source, None, 0, now=utc(2026, 9, 21), enqueue=False)
    print("  attempt %d -> %s" % (attempt, result))
print("\nnotified-keys.json entry for that key:")
doc = notify.load_notified_keys()
print(json.dumps(doc["keys"].get(key21), indent=2, sort_keys=True))
print("total alert lines carrying that dedupe_key: %d" % len(notif_lines(key21[:16])))

print("\n5c. FRESH key, never dispatched -- the NOTIFIED -> DEDUPED transition on one key:")
fresh_day = "2026-09-23"
fresh_key = changedetect.dedupe_key(fresh_day, "BALANCE_CHANGED", "balance_cents", 1000, 800)
fresh_change = {"change_type": "BALANCE_CHANGED", "field": "balance_cents",
                "old_value": 1000, "new_value": 800, "prior_day_key": "2026-09-22"}
snap23 = changedetect.load_snapshot("2026-09-22")
prior23 = changedetect.load_snapshot("2026-09-21")
src23 = {"kind": "operator_entered", "note": "operator-entered record for 2026-09-23"}
t0 = time.perf_counter()
for attempt in (1, 2, 3):
    result = run_daily_check.dispatch_change(
        fresh_day, fresh_change, snap23, prior23, src23, None, 0, now=utc(2026, 9, 23), enqueue=False)
    print("  attempt %d -> %s   (dedupe_key=%s)" % (attempt, result, fresh_key[:16]))
print("  dispatches actually sent to the sink (stub lines added): %d"
      % len([l for l in (paths.logs_dir() / "toast-stub.log").read_text().splitlines()
             if fresh_key[:16] in l or "BALANCE CHANGE" in l]))
print("  dedupe index delivery label: %s" % json.dumps(notify.load_notified_keys()["keys"].get(fresh_key)))
print("  -> one notification for the change, all later attempts of the SAME key are log-only.")

# =============================================================== PHASE D
banner("PHASE D -- multi-day catch-up: last success 2026-09-19, next run 2026-09-30")
sub("run2")
paths.ensure_layout()
import shutil  # noqa: E402
# seed a prior snapshot at 2026-09-19 so the compare is real (not a baseline)
shutil.copy(os.path.join(SCRATCH, "run1", "snapshots", "2026-09-19.json"),
            paths.snapshots_dir() / "2026-09-19.json")
gate.save_ledger({
    "schema_version": 1, "last_attempt_day": "2026-09-19", "last_success_day": "2026-09-19",
    "last_attempt_at_utc": paths.iso_utc(utc(2026, 9, 19)), "last_success_at_utc": paths.iso_utc(utc(2026, 9, 19)),
    "last_outcome": "INITIAL_BASELINE", "consecutive_missed_days": 0, "timezone": "UTC",
    "updated_at_utc": None,
})
ledger = gate.load_ledger()
missed = gate.missed_days("2026-09-30", ledger)
print("ledger.last_success_day = %s" % ledger.get("last_success_day"))
print("gate.missed_days('2026-09-30', ledger) = %s" % missed)
print("count = %d" % len(missed))

write_record("2026-09-30", "ACTIVE", 1500, 1000, 0)
t0 = time.perf_counter()
rc = run_daily_check.run(argv=[], now=utc(2026, 9, 30))
elapsed = time.perf_counter() - t0
print("\nexit_code=%s  wall_clock_seconds=%.3f (STUB sender, no toast)" % (rc, elapsed))
recs = dump_alerts("after 2026-09-30 catch-up")
missed_lines = [r for r in recs if r.get("event_type") == "MISSED_DAY"]
print("\nMISSED_DAY alerts produced: %d" % len(missed_lines))
for r in missed_lines:
    print("  %s ts=%s severity=%s first_msg=%r" % (
        r.get("day_key"), r.get("ts_utc"), r.get("severity"),
        (r.get("message") or "").splitlines()[0]))
print("\nstub delivery lines written: %d" % len(
    (paths.logs_dir() / "toast-stub.log").read_text().splitlines()
    if (paths.logs_dir() / "toast-stub.log").exists() else []))
print("Is there ONE coalesced summary? searching for a summary/coalesce line:")
print([r.get("event_type") for r in recs if "CHANGES" in (r.get("message") or "")])
print("\nper-dispatch sleep in the MISSED_DAY loop (run_daily_check.py line 346):")
import inspect  # noqa: E402
print("  source of the missed-day loop:")
for i, line in enumerate(inspect.getsource(run_daily_check._run).splitlines(), 1):
    if "sleep_seconds=0" in line or "MISSED_DAY" in line or "notify_change" in line:
        print("    %s" % line.strip())

banner("PHASE D2 -- the catch-up REPEATS if the return-day run fails (dedupe key embeds the day)")
before_counts = {}
for r in paths.read_jsonl(paths.alerts_path()):
    if r.get("event_type") == "MISSED_DAY":
        before_counts[(r.get("message") or "").splitlines()[0]] = before_counts.get(
            (r.get("message") or "").splitlines()[0], 0) + 1
print("MISSED_DAY alert lines already on disk for run2: %d" % sum(before_counts.values()))
print("simulate the return-day run having FAILED: roll the ledger back to last_success_day=2026-09-19")
led = gate.load_ledger()
led["last_success_day"] = "2026-09-19"
led["last_attempt_day"] = "2026-09-30"
gate.save_ledger(led)
print("gate.missed_days('2026-10-01', ledger) = %s" % gate.missed_days("2026-10-01", gate.load_ledger()))
print("count = %d" % len(gate.missed_days("2026-10-01", gate.load_ledger())))
rc = run_daily_check.run(argv=[], now=utc(2026, 10, 1))
print("exit_code=%s" % rc)
recs = paths.read_jsonl(paths.alerts_path())
missed_lines = [r for r in recs if r.get("event_type") == "MISSED_DAY"]
print("MISSED_DAY alert lines now on disk: %d" % len(missed_lines))
seen = {}
for r in missed_lines:
    k = (r.get("message") or "").splitlines()[0]
    seen[k] = seen.get(k, 0) + 1
print("days alerted TWICE (same missed day, different day_key in the key):")
for k, v in sorted(seen.items()):
    if v > 1:
        print("  %-32s x%d" % (k, v))
print("distinct MISSED_DAY alerts for 2026-09-20..2026-09-29 re-emitted on 2026-10-01: %d" % sum(
    1 for k, v in seen.items() if v > 1))
print("run-failure line for 2026-10-01 present? %s" % [
    r.get("event_type") for r in recs if r.get("day_key") == "2026-10-01"])
print("\n-> every missed day is re-alerted on each subsequent day until a run SUCCEEDS, because the "
      "dedupe key is sha256(day|...|missed_day|...) and 'day' changes. This is the fatigue amplifier.")

