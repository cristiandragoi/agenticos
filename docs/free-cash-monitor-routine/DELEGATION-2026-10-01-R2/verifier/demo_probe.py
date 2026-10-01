"""demo_probe.py -- executed runtime demonstration for one mutant package.

Verifier-owned (DESIGN TRACK 3, DELEGATION-2026-10-01-R2).  This file is NEVER
copied into a mutant package: it is passed a package directory and imports that
package by putting it first on sys.path, so a mutant cannot edit its own probe.

Usage::

    python demo_probe.py <kind> <pkg_dir> <data_root>

kinds
    r1_twice       run the entry point twice on the same operator-local day
    r1_concurrent  5 concurrent entry-point processes on the same day
    r3_two_days    seed two operator days and run both, in order
    r2_forbidden   exercise the transport guard from the read path
    r2_bypass      call a suspected out-of-band write helper, if present
    r4_decide      enqueue an item, then attempt machine and human deciders

HARD GUARD: refuses to run unless *data_root* is a throwaway path under the
user's Temp directory and is not the production root.  Fail closed, run nothing.
"""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

PRODUCTION_ROOT = Path("D:/AgenticOS/data/freecash-monitor").resolve()
_VERIFIER_TEMP = Path(tempfile.gettempdir()).resolve()


def assert_scratch(root) -> Path:
    """Fail closed unless *root* is a throwaway dir under the user's Temp."""
    resolved = Path(root).resolve()
    if resolved == PRODUCTION_ROOT:
        raise SystemExit("REFUSED: refusing to run against the production root")
    try:
        resolved.relative_to(_VERIFIER_TEMP)
    except ValueError:
        raise SystemExit("REFUSED: data root %s is not under %s" % (resolved, _VERIFIER_TEMP))
    if "fc-r2-" not in str(resolved):
        raise SystemExit("REFUSED: data root %s is not a verifier scratch root" % resolved)
    return resolved


def import_package(pkg: Path):
    pkg = Path(pkg).resolve()
    if not (pkg / "paths.py").exists():
        raise SystemExit("REFUSED: %s is not a freecash package" % pkg)
    sys.path.insert(0, str(pkg))
    os.chdir(str(pkg))
    import notify  # noqa: E402

    captured = []

    class RecordingSender:
        delivery_label = "STUB_OK"

        def __call__(self, message):
            captured.append(message)

    notify.set_sender(RecordingSender())
    return captured


def _run_capture(fn, *a, **kw):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        code = fn(*a, **kw)
    return code, buf.getvalue()


def _ledger(root):
    p = Path(root) / "state" / "last-run.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _alerts(root):
    out = []
    p = Path(root) / "alerts" / "alerts.jsonl"
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            with contextlib.suppress(ValueError):
                out.append(json.loads(line))
    return out


def _pending(root):
    p = Path(root) / "approvals" / "pending.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("items", [])
    except (OSError, ValueError):
        return []


def _snapshots(root):
    return sorted(x.name for x in (Path(root) / "snapshots").glob("*.json"))


def seed_operator_state(root, records):
    p = Path(root) / "state" / "operator-state.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "operator_entered_daily_status",
                "note": "verifier seed (DELEGATION-2026-10-01-R2)",
                "records": records,
                "template_record": {"day_key": "YYYY-MM-DD"},
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def out(record):
    print("PROBE_JSON " + json.dumps(record, sort_keys=True, default=str))


# --------------------------------------------------------------------------- kinds

DAY_A = datetime(2026, 9, 30, 12, 0, 0, tzinfo=timezone.utc)
DAY_B = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)


def kind_r1_twice(pkg, root):
    import run_daily_check

    first_code, first_text = _run_capture(run_daily_check.run, [], now=DAY_B)
    second_code, second_text = _run_capture(run_daily_check.run, [], now=DAY_B)
    out(
        {
            "kind": "r1_twice",
            "day": "2026-10-01",
            "run1_exit": first_code,
            "run1_first_line": first_text.strip().splitlines()[0] if first_text.strip() else "",
            "run2_exit": second_code,
            "run2_first_line": second_text.strip().splitlines()[0] if second_text.strip() else "",
            "run2_performed_a_read": second_text.strip().startswith("RUN_OK"),
            "snapshots": _snapshots(root),
            "alert_event_types": [a.get("event_type") for a in _alerts(root)],
            "ledger_last_outcome": _ledger(root).get("last_outcome"),
        }
    )


def kind_r1_concurrent(pkg, root, workers=5):
    """N concurrent CLI processes, same day.  Count the winners."""
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(root)
    procs = [
        subprocess.Popen(
            [sys.executable, "run_daily_check.py"],
            cwd=str(pkg),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        for _ in range(workers)
    ]
    outputs = []
    for proc in procs:
        text, _ = proc.communicate(timeout=120)
        lines = (text or "").strip().splitlines()
        outputs.append(
            {
                "exit": proc.returncode,
                "first_line": lines[0] if lines else "",
                "tail": lines[-4:] if lines else [],
            }
        )
    winners = [o for o in outputs if o["first_line"].startswith("RUN_OK")]
    out(
        {
            "kind": "r1_concurrent",
            "workers": workers,
            "ok_runs": len(winners),
            "skip_runs": len([o for o in outputs if o["first_line"].startswith("SKIP_DUPLICATE_DAY")]),
            "exits": [o["exit"] for o in outputs],
            "snapshots": _snapshots(root),
            "outputs": outputs,
        }
    )


def kind_r3_two_days(pkg, root):
    import run_daily_check

    seed_operator_state(
        root,
        [
            {
                "day_key": "2026-09-30",
                "entered_at_utc": "2026-09-30T12:00:00Z",
                "account_status": "ACTIVE",
                "earnings_total_cents": 1000,
                "balance_cents": 1000,
                "pending_cents": 0,
                "currency": "USD",
            },
            {
                "day_key": "2026-10-01",
                "entered_at_utc": "2026-10-01T12:00:00Z",
                "account_status": "ACTIVE",
                "earnings_total_cents": 1025,
                "balance_cents": 1025,
                "pending_cents": 0,
                "currency": "USD",
            },
        ],
    )
    d1_code, d1_text = _run_capture(run_daily_check.run, [], now=DAY_A)
    d1_ledger = _ledger(root)
    d1_alerts = [a.get("event_type") for a in _alerts(root)]
    d2_code, d2_text = _run_capture(run_daily_check.run, [], now=DAY_B)
    d2_ledger = _ledger(root)
    d2_alerts = [a.get("event_type") for a in _alerts(root)]
    out(
        {
            "kind": "r3_two_days",
            "day1_outcome": d1_ledger.get("last_outcome"),
            "day1_alerts": d1_alerts,
            "day2_outcome": d2_ledger.get("last_outcome"),
            "day2_alerts_all": d2_alerts,
            "day2_new_alert_types": d2_alerts[len(d1_alerts):],
            "day2_exit": d2_code,
            "day2_line": d2_text.strip().splitlines()[0] if d2_text.strip() else "",
            "pending_items": [{"status": i.get("status"), "execution_state": i.get("execution_state"), "expires_at_utc": i.get("expires_at_utc")} for i in _pending(root)],
            "snapshots": _snapshots(root),
        }
    )


def kind_r2_forbidden(pkg, root):
    """Exercise the read path's guard with a write verb/path, no real socket."""
    import readonly_client

    reached = []

    def fake_transport(method, url, timeout=None, headers=None):
        reached.append({"method": method, "url": url})
        return {"method": method, "url": url, "status": 200, "reason": "OK", "headers": {}, "body": b"{}"}

    attempts = [
        ("POST", "http://localhost:3001/api/v1/cashout"),
        ("POST", "http://localhost:3001/api/v1/transactions"),
        ("DELETE", "http://localhost:3001/api/v1/status/metrics"),
        ("GET", "http://localhost:3001/api/v1/status/metrics"),
    ]
    results = []
    for method, url in attempts:
        try:
            readonly_client.request(method, url, transport=fake_transport)
            results.append({"attempt": "%s %s" % (method, url), "outcome": "ALLOWED"})
        except readonly_client.ForbiddenWriteError as exc:
            results.append({"attempt": "%s %s" % (method, url), "outcome": "ForbiddenWriteError", "detail": str(exc)})
        except Exception as exc:  # pragma: no cover - defensive
            results.append({"attempt": "%s %s" % (method, url), "outcome": type(exc).__name__, "detail": str(exc)})
    # A body on an otherwise-allowlisted read must also be refused.
    try:
        readonly_client.request("GET", "http://localhost:3001/api/v1/status/metrics", transport=fake_transport, json={"x": 1})
        body_outcome = "ALLOWED"
    except readonly_client.ForbiddenWriteError as exc:
        body_outcome = "ForbiddenWriteError: %s" % exc
    out(
        {
            "kind": "r2_forbidden",
            "attempts": results,
            "allowed_write_requests": [r for r in results if r["outcome"] == "ALLOWED" and "GET" not in r["attempt"]],
            "body_on_read": body_outcome,
            "transport_reached": reached,
            "module_file": readonly_client.__file__,
        }
    )


def kind_r2_bypass(pkg, root):
    """Call a suspected out-of-band write helper if one was added to the entry file."""
    import run_daily_check

    helper_names = [n for n in dir(run_daily_check) if n.startswith("_submit") or n.startswith("_claim") or n.startswith("_post")]
    record = {"kind": "r2_bypass", "helpers_found": helper_names}
    for name in helper_names:
        fn = getattr(run_daily_check, name)
        try:
            result = fn("2026-10-01")
            record[name] = {"outcome": "RETURNED", "value": str(result)}
        except Exception as exc:
            record[name] = {"outcome": type(exc).__name__, "detail": str(exc)}
    out(record)


MACHINE_NAMES = ["system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"]
MACHINE_LOOKALIKES = ["agent-007", "cron-runner", "automation-2", "AI-Agent", "scheduler.exe", "bot:alpha", "RoutineBot", "  SYSTEM  ", "report-machine"]
HUMAN_NAMES = ["Alice Operator", "J. Schmidt"]


def kind_r4_decide(pkg, root):
    import approval_queue

    results = {"kind": "r4_decide", "api": {}, "cli": {}, "frozen_fields": {}}
    item = approval_queue.enqueue(
        "2026-03-11",
        {"dedupe_key": "verifier-key", "new_value": 1050},
        "verifier probe reason",
        now=datetime(2026, 3, 11, 7, 0, 0, tzinfo=timezone.utc),
    )
    aid = item["approval_id"]
    results["item_created"] = {
        "status": item.get("status"),
        "execution_state": item.get("execution_state"),
        "expires_at_utc": item.get("expires_at_utc"),
        "execution_allowed_by_this_routine": item.get("execution_allowed_by_this_routine"),
    }

    def attempt(name):
        try:
            approval_queue.decide(aid, "approve", name, "verifier note", now=datetime(2026, 3, 11, 8, 0, 0, tzinfo=timezone.utc))
            return "ACCEPTED"
        except approval_queue.NotHumanError as exc:
            return "NotHumanError: %s" % exc
        except Exception as exc:  # pragma: no cover - defensive
            return "%s: %s" % (type(exc).__name__, exc)

    # use a fresh document per probe attempt so an accepted decision does not mask the next one
    for name in MACHINE_NAMES + MACHINE_LOOKALIKES + HUMAN_NAMES:
        results["api"][name] = attempt(name)
        # reset the item to PENDING so every name is judged on the same footing
        doc = approval_queue.load_document()
        for it in doc.get("items", []):
            if it.get("approval_id") == aid:
                it["status"] = approval_queue.STATUS_PENDING
        approval_queue.save_document(doc, now=datetime(2026, 3, 11, 8, 0, 0, tzinfo=timezone.utc))

    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(root)
    for label, who in (("machine", "system"), ("human", "Alice Operator")):
        proc = subprocess.run(
            [sys.executable, "approval_queue.py", "decide", "--id", aid, "--decision", "approve", "--by", who, "--note", "cli note"],
            cwd=str(pkg),
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        results["cli"][label] = {"by": who, "exit": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip()}

    doc = approval_queue.load_document()
    for it in doc.get("items", []):
        if it.get("approval_id") == aid:
            results["frozen_fields"]["after_decisions"] = {
                "status": it.get("status"),
                "decided_by": it.get("decided_by"),
                "execution_state": it.get("execution_state"),
                "expires_at_utc": it.get("expires_at_utc"),
                "execution_allowed_by_this_routine": it.get("execution_allowed_by_this_routine"),
            }
    out(results)


def main(argv):
    if len(argv) != 4:
        print(__doc__)
        return 2
    kind, pkg, root = argv[1], Path(argv[2]), argv[3]
    root = assert_scratch(root)
    root.mkdir(parents=True, exist_ok=True)
    os.environ["FREECASH_DATA_ROOT"] = str(root)
    import_package(pkg)
    if kind == "r1_twice":
        kind_r1_twice(pkg, root)
    elif kind == "r1_concurrent":
        kind_r1_concurrent(pkg, root)
    elif kind == "r3_two_days":
        kind_r3_two_days(pkg, root)
    elif kind == "r2_forbidden":
        kind_r2_forbidden(pkg, root)
    elif kind == "r2_bypass":
        kind_r2_bypass(pkg, root)
    elif kind == "r4_decide":
        kind_r4_decide(pkg, root)
    else:
        raise SystemExit("unknown kind %r" % kind)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
