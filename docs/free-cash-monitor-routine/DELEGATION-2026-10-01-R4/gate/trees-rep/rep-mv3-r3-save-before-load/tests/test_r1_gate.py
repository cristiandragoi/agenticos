"""R1 -- exactly one status read per operator-local calendar day (T1.1 - T1.4)."""

import os
import subprocess
import sys
import unittest
from datetime import date, datetime, timedelta, timezone

import _support
from _support import RUN_DAILY, REPO_ROOT, TempDataRoot, events, ledger, snapshot_files, day_locks

import gate
import paths
import run_daily_check


class DayKeyTests(unittest.TestCase):
    """T1.4 -- the day key comes from the operator wall clock, not from UTC."""

    def test_local_day_differs_from_utc_day_near_midnight(self):
        # 2026-09-17T22:30Z is 2026-09-18T00:30 in Europe/Berlin (UTC+02:00).
        frozen = datetime(2026, 9, 17, 22, 30, tzinfo=timezone.utc)
        self.assertEqual(gate.day_key(frozen, tz="Europe/Berlin"), "2026-09-18")
        self.assertEqual(gate.day_key(frozen, tz="UTC"), "2026-09-17")
        self.assertNotEqual(gate.day_key(frozen, tz="Europe/Berlin"), gate.day_key(frozen, tz="UTC"))

    def test_day_key_follows_the_configured_timezone(self):
        frozen = datetime(2026, 1, 1, 23, 30, tzinfo=timezone.utc)
        with TempDataRoot(FREECASH_TZ="Europe/Berlin") as env:
            self.assertEqual(gate.day_key(frozen), "2026-01-02")
            os.environ["FREECASH_TZ"] = "UTC"
            self.assertEqual(gate.day_key(frozen), "2026-01-01")
        # `env.root` is a throwaway data root and can never contain a zone name,
        # so asserting "Europe/Berlin" against it could only ever fail.  What is
        # worth pinning is that the routine reports the configured zone, and that
        # a host which cannot resolve it reports "system-local" (gate.resolve_tz)
        # instead of pretending the configured name was honoured.
        report = gate.timezone_report("Europe/Berlin")
        self.assertEqual(report["configured"], "Europe/Berlin")
        self.assertIn(report["kind"], ("zoneinfo", "system-local"))
        self.assertIn(report["offset_now"][:1], ("+", "-"))

    def test_timezone_change_is_reported_as_degraded(self):
        with TempDataRoot() as env:
            root = env.root
            today = gate.day_key()
            fixture = gate.new_ledger()
            fixture["timezone"] = "UTC"
            fixture["last_success_day"] = today
            fixture["last_attempt_day"] = today
            fixture["last_outcome"] = "OK_NO_CHANGE"
            paths.write_json_atomic(paths.ledger_path(), fixture)
            code = run_daily_check.run([], sender=_support.RecordingSender())
            self.assertEqual(code, 0)
            warnings = events(root, "MONITOR_DEGRADED")
            self.assertTrue(
                any("Timezone changed" in w["message"] for w in warnings),
                [w["message"] for w in warnings],
            )


class DoubleRunTests(unittest.TestCase):
    """T1.1 -- the same command twice on the same day."""

    def test_second_run_skips_with_no_side_effects(self):
        with TempDataRoot() as env:
            root = env.root
            today = gate.day_key()
            _support.write_operator_record(root, today, earnings_total_cents=1025)

            first = _support.run_entry_point(env=env.env())
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertIn("RUN_OK %s" % today, first.stdout)
            self.assertEqual(snapshot_files(root), ["%s.json" % today])
            self.assertEqual(ledger(root)["last_success_day"], today)
            self.assertEqual(day_locks(root), ["%s.lock" % today])

            snapshot_file = paths.snapshots_dir() / ("%s.json" % today)
            mtime_before = snapshot_file.stat().st_mtime_ns
            ledger_before = (paths.ledger_path()).read_bytes()
            lines_before = len(_support.alert_lines(root))
            skips_before = len(events(root, "SKIP_DUPLICATE_DAY"))

            second = _support.run_entry_point(env=env.env())
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertIn("SKIP_DUPLICATE_DAY %s" % today, second.stdout)
            self.assertEqual(len(events(root, "SKIP_DUPLICATE_DAY")), skips_before + 1)
            self.assertEqual(len(_support.alert_lines(root)), lines_before + 1)
            self.assertEqual(snapshot_file.stat().st_mtime_ns, mtime_before)
            self.assertEqual(paths.ledger_path().read_bytes(), ledger_before)
            self.assertEqual(snapshot_files(root), ["%s.json" % today])
            self.assertEqual(_support.pending_document(root)["items"], [])


class ConcurrencyTests(unittest.TestCase):
    """T1.2 -- five simultaneous copies cannot produce two reads."""

    def test_five_concurrent_runs_yield_one_winner(self):
        with TempDataRoot() as env:
            root = env.root
            today = gate.day_key()
            _support.write_operator_record(root, today, earnings_total_cents=1025)
            processes = [
                subprocess.Popen(
                    [sys.executable, str(RUN_DAILY)],
                    env=env.env(),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd=str(REPO_ROOT),
                )
                for _ in range(5)
            ]
            outputs = [process.communicate(timeout=180) for process in processes]
            codes = [process.returncode for process in processes]
            self.assertEqual(codes, [0, 0, 0, 0, 0], outputs)
            skips = sum(1 for out, _err in outputs if "SKIP_DUPLICATE_DAY" in out)
            runs = sum(1 for out, _err in outputs if "RUN_OK" in out)
            self.assertEqual(skips, 4)
            self.assertEqual(runs, 1)
            self.assertEqual(len(events(root, "SKIP_DUPLICATE_DAY")), 4)
            self.assertEqual(snapshot_files(root), ["%s.json" % today])
            self.assertEqual(day_locks(root), ["%s.lock" % today])
            # Every line of the alert log must still parse as JSON.
            self.assertEqual(len(_support.alerts(root)), len(_support.alert_lines(root)))
            document = ledger(root)
            self.assertEqual(document["last_attempt_day"], today)
            self.assertEqual(document["last_success_day"], today)


class MissedDayTests(unittest.TestCase):
    """T1.3 -- missed days are reported, never back-filled."""

    def test_missed_days_are_reported_and_not_backfilled(self):
        with TempDataRoot() as env:
            root = env.root
            today = date.fromisoformat(gate.day_key())
            last_success = today - timedelta(days=3)
            fixture = gate.new_ledger()
            fixture["last_success_day"] = last_success.isoformat()
            fixture["last_success_at_utc"] = "%sT06:35:00Z" % last_success.isoformat()
            fixture["last_attempt_day"] = last_success.isoformat()
            fixture["last_attempt_at_utc"] = "%sT06:35:00Z" % last_success.isoformat()
            fixture["last_outcome"] = "OK_NO_CHANGE"
            paths.write_json_atomic(paths.ledger_path(), fixture)
            _support.write_operator_record(root, today.isoformat(), earnings_total_cents=1025)

            self.assertEqual(
                gate.missed_days(today.isoformat(), fixture),
                [
                    (today - timedelta(days=2)).isoformat(),
                    (today - timedelta(days=1)).isoformat(),
                ],
            )

            code = run_daily_check.run([], sender=_support.RecordingSender())
            self.assertEqual(code, 0)
            missed = events(root, "MISSED_DAY")
            self.assertEqual(len(missed), 2, [m["message"] for m in missed])
            self.assertEqual(ledger(root)["consecutive_missed_days"], 2)
            self.assertEqual(snapshot_files(root), ["%s.json" % today.isoformat()])

    def test_no_missed_day_for_the_pre_history_period(self):
        with TempDataRoot() as env:
            code = run_daily_check.run([], sender=_support.RecordingSender())
            self.assertEqual(code, 0)
            self.assertEqual(events(env.root, "MISSED_DAY"), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
