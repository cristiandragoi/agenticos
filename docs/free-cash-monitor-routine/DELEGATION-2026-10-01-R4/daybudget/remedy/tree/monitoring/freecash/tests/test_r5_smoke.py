"""T5.1 / T5.2 -- fresh install, bounded delivery failure, watchdog, refusals."""

import json
import unittest
from datetime import datetime, timedelta, timezone

import _support
from _support import RecordingSender, TempDataRoot, events

import gate
import notify
import paths
import run_daily_check
import watchdog

BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)


def day_at(offset: int) -> str:
    return (BASE.date() + timedelta(days=offset)).isoformat()


def moment(offset: int) -> datetime:
    return BASE + timedelta(days=offset)


class FreshInstallTests(unittest.TestCase):
    """T5.1 -- the first ever run."""

    def test_first_run_with_operator_data_is_a_silent_baseline(self):
        with TempDataRoot() as env:
            root = env.root
            today = gate.day_key()
            _support.write_operator_record(root, today, earnings_total_cents=1025, balance_cents=1025)
            sender = RecordingSender()
            self.assertEqual(run_daily_check.run([], sender=sender), 0)
            self.assertEqual(len(events(root, "INITIAL_BASELINE")), 1)
            self.assertEqual(sender.messages, [], "a first run must not produce a fake alarm")
            self.assertEqual(_support.snapshot_files(root), ["%s.json" % today])
            self.assertEqual(_support.ledger(root)["last_success_day"], today)
            self.assertEqual(events(root, "MISSED_DAY"), [])
            self.assertEqual(_support.pending_document(root)["items"], [])
            self.assertEqual(_support.day_locks(root), ["%s.lock" % today])

    def test_first_run_without_data_spends_no_day_and_reports_no_data(self):
        """A fresh install with no reading must not spend the day key.

        CHANGED by stream D (day budget, operator rule R2 "check status once per
        day").  The shipped expectation was ``run without data -> the day is
        consumed, a null snapshot exists and a success day is booked`` -- which is
        exactly the defect: a run that acquired nothing spent the day, advanced
        ``last_success_day`` and silenced the watchdog.
        """
        with TempDataRoot() as env:
            root = env.root
            today = gate.day_key()
            sender = RecordingSender()
            self.assertEqual(run_daily_check.run([], sender=sender), 0)
            self.assertEqual(sender.messages, [])
            degraded = events(root, "MONITOR_DEGRADED")
            self.assertEqual(len(degraded), 1, [record["message"] for record in degraded])
            self.assertEqual(degraded[0]["severity"], "info")
            # no reading -> no day spent, no snapshot, no ledger row at all
            self.assertEqual(_support.day_locks(root), [], "the day %s must not be consumed" % today)
            self.assertEqual(_support.snapshot_files(root), [])
            self.assertFalse(paths.ledger_path().exists(), "a run that acquired nothing books nothing")
            self.assertEqual(_support.ledger(root), {})
            self.assertEqual(_support.pending_document(root)["items"], [])
            # the day is still free, so a second data-less run is no-data again
            self.assertEqual(run_daily_check.run([], sender=sender), 0)
            self.assertEqual(len(events(root, "SKIP_DUPLICATE_DAY")), 0)
            self.assertEqual(_support.day_locks(root), [])


class DeliveryFailureTests(unittest.TestCase):
    """T5.2 -- two attempts, one full record, then never again."""

    def test_delivery_failure_is_bounded_and_keeps_the_full_message(self):
        with TempDataRoot() as env:
            root = env.root
            good = RecordingSender()
            _support.write_operator_record(root, day_at(0), earnings_total_cents=1025, balance_cents=1025)
            self.assertEqual(run_daily_check.run([], now=moment(0), sender=good), 0)

            failing = RecordingSender(fail_times=2)
            _support.write_operator_record(root, day_at(1), earnings_total_cents=1340, balance_cents=1340)
            code = run_daily_check.run([], now=moment(1), sender=failing)
            self.assertEqual(code, 0, "a delivery failure must never fail the run")
            self.assertEqual(failing.attempts, 2, "at most two attempts, then stop")
            failures = events(root, "DELIVERY_FAILED")
            self.assertEqual(len(failures), 1, [record["message"] for record in failures])
            self.assertIn("$10.25 -> $13.40", failures[0]["message"])
            self.assertIn("No action taken", failures[0]["message"])
            self.assertEqual(notify.key_delivery(failures[0]["dedupe_key"]), "FAILED_TOAST")
            self.assertEqual(len(events(root, "MONITOR_DEGRADED")), 1)
            self.assertEqual(
                _support.snapshot_files(root), ["%s.json" % day_at(0), "%s.json" % day_at(1)]
            )
            self.assertEqual(_support.ledger(root)["last_success_day"], day_at(1))
            self.assertEqual(_support.ledger(root)["last_outcome"], "EARNINGS_CHANGED")


class WatchdogTests(unittest.TestCase):
    """The same-evening missed-run detector, read-only over the state directory."""

    def test_healthy_day_raises_no_alarm(self):
        with TempDataRoot() as env:
            today = gate.day_key()
            _support.write_operator_record(env.root, today)
            self.assertEqual(run_daily_check.run([], sender=RecordingSender()), 0)
            state = watchdog.check(sender=RecordingSender())
            self.assertTrue(state["covered"])
            self.assertEqual(events(env.root, "MISSED_DAY"), [])

    def test_missing_check_raises_one_alarm_and_changes_no_state(self):
        with TempDataRoot() as env:
            root = env.root
            before = _support.ledger(root)
            state = watchdog.check(sender=RecordingSender())
            self.assertFalse(state["covered"])
            missed = events(root, "MISSED_DAY")
            self.assertEqual(len(missed), 1)
            self.assertEqual(missed[0]["severity"], "alert")
            self.assertIn("MISSED DAY", missed[0]["message"])
            self.assertEqual(_support.snapshot_files(root), [])
            self.assertFalse(paths.ledger_path().exists())
            watchdog.check(sender=RecordingSender())
            self.assertEqual(len(events(root, "MISSED_DAY")), 1, "the same day alarms once")
            self.assertEqual(_support.ledger(root), before)


class RefusalTests(unittest.TestCase):
    """A second status read on the same day is refused and audited."""

    def test_force_recheck_is_refused_and_recorded(self):
        with TempDataRoot() as env:
            root = env.root
            result = _support.run_entry_point(
                ["--force-recheck", "--reason", "I want to look again"], env=env.env()
            )
            self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
            self.assertIn("REFUSED_FORCE_RECHECK", result.stdout)
            self.assertEqual(_support.snapshot_files(root), [])
            self.assertEqual(_support.day_locks(root), [])
            audit = paths.logs_dir() / "forced-recheck-requests.jsonl"
            self.assertTrue(audit.exists())
            record = json.loads(audit.read_text(encoding="utf-8").strip())
            self.assertEqual(record["decision"], "REFUSED")
            self.assertEqual(record["reason"], "I want to look again")

    def test_print_state_is_read_only(self):
        with TempDataRoot() as env:
            result = _support.run_entry_point(["--print-state"], env=env.env())
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("schema_version", result.stdout)
            self.assertEqual(_support.snapshot_files(env.root), [])
            self.assertEqual(_support.day_locks(env.root), [])

    def test_unknown_read_source_is_rejected(self):
        with TempDataRoot() as env:
            result = _support.run_entry_point(env=env.env(FREECASH_READ_SOURCE="provider_api"))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unknown read source", result.stderr)
            self.assertEqual(_support.day_locks(env.root), [], "no day may be consumed by a bad invocation")


if __name__ == "__main__":
    unittest.main(verbosity=2)
