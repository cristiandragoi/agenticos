#!/usr/bin/env python
"""run_xml_gate_redgreen.py -- failing-something proof for xml_gate.py.

Plants ten concrete violations into copies of FreeCash-Daily-Monitor-R4.xml and
runs xml_gate.py against each. Every mutant MUST be caught (gate exit non-zero);
the unmodified artifact MUST pass (gate exit 0). A mutant that survives is printed
as an OPEN DEFECT and the harness itself exits non-zero.

Evidence is written by the caller into raw/17-... and raw/18-...
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.join(HERE, "FreeCash-Daily-Monitor-R4.xml")
GATE = os.path.join(HERE, "xml_gate.py")
PY = r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
TODAY = "2026-10-01"

SECOND_EXEC = (
    '    <Exec>\n'
    '      <Command>C:\\Windows\\System32\\cmd.exe</Command>\n'
    '      <Arguments>/c ' + PY + ' D:\\AgenticOS\\monitoring\\freecash\\run_daily_check.py '
    '--force-recheck</Arguments>\n'
    '    </Exec>\n'
    '  </Actions>'
)

# (mutant id, what it violates incl. rule TITLE, old substring, new substring)
MUTANTS = [
    ("mv01-raw-ampersand",
     "R4 APPROVAL BEFORE EXTERNAL ACTION / well-formedness: raw & in <Arguments>",
     "2&gt;&amp;1", "2>&1"),
    ("mv02-wrong-interpreter",
     "R2 ONCE PER DAY: non-tzdata interpreter loses the operator-local day key",
     r"hermes-agent\venv\Scripts\python.exe D:\AgenticOS\monitoring",
     r"Python314\python.exe D:\AgenticOS\monitoring"),
    ("mv03-second-exec",
     "R2 ONCE PER DAY: a second <Exec> joins the day read with a second command",
     "  </Actions>", SECOND_EXEC),
    ("mv04-shell-chaining",
     "R2 ONCE PER DAY: shell chaining turns one Exec into several commands",
     "--source operator_state", "--source operator_state &amp;&amp; echo done"),
    ("mv05-past-start-boundary",
     "R2 ONCE PER DAY: past boundary plus StartWhenAvailable fires a catch-up "
     "run that burns the day",
     "<StartBoundary>2026-10-05T09:00:00</StartBoundary>",
     "<StartBoundary>2026-09-01T09:00:00</StartBoundary>"),
    ("mv06-parallel-instances",
     "R2 ONCE PER DAY: Parallel lets a slow run stack with the next trigger",
     "<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
     "<MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>"),
    ("mv07-no-start-when-available",
     "R2 ONCE PER DAY: a missed day is silently lost",
     "<StartWhenAvailable>true</StartWhenAvailable>",
     "<StartWhenAvailable>false</StartWhenAvailable>"),
    ("mv08-elevated-runlevel",
     "R1 NO EARNING ACTION: elevation is not needed to read and must not be held",
     "<RunLevel>LeastPrivilege</RunLevel>",
     "<RunLevel>HighestAvailable</RunLevel>"),
    ("mv09-skip-days",
     "R2 ONCE PER DAY: DaysInterval 2 silently drops every other day",
     "<DaysInterval>1</DaysInterval>", "<DaysInterval>2</DaysInterval>"),
    ("mv10-forbidden-verb",
     "R1 NO EARNING ACTION: an earning/withdraw flag on the scheduled command",
     "--source operator_state", "--source operator_state --withdraw"),
    ("mv11-double-hyphen-in-comment",
     "R4 APPROVAL BEFORE EXTERNAL ACTION / well-formedness: '--' inside an XML "
     "comment, which expat rejects",
     "  OBSERVE-ONLY ACTION", "  OBSERVE-ONLY -- ACTION"),
    # mv03 is caught earlier by the forbidden-verb check, so that mutant alone does
    # not prove the "exactly one <Exec>" detector. This one scores zero on every
    # verb check and can only be caught by counting Exec elements.
    ("mv12-second-exec-benign",
     "R2 ONCE PER DAY: a second, verb-free <Exec> still multiplies the action",
     "  </Actions>",
     '    <Exec>\n'
     '      <Command>C:\\Windows\\System32\\cmd.exe</Command>\n'
     '      <Arguments>/c echo second action</Arguments>\n'
     '    </Exec>\n'
     '  </Actions>'),
]


def run_gate(path):
    proc = subprocess.run([PY, GATE, path, "--today", TODAY],
                          capture_output=True, text=True)
    first = (proc.stdout.strip().splitlines() or ["<no stdout>"])[0]
    return proc.returncode, first


def main():
    source = open(REAL, encoding="utf-8").read()
    mutdir = os.path.join(HERE, "raw", "mutants")
    os.makedirs(mutdir, exist_ok=True)

    print("GATE            : %s" % GATE)
    print("ARTIFACT        : %s" % REAL)
    print("INTERPRETER     : %s" % PY)
    print("ASSUMED TODAY   : %s" % TODAY)
    print()

    caught = 0
    survived = []
    not_planted = []

    for name, violation, old, new in MUTANTS:
        text = source
        if text.count(old) < 1:
            not_planted.append(name)
            print("PLANT-FAIL : %-28s substring not found: %r" % (name, old[:50]))
            continue
        text = text.replace(old, new, 1)
        path = os.path.join(mutdir, name + ".xml")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        rc, first = run_gate(path)
        if rc != 0:
            caught += 1
            print("RED        : %-28s exit %d  | %s" % (name, rc, violation))
            print("             gate said: %s" % first)
        else:
            survived.append(name)
            print("SURVIVED   : %-28s exit 0  <-- OPEN DEFECT" % name)
        print()

    print("-" * 78)
    rc_real, first_real = run_gate(REAL)
    print("GREEN      : %-28s exit %d  | unmodified artifact" % ("FreeCash-Daily-Monitor-R4.xml", rc_real))
    print("             gate said: %s" % first_real)
    print()
    print("mutants planted   : %d" % (len(MUTANTS) - len(not_planted)))
    print("mutants caught    : %d" % caught)
    print("mutants survived  : %d %s" % (len(survived), survived or ""))
    print("plant failures    : %d %s" % (len(not_planted), not_planted or ""))

    ok = (not survived) and (not not_planted) and rc_real == 0
    print("HARNESS VERDICT   : %s" % ("ALL MUTANTS CAUGHT, ARTIFACT CLEAN" if ok
                                     else "OPEN DEFECT - see lines above"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
