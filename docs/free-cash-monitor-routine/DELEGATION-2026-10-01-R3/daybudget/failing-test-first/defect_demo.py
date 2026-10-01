"""Reproduce the approved 2026-10-01 production symptom on a throwaway root.

Runs the SHIPPED package (or any tree named by FREECASH_ROUTINE_DIR) once with
``data_available=False`` and prints the four damaged facts:

  1. the day key was spent            -> day-locks/2026-10-01.lock exists
  2. last_success_day advanced        -> 2026-09-30 -> 2026-10-01
  3. consecutive_missed_days reset    -> 9 -> 0
  4. the watchdog reports OK          -> WATCHDOG_OK (no MISSED_DAY alarm)

No socket is opened and the production state root is never touched (TempDataRoot
points FREECASH_DATA_ROOT at a throwaway directory).
"""

import contextlib
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
ROUTINE = Path(os.environ.get("FREECASH_ROUTINE_DIR", r"D:/AgenticOS/monitoring/freecash"))
for _entry in (str(ROUTINE), str(ROUTINE / "tests")):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

from _support import RecordingSender, TempDataRoot, day_locks, events, snapshot_files  # noqa: E402

import gate  # noqa: E402
import paths  # noqa: E402
import run_daily_check  # noqa: E402
import watchdog  # noqa: E402

BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)


def main() -> int:
    with TempDataRoot() as env:
        root = env.root
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

        print("BEFORE  last_success_day=%s consecutive_missed_days=%s"
              % (fixture["last_success_day"], fixture["consecutive_missed_days"]))
        print("BEFORE  day_locks=%s snapshots=%s" % (day_locks(root), snapshot_files(root)))

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = run_daily_check.run([], now=BASE, sender=RecordingSender())
        print("run_daily_check exit=%s" % code)
        print(buffer.getvalue().strip())

        document = json.loads(paths.ledger_path().read_text(encoding="utf-8"))
        print("AFTER   last_success_day=%s consecutive_missed_days=%s last_outcome=%s"
              % (document["last_success_day"], document["consecutive_missed_days"], document["last_outcome"]))
        print("AFTER   day_locks=%s snapshots=%s" % (day_locks(root), snapshot_files(root)))

        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            state = watchdog.check(now=BASE, sender=RecordingSender())
        print("watchdog covered=%s" % state["covered"])
        print("watchdog says: %s" % buffer.getvalue().strip())
        print("MISSED_DAY alerts=%d" % len(events(root, "MISSED_DAY")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
