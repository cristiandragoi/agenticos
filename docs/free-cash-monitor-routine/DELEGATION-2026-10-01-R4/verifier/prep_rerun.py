"""R4/V prep: repoint the copied R3 10-mutant harness at THIS stream's dirs, and
build a 'repaired' package copy so the R3 verifier gate (rule_gate_r3.py) has a
green baseline to falsify.  Writes only under DELEGATION-2026-10-01-R4/verifier/.
"""
import hashlib
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path("D:/AgenticOS")

# ---------------------------------------------------------------- 1. harness repoint
src = HERE / "mutation_harness_r3gate_rerun.py"
text = src.read_text(encoding="utf-8")

repl = [
    ('PACKAGE = Path("D:/AgenticOS/monitoring/freecash")',
     'PACKAGE = Path("D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R4/verifier/pkg-clean")'),
    ('GATE = HERE / "rule_gate.py"',
     'GATE = HERE / "rule_gate_r3gate.py"'),
    ('TEMP = Path(os.environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r3-gate-harness"',
     'TEMP = Path(os.environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r4-verifier-r3gate-rerun"'),
    ('PRODUCTION_ROOT = "D:/AgenticOS/data/freecash-monitor"',
     'PRODUCTION_ROOT = "D:/AgenticOS/data/freecash-monitor"'),
    ('    evidence = HERE / "mutation-evidence"',
     '    evidence = HERE / "evidence" / "mutation-r3gate"'),
]
for old, new in repl:
    assert text.count(old) == 1, (old, text.count(old))
    text = text.replace(old, new)
src.write_text(text, encoding="utf-8", newline="\n")
print("harness repointed; sha256 =", hashlib.sha256(src.read_bytes()).hexdigest()[:16])

# ---------------------------------------------------------------- 2. repaired copy
clean = HERE / "pkg-clean"
rep = HERE / "pkg-repaired"
if rep.exists():
    shutil.rmtree(rep)
shutil.copytree(clean, rep, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

# fix A: MONITOR_DEGRADED removed from gate.SUCCESS_OUTCOMES
g = rep / "gate.py"
gt = g.read_text(encoding="utf-8")
assert gt.count('        "MONITOR_DEGRADED",\n') == 1
gt = gt.replace('        "MONITOR_DEGRADED",\n', '', 1)
g.write_text(gt, encoding="utf-8", newline="\n")

# fix B: decider guard becomes an ALLOWLIST of human identities
aq = rep / "approval_queue.py"
at = aq.read_text(encoding="utf-8")
old = ('    if who.lower() in NON_HUMAN_DECIDERS:\n'
       '        raise NotHumanError(\n'
       '            "refused: %r is not a human identity; this routine may only record a "\n'
       '            "decision made by a person" % who\n'
       '        )\n'
       '    return who\n')
new = ('    HUMAN_OPERATORS = frozenset({"alice operator", "bob operator", "cd-pr"})\n'
       '    if who.lower() not in HUMAN_OPERATORS:\n'
       '        raise NotHumanError(\n'
       '            "refused: %r is not an allowlisted human operator" % who\n'
       '        )\n'
       '    return who\n')
assert at.count(old) == 1
at = at.replace(old, new, 1)
aq.write_text(at, encoding="utf-8", newline="\n")
print("repaired copy built at", rep)
