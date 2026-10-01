"""Day-budget acceptance test -- written FIRST against the shipped package.

Rule R2 (operator numbering, title "status is checked at most once per
operator-local calendar day"; the shipped ``gate.py`` docstring labels it "R1")
is about *a check that acquires today's figures*.  A run that acquires nothing
must not spend the day.

This file encodes the acceptance bar of DELEGATION-2026-10-01-R3 stream D:

  data-less run (``data_available == False``)
    * leaves ``state/day-locks/`` EMPTY                 (does not consume the day)
    * does NOT advance ``last_success_day``
    * does NOT reset ``consecutive_missed_days``
    * writes no snapshot
    * is reported ``WATCHDOG_MISSED_DAY``
    * leaves the day usable: a later reading-present run the same day succeeds

  reading-present run
    * exactly one lock, exactly one snapshot
    * a second run the same day is ``SKIP_DUPLICATE_DAY`` with no side effects

The fixture mirrors the operator's approved production symptom of 2026-10-01:
before the bad run the ledger read ``last_success_day=2026-09-30`` and
``consecutive_missed_days=9``; a data-less run on 2026-10-01 advanced success to
2026-10-01 and reset the counter 9 -> 0.

Run it against either tree by pointing FREECASH_ROUTINE_DIR at it:

    FREECASH_ROUTINE_DIR=D:/AgenticOS/monitoring/freecash <python> test_daybudget_data_less.py

Every run uses a throwaway data root (``TempDataRoot`` -> ``FREECASH_DATA_ROOT``);
the production state root is never touched.
"""

import contextlib
import io
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
#: When this file is copied next to the package's own _support.py it targets that
#: tree; otherwise it targets the shipped package.  FREECASH_ROUTINE_DIR wins.
_DEFAULT_ROUTINE = (
    _HERE.parent if (_HERE / "_support.py").exists() else Path(r"D:/AgenticOS/monitoring/freecash")
)
ROUTINE = Path(os.environ.get("FREECASH_ROUTINE_DIR", str(_DEFAULT_ROUTINE)))
for _entry in (str(ROUTINE), str(ROUTINE / "tests")):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

import _support  # noqa: E402  (path set above)
from _support import (  # noqa: E402
    RecordingSender,
    TempDataRoot,
    day_locks,
    events,
    ledger,
    snapshot_files,
    write_operator_record,
)

import gate  # noqa: E402
import paths  # noqa: E402
import run_daily_check  # noqa: E402
import watchdog  # noqa: E402

#: 06:35 UTC is 08:35 Europe/Berlin -- the designed run time, clear of midnight.
BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)
TODAY = "2026-10-01"
PRIOR_SUCCESS = "2026-09-30"
PRIOR_MISSED = 9

#: The pre-defect ledger: healthy through 2026-09-30, nine missed days behind it.
PRODUCTION_FIXTURE = {
    "last_attempt_day": PRIOR_SUCCESS,
    "last_attempt_at_utc": "2026-09-30T06:53:46Z",
    "last_success_day": PRIOR_SUCCESS,
    "last_success_at_utc": "2026-09-30T06:53:46Z",
    "last_outcome": "MONITOR_DEGRADED",
    "consecutive_missed_days": PRIOR_MISSED,
}


def seed_ledger(root):
    fixture = gate.new_ledger()
    fixture.update(PRODUCTION_FIXTURE)
    paths.write_json_atomic(paths.ledger_path(), fixture)
    return fixture


def run_watchdog(**kwargs):
    """Run watchdog.check and capture the token it prints."""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        state = watchdog.check(**kwargs)
    return state, buffer.getvalue()


class _DataLessFixture(unittest.TestCase):
    """No operator record for TODAY -> data_available is False."""

    def setUp(self):
        self.env = TempDataRoot()
        self.root = self.env.__enter__().root
        seed_ledger(self.root)

    def tearDown(self):
        self.env.__exit__(None, None, None)

    def run_once(self):
        return run_daily_check.run([], now=BASE, sender=RecordingSender())


class DataLessRunBudgetTest(_DataLessFixture):
    """A run that acquires nothing must not spend the day."""

    def test_data_less_run_consumes_no_day_lock(self):
        self.assertEqual(self.run_once(), 0)
        self.assertEqual(day_locks(self.root), [], "a data-less run must leave no day lock")

    def test_data_less_run_does_not_advance_last_success_day(self):
        self.assertEqual(self.run_once(), 0)
        self.assertEqual(
            ledger(self.root)["last_success_day"], PRIOR_SUCCESS,
            "a data-less run must not book a success day",
        )

    def test_data_less_run_does_not_reset_consecutive_missed_days(self):
        self.assertEqual(self.run_once(), 0)
        self.assertEqual(
            ledger(self.root)["consecutive_missed_days"], PRIOR_MISSED,
            "a data-less run must not reset the miss counter",
        )

    def test_data_less_run_writes_no_snapshot(self):
        self.assertEqual(self.run_once(), 0)
        # a null snapshot would block the real one later today (save_snapshot
        # refuses to overwrite), so none may be written.
        self.assertEqual(snapshot_files(self.root), [], "a data-less run must write no snapshot")
        self.assertEqual(ledger(self.root)["last_outcome"], "MONITOR_DEGRADED")

    def test_data_less_run_is_reported_as_watchdog_missed_day(self):
        self.assertEqual(self.run_once(), 0)
        state, printed = run_watchdog(now=BASE, sender=RecordingSender())
        self.assertFalse(state["covered"], printed)
        self.assertIn("WATCHDOG_MISSED_DAY", printed, printed)
        missed = events(self.root, "MISSED_DAY")
        self.assertEqual(len(missed), 1, [m["message"] for m in missed])
        self.assertEqual(missed[0]["severity"], "alert")


class DayStaysUsableTest(_DataLessFixture):
    """The day key released by a data-less run is still there for a real reading."""

    def test_the_day_is_still_usable_after_a_data_less_run(self):
        self.assertEqual(self.run_once(), 0)
        self.assertEqual(day_locks(self.root), [])

        # The operator now enters the reading for today and runs again.
        write_operator_record(self.root, TODAY, earnings_total_cents=1025, balance_cents=1025)
        self.assertEqual(self.run_once(), 0)

        self.assertEqual(day_locks(self.root), ["%s.lock" % TODAY])
        self.assertEqual(snapshot_files(self.root), ["%s.json" % TODAY])
        document = ledger(self.root)
        self.assertEqual(document["last_success_day"], TODAY)
        # On a real success the counter is recomputed from the actual gap: there
        # is no day between 2026-09-30 and 2026-10-01, so it is 0.
        self.assertEqual(document["consecutive_missed_days"], 0)


class ReadingPresentBudgetTest(unittest.TestCase):
    """A run that acquires figures spends exactly one day, once."""

    def test_reading_present_run_consumes_one_day_and_duplicate_skips(self):
        with TempDataRoot() as env:
            root = env.root
            write_operator_record(root, TODAY, earnings_total_cents=1025, balance_cents=1025)

            first = run_daily_check.run([], now=BASE, sender=RecordingSender())
            self.assertEqual(first, 0)
            self.assertEqual(day_locks(root), ["%s.lock" % TODAY])
            self.assertEqual(snapshot_files(root), ["%s.json" % TODAY])
            self.assertEqual(ledger(root)["last_success_day"], TODAY)

            snapshot_file = paths.snapshots_dir() / ("%s.json" % TODAY)
            mtime_before = snapshot_file.stat().st_mtime_ns
            ledger_before = paths.ledger_path().read_bytes()
            lines_before = len(_support.alert_lines(root))

            second = run_daily_check.run([], now=BASE, sender=RecordingSender())
            self.assertEqual(second, 0)
            self.assertEqual(len(events(root, "SKIP_DUPLICATE_DAY")), 1)
            self.assertEqual(len(_support.alert_lines(root)), lines_before + 1)
            self.assertEqual(snapshot_file.stat().st_mtime_ns, mtime_before)
            self.assertEqual(paths.ledger_path().read_bytes(), ledger_before)
            self.assertEqual(day_locks(root), ["%s.lock" % TODAY])
            self.assertEqual(snapshot_files(root), ["%s.json" % TODAY])


if __name__ == "__main__":
    unittest.main(verbosity=2)
