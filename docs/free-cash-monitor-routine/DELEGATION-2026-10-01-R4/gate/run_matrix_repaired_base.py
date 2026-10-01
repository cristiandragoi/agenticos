#!/usr/bin/env python3
"""run_matrix_repaired_base.py -- same 10 mutations, but planted on the REPAIRED
package (the artifact the gate of record is supposed to certify), not on the
un-repaired one.  A gate whose mutant set is closed must still be non-zero on
every row here, and each row must flip the rule the mutation targets.

Trees land in trees-rep/, raw output in runs-rep/.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PY = "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
REPO = Path("D:/AgenticOS")
HERE = Path(__file__).resolve().parent
OUT = HERE / "trees-rep"
RUNS = HERE / "runs-rep"
TMP = Path(os.environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r4-gate-rep"
HARNESS = REPO / "docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/gate/mutation_harness_r3gate.py"

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


def load_harness():
    spec = importlib.util.spec_from_file_location("r3gate_harness", HARNESS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    RUNS.mkdir(parents=True, exist_ok=True)
    base = (HERE / "trees" / "repaired")
    assert base.is_dir(), "build trees/ first"
    h = load_harness()

    names = []
    for mutation in h.MUTATIONS:
        name = "rep-" + mutation["id"]
        target = OUT / name
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(base, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        for rel, content in mutation.get("add", []):
            p = target / rel
            if p.exists():
                raise SystemExit("rep-mutant %s: add target exists %s" % (name, rel))
            p.write_text(content, encoding="utf-8", newline="")
        ok = True
        for rel, find, replace in mutation["edits"]:
            p = target / rel
            txt = p.read_text(encoding="utf-8")
            if txt.count(find) != 1:
                print("SKIP %s: anchor in %s matched %d (the CTRL repair rewrites the same lines)"
                      % (name, rel, txt.count(find)))
                ok = False
                break
            p.write_text(txt.replace(find, replace), encoding="utf-8", newline="")
        if ok:
            names.append(name)
    names.insert(0, "rep-base")
    if not (OUT / "rep-base").exists():
        shutil.copytree(base, OUT / "rep-base", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

    rows = []
    for gate, tmpl in GATES:
        for tree in names:
            tdir = OUT / tree
            wd = TMP / ("%s-%s" % (gate, tree))
            wd.mkdir(parents=True, exist_ok=True)
            (wd / "root").mkdir(parents=True, exist_ok=True)
            argv = [a.replace("TREE", str(tdir)).replace("WD", str(wd)) for a in tmpl]
            env = dict(os.environ)
            env["FREECASH_DATA_ROOT"] = str(wd / "root")
            env["AGENTICOS_DATA_DIR"] = str(wd / "agenticos-data")
            env["AGENT_TEAMS_DB_PATH"] = str(wd / "agent-teams.sqlite3")
            env["FREECASH_TZ"] = "Europe/Berlin"
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            try:
                p = subprocess.run([PY] + argv, capture_output=True, text=True, env=env,
                                   cwd=str(HERE), timeout=900, errors="replace")
                out, rc = (p.stdout or "") + (p.stderr or ""), p.returncode
            except subprocess.TimeoutExpired:
                out, rc = "TIMEOUT", 124
            (RUNS / ("%s__%s.txt" % (gate, tree))).write_text(out, encoding="utf-8")
            summ = ""
            for line in out.splitlines():
                if line.strip().startswith("SUMMARY:"):
                    summ = line.strip()
            if gate == "G5_r3verifier":
                try:
                    j = json.loads(out)
                    summ = " ".join("%s=%s" % (k, v) for k, v in sorted(j["rules"].items()))
                except Exception:
                    pass
            rows.append({"gate": gate, "tree": tree, "exit": rc, "summary": summ})
            print("%-16s %-34s exit=%-3d %s" % (gate, tree, rc, summ[:70]), flush=True)
            (RUNS / "matrix-rep.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print("\nrows=%d" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
