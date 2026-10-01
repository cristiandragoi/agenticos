"""fallback_probe_driver.py -- exercise the residual no-reading path of the remedy.

The remedy's primary path is a pre-flight probe: with no reading for today, the
day lock is never taken.  One path remains where the lock *is* taken and the run
still acquires nothing: the probe saw a reading and the read itself then found
none (the operator record was removed in between, or a non-probed source
degrades after the lock).  This driver plants exactly that state, because no
suite covers it, and asserts the day-budget properties still hold there:

    * exit 0, ``RUN_NO_DATA`` printed, ``day_lock=RELEASED``
    * no snapshot written
    * ``last_success_day`` unchanged and ``consecutive_missed_days`` preserved
    * the watchdog reports the day as MISSED, not covered (this is the case the
      shipped ``SUCCESS_OUTCOMES`` set got wrong: attempt == today + a degraded
      outcome used to mean "covered")

Run with::

    FREECASH_ROUTINE_DIR=<package copy> FREECASH_DATA_ROOT=<scratch> \\
      <python 3.11 with tzdata> fallback_probe_driver.py

Exit code 0 when every property holds, 1 otherwise.  Writes only inside
``FREECASH_DATA_ROOT``.
"""

import io
import contextlib
import os
import sys
from datetime import datetime, timezone

ROUTINE = os.environ["FREECASH_ROUTINE_DIR"]
sys.path.insert(0, ROUTINE)

import gate  # noqa: E402
import paths  # noqa: E402
import run_daily_check  # noqa: E402
import watchdog  # noqa: E402

BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)  # 08:35 Europe/Berlin
FAILURES = []


class Recorder:
    delivery_label = "TOAST_OK"

    def __init__(self):
        self.messages = []

    def __call__(self, message):
        self.messages.append(message)


def check(name, condition, detail=""):
    if condition:
        print("CHECK PASS  fallback: %s" % name)
    else:
        print("CHECK FAIL  fallback: %s %s" % (name, detail))
        FAILURES.append(name)


def seed_ledger():
    fixture = gate.new_ledger()
    fixture.update(
        {
            "last_attempt_day": "2026-09-30",
            "last_attempt_at_utc": "2026-09-30T06:53:46Z",
            "last_success_day": "2026-09-30",
            "last_success_at_utc": "2026-09-30T06:53:46Z",
            "last_outcome": "MONITOR_DEGRADED",
            "consecutive_missed_days": 9,
        }
    )
    paths.write_json_atomic(paths.ledger_path(), fixture)


def seed_record(day):
    paths.write_json_atomic(
        paths.operator_state_path(),
        {
            "schema_version": paths.SCHEMA_VERSION,
            "kind": "operator_entered_daily_status",
            "note": "fallback driver seed",
            "records": [
                {
                    "day_key": day,
                    "entered_at_utc": "%sT06:40:00Z" % day,
                    "account_status": "ACTIVE",
                    "earnings_total_cents": 1025,
                    "balance_cents": 1025,
                    "pending_cents": 0,
                    "currency": "USD",
                }
            ],
        },
    )


def main() -> int:
    day = gate.day_key(BASE)
    paths.ensure_layout()
    seed_ledger()
    seed_record(day)  # so the pre-flight probe passes

    # The probe passes, the read does not: this is the planted state.
    run_daily_check.read_source = lambda *a, **k: {
        "kind": "operator_entered",
        "read_ops": [],
        "data_available": False,
        "note": "planted: the record disappeared between probe and read",
        "payload": None,
        "raw_body": b"",
    }

    code = run_daily_check.run([], now=BASE, sender=Recorder())

    locks = sorted(p.name for p in paths.day_locks_dir().glob("*.lock")) if paths.day_locks_dir().exists() else []
    snaps = sorted(p.name for p in paths.snapshots_dir().glob("*.json")) if paths.snapshots_dir().exists() else []
    document = gate.load_ledger()

    check("run exits 0", code == 0, "exit=%s" % code)
    check("day lock released", locks == [], locks)
    check("no snapshot written", snaps == [], snaps)
    check("last_success_day unchanged", document.get("last_success_day") == "2026-09-30", document.get("last_success_day"))
    check("consecutive_missed_days preserved", document.get("consecutive_missed_days") == 9, document.get("consecutive_missed_days"))
    check("outcome recorded as MONITOR_DEGRADED", document.get("last_outcome") == "MONITOR_DEGRADED", document.get("last_outcome"))

    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        state = watchdog.check(now=BASE, sender=Recorder())
    printed = buffer.getvalue()
    print("    watchdog said: %s" % printed.strip().replace("\n", " | "))
    check("watchdog reports the day as NOT covered", state["covered"] is False, printed)
    check("watchdog prints WATCHDOG_MISSED_DAY", "WATCHDOG_MISSED_DAY" in printed, printed)

    print("fallback_probe_driver: %s" % ("OK" if not FAILURES else "FAILED %s" % FAILURES))
    return 0 if not FAILURES else 1


if __name__ == "__main__":
    sys.exit(main())
