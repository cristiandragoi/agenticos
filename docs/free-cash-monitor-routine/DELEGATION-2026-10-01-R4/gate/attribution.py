#!/usr/bin/env python3
"""attribution.py -- per-mutant attribution: which checks fail on the mutant that
PASS on the repaired (accepted) package.  A gate only 'catches' a mutant when at
least one check that is green on the accepted tree is red on the mutant.

Sources: runs/G5_r3verifier__<tree>.txt (JSON, check ids + ok) and the FAIL lines
of runs/G2_0930__<tree>.txt / runs/G4_r3gate__<tree>.txt.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs"
TREES = ["shipped", "repaired", "mv1-r1-post-cashout", "mv2-r2-lock-removed",
         "mv3-r3-save-before-load", "mv4-r4-execute-without-by", "adv1-r1-obfuscated-method",
         "adv2-r2-lock-nonbinding", "adv3-r4-getattr-exec", "adv4-r1-conditional-backdoor",
         "adv5-r3-compare-disabled", "adv6-r1-new-socket-file"]


def g5_checks(tree):
    txt = (RUNS / ("G5_r3verifier__%s.txt" % tree)).read_text(encoding="utf-8", errors="replace")
    j = json.loads(txt)
    return {c["id"]: bool(c["ok"]) for c in j["checks"]}


def text_fail_lines(gate, tree):
    txt = (RUNS / ("%s__%s.txt" % (gate, tree))).read_text(encoding="utf-8", errors="replace")
    return [l.strip() for l in txt.splitlines() if l.strip().startswith("FAIL")]


def rule_flips(gate, tree):
    """Rule-level flips for G2/G4: rules PASS on repaired, FAIL on mutant."""
    def rules(t):
        out = {}
        txt = (RUNS / ("%s__%s.txt" % (gate, t))).read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r">>> RULE (\d) RESULT: (\w+)", txt):
            out["R%s" % m.group(1)] = m.group(2)
        return out
    base = rules("repaired")
    mut = rules(tree)
    return sorted(k for k in mut if mut[k] == "FAIL" and base.get(k) == "PASS")


base5 = g5_checks("repaired")
print("=== G5_r3verifier (rule_gate_r3.py): checks red on mutant that are GREEN on repaired ===")
print("repaired check ids: %s" % ",".join(sorted(base5)))
survivors5 = []
for t in TREES:
    c = g5_checks(t)
    newly = sorted(k for k, v in c.items() if not v and base5.get(k))
    rules = sorted({k.split(".")[0] for k in newly})
    print("  %-30s exit-flip-checks=%-28s rules=%s" % (t, ",".join(newly) or "NONE", ",".join(rules) or "-"))
    if t not in ("shipped", "repaired") and not newly:
        survivors5.append(t)
print("  G5 survivors (no check red-vs-repaired): %s" % (survivors5 or "none"))

print()
print("=== G2_0930 (rule_gate.py 2026-09-30): rules red on mutant that are GREEN on repaired ===")
survivors2 = []
for t in TREES:
    fl = rule_flips("G2_0930", t)
    print("  %-30s flipped_rules=%s" % (t, ",".join(fl) or "NONE"))
    if t not in ("shipped", "repaired") and not fl:
        survivors2.append(t)
print("  G2 survivors (no rule flips): %s" % (survivors2 or "none"))

print()
print("=== G4_r3gate (rule_gate.py 2026-10-01-R3): rules red on mutant that are GREEN on repaired ===")
survivors4 = []
for t in TREES:
    fl = rule_flips("G4_r3gate", t)
    print("  %-30s flipped_rules=%s" % (t, ",".join(fl) or "NONE"))
    if t not in ("shipped", "repaired") and not fl:
        survivors4.append(t)
print("  G4 survivors: %s" % (survivors4 or "none"))
