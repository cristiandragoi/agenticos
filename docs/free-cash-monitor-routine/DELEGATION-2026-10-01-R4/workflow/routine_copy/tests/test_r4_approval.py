"""R4 -- human approval before any external action (T4.1 - T4.4)."""

import json
import re
import subprocess
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import _support
from _support import RecordingSender, TempDataRoot, events

import approval_queue
import changedetect
import gate
import notify
import paths
import run_daily_check
import watchdog

APPROVAL_QUEUE = Path(_support.ROUTINE_DIR) / "approval_queue.py"

BASE = datetime(2026, 10, 1, 6, 35, tzinfo=timezone.utc)

MODULE_FILES = (
    "paths.py",
    "gate.py",
    "readonly_client.py",
    "changedetect.py",
    "notify.py",
    "approval_queue.py",
    "watchdog.py",
    "verify_readonly.py",
    "run_daily_check.py",
    "operator_state.py",
)

APPROVED_LITERAL = re.compile(r"==\s*[\"']APPROVED[\"']")
EXECUTED_LITERAL = re.compile(r"(?<!NOT_)EXECUTED")


def day_at(offset: int) -> str:
    return (BASE.date() + timedelta(days=offset)).isoformat()


def moment(offset: int) -> datetime:
    return BASE + timedelta(days=offset)


def scan_for_execution(root) -> list:
    """Every occurrence of the token in the state tree, minus NOT_EXECUTED."""
    found = []
    for path in Path(root).rglob("*"):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for hit in EXECUTED_LITERAL.findall(text):
            found.append("%s: %s" % (path, hit))
    return found


class PendingForeverTests(unittest.TestCase):
    """T4.1 -- no clock advance may convert a pending item into an executed one."""

    def test_pending_item_survives_a_ninety_day_clock_advance(self):
        with TempDataRoot() as env:
            root = env.root
            sender = RecordingSender()
            _support.write_operator_record(root, day_at(0), earnings_total_cents=1025, balance_cents=1025)
            self.assertEqual(run_daily_check.run([], now=moment(0), sender=sender), 0)
            _support.write_operator_record(root, day_at(1), earnings_total_cents=1340, balance_cents=1340)
            self.assertEqual(run_daily_check.run([], now=moment(1), sender=sender), 0)

            items = _support.pending_document(root)["items"]
            self.assertEqual(len(items), 1)
            approval_id = items[0]["approval_id"]

            for offset in range(2, 91):
                self.assertEqual(run_daily_check.run([], now=moment(offset), sender=sender), 0)
                watchdog.check(now=moment(offset), sender=sender)

            document = _support.pending_document(root)
            self.assertEqual(len(document["items"]), 1)
            item = document["items"][0]
            self.assertEqual(item["approval_id"], approval_id)
            self.assertEqual(item["status"], "PENDING")
            self.assertIsNone(item["expires_at_utc"], "expires_at_utc must always be null")
            self.assertIsNone(item["decided_at_utc"])
            self.assertIsNone(item["decided_by"])
            self.assertEqual(item["execution_state"], "NOT_EXECUTED")
            self.assertFalse(item["execution_allowed_by_this_routine"])

            reminders = [
                record
                for record in events(root, "APPROVAL_PENDING")
                if (record.get("observed") or {}).get("reminder")
            ]
            self.assertGreaterEqual(len(reminders), 12)
            self.assertLessEqual(len(reminders), 13, "at most one reminder per 7 days")
            self.assertEqual(scan_for_execution(root), [], "no component executed anything")


class HumanDecisionTests(unittest.TestCase):
    """T4.2 -- the decision CLI records who decided and why.  Nothing else changes."""

    def _seed(self, root, day="2026-10-02"):
        change = {
            "change_type": "EARNINGS_CHANGED",
            "field": "earnings_total_cents",
            "old_value": 1025,
            "new_value": 1340,
        }
        return approval_queue.enqueue(day, change, "earnings moved", now=moment(1))

    def test_decide_records_the_decision_and_keeps_the_freeze(self):
        with TempDataRoot() as env:
            root = env.root
            item = self._seed(root)
            decided = approval_queue.decide(
                item["approval_id"], "approve", "Operator Jane", "I checked the figures myself"
            )
            self.assertEqual(decided["status"], "APPROVED")
            self.assertEqual(decided["decided_by"], "Operator Jane")
            self.assertEqual(decided["decision_note"], "I checked the figures myself")
            self.assertTrue(decided["decided_at_utc"])
            self.assertEqual(decided["execution_state"], "NOT_EXECUTED")
            self.assertIsNone(decided["expires_at_utc"])
            self.assertFalse(decided["execution_allowed_by_this_routine"])

            lines = [
                line
                for line in (paths.decided_path()).read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual(len(lines), 1)
            record = json.loads(lines[0])
            self.assertEqual(record["approval_id"], item["approval_id"])
            self.assertEqual(record["decision"], "APPROVED")
            self.assertEqual(record["execution_state"], "NOT_EXECUTED")
            self.assertEqual(scan_for_execution(root), [])

    def test_documented_cli_invocation_works_and_reject_is_recorded(self):
        with TempDataRoot() as env:
            root = env.root
            item = self._seed(root)
            process = subprocess.run(
                [
                    sys.executable,
                    str(APPROVAL_QUEUE),
                    "decide",
                    "--id",
                    item["approval_id"],
                    "--decision",
                    "reject",
                    "--by",
                    "Operator Jane",
                    "--note",
                    "keeping an eye on it, not needed",
                ],
                capture_output=True,
                text=True,
                env=env.env(),
            )
            self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
            self.assertIn("REJECTED", process.stdout)
            self.assertIn("this routine executes nothing", process.stdout)
            items = _support.pending_document(root)["items"]
            self.assertEqual(items[0]["status"], "REJECTED")
            self.assertEqual(items[0]["execution_state"], "NOT_EXECUTED")
            self.assertIsNone(items[0]["expires_at_utc"])

    def test_a_machine_may_not_sign_a_decision(self):
        with TempDataRoot() as env:
            item = self._seed(env.root)
            for identity in ("system", "routine", "cron", "   ", "scheduler"):
                with self.assertRaises(approval_queue.NotHumanError, msg=identity):
                    approval_queue.decide(item["approval_id"], "approve", identity, "auto")
            with self.assertRaises(ValueError):
                approval_queue.decide(item["approval_id"], "approve", "Operator Jane", "   ")
            self.assertEqual(_support.pending_document(env.root)["items"][0]["status"], "PENDING")
            self.assertFalse(paths.decided_path().exists())

    def test_cli_refuses_a_machine_identity_with_exit_code_4(self):
        with TempDataRoot() as env:
            item = self._seed(env.root)
            process = subprocess.run(
                [
                    sys.executable,
                    str(APPROVAL_QUEUE),
                    "decide",
                    "--id",
                    item["approval_id"],
                    "--decision",
                    "approve",
                    "--by",
                    "system",
                    "--note",
                    "automatic",
                ],
                capture_output=True,
                text=True,
                env=env.env(),
            )
            self.assertEqual(process.returncode, 4, process.stdout + process.stderr)
            self.assertIn("REFUSED", process.stderr)


class ExpiredApprovalTests(unittest.TestCase):
    """T4.3 -- a past expiry and an APPROVED status still execute nothing."""

    def test_past_expiry_plus_approved_status_executes_nothing(self):
        with TempDataRoot() as env:
            root = env.root
            today = gate.day_key()
            crafted = {
                "schema_version": 1,
                "updated_at_utc": "2026-01-01T00:00:00Z",
                "items": [
                    {
                        "approval_id": "11111111-2222-3333-4444-555555555555",
                        "created_at_utc": "2025-12-01T08:00:00Z",
                        "day_key": "2025-12-01",
                        "change_dedupe_key": "deadbeef",
                        "reason": "crafted fixture: already decided, long expired",
                        "proposed_action": {"action_type": "OPERATOR_REVIEW", "amount_cents": 315},
                        "status": "APPROVED",
                        "status_reason": "approved long ago",
                        "decided_at_utc": "2025-12-01T09:00:00Z",
                        "decided_by": "Operator Jane",
                        "decision_note": "approved at the time",
                        "expires_at_utc": "2025-12-08T09:00:00Z",
                        "execution_state": "NOT_EXECUTED",
                        "execution_allowed_by_this_routine": False,
                    }
                ],
            }
            paths.write_json_atomic(paths.pending_path(), crafted)
            before = paths.pending_path().read_bytes()

            _support.write_operator_record(root, today, earnings_total_cents=1340, balance_cents=1340)
            self.assertEqual(run_daily_check.run([], sender=RecordingSender()), 0)
            watchdog.check(sender=RecordingSender())
            approval_queue.main(["list"])

            self.assertEqual(paths.pending_path().read_bytes(), before, "no component may rewrite the item")
            self.assertEqual(scan_for_execution(root), [], "a past expiry must never produce an execution")
            item = _support.pending_document(root)["items"][0]
            self.assertEqual(item["status"], "APPROVED")
            self.assertEqual(item["execution_state"], "NOT_EXECUTED")
            self.assertEqual(item["expires_at_utc"], "2025-12-08T09:00:00Z")


class StaticFreezeTests(unittest.TestCase):
    """T4.4 -- the routine cannot execute: there is no such code path to find."""

    def test_no_module_treats_an_approved_status_as_a_trigger(self):
        for name in MODULE_FILES:
            text = (Path(_support.ROUTINE_DIR) / name).read_text(encoding="utf-8")
            for lineno, line in enumerate(text.splitlines(), start=1):
                self.assertIsNone(
                    APPROVED_LITERAL.search(line),
                    "%s:%d reads an approved status: %s" % (name, lineno, line.strip()),
                )
                self.assertFalse(
                    EXECUTED_LITERAL.search(line),
                    "%s:%d carries an executable state token: %s" % (name, lineno, line.strip()),
                )
                if 'execution_state"] =' in line:
                    self.assertIn("EXECUTION_STATE_NOT_EXECUTED", line, "%s:%d" % (name, lineno))

    def test_only_the_readonly_client_may_reach_a_socket_library(self):
        for name in MODULE_FILES:
            text = (Path(_support.ROUTINE_DIR) / name).read_text(encoding="utf-8")
            self.assertNotIn("import socket", text, name)
            self.assertNotIn("import requests", text, name)
            self.assertNotIn("import httpx", text, name)
            if name in ("readonly_client.py", "verify_readonly.py"):
                # The transport, and the checker's own pattern table, are the two
                # places allowed to name these tokens -- both carry exemptions.
                self.assertIn("readonly-exempt:", text, name)
                continue
            self.assertNotIn("http.client", text, name)  # readonly-exempt: negative assertion in a test; it reads module source and never opens a socket
            self.assertNotIn("urllib.request", text, name)
            self.assertNotIn("socket.socket", text, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
