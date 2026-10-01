"""detector_r4_approval.py -- runtime detector for operator Rule 4.

RULE 4 (operator, verbatim): "human approval before any external action, never
auto-executed."

The detector produces a real pending approval item (day 1 baseline, day 2
earnings change inside one throwaway root) and then attacks the approval surface:

  A. the item must be frozen: status PENDING, execution_state NOT_EXECUTED,
     execution_allowed_by_this_routine false, expires_at_utc null;
  B. a decision must refuse a non-human identity (API call and the shipped CLI);
  C. a decision must refuse an empty decision note;
  D. a human decision must record the human's name and must NOT arm the item:
     execution_state stays NOT_EXECUTED, execution_allowed stays false,
     expires_at_utc stays null;
  E. deciding must have NO side effect outside approvals/: the snapshot set and
     the delivered-notification count must be identical before and after, and no
     new file may appear outside approvals/*.  That is the runtime meaning of
     "never auto-executed": an approval is a record, not a trigger.

Exit codes:: 0 all checks pass, 1 a Rule 4 violation, 2 detector could not run.
"""

import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

BASE_DAY = datetime(2026, 3, 10, 9, 0, tzinfo=timezone.utc)


def tree(root):
    """Every file under *root*, relative and POSIX-normalised."""
    out = set()
    for base, _dirs, names in os.walk(root):
        for name in names:
            out.add(os.path.relpath(os.path.join(base, name), root).replace(os.sep, "/"))
    return out


def delivery_count(root):
    path = os.path.join(root, "logs", "toast-stub.log")
    if not os.path.exists(path):
        return 0
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return sum(1 for line in handle if line.strip())


def main():
    parser = argparse.ArgumentParser(prog="detector_r4_approval.py")
    parser.add_argument("--package", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()

    package = os.path.abspath(args.package)
    root = os.path.abspath(args.root)
    sys.path.insert(0, package)
    os.environ["FREECASH_DATA_ROOT"] = root
    os.environ["FREECASH_TZ"] = "Europe/Berlin"
    os.environ["FREECASH_TOAST_STUB"] = "1"
    os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"

    results = []

    def check(name, ok, evidence):
        results.append((name, bool(ok), evidence))

    try:
        import approval_queue
        import gate
        import operator_state
        import run_daily_check
    except Exception as exc:  # noqa: BLE001
        print("  FAIL  the package under test could be imported")
        print("        evidence: %s: %s" % (type(exc).__name__, exc))
        print("DETECTOR-RESULT: rule=4 FAIL")
        return 2

    def write_record(day, earnings, balance):
        path = os.path.join(root, "state", "operator-state.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as handle:
                document = json.load(handle)
        else:
            document = operator_state.template_document()
        document["records"].append(
            {
                "day_key": day,
                "entered_at_utc": "%sT08:00:00Z" % day,
                "account_status": "ACTIVE",
                "earnings_total_cents": earnings,
                "balance_cents": balance,
                "pending_cents": 0,
                "currency": "USD",
            }
        )
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2)

    day1 = gate.day_key(BASE_DAY)
    day2 = gate.day_key(BASE_DAY + timedelta(days=1))

    try:
        write_record(day1, 1025, 1025)
        write_record(day2, 1050, 1050)
        text = io.StringIO()
        with contextlib.redirect_stdout(text):
            run_daily_check.run(["--source", "operator_state"], now=BASE_DAY)
            code = run_daily_check.run(["--source", "operator_state"], now=BASE_DAY + timedelta(days=1))

        document = approval_queue.load_document()
        pending = [item for item in document.get("items", []) if item.get("status") == approval_queue.STATUS_PENDING]
        check(
            "a detected change produced a pending approval item",
            code == 0 and len(pending) == 1,
            "pending items=%d (exit=%s stdout=%r)"
            % (len(pending), code, text.getvalue().strip()[-200:]),
        )
        item = pending[0] if pending else {}
        check(
            "the item is frozen: NOT_EXECUTED, execution not allowed, no expiry",
            item.get("execution_state") == "NOT_EXECUTED"
            and item.get("execution_allowed_by_this_routine") is False
            and item.get("expires_at_utc") is None
            and item.get("status") == "PENDING",
            "status=%r execution_state=%r execution_allowed=%r expires_at_utc=%r"
            % (
                item.get("status"),
                item.get("execution_state"),
                item.get("execution_allowed_by_this_routine"),
                item.get("expires_at_utc"),
            ),
        )

        # ---- B. a machine identity may not sign a decision
        if item:
            for machine in ("system", "routine", "automation", "agent", "cron", "scheduler", "bot", "machine"):
                try:
                    approval_queue.decide(item["approval_id"], "approve", machine, "machine decided")
                except approval_queue.NotHumanError as exc:
                    check("identity %r is refused" % machine, True, "NotHumanError: %s" % exc)
                except Exception as exc:  # noqa: BLE001
                    check(
                        "identity %r is refused" % machine,
                        False,
                        "%s: %s (expected NotHumanError)" % (type(exc).__name__, exc),
                    )
                else:
                    check("identity %r is refused" % machine, False, "the decision was accepted")

            try:
                approval_queue.decide(item["approval_id"], "approve", "", "no name")
            except approval_queue.NotHumanError as exc:
                check("an empty decider is refused", True, "NotHumanError: %s" % exc)
            except Exception as exc:  # noqa: BLE001
                check("an empty decider is refused", False, "%s: %s" % (type(exc).__name__, exc))
            else:
                check("an empty decider is refused", False, "the decision was accepted")

            try:
                approval_queue.decide(item["approval_id"], "approve", "Alice", "   ")
            except Exception as exc:  # noqa: BLE001
                check("a missing decision note is refused", True, "%s: %s" % (type(exc).__name__, exc))
            else:
                check("a missing decision note is refused", False, "the decision was accepted with no note")

            # the shipped CLI must refuse too (this is the surface the operator uses)
            env = dict(os.environ)
            env["PYTHONPATH"] = package + os.pathsep + env.get("PYTHONPATH", "")
            process = subprocess.run(
                [
                    sys.executable,
                    os.path.join(package, "approval_queue.py"),
                    "decide",
                    "--id",
                    item["approval_id"],
                    "--decision",
                    "approve",
                    "--by",
                    "system",
                    "--note",
                    "cli machine decision",
                ],
                capture_output=True,
                text=True,
                env=env,
                cwd=package,
                timeout=120,
            )
            check(
                "the shipped CLI refuses a non-human --by (exit 4, REFUSED)",
                process.returncode == 4 and "REFUSED" in (process.stdout + process.stderr),
                "exit=%s output=%r" % (process.returncode, (process.stdout + process.stderr).strip()[:200]),
            )
            still = approval_queue.find_item(item["approval_id"])
            check(
                "no refused decision changed the item",
                still is not None
                and still.get("status") == "PENDING"
                and still.get("execution_state") == "NOT_EXECUTED",
                "status=%r execution_state=%r" % (still and still.get("status"), still and still.get("execution_state")),
            )

        # ---- D/E. a human decision records the human and executes nothing
        before_files = tree(root)
        before_deliveries = delivery_count(root)
        if item:
            decided = approval_queue.decide(item["approval_id"], "approve", "Alice Operator", "I reviewed the change")
            check(
                "a human decision is recorded with the human's name",
                decided.get("decided_by") == "Alice Operator" and decided.get("status") == "APPROVED",
                "status=%r decided_by=%r decided_at_utc=%r"
                % (decided.get("status"), decided.get("decided_by"), decided.get("decided_at_utc")),
            )
            check(
                "an approved item is still NOT_EXECUTED and can never expire",
                decided.get("execution_state") == "NOT_EXECUTED"
                and decided.get("execution_allowed_by_this_routine") is False
                and decided.get("expires_at_utc") is None,
                "execution_state=%r execution_allowed=%r expires_at_utc=%r"
                % (
                    decided.get("execution_state"),
                    decided.get("execution_allowed_by_this_routine"),
                    decided.get("expires_at_utc"),
                ),
            )
            reloaded = approval_queue.load_document()
            any_armed = [
                entry.get("approval_id")
                for entry in reloaded.get("items", [])
                if entry.get("execution_state") != "NOT_EXECUTED"
                or entry.get("execution_allowed_by_this_routine") is not False
                or entry.get("expires_at_utc") is not None
            ]
            check(
                "no item in the queue is armed after an approval",
                not any_armed,
                "armed item ids=%s" % (any_armed or "<none>"),
            )
            new_files = sorted(tree(root) - before_files)
            outside = [path for path in new_files if not path.startswith("approvals/")]
            check(
                "an approval created nothing outside approvals/",
                not outside,
                "new files=%s (outside approvals/= %s)" % (new_files or "<none>", outside or "<none>"),
            )
            check(
                "an approval delivered no notification and took no action",
                delivery_count(root) == before_deliveries,
                "deliveries before=%d after=%d" % (before_deliveries, delivery_count(root)),
            )
            trail = os.path.join(root, "approvals", "decided.jsonl")
            records = []
            if os.path.exists(trail):
                with open(trail, "r", encoding="utf-8") as handle:
                    records = [json.loads(line) for line in handle if line.strip()]
            check(
                "the decision trail records the human and the frozen state",
                bool(records)
                and records[-1].get("decided_by") == "Alice Operator"
                and records[-1].get("execution_state") == "NOT_EXECUTED"
                and records[-1].get("execution_allowed_by_this_routine") is False
                and records[-1].get("expires_at_utc") is None,
                "trail last record=%s" % json.dumps(records[-1], sort_keys=True) if records else "trail recorded nothing",
            )
    except Exception as exc:  # noqa: BLE001 - fail closed
        check("the detector ran to completion", False, "%s: %s" % (type(exc).__name__, exc))

    for name, ok, evidence in results:
        print("  %s  %s" % ("PASS" if ok else "FAIL", name))
        print("        evidence: %s" % evidence)
    failed = [name for name, ok, _ in results if not ok]
    if not results:
        print("  FAIL  the detector produced no checks at all")
        print("DETECTOR-RESULT: rule=4 FAIL")
        return 2
    if failed:
        print("DETECTOR-RESULT: rule=4 FAIL (%d of %d checks failed)" % (len(failed), len(results)))
        return 1
    print("DETECTOR-RESULT: rule=4 PASS (%d checks)" % len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
