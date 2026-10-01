"""preflight_check.py -- day-budget guard that sits IN FRONT of the routine's entry point.

RULE MAPPING (operator numbering is authoritative; the shipped docstrings are inverted --
the wrapper prints the title with the number every time, never a bare "R1"/"R2"):

    operator "R2 ONCE PER DAY"      == shipped gate.py:1 docstring "R1"
    operator "R1 NO EARNING ACTION" == shipped readonly_client.py:1 docstring "R2"
    operator "R3 NOTIFY ON CHANGE"  == shipped R3
    operator "R4 APPROVAL FIRST"    == shipped R4

THE DEFECT THIS WRAPPER EXISTS TO STOP (operator "R2 ONCE PER DAY"):
    run_daily_check.py resolves the day key and ACQUIRES THE LOCK at :308-309, and only
    then reads the source at :372.  A run on a day whose source carries no record
    therefore burns the day's one allowed read: the lock exists, the snapshot is written
    with null figures, and gate.record_outcome() books MONITOR_DEGRADED as a SUCCESS day
    (gate.py:32-40 lists it in SUCCESS_OUTCOMES; gate.py:198-200 advances
    last_success_day for it).  2026-09-30 is the production proof.

WHAT THIS WRAPPER DOES
    It checks, BEFORE the entry point runs, that today's source can actually yield a
    reading.  If it cannot, it refuses and the entry point is never invoked -- so the
    day lock is only ever acquired on a day that will carry a reading.

WHAT IT DOES NOT DO
    It does not fix the read-before-lock ordering inside the entry point (stream D's
    remedy).  It is a guard, not the fix; it is bypassable by calling the entry point
    directly, which is exactly what the shipped scheduler template would do.  Both
    statements are true and are stated separately.

EXIT CODES
    0  precondition met; the entry point ran and its exit code is propagated
    4  REFUSED: no record for today in the source; entry point NOT invoked
    5  REFUSED: today's day lock already exists -- the day is already spent
    6  REFUSED: source kind cannot be pre-flighted without a second status read
    2  usage error
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_ROUTINE_DIR = "D:/AgenticOS/monitoring/freecash"
PREFLIGHT_REFUSED = 4
DAY_SPENT = 5
UNPREFLIGHTABLE = 6


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="preflight_check.py",
        description=(
            "Refuse to invoke the Free Cash daily check on a day whose source carries "
            "no record, so the day lock is only acquired on a day that will actually "
            "carry a reading."
        ),
    )
    parser.add_argument("--routine-dir", default=DEFAULT_ROUTINE_DIR,
                        help="directory holding run_daily_check.py and its modules")
    parser.add_argument("--entry", default="run_daily_check.py", help="entry point filename")
    parser.add_argument("--source", choices=("operator_state", "metrics_http"), default=None,
                        help="read source under test (default: FREECASH_READ_SOURCE or operator_state)")
    parser.add_argument("--python", default=sys.executable, help="interpreter for the entry point")
    parser.add_argument("--allow-default-root", action="store_true",
                        help="permit running against the shipped default root "
                             "(D:/AgenticOS/data/freecash-monitor) when FREECASH_DATA_ROOT is unset. "
                             "Required for production deployment; never used by this stream.")
    parser.add_argument("args", nargs="*", help="extra arguments passed through to the entry point")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    try:  # keep PREFLIGHT lines in order with the child's own output when piped to a file
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass
    routine = Path(args.routine_dir).resolve()
    if not (routine / args.entry).is_file():
        print("PREFLIGHT USAGE: entry point not found: %s" % (routine / args.entry))
        return 2
    sys.path.insert(0, str(routine))
    import gate            # noqa: E402  (routine module, resolved from --routine-dir)
    import operator_state  # noqa: E402

    source = args.source or os.environ.get("FREECASH_READ_SOURCE") or "operator_state"
    root = os.environ.get("FREECASH_DATA_ROOT")
    if not root and not args.allow_default_root:
        print("PREFLIGHT REFUSED: FREECASH_DATA_ROOT is not set. Refusing to run against "
              "the default root (D:/AgenticOS/data/freecash-monitor) unless "
              "--allow-default-root is given (production deployment only).")
        return PREFLIGHT_REFUSED
    if not root:
        root = "D:/AgenticOS/data/freecash-monitor (SDK default; --allow-default-root)"

    day = gate.day_key()
    report = gate.timezone_report()
    print("PREFLIGHT day_key=%s tz=%s tz_kind=%s tz_available=%s source=%s"
          % (day, gate.tz_name(), report["kind"], report["available"], source))
    print("PREFLIGHT data_root=%s" % root)
    if report["kind"] == "system-local":
        print("PREFLIGHT WARNING: the configured timezone %r did not resolve (no tzdata). "
              "The day key above is NOT the operator-local key. Use the tzdata-capable "
              "interpreter." % report["configured"])

    lock = gate.lock_path(day)
    if lock.exists():
        print("PREFLIGHT REFUSED [operator R2 ONCE PER DAY]: day lock %s already exists. "
              "Today's single read is spent; the entry point was NOT invoked." % lock)
        return DAY_SPENT

    if source == "metrics_http":
        print("PREFLIGHT REFUSED [operator R2 ONCE PER DAY]: source=metrics_http cannot be "
              "pre-flighted without performing a second status read of the same day. The "
              "day-budget fix for this source belongs inside the entry point "
              "(read-before-lock or a two-phase lock); this wrapper will not double-read.")
        return UNPREFLIGHTABLE

    record = operator_state.record_for_day(day)
    if record is None:
        print("PREFLIGHT REFUSED [operator R2 ONCE PER DAY]: no operator-entered record "
              "for %s in %s." % (day, operator_state.paths.operator_state_path()))
        print("PREFLIGHT RESULT: entry_point_invocations=0 day_lock_created=%s "
              "snapshot_written=False status_read_performed=False" % lock.exists())
        return PREFLIGHT_REFUSED

    print("PREFLIGHT OK: record for %s present (account_status=%s earnings_total_cents=%s "
          "balance_cents=%s pending_cents=%s). Invoking the entry point."
          % (day, record.get("account_status"), record.get("earnings_total_cents"),
             record.get("balance_cents"), record.get("pending_cents")))
    env = dict(os.environ)
    env["FREECASH_READ_SOURCE"] = source
    command = [args.python, str(routine / args.entry)] + list(args.args)
    print("PREFLIGHT EXEC: %s" % " ".join(command))
    completed = subprocess.run(command, env=env)
    print("PREFLIGHT entry_point_exit=%s" % completed.returncode)
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
