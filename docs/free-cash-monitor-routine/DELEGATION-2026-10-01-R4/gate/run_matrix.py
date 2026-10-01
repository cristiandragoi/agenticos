#!/usr/bin/env python3
"""run_matrix.py -- the verdict matrix: every gate x every tree.

5 gates x 12 trees (shipped, repaired, 10 mutants).  One subprocess per cell,
raw stdout+stderr saved to runs/<gate>__<tree>.txt, exit code recorded.
Nothing is written outside D:/AgenticOS/docs/free-cash-monitor-routine/
DELEGATION-2026-10-01-R4/gate/ and throwaway roots under $LOCALAPPDATA/Temp.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PY = "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
REPO = Path("D:/AgenticOS")
HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"
TREES = HERE / "trees"
TMP = Path(os.environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r4-gate-matrix"

GATES = [
    ("G1_shipped_1file", [str(REPO / "scripts/monitoring/rule_gate_verify.py"), "TREE/run_daily_check.py"]),
    ("G2_0930", [str(REPO / "docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py"),
                 "--package", "TREE", "--workdir", "WD/g2"]),
    ("G3_1001", [str(REPO / "docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/verify_freecash_rules.py"),
                 "TREE", "--workdir", "WD/g3"]),
    ("G4_r3gate", [str(REPO / "docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/gate/rule_gate.py"),
                   "--package", "TREE", "--workdir", "WD/g4"]),
    ("G5_r3verifier", [str(REPO / "docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/verifier/rule_gate_r3.py"),
                       "--package", "TREE", "--json"]),
]

TREES_ORDER = ["shipped", "repaired", "mv1-r1-post-cashout", "mv2-r2-lock-removed",
               "mv3-r3-save-before-load", "mv4-r4-execute-without-by",
               "adv1-r1-obfuscated-method", "adv2-r2-lock-nonbinding", "adv3-r4-getattr-exec",
               "adv4-r1-conditional-backdoor", "adv5-r3-compare-disabled", "adv6-r1-new-socket-file"]


def summarise(gate: str, tree: str, out: str) -> dict:
    s = {"summary": "", "verdict": "", "result": "", "failed_rules": ""}
    for line in out.splitlines():
        ls = line.strip().lstrip("\r")
        if ls.startswith("SUMMARY:"):
            s["summary"] = ls
        elif ls.startswith("VERDICT:"):
            s["verdict"] = ls
        elif ls.startswith("[verify_freecash_rules] RESULT"):
            s["result"] = ls
    if gate == "G5_r3verifier":
        # --json output
        try:
            j = json.loads(out)
            s["summary"] = " ".join("%s=%s" % (k, v) for k, v in sorted(j["rules"].items()))
            s["failed_rules"] = ",".join(sorted(k for k, v in j["rules"].items() if v == "FAIL"))
        except Exception:
            pass
    return s


def main() -> int:
    RUNS.mkdir(parents=True, exist_ok=True)
    rows = []
    for gate, tmpl in GATES:
        for tree in TREES_ORDER:
            tdir = TREES / tree
            if not tdir.is_dir():
                print("MISSING TREE %s" % tree)
                continue
            wd = TMP / ("%s-%s" % (gate, tree))
            wd.mkdir(parents=True, exist_ok=True)
            argv = [a.replace("TREE", str(tdir)).replace("WD", str(wd)) for a in tmpl]
            env = dict(os.environ)
            env["FREECASH_DATA_ROOT"] = str(wd / "root")
            env["AGENTICOS_DATA_DIR"] = str(wd / "agenticos-data")
            env["AGENT_TEAMS_DB_PATH"] = str(wd / "agent-teams.sqlite3")
            env["FREECASH_TZ"] = "Europe/Berlin"
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            (wd / "root").mkdir(parents=True, exist_ok=True)
            try:
                p = subprocess.run([PY] + argv, capture_output=True, text=True,
                                   env=env, cwd=str(HERE), timeout=900, errors="replace")
                out = (p.stdout or "") + (p.stderr or "")
                rc = p.returncode
            except subprocess.TimeoutExpired:
                out, rc = "TIMEOUT after 900s", 124
            (RUNS / ("%s__%s.txt" % (gate, tree))).write_text(out, encoding="utf-8")
            s = summarise(gate, tree, out)
            row = {"gate": gate, "tree": tree, "exit": rc, "argv": argv, **s}
            rows.append(row)
            print("%-16s %-30s exit=%-3d %s | %s" % (gate, tree, rc, s["summary"][:74], s["verdict"][:60]),
                  flush=True)
            (RUNS / "matrix.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print("\nrows=%d" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
