"""R3 -- notify on an earnings or account-status change (T3.1 - T3.4)."""

import hashlib
import json
import unittest
from datetime import datetime, timedelta, timezone

import _support
from _support import RecordingSender, TempDataRoot, events, snapshot_files

import changedetect
import notify
import paths
import run_daily_check

#: 06:35 UTC is 08:35 Europe/Berlin -- the designed run time, well clear of both
#: the midnight and the DST boundary, so the local day key is unambiguous.
BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)


def day_at(offset: int) -> str:
    return (BASE.date() + timedelta(days=offset)).isoformat()


def moment(offset: int) -> datetime:
    return BASE + timedelta(days=offset)


class ChangeDetectionTests(unittest.TestCase):
    def setUp(self):
        self.env = TempDataRoot()
        self.root = self.env.__enter__().root

    def tearDown(self):
        self.env.__exit__(None, None, None)

    def run_day(self, offset, sender, **fields):
        day = day_at(offset)
        _support.write_operator_record(self.root, day, **fields)
        code = run_daily_check.run([], now=moment(offset), sender=sender)
        self.assertEqual(code, 0)
        return day

    def successful(self):
        return RecordingSender()

    # ---------------------------------------------------------------- T3.1

    def test_earnings_change_notifies_exactly_once(self):
        sender = self.successful()
        day0 = self.run_day(0, sender, earnings_total_cents=1025, balance_cents=1025)
        self.assertEqual(sender.messages, [], "a first run must not produce a fake alarm")
        self.assertEqual(len(events(self.root, "INITIAL_BASELINE")), 1)
        self.assertEqual(_support.pending_document(self.root)["items"], [])

        day1 = self.run_day(1, sender, earnings_total_cents=1340, balance_cents=1340)
        earnings = events(self.root, "EARNINGS_CHANGED")
        self.assertEqual(len(earnings), 1, [e["message"] for e in earnings])
        self.assertEqual(earnings[0]["observed"]["old_value"], 1025)
        self.assertEqual(earnings[0]["observed"]["new_value"], 1340)
        self.assertEqual(len(sender.messages), 1, "exactly one notification per distinct change")
        self.assertIn("EARNINGS CHANGE %s" % day1, sender.messages[0])
        self.assertIn("$10.25 -> $13.40", sender.messages[0])
        self.assertIn("(+$3.15)", sender.messages[0])
        self.assertIn("No action taken", sender.messages[0])
        self.assertEqual(notify.key_delivery(earnings[0]["dedupe_key"]), "TOAST_OK")
        items = _support.pending_document(self.root)["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["status"], "PENDING")
        self.assertIsNone(items[0]["expires_at_utc"])
        self.assertEqual(items[0]["execution_state"], "NOT_EXECUTED")
        self.assertFalse(items[0]["execution_allowed_by_this_routine"])

    # ---------------------------------------------------------------- T3.2

    def test_status_change_notifies_exactly_once_and_uses_its_own_key(self):
        sender = self.successful()
        self.run_day(0, sender, account_status="ACTIVE", earnings_total_cents=1340, balance_cents=1340)
        day1 = self.run_day(1, sender, account_status="RESTRICTED", earnings_total_cents=1340, balance_cents=1340)
        status = events(self.root, "STATUS_CHANGED")
        self.assertEqual(len(status), 1, [e["message"] for e in status])
        self.assertEqual(len(sender.messages), 1)
        self.assertIn("STATUS CHANGE %s" % day1, sender.messages[0])
        self.assertIn("ACTIVE -> RESTRICTED", sender.messages[0])
        self.assertEqual(events(self.root, "EARNINGS_CHANGED"), [])
        earnings_key = changedetect.dedupe_key(day1, "EARNINGS_CHANGED", "earnings_total_cents", 1025, 1340)
        self.assertNotEqual(status[0]["dedupe_key"], earnings_key)

    # ---------------------------------------------------------------- T3.3

    def test_no_change_day_is_log_only(self):
        sender = self.successful()
        self.run_day(0, sender, earnings_total_cents=1340, balance_cents=1340)
        self.run_day(1, sender, earnings_total_cents=1340, balance_cents=1340)
        quiet = events(self.root, "OK_NO_CHANGE")
        self.assertEqual(len(quiet), 1, [e["message"] for e in quiet])
        self.assertEqual(quiet[0]["severity"], "info")
        self.assertIn("No notification sent", quiet[0]["message"])
        self.assertEqual(len(sender.messages), 0, "OK_NO_CHANGE must never dispatch")
        self.assertEqual(_support.pending_document(self.root)["items"], [])

    # ---------------------------------------------------------------- exactness

    def test_one_cent_is_a_change_because_cents_are_exact(self):
        sender = self.successful()
        self.run_day(0, sender, earnings_total_cents=20000, balance_cents=20000)
        self.run_day(1, sender, earnings_total_cents=20099, balance_cents=20000)
        self.assertEqual(len(events(self.root, "EARNINGS_CHANGED")), 1)
        self.assertEqual(len(sender.messages), 1)

    def test_pending_movement_counts_as_an_earnings_change(self):
        sender = self.successful()
        self.run_day(0, sender, pending_cents=0)
        self.run_day(1, sender, pending_cents=315)
        pending = events(self.root, "EARNINGS_CHANGED")
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["observed"]["field"], "pending_cents")

    def test_balance_movement_has_its_own_type(self):
        sender = self.successful()
        self.run_day(0, sender, balance_cents=1025, earnings_total_cents=1340)
        self.run_day(1, sender, balance_cents=1025 + 500, earnings_total_cents=1340)
        self.assertEqual(len(events(self.root, "BALANCE_CHANGED")), 1)

    # ---------------------------------------------------------------- T3.4

    def test_same_key_is_never_notified_twice_and_the_key_includes_the_day(self):
        day = day_at(1)
        other_day = day_at(2)
        spy = RecordingSender()
        change = {
            "change_type": "EARNINGS_CHANGED",
            "field": "earnings_total_cents",
            "old_value": 1025,
            "new_value": 1340,
            "prior_day_key": day_at(0),
        }
        key = changedetect.dedupe_key(day, "EARNINGS_CHANGED", "earnings_total_cents", 1025, 1340)
        subject = "%s|%s|%s|%s|%s" % (day, "EARNINGS_CHANGED", "earnings_total_cents", 1025, 1340)
        self.assertEqual(key, hashlib.sha256(subject.encode("utf-8")).hexdigest())

        self.assertEqual(notify.notify_change(day, change, "m1", key, sender=spy, sleep_seconds=0), "NOTIFIED")
        self.assertEqual(notify.notify_change(day, change, "m1", key, sender=spy, sleep_seconds=0), "DEDUPED")
        self.assertEqual(len(spy.messages), 1, "the same key must never notify twice")
        self.assertEqual(len(events(self.root, "EARNINGS_CHANGED")), 2, "both detections are logged")

        later_key = changedetect.dedupe_key(
            other_day, "EARNINGS_CHANGED", "earnings_total_cents", 1025, 1340
        )
        self.assertNotEqual(key, later_key, "the day key is part of the dedupe key")
        self.assertEqual(
            notify.notify_change(other_day, change, "m2", later_key, sender=spy, sleep_seconds=0),
            "NOTIFIED",
        )
        self.assertEqual(len(spy.messages), 2)

    # ---------------------------------------------------------------- schema

    def test_snapshot_is_immutable_once_written(self):
        day = day_at(0)
        metrics = changedetect.normalize_metrics(dict(_support.DEFAULT_METRICS))
        snapshot = changedetect.build_snapshot(day, metrics, {"kind": "operator_entered"}, b"{}")
        path, written = changedetect.save_snapshot(snapshot)
        self.assertTrue(written)
        before = path.read_bytes()
        tampered = json.loads(before.decode("utf-8"))
        tampered["earnings_total_cents"] = 999999
        _path2, written_again = changedetect.save_snapshot(tampered)
        self.assertFalse(written_again)
        self.assertEqual(path.read_bytes(), before)

    def test_missing_field_is_a_metric_error_not_a_zero(self):
        with self.assertRaises(changedetect.MetricError):
            changedetect.normalize_metrics({"account_status": "ACTIVE", "earnings_total_cents": 1})
        with self.assertRaises(changedetect.MetricError):
            changedetect.normalize_metrics({"status": "ACTIVE", "earnings_cents": "x", "balance_cents": 1, "pending_cents": 0})

    def test_whole_currency_and_cents_aliases_both_work(self):
        with_cents = changedetect.normalize_metrics(dict(_support.DEFAULT_METRICS))
        self.assertEqual(with_cents["earnings_total_cents"], 1025)
        with_dollars = changedetect.normalize_metrics(
            {"status": "ACTIVE", "earnings_total": 10.25, "balance": "10.25", "pending": 0}
        )
        self.assertEqual(with_dollars["earnings_total_cents"], 1025)
        self.assertEqual(with_dollars["balance_cents"], 1025)

    def test_currency_change_is_degraded_not_a_change(self):
        metrics = changedetect.normalize_metrics(dict(_support.DEFAULT_METRICS))
        prior = changedetect.build_snapshot(day_at(0), metrics, {"kind": "operator_entered"}, b"a")
        other = dict(metrics)
        other["currency"] = "EUR"
        current = changedetect.build_snapshot(day_at(1), other, {"kind": "operator_entered"}, b"b")
        verdict = changedetect.compare(prior, current)
        self.assertEqual(verdict["changes"], [])
        self.assertTrue(any("currency changed" in note for note in verdict["degraded"]))

    def test_prior_without_data_is_a_baseline_not_a_change(self):
        metrics = changedetect.normalize_metrics(dict(_support.DEFAULT_METRICS))
        prior = changedetect.build_snapshot(day_at(0), {}, {"kind": "x", "data_available": False}, b"")
        current = changedetect.build_snapshot(day_at(1), metrics, {"kind": "x"}, b"c")
        verdict = changedetect.compare(prior, current)
        self.assertTrue(verdict["baseline"])
        self.assertEqual(verdict["changes"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
