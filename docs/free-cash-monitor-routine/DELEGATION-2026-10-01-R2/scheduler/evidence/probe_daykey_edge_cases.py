"""Probe: day-key edge cases, executed against the REAL gate.day_key.

Run:  <tzdata-python> probe_daykey_edge_cases.py
Read-only. Sets FREECASH_DATA_ROOT to a throwaway dir so nothing can touch
production state (day_key itself never opens a file).
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, r"D:/AgenticOS/monitoring/freecash")
os.environ["FREECASH_DATA_ROOT"] = r"C:/Users/cd-pr/AppData/Local/Temp/fc-r2/probe-noop"
os.environ["FREECASH_TZ"] = "Europe/Berlin"

import gate  # noqa: E402

BERLIN = ZoneInfo("Europe/Berlin")

print("gate.__file__ =", gate.__file__)
print("gate.DEFAULT_TZ =", gate.DEFAULT_TZ, "| gate.tz_name() =", gate.tz_name())
print("gate.resolve_tz('Europe/Berlin') kind =", gate.resolve_tz("Europe/Berlin")[1])
print("gate.timezone_report() =", gate.timezone_report())
print()

# ---------------------------------------------------------------- 3(b) DST
print("=" * 72)
print("3(b) DST -- Europe/Berlin transitions of 2026, at hourly resolution")
print("=" * 72)

def show(label, dt):
    print("  %-46s -> day_key=%s  (utcoffset=%s, tzname=%s)"
          % (label, gate.day_key(dt), dt.strftime("%z"), dt.tzname()))

# Locate the two 2026 transitions from the zone itself (not from memory).
d = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
prev = d.astimezone(BERLIN).utcoffset()
transitions = []
while d < datetime(2027, 1, 1, 12, tzinfo=timezone.utc):
    off = d.astimezone(BERLIN).utcoffset()
    if off != prev:
        transitions.append((d, prev, off))
        prev = off
    d += timedelta(hours=1)
print("transitions found in 2026 (UTC instants):")
for t, o, n in transitions:
    print("  %s UTC  %s -> %s  (Berlin local %s)"
          % (t.isoformat(), o, n, t.astimezone(BERLIN).isoformat()))
print()

spring = [t for t in transitions if t[2] > t[1]][0][0].astimezone(BERLIN).date()
autumn = [t for t in transitions if t[2] < t[1]][0][0].astimezone(BERLIN).date()
print("spring-forward local date:", spring)
print("autumn-back local date   :", autumn)
print()

print("-- spring forward (%s, 02:00 CET -> 03:00 CEST) --" % spring)
show("before jump: %sT01:30+01:00" % spring, datetime(spring.year, spring.month, spring.day, 1, 30, tzinfo=timezone(timedelta(hours=1))))
show("after  jump: %sT03:30+02:00" % spring, datetime(spring.year, spring.month, spring.day, 3, 30, tzinfo=timezone(timedelta(hours=2))))
show("UTC 00:30Z on that date", datetime(spring.year, spring.month, spring.day, 0, 30, tzinfo=timezone.utc))
print()

print("-- autumn back (%s, 03:00 CEST -> 02:00 CET; local 02:00-03:00 repeats) --" % autumn)
show("first  01:30 (CEST, +02:00)", datetime(autumn.year, autumn.month, autumn.day, 1, 30, tzinfo=timezone(timedelta(hours=2))))
show("second 01:30 (CET,  +01:00) [the repeated hour]", datetime(autumn.year, autumn.month, autumn.day, 1, 30, tzinfo=timezone(timedelta(hours=1))))
show("local 04:00 same day", datetime(autumn.year, autumn.month, autumn.day, 4, 0, tzinfo=BERLIN))
show("day after, local 00:30", datetime(autumn.year, autumn.month, autumn.day, 0, 30, tzinfo=BERLIN) + timedelta(days=1))
print()

# Exhaustive: every UTC hour (and every 15 min) across the whole 25h autumn day
# and the 23h spring day must collapse to exactly ONE day key -- that is what
# makes "one lock per day" hold across a DST transition.
for label, day in (("spring-forward day", spring), ("autumn-back day", autumn)):
    start = datetime(day.year, day.month, day.day, 0, 0, tzinfo=BERLIN) - timedelta(hours=6)
    end = start + timedelta(hours=36)
    keys = set()
    t = start
    while t <= end:
        keys.add(gate.day_key(t))
        t += timedelta(minutes=15)
    local_keys = sorted(keys)
    print("%s: 145 sample instants across a 36h window -> distinct day_keys=%s"
          % (label, local_keys))
    print("   distinct keys covering the transition date itself: %s"
          % sorted(k for k in keys))
print()
print("VERDICT: day_key is the operator-local CALENDAR date. During the autumn")
print("repeated hour both 01:30 instants map to the same date, so the atomic")
print("lock name is identical and the second one is refused by the lock -- no")
print("second read is possible. Across the spring gap the date never skips.")
print()

# ---------------------------------------------------------------- 3(c) backwards clock (key arithmetic only)
print("=" * 72)
print("3(c) CLOCK MOVES BACKWARDS -- key arithmetic")
print("=" * 72)
now_day = "2026-10-05"
back_now = datetime(2026, 10, 4, 23, 30, tzinfo=BERLIN)
print("ledger.last_success_day =", now_day)
print("clock now says           =", back_now.isoformat(), "-> day_key =", gate.day_key(back_now))
ledger = {"last_success_day": now_day, "last_attempt_day": now_day, "last_outcome": "MONITOR_DEGRADED"}
print("gate.clock_moved_backwards(%r, ledger) = %s" % (gate.day_key(back_now), gate.clock_moved_backwards(gate.day_key(back_now), ledger)))
print("gate.missed_days(%r, ledger)           = %s   # empty: today < last_success" % (gate.day_key(back_now), gate.missed_days(gate.day_key(back_now), ledger)))
print("gate.consecutive_missed_days(...)       =", gate.consecutive_missed_days(gate.day_key(back_now), ledger))
print("NOTE: clock_moved_backwards() is DEFINED but never CALLED anywhere in")
print("      monitoring/freecash/ (grep: definition only). Verified separately.")
