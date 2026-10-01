"""build_daybudget_fix.py -- the *minimal* package copy on which R3's
test_daybudget_data_less.py can be shown to go GREEN, so the suite is proven
satisfiable (and therefore falsifiable) instead of merely red for an
environmental reason.

Three edits, all in a COPY under this stream's own directory:
  1. gate.SUCCESS_OUTCOMES: drop "MONITOR_DEGRADED".
  2. run_daily_check._run: probe reading availability BEFORE the day lock; a
     data-less run returns without taking the lock, writing a snapshot, or
     touching the ledger.
  3. (nothing else)
"""
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
src = HERE / "pkg-clean"
dst = HERE / "pkg-daybudget-fix"
if dst.exists():
    shutil.rmtree(dst)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

g = dst / "gate.py"
t = g.read_text(encoding="utf-8")
assert t.count('        "MONITOR_DEGRADED",\n') == 1
g.write_text(t.replace('        "MONITOR_DEGRADED",\n', '', 1), encoding="utf-8", newline="\n")

rd = dst / "run_daily_check.py"
t = rd.read_text(encoding="utf-8")
anchor = ('    source_kind = resolve_source(args.source)\n'
          '    day = gate.day_key(now)\n'
          '    acquired, lock = gate.acquire_day_lock(day)\n')
assert t.count(anchor) == 1
probe = (
    '    source_kind = resolve_source(args.source)\n'
    '    day = gate.day_key(now)\n'
    '    # R2 (operator numbering; shipped gate.py labels it "R1") -- a run that can\n'
    '    # acquire no reading must not spend the day: probe availability BEFORE the\n'
    '    # exclusive-create lock, so the day stays open for a later real reading.\n'
    '    if source_kind == "operator_state" and operator_state.record_for_day(day) is None:\n'
    '        notify.alert(\n'
    '            "MONITOR_DEGRADED",\n'
    '            day,\n'
    '            "No operator-entered reading for %s. The day was NOT consumed and no "\n'
    '            "snapshot was written; a later run today can still read." % day,\n'
    '            severity=notify.SEVERITY_INFO,\n'
    '            observed={"data_available": False, "day_spent": False},\n'
    '        )\n'
    '        print(\n'
    '            "RUN_OK %s outcome=MONITOR_DEGRADED source=operator_entered(data_available=False) "\n'
    '            "snapshot=none written=False changes=0 notifications=0 approvals=0 reminders=0 "\n'
    '            "lock=none" % day\n'
    '        )\n'
    '        return 0\n'
    '    acquired, lock = gate.acquire_day_lock(day)\n')
rd.write_text(t.replace(anchor, probe, 1), encoding="utf-8", newline="\n")
print("built", dst)
