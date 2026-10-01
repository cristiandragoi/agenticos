#!/usr/bin/env python3
"""Gate-falsification harness for the Free Cash daily monitor rule gate.

Builds one throwaway copy of the monitoring package per rule, applies ONE
genuine violation to each copy, then runs

    python scripts/monitoring/rule_gate_verify.py <mutant run_daily_check.py>

against every copy plus the pristine tree, and records raw stdout/stderr/exit
code.  Nothing is written into D:/AgenticOS: every mutant lives under
%LOCALAPPDATA%/Temp.  The pristine tree is only READ.

Usage:  python harness.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path("D:/AgenticOS")
SRC_PKG = REPO / "monitoring" / "freecash"
GATE = REPO / "scripts" / "monitoring" / "rule_gate_verify.py"
PY = sys.executable
SCRATCH = Path(os.environ["LOCALAPPDATA"]) / "Temp" / "fc-gate-mutation-2026-09-21"
LOGS = SCRATCH / "logs"

TARGET = "run_daily_check.py"

# --------------------------------------------------------------------------- anchors

R1_ANCHOR = """    source_kind = resolve_source(args.source)
    day = gate.day_key(now)
    acquired, lock = gate.acquire_day_lock(day)
    if not acquired:
"""

R1_MUTATION = """    source_kind = resolve_source(args.source)
    day = gate.day_key(now)
    lock = paths.day_locks_dir() / ("%s.lock" % day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    acquired = not lock.exists()
    if acquired:
        lock.write_text("", encoding="utf-8")
    if not acquired:
"""

R1_DISABLE_MUTATION = """    source_kind = resolve_source(args.source)
    day = gate.day_key(now)
    lock = paths.day_locks_dir() / ("%s.lock" % day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    acquired = True  # R1 MUTATION: the day lock no longer denies anything
    if not acquired:
"""

R1_INLINE_CLEAN = """    source_kind = resolve_source(args.source)
    day = now.strftime("%Y-%m-%d") if now is not None else gate.day_key(now)
    lock = paths.day_locks_dir() / ("%s.lock" % day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        fd = None
    acquired = fd is not None
    if fd is not None:
        os.close(fd)
    if not acquired:
"""

R1_INLINE_NOATOMIC_FROM = """    lock = paths.day_locks_dir() / ("%s.lock" % day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        fd = None
    acquired = fd is not None
    if fd is not None:
        os.close(fd)
"""

R1_INLINE_NOATOMIC_TO = """    lock = paths.day_locks_dir() / ("%s.lock" % day)
    lock.parent.mkdir(parents=True, exist_ok=True)
    acquired = not lock.exists()
    if acquired:
        lock.write_text("", encoding="utf-8")
"""

R2_ANCHOR = """    if kind == "metrics_http":
"""

R2_MUTATION = """    if kind == "metrics_http":
        import urllib.request  # R2 MUTATION: real outbound write call

        urllib.request.urlopen(
            urllib.request.Request(
                "http://localhost:3001/api/v1/cashout", method="POST", data=b"{}"
            )
        )  # R2 MUTATION: POST /api/v1/cashout on the read client path
"""

R3_ANCHOR = """    prior = changedetect.load_prior_snapshot(day)
    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
    verdict = changedetect.compare(prior, snapshot)
    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
"""

R3_MUTATION = """    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)
    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)
    prior = changedetect.load_snapshot(day)
    verdict = changedetect.compare(prior, snapshot)
"""

R4_FUNCS_ANCHOR = """def nag_pending(day, now, sender, sleep_seconds) -> int:
"""

R4_FUNCS_MUTATION = '''def execute_action(item):
    """R4 MUTATION: carries out a queued approval with no human in the loop."""
    paths.append_jsonl(
        paths.logs_dir() / "executed.jsonl",
        {"executed": item.get("approval_id"), "by": "routine", "human_approval": None},
    )
    return True


def auto_execute_approved(day) -> int:
    """R4 MUTATION: picks up APPROVED items and executes them automatically."""
    document = approval_queue.load_document()
    count = 0
    for item in document.get("items", []):
        if item.get("status") != "APPROVED":
            continue
        execute_action(item)
        item["execution_state"] = "EXECUTED"
        count += 1
    if count:
        approval_queue.save_document(document, now=None)
    return count


def nag_pending(day, now, sender, sleep_seconds) -> int:
'''

R4_CALL_ANCHOR = "    reminders = nag_pending(day, now, sender, 0)\n"

R4_CALL_MUTATION = "    reminders = nag_pending(day, now, sender, 0) + auto_execute_approved(day)\n"


MUTANTS = {
    "m1-r1-remove-daylock": (
        "R1",
        "remove the atomic day-lock acquisition and replace it with a non-atomic "
        "read-then-write existence check (two same-day runs both pass it)",
        [(R1_ANCHOR, R1_MUTATION)],
    ),
    "m1b-r1-disable-daylock": (
        "R1",
        "disable the day lock completely (acquired = True): a second same-day run "
        "reads again and the day lock denies nothing",
        [(R1_ANCHOR, R1_DISABLE_MUTATION)],
    ),
    "m2-r2-post-cashout": (
        "R2",
        'add a POST to "http://localhost:3001/api/v1/cashout" on the read client path',
        [(R2_ANCHOR, R2_MUTATION)],
    ),
    "m3-r3-save-before-load": (
        "R3",
        "restore the save-before-load ordering bug: the new snapshot is written "
        "first and the comparison then loads today's own file",
        [(R3_ANCHOR, R3_MUTATION)],
    ),
    "m4-r4-auto-execute-approved": (
        "R4",
        "add a code path that executes a queued APPROVED approval automatically, "
        "with no --by and no human in the loop",
        [(R4_FUNCS_ANCHOR, R4_FUNCS_MUTATION), (R4_CALL_ANCHOR, R4_CALL_MUTATION)],
    ),
    # --- supplementary R1 scope controls (not rule mutants; they pin down what
    # the R1 check actually measures on a single file) ---
    "ctl-r1-inline-atomic": (
        "R1-control",
        "put the whole R1 mechanism (O_CREAT|O_EXCL day lock + calendar-day key) "
        "INSIDE run_daily_check.py, matching the gate's single-file scope",
        [(R1_ANCHOR, R1_INLINE_CLEAN)],
    ),
    "ctl-r1-inline-noatomic": (
        "R1-control",
        "same in-file version but with the atomic exclusive create replaced by a "
        "read-then-write existence check",
        [(R1_ANCHOR, R1_INLINE_CLEAN), (R1_INLINE_NOATOMIC_FROM, R1_INLINE_NOATOMIC_TO)],
    ),
}


def copy_pkg(dest: Path) -> Path:
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SRC_PKG, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return dest


def apply_mutation(text: str, pairs, label: str) -> str:
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"[harness] {label}: anchor matched {n} times, expected 1:\n{old!r}")
        text = text.replace(old, new)
    return text


def run_gate(target: Path, tag: str, extra=()) -> dict:
    cmd = [PY, str(GATE), str(target), "--json-out", str(LOGS / f"{tag}.json"), *extra]
    proc = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True, timeout=600)
    raw = (proc.stdout or "") + (("\n--- stderr ---\n" + proc.stderr) if proc.stderr.strip() else "")
    (LOGS / f"{tag}.gate.txt").write_text(raw, encoding="utf-8")
    summary = next((l for l in raw.splitlines() if l.startswith("SUMMARY:")), "SUMMARY: <none>")
    verdict = next((l for l in raw.splitlines() if l.startswith("VERDICT:")), "VERDICT: <none>")
    jf = LOGS / f"{tag}.json"
    data = json.loads(jf.read_text(encoding="utf-8")) if jf.exists() else {}
    rules = {r: (data.get("rules", {}).get(r, {}).get("result", "?")) for r in ("R1", "R2", "R3", "R4")}
    return {
        "tag": tag,
        "target": target.as_posix(),
        "command": " ".join(cmd),
        "exit_code": proc.returncode,
        "summary_line": summary,
        "verdict_line": verdict,
        "rules": rules,
        "raw_log": (LOGS / f"{tag}.gate.txt").as_posix(),
        "json_log": (LOGS / f"{tag}.json").as_posix(),
    }


def main() -> int:
    LOGS.mkdir(parents=True, exist_ok=True)
    results = []

    # ---- pristine tree (the "unmutated" column) -----------------------------
    results.append(run_gate(SRC_PKG / TARGET, "baseline-pristine"))

    # ---- newline control: same bytes, LF only, no mutation -------------------
    pkg = copy_pkg(SCRATCH / "ctl-newline-lf-only" / "monitoring" / "freecash")
    target = pkg / TARGET
    text = target.read_text(encoding="utf-8")
    target.write_text(text, encoding="utf-8")
    shutil.copy2(target, LOGS / "ctl-newline-lf-only.run_daily_check.py")
    rec = run_gate(target, "ctl-newline-lf-only")
    rec["rule_under_test"] = "control"
    rec["mutation"] = "no mutation: identical text re-written with LF newlines"
    results.append(rec)

    # ---- mutants ------------------------------------------------------------
    for label, (rule, description, pairs) in MUTANTS.items():
        pkg = copy_pkg(SCRATCH / label / "monitoring" / "freecash")
        target = pkg / TARGET
        original = target.read_text(encoding="utf-8")
        mutated = apply_mutation(original, pairs, label)
        if mutated == original:
            raise SystemExit(f"[harness] {label}: mutation was a no-op")
        target.write_text(mutated, encoding="utf-8")
        # keep a copy of the mutated file next to the log for the report/diff
        shutil.copy2(target, LOGS / f"{label}.run_daily_check.py")
        rec = run_gate(target, label)
        rec["rule_under_test"] = rule
        rec["mutation"] = description
        rec["diff_lines"] = sum(
            1 for a, b in zip(original.splitlines(), mutated.splitlines()) if a != b
        )
        results.append(rec)

    (SCRATCH / "matrix.json").write_text(json.dumps(results, indent=2), encoding="utf-8")

    print(f"scratch   : {SCRATCH.as_posix()}")
    print(f"python    : {PY}")
    print(f"gate      : {GATE.as_posix()}    ({GATE.stat().st_size} bytes)")
    print()
    hdr = f"{'run':34s} {'rule':10s} {'exit':>4s}  {'R1':4s} {'R2':4s} {'R3':4s} {'R4':4s}"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        ru = r.get("rule_under_test", "baseline")
        print(
            f"{r['tag']:34s} {ru:10s} {r['exit_code']:>4d}  "
            f"{r['rules']['R1']:4s} {r['rules']['R2']:4s} "
            f"{r['rules']['R3']:4s} {r['rules']['R4']:4s}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
