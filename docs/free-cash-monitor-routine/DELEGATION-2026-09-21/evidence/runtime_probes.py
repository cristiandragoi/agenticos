#!/usr/bin/env python3
"""Runtime probes that show each mutation is a GENUINE violation and that the
unmutated routine's mechanism (where the gate cannot see it) actually denies it.

Everything runs in throwaway copies under %LOCALAPPDATA%/Temp with a throwaway
FREECASH_DATA_ROOT.  No network request is made, no external action is taken and
nothing under D:/AgenticOS is written.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path("D:/AgenticOS")
SRC_PKG = REPO / "monitoring" / "freecash"
PY = sys.executable
SCRATCH = Path(os.environ["LOCALAPPDATA"]) / "Temp" / "fc-gate-mutation-2026-09-21"
OUT = SCRATCH / "runtime"
ROOTS = SCRATCH / "roots"

PRISTINE = SCRATCH / "pristine" / "monitoring" / "freecash"
M1 = SCRATCH / "m1-r1-remove-daylock" / "monitoring" / "freecash"
M1B = SCRATCH / "m1b-r1-disable-daylock" / "monitoring" / "freecash"
M2 = SCRATCH / "m2-r2-post-cashout" / "monitoring" / "freecash"
M3 = SCRATCH / "m3-r3-save-before-load" / "monitoring" / "freecash"
M4 = SCRATCH / "m4-r4-auto-execute-approved" / "monitoring" / "freecash"

APPROVAL_ID = "11111111-1111-1111-1111-111111111111"

lines: list[str] = []


def say(text: str = "") -> None:
    print(text)
    lines.append(text)


def env_for(root: Path) -> dict:
    e = dict(os.environ)
    e.update(
        {
            "FREECASH_DATA_ROOT": str(root),
            "FREECASH_TZ": "Europe/Berlin",
            "FREECASH_TOAST_STUB": "1",
            "FREECASH_TOAST_RETRY_SLEEP_SECONDS": "0",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    return e


def fresh_root(name: str) -> Path:
    root = ROOTS / name
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    return root


def stop_rule(title: str) -> None:
    say()
    say("=" * 78)
    say(title)
    say("=" * 78)


# --------------------------------------------------------------------------- R1


def probe_r1_concurrency() -> None:
    stop_rule("R1 RUNTIME: 5 simultaneous same-day invocations (fresh root each)")
    for label, pkg in (("pristine", PRISTINE), ("m1-r1-remove-daylock", M1)):
        root = fresh_root("r1-" + label)
        env = env_for(root)
        procs = [
            subprocess.Popen(
                [PY, "run_daily_check.py"],
                cwd=str(pkg),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for _ in range(5)
        ]
        outs = []
        for p in procs:
            o, e = p.communicate(timeout=300)
            outs.append((p.returncode, (o or "").strip().splitlines(), (e or "").strip()))
        ran, skipped = 0, 0
        say(f"--- {label}  (root {root.as_posix()})")
        for i, (rc, out, err) in enumerate(outs, 1):
            last = out[-1] if out else ""
            if last.startswith("RUN_OK"):
                ran += 1
            elif last.startswith("SKIP_DUPLICATE_DAY"):
                skipped += 1
            say(f"    proc{i}: exit={rc} last_stdout={last[:120]!r}" + (f" stderr={err[:80]!r}" if err else ""))
        say(f"    => RUN_OK(reads)={ran}  SKIP_DUPLICATE_DAY={skipped}  locks={sorted(p.name for p in (root / 'state/day-locks').glob('*'))}")
        snapshots = sorted(p.name for p in (root / "snapshots").glob("*.json"))
        say(f"    => snapshots written: {snapshots}")


# --------------------------------------------------------------------------- R3

TWO_DAY_DRIVER = r'''
import os, sys
from datetime import datetime, timezone
sys.path.insert(0, os.getcwd())
import operator_state, paths, run_daily_check

day = sys.argv[1]
earnings = int(sys.argv[2])
now = datetime.strptime(day, "%Y-%m-%d").replace(hour=6, minute=0, tzinfo=timezone.utc)
paths.ensure_layout()
doc = operator_state.load_document() or operator_state.template_document()
doc["records"].append({
    "day_key": day,
    "entered_at_utc": "%sT06:30:00Z" % day,
    "account_status": "ACTIVE",
    "earnings_total_cents": earnings,
    "balance_cents": earnings,
    "pending_cents": 0,
    "currency": "USD",
})
paths.write_json_atomic(paths.operator_state_path(), doc)
rc = run_daily_check.run([], now=now)
print("DRIVER rc=%s" % rc)
'''


def probe_r1_sequential() -> None:
    stop_rule("R1 RUNTIME: two SEQUENTIAL same-day runs, same root (does the lock deny the second?)")
    for label, pkg in (
        ("pristine", PRISTINE),
        ("m1-r1-remove-daylock", M1),
        ("m1b-r1-disable-daylock", M1B),
    ):
        root = fresh_root("r1seq-" + label)
        env = env_for(root)
        say(f"--- {label}  (root {root.as_posix()})")
        for n in (1, 2):
            proc = subprocess.run(
                [PY, "run_daily_check.py"],
                cwd=str(pkg),
                env=env,
                capture_output=True,
                text=True,
                timeout=300,
            )
            last = (proc.stdout or "").strip().splitlines()
            say(f"    run#{n}: exit={proc.returncode} last_stdout={(last[-1] if last else '')[:130]!r}")
        say(f"    => snapshots: {sorted(p.name for p in (root / 'snapshots').glob('*.json'))}")


def probe_r3_two_day() -> None:
    stop_rule("R3 RUNTIME: two consecutive day runs with a real earnings move (1000 -> 1500 cents)")
    driver = SCRATCH / "two_day_driver.py"
    driver.write_text(TWO_DAY_DRIVER, encoding="utf-8")
    for label, pkg in (("pristine", PRISTINE), ("m3-r3-save-before-load", M3)):
        root = fresh_root("r3-" + label)
        env = env_for(root)
        say(f"--- {label}  (root {root.as_posix()})")
        for day, earnings in (("2026-09-15", 1000), ("2026-09-16", 1500)):
            proc = subprocess.run(
                [PY, str(driver), day, str(earnings)],
                cwd=str(pkg),
                env=env,
                capture_output=True,
                text=True,
                timeout=300,
            )
            for raw in (proc.stdout or "").strip().splitlines():
                say(f"    day={day} earnings={earnings} | {raw}")
            if proc.stderr.strip():
                say(f"    day={day} stderr: {proc.stderr.strip()[:200]}")
        alerts = root / "alerts" / "alerts.jsonl"
        if alerts.exists():
            events = [json.loads(l)["event_type"] for l in alerts.read_text(encoding="utf-8").splitlines() if l.strip()]
            say(f"    => alerts.jsonl event_types: {events}")


# --------------------------------------------------------------------------- R2

R2_DENY_PROBE = r'''
import os, sys
sys.path.insert(0, os.getcwd())
import readonly_client

def marker(*a, **k):
    return {"TRANSPORT_WAS_CALLED": True}

attempts = [
    ("POST", "http://localhost:3001/api/v1/cashout"),
    ("PUT", "http://localhost:3001/api/v1/status/metrics"),
    ("GET", "http://localhost:3001/api/v1/cashout"),
    ("GET", "http://example.com/api/v1/status/metrics"),
]
for method, url in attempts:
    try:
        got = readonly_client.request(method, url, transport=marker)
        print("ALLOWED   %-5s %-50s -> %r" % (method, url, got))
    except readonly_client.ForbiddenWriteError as exc:
        print("REFUSED   %-5s %-50s -> ForbiddenWriteError: %s" % (method, url, exc))
    except Exception as exc:
        print("OTHER     %-5s %-50s -> %s: %s" % (method, url, type(exc).__name__, exc))
'''


def probe_r2_deny() -> None:
    stop_rule("R2 RUNTIME: the unmutated transport's deny-by-default guard (stub transport, no socket)")
    probe = SCRATCH / "r2_deny_probe.py"
    probe.write_text(R2_DENY_PROBE, encoding="utf-8")
    for label, pkg in (("pristine", PRISTINE), ("m2-r2-post-cashout", M2)):
        proc = subprocess.run(
            [PY, str(probe)],
            cwd=str(pkg),
            env=env_for(fresh_root("r2-" + label)),
            capture_output=True,
            text=True,
            timeout=300,
        )
        say(f"--- {label}")
        for raw in (proc.stdout or "").strip().splitlines():
            say("    " + raw)
        if proc.stderr.strip():
            say("    stderr: " + proc.stderr.strip()[:200])
    # the gate's own --run refusal for a write-shaped implementation
    say()
    say("--- gate --run against the R2 mutant (verifier's own write-call guard)")
    proc = subprocess.run(
        [PY, str(REPO / "scripts/monitoring/rule_gate_verify.py"), str(M2 / "run_daily_check.py"), "--run"],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        timeout=600,
    )
    for raw in (proc.stdout or "").splitlines():
        if raw.strip().startswith("- ") or raw.startswith("    exit=") or "REFUSED" in raw:
            say("    " + raw.strip())
    say(f"    gate --run exit={proc.returncode}")


# --------------------------------------------------------------------------- R4


def seed_approved(root: Path) -> None:
    (root / "approvals").mkdir(parents=True, exist_ok=True)
    doc = {
        "schema_version": 1,
        "updated_at_utc": "2026-09-20T09:00:00Z",
        "items": [
            {
                "approval_id": APPROVAL_ID,
                "created_at_utc": "2026-09-20T06:00:00Z",
                "day_key": "2026-09-20",
                "change_dedupe_key": "deadbeef",
                "reason": "Earnings moved 10.00 -> 15.00.",
                "proposed_action": {
                    "action_type": "REQUEST_PAYOUT",
                    "amount_cents": 500,
                    "destination": "OPERATOR_SPECIFIED - not stored by the routine",
                    "provider_endpoint": "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase",
                },
                "status": "APPROVED",
                "status_reason": "operator approved on 2026-09-20",
                "decided_at_utc": "2026-09-20T09:00:00Z",
                "decided_by": "Operator Name",
                "decision_note": "reviewed by hand",
                "expires_at_utc": None,
                "execution_state": "NOT_EXECUTED",
                "execution_allowed_by_this_routine": False,
            }
        ],
    }
    (root / "approvals" / "pending.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")


def item_state(root: Path) -> dict:
    doc = json.loads((root / "approvals" / "pending.json").read_text(encoding="utf-8"))
    return {k: doc["items"][0].get(k) for k in ("approval_id", "status", "execution_state", "expires_at_utc", "decided_by")}


def probe_r4_auto_execute() -> None:
    stop_rule("R4 RUNTIME: one APPROVED queue item, routine entry point run with no human --by")
    for label, pkg in (("pristine", PRISTINE), ("m4-r4-auto-execute-approved", M4)):
        root = fresh_root("r4-" + label)
        seed_approved(root)
        env = env_for(root)
        proc = subprocess.run(
            [PY, "run_daily_check.py"],
            cwd=str(pkg),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        say(f"--- {label}  (root {root.as_posix()})")
        for raw in (proc.stdout or "").strip().splitlines():
            say("    " + raw[:160])
        say(f"    entry-point exit={proc.returncode}")
        marker_file = root / "logs" / "executed.jsonl"
        if marker_file.exists():
            say(f"    logs/executed.jsonl EXISTS: {marker_file.read_text(encoding='utf-8').strip()!r}")
        else:
            say("    logs/executed.jsonl: NOT CREATED (nothing was executed)")
        say(f"    queue item after the run: {item_state(root)}")

    say()
    say("--- pristine: the human-decision CLI refuses a machine identity (R4 mechanism)")
    root = ROOTS / "r4-decide"
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    seed_approved(root)
    env = env_for(root)
    for by in ("routine", "Operator Name"):
        proc = subprocess.run(
            [
                PY,
                "approval_queue.py",
                "decide",
                "--id",
                APPROVAL_ID,
                "--decision",
                "approve",
                "--by",
                by,
                "--note",
                "checked by hand",
            ],
            cwd=str(PRISTINE),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        say(f"    --by {by!r} exit={proc.returncode} stdout={(proc.stdout or '').strip()[:160]!r} stderr={(proc.stderr or '').strip()[:200]!r}")
    say(f"    queue item after both attempts: {item_state(root)}")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ROOTS.mkdir(parents=True, exist_ok=True)
    probe_r1_concurrency()
    probe_r1_sequential()
    probe_r3_two_day()
    probe_r2_deny()
    probe_r4_auto_execute()
    (OUT / "runtime-probe-output.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    say()
    say(f"[written] {(OUT / 'runtime-probe-output.txt').as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
