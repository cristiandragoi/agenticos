"""Driver: backward clock and slept-machine catch-up, driven through the REAL
entry point (run_daily_check.run) with an injected clock.

Every scenario uses its own throwaway FREECASH_DATA_ROOT. Production state is
never referenced. Read-only outside the scratch roots.
"""

import os
import sys

sys.path.insert(0, r"D:/AgenticOS/monitoring/freecash")

import paths  # noqa: E402
import gate  # noqa: E402
import run_daily_check  # noqa: E402

BASE = r"C:/Users/cd-pr/AppData/Local/Temp/fc-r2"
os.environ["FREECASH_TZ"] = "Europe/Berlin"
os.environ["FREECASH_READ_SOURCE"] = "operator_state"
os.environ["FREECASH_TOAST_STUB"] = "1"


def use(root):
    os.environ["FREECASH_DATA_ROOT"] = root
    print("  [FREECASH_DATA_ROOT=%s]" % root)


def show_state(root, label):
    lp = os.path.join(root, "state", "last-run.json")
    locks = sorted(os.listdir(os.path.join(root, "state", "day-locks"))) if os.path.isdir(os.path.join(root, "state", "day-locks")) else []
    snaps = sorted(os.listdir(os.path.join(root, "snapshots"))) if os.path.isdir(os.path.join(root, "snapshots")) else []
    alerts = 0
    ap = os.path.join(root, "alerts", "alerts.jsonl")
    if os.path.exists(ap):
        with open(ap, "r", encoding="utf-8") as fh:
            alerts = sum(1 for _ in fh)
    print("  %s: locks=%s snapshots=%s alert_lines=%d" % (label, locks, snaps, alerts))
    try:
        with open(lp, "r", encoding="utf-8") as fh:
            print("  %s: ledger=%s" % (label, fh.read().strip().replace("\n", " ")))
    except OSError:
        print("  %s: ledger=ABSENT" % label)


def run_at(root, now, argv):
    use(root)
    rc = run_daily_check.run(argv, now=now)
    print("  exit=%d" % rc)
    return rc


print("=" * 74)
print("SCENARIO C1 -- clock jumps FORWARD to a new day, then BACKWARD to the")
print("               previous (never-run) calendar day, then forward again")
print("=" * 74)
root = BASE + "/backclock"
import shutil  # noqa: E402
shutil.rmtree(root, ignore_errors=True)
os.makedirs(root, exist_ok=True)

from datetime import datetime, timedelta, timezone  # noqa: E402
BERLIN = gate.zone("Europe/Berlin")

t_d1 = datetime(2026, 10, 5, 0, 5, tzinfo=BERLIN)     # day 2026-10-05
t_back = datetime(2026, 10, 4, 23, 30, tzinfo=BERLIN)  # day 2026-10-04 (earlier, never run)
t_return = datetime(2026, 10, 5, 1, 0, tzinfo=BERLIN)  # back to 2026-10-05

print("\n-- step 1: run with clock at %s (day_key=%s) --" % (t_d1.isoformat(), gate.day_key(t_d1)))
run_at(root, t_d1, ["--source", "operator_state"])
show_state(root, "after step 1")

print("\n-- step 2: CLOCK MOVES BACKWARDS to %s (day_key=%s, an EARLIER day) --" % (t_back.isoformat(), gate.day_key(t_back)))
print("   ledger before step 2 records last_attempt_day=%s" % gate.load_ledger().get("last_attempt_day"))
run_at(root, t_back, ["--source", "operator_state"])
show_state(root, "after step 2")

print("\n-- step 3: clock returns to %s (day_key=%s) --" % (t_return.isoformat(), gate.day_key(t_return)))
run_at(root, t_return, ["--source", "operator_state"])
show_state(root, "after step 3")

print("\n-- step 4: clock jumps back AGAIN onto the ALREADY-CONSUMED day %s --" % gate.day_key(t_back))
run_at(root, t_back, ["--source", "operator_state"])
show_state(root, "after step 4")

print()
print("=" * 74)
print("SCENARIO C2 -- clock moves backwards but stays inside the SAME calendar day")
print("=" * 74)
root2 = BASE + "/backclock-sameday"
shutil.rmtree(root2, ignore_errors=True)
os.makedirs(root2, exist_ok=True)
t_noon = datetime(2026, 10, 6, 12, 0, tzinfo=BERLIN)
t_morning = datetime(2026, 10, 6, 7, 0, tzinfo=BERLIN)
print("\n-- run at %s (day_key=%s) --" % (t_noon.isoformat(), gate.day_key(t_noon)))
run_at(root2, t_noon, ["--source", "operator_state"])
print("\n-- clock jumps back to %s, same day_key=%s --" % (t_morning.isoformat(), gate.day_key(t_morning)))
run_at(root2, t_morning, ["--source", "operator_state"])
show_state(root2, "after same-day rewind")

print()
print("=" * 74)
print("SCENARIO D1 -- machine ASLEEP / OFF for a gap: next run's catch-up behaviour")
print("=" * 74)
root3 = BASE + "/asleep-gap"
shutil.rmtree(root3, ignore_errors=True)
os.makedirs(os.path.join(root3, "state"), exist_ok=True)
# Seed a ledger whose last success is 2026-09-25, i.e. the machine missed 5 days.
seed = {
    "schema_version": 1,
    "last_attempt_day": "2026-09-25",
    "last_success_day": "2026-09-25",
    "last_attempt_at_utc": "2026-09-25T07:00:00Z",
    "last_success_at_utc": "2026-09-25T07:00:00Z",
    "last_outcome": "OK_NO_CHANGE",
    "consecutive_missed_days": 0,
    "timezone": "Europe/Berlin",
    "updated_at_utc": "2026-09-25T07:00:00Z",
}
paths.write_json_atomic(os.path.join(root3, "state", "last-run.json"), seed)
print("seeded ledger: last_success_day=2026-09-25")
t_wake = datetime(2026, 10, 1, 5, 5, tzinfo=BERLIN)
print("-- first run after waking at %s (day_key=%s) --" % (t_wake.isoformat(), gate.day_key(t_wake)))
use(root3)
print("  gate.missed_days(%r, seeded_ledger) = %s" % (gate.day_key(t_wake), gate.missed_days(gate.day_key(t_wake), seed)))
run_at(root3, t_wake, ["--source", "operator_state"])
show_state(root3, "after wake run")

print("\n-- SECOND run the same day, to show the watchdog's view --")
use(root3)
import watchdog  # noqa: E402
state = watchdog.evaluate(now=t_wake)
print("  watchdog.evaluate(now=%s) = %s" % (t_wake.isoformat(), state))
print("  -> covered=%s ; a data-less MONITOR_DEGRADED run reports the day COVERED" % state["covered"])
print("\n  MISSED_DAY lines emitted to alerts.jsonl on the wake run:")
ap = os.path.join(root3, "alerts", "alerts.jsonl")
with open(ap, "r", encoding="utf-8") as fh:
    for line in fh:
        if "MISSED_DAY" in line:
            import json  # noqa: E402
            rec = json.loads(line)
            print("    %s  %s" % (rec["day_key"], rec["message"].splitlines()[0]))
print("\n  NOTE: the gap days were NOT re-read -- the routine never back-fills")
print("  (gate.missed_days docstring: 'The routine never back-fills a missed day').")
