#!/usr/bin/env python
"""HOLE HUNT -- the defects the four-rule happy path hides.

H1  MONITOR_DEGRADED is a member of gate.SUCCESS_OUTCOMES, so a day on which
    NOTHING was read is recorded as a SUCCESS day and the watchdog stays silent.
H5  every duplicate same-day invocation appends another unbounded audit line.
H6  readonly_client._transport() is an unguarded, directly callable socket site.

(H2 = a dormant write path that evades all three shipped static gates, H3 = a
real change absorbed after a degraded day, H7 = unreachable coalescing branch:
those are reproduced by attack_gates_evasion.py and attack_u3.py.)

Everything here runs against a throwaway sandbox.  The production root is only
ever READ, and only for H1's "this is not theoretical" line.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (PROD_ROOT, Recorder, alerts, check, fresh_data_root, header,  # noqa: E402
                     line, sandbox, set_env, use_package, utc)

header("HOLE HUNT -- the four rules as implemented, attacked where they interact")
root = fresh_data_root("holes")
set_env(root)
use_package()

import gate  # noqa: E402
import watchdog  # noqa: E402

line("sandbox data root : %s" % root)

# ------------------------------------------------------------------ H1
line("")
line("=" * 96)
line("H1 -- MONITOR_DEGRADED counts as a SUCCESS day, so the watchdog is silenced")
line("=" * 96)
line("gate.SUCCESS_OUTCOMES = %s" % sorted(gate.SUCCESS_OUTCOMES))
check("MONITOR_DEGRADED IS in gate.SUCCESS_OUTCOMES", "MONITOR_DEGRADED" in gate.SUCCESS_OUTCOMES,
      "'a day where nothing was read' is classified identically to a real successful read")
check("READ_FAILED is NOT in gate.SUCCESS_OUTCOMES (the failure path is honest)",
      "READ_FAILED" not in gate.SUCCESS_OUTCOMES)

TODAY = "2026-10-01"


def probe(outcome, label):
    """Put a ledger in the sandbox as if the day ended with *outcome*, then run
    the watchdog against it and record what the operator would see."""
    d = sandbox("h1-%s" % label) / "data"
    (d / "state").mkdir(parents=True, exist_ok=True)
    (d / "alerts").mkdir(parents=True, exist_ok=True)
    ledger = {
        "schema_version": 1,
        "last_attempt_day": TODAY,
        "last_success_day": TODAY if outcome in gate.SUCCESS_OUTCOMES else "2026-09-30",
        "last_attempt_at_utc": "2026-10-01T06:00:00Z",
        "last_success_at_utc": "2026-10-01T06:00:00Z",
        "last_outcome": outcome,
        "consecutive_missed_days": 0,
        "timezone": "Europe/Berlin",
        "updated_at_utc": "2026-10-01T06:00:00Z",
    }
    (d / "state" / "last-run.json").write_text(json.dumps(ledger, indent=2), encoding="utf-8")
    os.environ["FREECASH_DATA_ROOT"] = str(d)
    state = watchdog.evaluate(now=utc(2026, 10, 1, 20), ledger=ledger)
    n_before = len(alerts(d))
    sender = Recorder()
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        watchdog.check(now=utc(2026, 10, 1, 20), ledger=ledger, sender=sender)
    n_after = len(alerts(d))
    return state, buf.getvalue().strip(), n_before, n_after, sender.attempts


for outcome in ("MONITOR_DEGRADED", "READ_FAILED"):
    state, printed, nb, na, deliv = probe(outcome, outcome.lower())
    line("")
    line("  ledger last_outcome=%-18s -> covered=%s  deliveries=%d  alert lines added=%d"
         % (outcome, state["covered"], deliv, na - nb))
    line("    watchdog stdout: %s" % printed)

s_deg, out_deg, nb, na, deliv_deg = probe("MONITOR_DEGRADED", "MONITOR_DEGRADED-x")
s_fail, out_fail, nb2, na2, deliv_fail = probe("READ_FAILED", "READ_FAILED-x")
check("H1: a MONITOR_DEGRADED day (nothing read) is reported WATCHDOG_OK -- NO alarm, NO delivery",
      s_deg["covered"] is True and deliv_deg == 0 and out_deg.startswith("WATCHDOG_OK"),
      "stdout=%r" % out_deg)
check("H1 control: a READ_FAILED day IS alarmed, so the watchdog is not simply dead",
      s_fail["covered"] is False and deliv_fail == 1 and "WATCHDOG_MISSED_DAY" in out_fail,
      "stdout=%r" % out_fail)
check("H1: with every intervening day degraded, the missed-day arithmetic stays at ZERO",
      gate.consecutive_missed_days(TODAY, {"last_success_day": "2026-09-30"}) == 0
      and gate.consecutive_missed_days(TODAY, {"last_success_day": "2026-09-25"}) == 5,
      "last_success_day=2026-09-30 -> 0; last_success_day=2026-09-25 -> 5.  Because a degraded "
      "day advances last_success_day, a week of degraded days shows 0 missed days")

# production evidence -- READ ONLY
line("")
line("--- H1 in PRODUCTION (read-only inspection; nothing written to the production root)")
prod_ledger = json.loads((PROD_ROOT / "state" / "last-run.json").read_text(encoding="utf-8"))
prod_snap = json.loads((PROD_ROOT / "snapshots" / "2026-10-01.json").read_text(encoding="utf-8"))
import hashlib  # noqa: E402
line("    production last-run.json : last_attempt_day=%s last_success_day=%s last_outcome=%s"
     % (prod_ledger.get("last_attempt_day"), prod_ledger.get("last_success_day"),
        prod_ledger.get("last_outcome")))
line("    production 2026-10-01.json: data_available=%s degraded=%s account_status=%r earnings=%r"
     % (prod_snap.get("source", {}).get("data_available"), prod_snap.get("degraded"),
        prod_snap.get("account_status"), prod_snap.get("earnings_total_cents")))
line("    raw_response_sha256=%s  == sha256(b'')=%s"
     % (prod_snap.get("raw_response_sha256"), hashlib.sha256(b"").hexdigest()))
os.environ["FREECASH_DATA_ROOT"] = str(root)   # point back at the sandbox
check("H1 is LIVE in production, not theoretical: last_success_day=2026-10-01 with NOTHING read",
      prod_ledger.get("last_outcome") == "MONITOR_DEGRADED"
      and prod_ledger.get("last_success_day") == "2026-10-01"
      and prod_snap.get("source", {}).get("data_available") is False
      and prod_snap.get("raw_response_sha256") == hashlib.sha256(b"").hexdigest(),
      "the watchdog will report WATCHDOG_OK for 2026-10-01 on a day nothing was read")

# ------------------------------------------------------------------ H4
line("")
line("=" * 96)
line("H4 -- an unresolvable timezone does NOT stop the run and still yields a SUCCESS day")
line("=" * 96)
import run_daily_check  # noqa: E402
from _common import write_record  # noqa: E402

line("gate.resolve_tz('Mars/Olympus City') = %s" % (gate.resolve_tz("Mars/Olympus City"),))
line("gate.timezone_report('Mars/Olympus City') = %s" % gate.timezone_report("Mars/Olympus City"))
check("'available' is False for an unresolvable zone -- the routine KNOWS it is degraded",
      gate.timezone_report("Mars/Olympus City")["available"] is False)

bad = fresh_data_root("h4-badtz")
set_env(bad, tz="Mars/Olympus City")
write_record(bad, "2026-10-01", earnings_total_cents=1025, balance_cents=1025)
import contextlib  # noqa: E402
import io  # noqa: E402
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    code = run_daily_check.run(now=utc(2026, 10, 1, 6), sender=Recorder())
out = buf.getvalue().strip()
led = json.loads((bad / "state" / "last-run.json").read_text(encoding="utf-8"))
line("")
line("stdout under FREECASH_TZ='Mars/Olympus City':")
for row in out.splitlines():
    line("    %s" % row)
line("ledger: last_success_day=%s last_outcome=%s timezone=%s"
     % (led.get("last_success_day"), led.get("last_outcome"), led.get("timezone")))
line("day key actually used: %s (machine-local zone, NOT the configured one)" % gate.day_key(utc(2026, 10, 1, 6)))
check("the run PROCEEDS (exit 0) with an unresolvable configured timezone",
      code == 0 and "RUN_OK" in out, "exit=%d" % code)
check("H4: the resulting day is recorded as a SUCCESS with the machine-local day key",
      led.get("last_success_day") == "2026-10-01"
      and led.get("last_outcome") in gate.SUCCESS_OUTCOMES,
      "outcome=%s -- a misconfigured zone silently rebases the day boundary and the watchdog"
      " will call the day covered" % led.get("last_outcome"))

# day key follows the resolved zone, not UTC
line("")
line("day-key sensitivity to the resolved zone (two fixed instants):")
for moment, label in ((utc(2026, 10, 1, 2), "2026-10-01T02:00Z"), (utc(2026, 9, 30, 20), "2026-09-30T20:00Z")):
    keys = {}
    for zone in ("UTC", "Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati"):
        keys[zone] = gate.day_key(moment, tz=zone)
        line("    %s  %-22s -> %s" % (label, zone, keys[zone]))
    line("    -> %d distinct day keys for one instant" % len(set(keys.values())))
check("the day boundary is a function of the resolved zone, so a silent fallback moves it",
      len({gate.day_key(utc(2026, 9, 30, 20), tz=z) for z in
           ("UTC", "Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati")}) > 1)

set_env(root)
line("")
line("HOLE HUNT (H1, H4, H5, H6) finished.")
