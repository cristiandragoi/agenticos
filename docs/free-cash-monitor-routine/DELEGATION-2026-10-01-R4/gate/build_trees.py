#!/usr/bin/env python3
"""build_trees.py -- construct the verdict-matrix target trees under R4/gate/trees/.

Read-only on the canonical package: everything is built from a COPY of
D:/AgenticOS/monitoring/freecash.  The mutation *definitions* are imported from
R3's gate/mutation_harness_r3gate.py (the spec of the 10 mutants) but the build
is driven here, not by that harness, so the sibling's evidence directory is
never rewritten mid-pass.

Trees produced:
  shipped   -- byte copy of monitoring/freecash
  repaired  -- shipped + the CTRL repair (MONITOR_DEGRADED dropped from
               SUCCESS_OUTCOMES; decider guard denylist -> allowlist)
  mv1..adv6 -- the 10 mutants (mv1-r1-post-cashout, mv2-r2-lock-removed,
               mv3-r3-save-before-load, mv4-r4-execute-without-by,
               adv1-r1-obfuscated-method, adv2-r2-lock-nonbinding,
               adv3-r4-getattr-exec, adv4-r1-conditional-backdoor,
               adv5-r3-compare-disabled, adv6-r1-new-socket-file)
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import sys
from pathlib import Path

REPO = Path("D:/AgenticOS")
PKG = REPO / "monitoring" / "freecash"
HERE = Path(__file__).resolve().parent
OUT = HERE / "trees"
HARNESS = REPO / "docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/gate/mutation_harness_r3gate.py"

CTRL_GATE_OLD = '        "MONITOR_DEGRADED",\n'
CTRL_AQ_OLD = (
    '    if who.lower() in NON_HUMAN_DECIDERS:\n'
    '        raise NotHumanError(\n'
    '            "refused: %r is not a human identity; this routine may only record a "\n'
    '            "decision made by a person" % who\n'
    '        )\n'
    '    return who\n'
)
CTRL_AQ_NEW = (
    '    HUMAN_OPERATORS = frozenset({"alice operator", "bob operator", "cd-pr"})\n'
    '    if who.lower() not in HUMAN_OPERATORS:\n'
    '        raise NotHumanError(\n'
    '            "refused: %r is not an allowlisted human operator" % who\n'
    '        )\n'
    '    return who\n'
)


def load_harness():
    spec = importlib.util.spec_from_file_location("r3gate_harness", HARNESS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def copy_pkg(dest: Path) -> Path:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(PKG, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return dest


def subst(path: Path, old: str, new: str, label: str) -> str:
    src = path.read_text(encoding="utf-8")
    n = src.count(old)
    if n != 1:
        raise SystemExit("BUILD %s: anchor matched %d times in %s" % (label, n, path))
    out = src.replace(old, new)
    if new:
        if out.count(new) != 1:
            raise SystemExit("BUILD %s: replacement not present exactly once in %s" % (label, path))
    else:
        if old in out:
            raise SystemExit("BUILD %s: anchor survived the deletion in %s" % (label, path))
    path.write_text(out, encoding="utf-8", newline="\n")
    return "%s: 1 substitution at %s (anchor len=%d)" % (label, path.name, len(old))


def tree_hashes(d: Path) -> dict:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(d.glob("*.py"))}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}

    shipped = copy_pkg(OUT / "shipped")
    manifest["shipped"] = {"path": str(shipped), "note": "byte copy of monitoring/freecash",
                           "hashes": tree_hashes(shipped)}

    repaired = copy_pkg(OUT / "repaired")
    n1 = subst(repaired / "gate.py", CTRL_GATE_OLD, "", "CTRL-R1.3")
    n2 = subst(repaired / "approval_queue.py", CTRL_AQ_OLD, CTRL_AQ_NEW, "CTRL-R4.3")
    manifest["repaired"] = {"path": str(repaired), "note": n1 + " | " + n2,
                            "hashes": tree_hashes(repaired)}

    h = load_harness()
    for mutation in h.MUTATIONS:
        name = mutation["id"]
        target = copy_pkg(OUT / name)
        for rel, content in mutation.get("add", []):
            p = target / rel
            if p.exists():
                raise SystemExit("BUILD %s: add target exists: %s" % (name, rel))
            p.write_text(content, encoding="utf-8", newline="")
        for rel, find, replace in mutation["edits"]:
            p = target / rel
            txt = p.read_text(encoding="utf-8")
            if txt.count(find) != 1:
                raise SystemExit("BUILD %s: anchor in %s matched %d times"
                                 % (name, rel, txt.count(find)))
            p.write_text(txt.replace(find, replace), encoding="utf-8", newline="")
        manifest[name] = {"path": str(target), "note": mutation["why"],
                          "hashes": tree_hashes(target)}

    (HERE / "trees-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("built %d trees under %s" % (len(manifest), OUT))
    for k in manifest:
        print("  %-30s %s" % (k, manifest[k]["note"][:110]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
