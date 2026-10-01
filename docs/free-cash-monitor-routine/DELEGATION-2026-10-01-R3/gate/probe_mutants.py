#!/usr/bin/env python3
"""probe_mutants.py -- fast static-only iteration harness for the R3 gate.

It reads the TEN mutations from the canonical adversarial harness
(DELEGATION-2026-10-01/verifier/mutation_harness.py, imported read-only, never
executed as a script), rebuilds each mutant copy under this run's own scratch
root, and runs THIS gate with --static-only against each copy plus the clean
package.  It prints one row per mutant: exit code, per-rule result, and the
first FAIL line.

--static-only makes this loop fast; the acceptance run (run_mutation_harness.py)
uses the *unmodified* harness copy with the runtime detectors on.

Usage::

    C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe \
        probe_mutants.py [--runtime]
"""

import argparse
import importlib.util
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATE = HERE / "rule_gate.py"
PACKAGE = Path("D:/AgenticOS/monitoring/freecash")
HARNESS = Path(
    "D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/mutation_harness.py"
)
SCRATCH = Path(os.environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r3-gate-probe"
WORK = SCRATCH / "mutants"


def load_mutations():
    spec = importlib.util.spec_from_file_location("canonical_mutation_harness", HARNESS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.MUTATIONS


def build(name, edits, add, target):
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(PACKAGE, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for rel, content in (add or []):
        path = target / rel
        if path.exists():
            raise SystemExit("mutation %s: add target already exists: %s" % (name, rel))
        path.write_text(content, encoding="utf-8", newline="")
    for rel, find, replace in edits:
        path = target / rel
        text = path.read_text(encoding="utf-8")
        count = text.count(find)
        if count != 1:
            raise SystemExit("mutation %s: anchor in %s matched %d times (expected 1)" % (name, rel, count))
        path.write_text(text.replace(find, replace), encoding="utf-8", newline="")
    return target


def run_gate(package, workdir, runtime):
    command = [sys.executable, str(GATE), "--package", str(package), "--workdir", str(workdir)]
    if not runtime:
        command.append("--static-only")
    process = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    return process.returncode, (process.stdout or "") + (process.stderr or "")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", action="store_true", help="run the detectors too (slow)")
    args = parser.parse_args()

    results = {r: "MISSING" for r in (1, 2, 3, 4)}
    findings = {}

    def report(output):
        return {r: (re.search(r">>> RULE %d RESULT: (\w+)" % r, output) or [None, "MISSING"])[1] for r in (1, 2, 3, 4)}

    exit_code, output = run_gate(PACKAGE, WORK / "_clean" / "work", args.runtime)
    clean = report(output)
    print("%-30s rule=%-3s exit=%-3d R1=%-6s R2=%-6s R3=%-6s R4=%-6s" % ("CLEAN(unmutated)", "-", exit_code, *[clean[r] for r in (1, 2, 3, 4)]))
    first = next((l.strip() for l in output.splitlines() if l.strip().startswith("FAIL")), "<none>")
    findings["clean"] = (exit_code, clean, first)
    print("    first FAIL: %s" % first[:150])

    rows = []
    for mutation in load_mutations():
        target = build(mutation["id"], mutation["edits"], mutation.get("add"), WORK / mutation["id"] / "pkg")
        exit_code, output = run_gate(target, WORK / mutation["id"] / "work", args.runtime)
        per_rule = report(output)
        expected = mutation["rule"]
        caught = exit_code != 0 and per_rule[expected] == "FAIL"
        first = next((l.strip() for l in output.splitlines() if l.strip().startswith("FAIL")), "<none>")
        findings[mutation["id"]] = (exit_code, per_rule, first)
        rows.append((mutation["id"], expected, caught))
        print("%-30s rule=%-3s exit=%-3d R1=%-6s R2=%-6s R3=%-6s R4=%-6s CAUGHT=%s"
              % (mutation["id"], expected, exit_code, per_rule[1], per_rule[2], per_rule[3], per_rule[4],
                 "YES" if caught else "NO"))
        print("    first FAIL: %s" % first[:150])
    missed = [name for name, _r, caught in rows if not caught]
    print()
    print("clean exit=%d  clean R1..R4=%s" % (findings["clean"][0], [findings["clean"][1][r] for r in (1, 2, 3, 4)]))
    print("caught=%d/%d  missed=%s" % (len(rows) - len(missed), len(rows), missed or "none"))
    return 0 if not missed and findings["clean"][0] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
