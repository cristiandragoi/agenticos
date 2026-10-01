#!/usr/bin/env python3
"""summarise_matrix.py -- render the 5x12 verdict matrix from runs/matrix.json."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
rows = json.loads((HERE / "runs" / "matrix.json").read_text(encoding="utf-8"))
trees = ["shipped", "repaired", "mv1-r1-post-cashout", "mv2-r2-lock-removed",
         "mv3-r3-save-before-load", "mv4-r4-execute-without-by", "adv1-r1-obfuscated-method",
         "adv2-r2-lock-nonbinding", "adv3-r4-getattr-exec", "adv4-r1-conditional-backdoor",
         "adv5-r3-compare-disabled", "adv6-r1-new-socket-file"]
gates = ["G1_shipped_1file", "G2_0930", "G3_1001", "G4_r3gate", "G5_r3verifier"]
d = {(r["gate"], r["tree"]): r for r in rows}

print("EXIT CODES  (rows = gates, cols = trees)")
print("%-18s %s" % ("gate", " ".join("%4s" % t.split("-")[0][:4] for t in trees)))
for g in gates:
    print("%-18s %s" % (g, " ".join("%4d" % d[(g, t)]["exit"] for t in trees)))
print()
print("FULL CELLS")
for g in gates:
    for t in trees:
        r = d[(g, t)]
        print("%-16s | %-30s | exit=%-3d | %s | %s | %s"
              % (g, t, r["exit"], r["summary"][:74], r["verdict"][:52], (r["result"] or r["failed_rules"])[:52]))
    print()
print("BAR CHECK: exit 0 on repaired AND non-zero on all 10 mutants")
for g in gates:
    ok_rep = d[(g, "repaired")]["exit"] == 0
    surv = [t for t in trees[2:] if d[(g, t)]["exit"] == 0]
    print("%-18s repaired_exit=%d  zero_exit_mutants=%s  BAR=%s"
          % (g, d[(g, "repaired")]["exit"], surv or "none",
             "MET" if (ok_rep and not surv) else "NOT MET"))
