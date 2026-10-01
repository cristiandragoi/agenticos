#!/usr/bin/env python3
"""run_mutation_tests.py -- prove verify_freecash_rules.py can fail.

A verifier that has never been observed to fail certifies nothing.  This harness
copies the pristine routine tree to a throw-away directory once per mutation,
injects one specific rule violation, and runs ``verify_freecash_rules.py``
against the mutated copy.  The mutation is only counted as demonstrated when the
checker exits 1 **and** names the expected rule id.

    python run_mutation_tests.py [SOURCE_TREE] [--checker PATH] [--keep]

SOURCE_TREE defaults to ``D:/AgenticOS/monitoring/freecash`` (the pristine tree).
The pristine tree is never modified: every mutation lands in a temp copy and the
checker itself runs probes against throw-away ``FREECASH_DATA_ROOT`` directories.

Exit code 0 only when every mutation makes the checker fail with its expected
rule id AND the checker passes on the pristine tree.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CHECKER = HERE / "verify_freecash_rules.py"
DEFAULT_SOURCE = Path("D:/AgenticOS/monitoring/freecash")


# --------------------------------------------------------------------------- mutations
# Each entry: id, rule, file, why, [(exact_old_text, new_text), ...]
# Every old_text must appear exactly once, otherwise the harness aborts loudly
# (a mutation that silently does not apply proves nothing).

MUTATIONS = [
    {
        "id": "M01",
        "rule": "R1",
        "file": "gate.py",
        "why": "day lock never refuses: two same-day runs both proceed (R1.1, R1.3)",
        "edits": [(
            '    try:\n'
            '        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n'
            '    except FileExistsError:\n'
            '        return False, lock\n',
            '    fd = os.open(str(lock), os.O_CREAT | os.O_WRONLY)  # MUTATION-M01: O_EXCL dropped\n',
        )],
    },
    {
        "id": "M02",
        "rule": "R1",
        "file": "gate.py",
        "why": "day key is a constant, so the operator-local calendar day is not computed (R1.2)",
        "edits": [(
            '    return now.astimezone(zone(tz)).date().isoformat()\n',
            '    return "2026-01-01"  # MUTATION-M02: constant day key\n',
        )],
    },
    {
        "id": "M03",
        "rule": "R2",
        "file": "readonly_client.py",
        "why": "POST is allowlisted and a withdraw path is added (R2.1, R2.2, R2.4)",
        "edits": [
            ('ALLOWED_METHODS = frozenset({"GET", "HEAD"})',
             'ALLOWED_METHODS = frozenset({"GET", "HEAD", "POST"})  # MUTATION-M03'),
            ('    re.compile(r"^/api/v1/status$"),\n    # Provider paths are added here ONLY after research resolves them, one line\n',
             '    re.compile(r"^/api/v1/status$"),\n    re.compile(r"^/api/v1/withdraw$"),  # MUTATION-M03\n    # Provider paths are added here ONLY after research resolves them, one line\n'),
        ],
    },
    {
        "id": "M04",
        "rule": "R2",
        "file": "readonly_client.py",
        "why": "the process audit guard is disabled (R2.3)",
        "edits": [(
            '    if event not in ("socket.connect", "socket.getaddrinfo"):\n        return\n',
            '    return  # MUTATION-M04: audit guard disabled\n',
        )],
    },
    {
        "id": "M05",
        "rule": "R3",
        "file": "changedetect.py",
        "why": "the snapshot is compared against itself, so no change is ever detected (R3.1)",
        "edits": [(
            '    result = {"baseline": False, "changes": [], "degraded": []}\n',
            '    prior = current  # MUTATION-M05: compares the snapshot with itself\n'
            '    result = {"baseline": False, "changes": [], "degraded": []}\n',
        )],
    },
    {
        "id": "M06",
        "rule": "R3",
        "file": "changedetect.py",
        "why": "equality no longer suppresses a change, so a no-change day notifies (R3.3)",
        "edits": [(
            '        if old == new:\n            continue\n',
            '        if False:  # MUTATION-M06: equality no longer suppresses a change\n            continue\n',
        )],
    },
    {
        "id": "M07",
        "rule": "R3",
        "file": "notify.py",
        "why": "the dedupe index always reads empty, so one key notifies twice (R3.2)",
        "edits": [(
            '    doc = paths.read_json(paths.notified_keys_path(), default=None)\n'
            '    if not isinstance(doc, dict) or not isinstance(doc.get("keys"), dict):\n'
            '        doc = {"schema_version": paths.SCHEMA_VERSION, "keys": {}}\n'
            '    return doc\n',
            '    return {"schema_version": paths.SCHEMA_VERSION, "keys": {}}  # MUTATION-M07\n',
        )],
    },
    {
        "id": "M08",
        "rule": "R4",
        "file": "approval_queue.py",
        "why": "a queued item is built already executed and auto-allowed (R4.1, R4.3)",
        "edits": [(
            '        "execution_state": EXECUTION_STATE_NOT_EXECUTED,\n'
            '        "execution_allowed_by_this_routine": EXECUTION_ALLOWED_BY_THIS_ROUTINE,\n    }\n',
            '        "execution_state": "EXECUTED",  # MUTATION-M08\n'
            '        "execution_allowed_by_this_routine": True,\n    }\n',
        )],
    },
    {
        "id": "M09",
        "rule": "R4",
        "file": "approval_queue.py",
        "why": "the human-only decision check is removed, so a machine may sign (R4.2)",
        "edits": [(
            '    if who.lower() in NON_HUMAN_DECIDERS:\n'
            '        raise NotHumanError(\n'
            '            "refused: %r is not a human identity; this routine may only record a "\n'
            '            "decision made by a person" % who\n'
            '        )\n    return who\n',
            '    return who  # MUTATION-M09: human-only decision no longer enforced\n',
        )],
    },
    {
        "id": "M10",
        "rule": "R2",
        "file": "operator_state.py",
        "why": "a provider host is hardcoded in the routine (R2.4)",
        "edits": [(
            'KIND = "operator_entered"\n',
            'KIND = "operator_entered"\n'
            'PROVIDER_URL = "https://api.provider.example/balance"  # MUTATION-M10\n',
        )],
    },
    {
        "id": "M11",
        "rule": "R2",
        "file": "gate.py",
        "why": "a second module gains a socket-capable import (R2.5)",
        "edits": [(
            'import os\nfrom datetime import date, datetime, timedelta, timezone, tzinfo as tzinfo_type\n',
            'import os\nimport socket  # MUTATION-M11: a second socket-capable module\n'
            'from datetime import date, datetime, timedelta, timezone, tzinfo as tzinfo_type\n',
        )],
    },
]


def _read(path: Path) -> str:
    # newline="" on the builtin: keep the file's own line endings untouched
    # (Path.read_text has no newline= argument before Python 3.13).
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def _write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def _apply(tree: Path, mutation: dict) -> None:
    for old, new in mutation["edits"]:
        target_file = tree / mutation["file"]
        text = _read(target_file)
        count = text.count(old)
        if count != 1:
            raise SystemExit(
                "mutation %s does not apply cleanly: expected exactly 1 occurrence of the "
                "anchor in %s, found %d. Fix the harness before trusting any result."
                % (mutation["id"], mutation["file"], count)
            )
        _write(target_file, text.replace(old, new, 1))


def _run_checker(checker: Path, target: Path, workdir: Path):
    proc = subprocess.run(
        [sys.executable, str(checker), str(target), "--workdir", str(workdir)],
        capture_output=True, text=True,
    )
    return proc


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="run_mutation_tests.py")
    parser.add_argument("source", nargs="?", default=str(DEFAULT_SOURCE),
                        help="pristine routine tree to mutate (default: %s)" % DEFAULT_SOURCE)
    parser.add_argument("--checker", default=str(DEFAULT_CHECKER), help="path to verify_freecash_rules.py")
    parser.add_argument("--keep", action="store_true", help="keep the mutated copies")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    source = Path(args.source).resolve()
    checker = Path(args.checker).resolve()
    if not source.is_dir():
        print("source tree not found: %s" % source, file=sys.stderr)
        return 2
    if not checker.is_file():
        print("checker not found: %s" % checker, file=sys.stderr)
        return 2

    workroot = Path(tempfile.mkdtemp(prefix="fc-mutation-"))
    print("=" * 78)
    print("MUTATION TEST HARNESS")
    print("  pristine source : %s" % source)
    print("  checker         : %s" % checker)
    print("  interpreter     : %s" % sys.executable)
    print("  scratch root    : %s" % workroot)
    print("=" * 78)

    summary = []
    all_ok = True

    for index, mutation in enumerate(MUTATIONS, start=1):
        copy_dir = workroot / ("%s-copy" % mutation["id"])
        shutil.copytree(source, copy_dir, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        _apply(copy_dir, mutation)
        data_dir = workroot / ("%s-work" % mutation["id"])
        data_dir.mkdir(parents=True, exist_ok=True)

        proc = _run_checker(checker, copy_dir, data_dir)
        expected_rule = mutation["rule"]
        names_rule = ("[%s" % expected_rule) in proc.stdout and "FAIL" in proc.stdout
        failed_rule_line = any(
            line.startswith("%s  " % expected_rule) and "[FAIL]" in line
            for line in proc.stdout.splitlines()
        )
        caught = (proc.returncode == 1 and names_rule and failed_rule_line)
        all_ok = all_ok and caught

        print("")
        print("#" * 78)
        print("# %s  rule=%s  file=%s" % (mutation["id"], mutation["rule"], mutation["file"]))
        print("# why: %s" % mutation["why"])
        print("# copy: %s" % copy_dir)
        print("#" * 78)
        print("$ python verify_freecash_rules.py %s" % copy_dir)
        print(proc.stdout.rstrip())
        if proc.stderr.strip():
            print("--- stderr ---")
            print(proc.stderr.rstrip())
        print("EXIT=%d   expected_rule=%s   caught=%s" % (proc.returncode, expected_rule, caught))

        summary.append({
            "id": mutation["id"], "rule": mutation["rule"], "file": mutation["file"],
            "exit": proc.returncode, "caught": caught,
        })

    # ---- pristine control -------------------------------------------------
    print("")
    print("#" * 78)
    print("# PRISTINE CONTROL -- the same checker against the unmodified tree")
    print("#" * 78)
    pristine_work = workroot / "pristine-work"
    pristine_work.mkdir(parents=True, exist_ok=True)
    proc = _run_checker(checker, source, pristine_work)
    print("$ python verify_freecash_rules.py %s" % source)
    print(proc.stdout.rstrip())
    if proc.stderr.strip():
        print("--- stderr ---")
        print(proc.stderr.rstrip())
    pristine_ok = proc.returncode == 0
    print("EXIT=%d   pristine_pass=%s" % (proc.returncode, pristine_ok))
    all_ok = all_ok and pristine_ok

    print("")
    print("=" * 78)
    print("MUTATION SUMMARY   %-4s %-4s %-24s %-6s %s" % ("id", "rule", "file", "exit", "caught"))
    for row in summary:
        print("                   %-4s %-4s %-24s %-6d %s"
              % (row["id"], row["rule"], row["file"], row["exit"], row["caught"]))
    print("-" * 78)
    print("mutations=%d caught_as_expected=%d pristine_checker_pass=%s"
          % (len(summary), sum(1 for r in summary if r["caught"]), pristine_ok))
    print("=" * 78)

    if not args.keep:
        shutil.rmtree(workroot, ignore_errors=True)
    else:
        print("scratch kept: %s" % workroot)

    if all_ok:
        print("[run_mutation_tests] OK - every mutation was detected and the pristine tree passed.")
        return 0
    print("[run_mutation_tests] FAIL - at least one expectation was not met.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
