#!/usr/bin/env python3
"""mutation_harness_r3gate.py -- INDEPENDENT falsification of the R3 rule gate.

BYTE-IDENTICAL COPY of ``DELEGATION-2026-10-01/verifier/mutation_harness.py``
(sha256 cfce16fe...) except for three repointings, so the same ten mutations are
replayed against a different gate:

  1. ``GATE`` points at ``<this file's directory>/rule_gate.py`` -- the R3 gate.
  2. ``TEMP`` is this run's own scratch root, so the two harnesses cannot share
     mutant copies.
  3. the evidence dir is the R3 gate's own ``mutation-evidence/``, not the
     2026-10-01 verifier's (this stream may only write under its own directory).

The mutation definitions, the anchor assertions, the detection rule
(``exit != 0`` AND ``>>> RULE <expected> RESULT: FAIL``) and the reporting are
unchanged.  Do not edit the mutations below: their value is that an independent
session wrote them.

This harness is *mine*, not the gate's own ``--self-test``.  It copies the
canonical package (``D:/AgenticOS/monitoring/freecash``) into a throwaway tree
under ``$LOCALAPPDATA/Temp`` -- the original is never touched -- applies ONE
concrete violation per rule (plus adversarial probes that try to *evade* the
detector), re-runs ``rule_gate.py`` against each copy with an identical command
line, and records exit code + per-rule RESULT + the first FAIL line.

A detector is trusted only if it returns FAIL for the violation it is supposed
to catch.  A mutation that the gate does *not* flag is a blind spot and is
reported as such.

Run with the pinned interpreter (the system python has no tzdata)::

    C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe \
        mutation_harness_r3gate.py

Nothing here registers a scheduler, opens a non-loopback socket, reads a
credential, or writes to the production state root.
"""

import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE = Path("D:/AgenticOS/monitoring/freecash")
GATE = HERE / "rule_gate.py"
TEMP = Path(os.environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r3-gate-harness"
WORK = TEMP / "mutants"
PRODUCTION_ROOT = "D:/AgenticOS/data/freecash-monitor"

# --------------------------------------------------------------------------- mutations
# Each mutation is (id, rule, rationale, [(file, find, replace), ...]).
# rule 0 = the parse gate (G0).

MUTATIONS = [
    # ---- PRIMARY: the task's four concrete violations ------------------------
    dict(
        id="mv1-r1-post-cashout",
        rule=1,
        why="R1: an automated earning action (POST /cashout) added beside the read path",
        edits=[
            (
                "readonly_client.py",
                '    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)',
                '    if verb == "GET":  # MUTATION R1: an automated earning action beside the read\n'
                '        _transport("POST", url.rsplit("/", 1)[0] + "/cashout", timeout=timeout)\n'
                '    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)',
            )
        ],
    ),
    dict(
        id="mv2-r2-lock-removed",
        rule=2,
        why="R2: the O_CREAT|O_EXCL day lock is removed, so a second same-day run reads again",
        edits=[
            (
                "gate.py",
                "        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n"
                "    except FileExistsError:\n"
                "        return False, lock",
                "        fd = os.open(str(lock), os.O_CREAT | os.O_WRONLY)  # MUTATION R2: O_EXCL removed\n"
                "    except FileExistsError:\n"
                "        return True, lock  # MUTATION R2: a consumed day is re-acquired",
            )
        ],
    ),
    dict(
        id="mv3-r3-save-before-load",
        rule=3,
        why="R3: the new snapshot is written before the prior one is loaded, so no change can ever be seen",
        edits=[
            (
                "run_daily_check.py",
                "    prior = changedetect.load_prior_snapshot(day)\n"
                '    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)\n'
                "    verdict = changedetect.compare(prior, snapshot)\n"
                "    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)",
                '    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)\n'
                "    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)  # MUTATION R3: written first\n"
                "    prior = changedetect.load_prior_snapshot(day)\n"
                "    verdict = changedetect.compare(prior, snapshot)",
            )
        ],
    ),
    dict(
        id="mv4-r4-execute-without-by",
        rule=4,
        why="R4: a queued approval executes with no human (--by is no longer required)",
        edits=[
            (
                "approval_queue.py",
                '    who = (name or "").strip()\n'
                "    if not who:\n"
                '        raise NotHumanError("--by is required: a decision must name the human who made it")\n'
                "    if who.lower() in NON_HUMAN_DECIDERS:\n"
                "        raise NotHumanError(\n"
                '            "refused: %r is not a human identity; this routine may only record a "\n'
                '            "decision made by a person" % who\n'
                "        )\n"
                "    return who",
                '    who = (name or "").strip() or "system"  # MUTATION R4: no --by required\n'
                "    return who",
            ),
            (
                "approval_queue.py",
                '    item["decision_note"] = reason\n',
                '    item["decision_note"] = reason\n'
                '    if item["status"] == STATUS_APPROVED:  # MUTATION R4: an approval becomes an action\n'
                "        import subprocess as _sp\n"
                '        _sp.run(["echo", "EXECUTED-APPROVAL", approval_id])\n',
            ),
        ],
    ),
    # ---- ADVERSARIAL PROBES: try to evade the detector -----------------------
    dict(
        id="adv1-r1-obfuscated-method",
        rule=1,
        why="R1 evasion: method + path built from non-literal fragments, so the static string scan sees no POST and no /cashout",
        edits=[
            (
                "readonly_client.py",
                '    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)',
                '    if verb == "GET":  # ADVERSARIAL: no POST/ /cashout literal anywhere\n'
                '        _m = "PO" + "ST"\n'
                '        _p = "/cash" + "out"\n'
                '        _transport(_m, url.rsplit("/", 1)[0] + _p, timeout=timeout)\n'
                '    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)',
            )
        ],
    ),
    dict(
        id="adv2-r2-lock-nonbinding",
        rule=2,
        why="R2 evasion: the O_CREAT|O_EXCL syscall is still present but a FileExistsError is swallowed into acquired=True",
        edits=[
            (
                "gate.py",
                "        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n"
                "    except FileExistsError:\n"
                "        return False, lock",
                "        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n"
                "    except FileExistsError:\n"
                "        return True, lock  # ADVERSARIAL: the barrier exists but no longer denies",
            )
        ],
    ),
    dict(
        id="adv3-r4-getattr-exec",
        rule=4,
        why="R4 evasion: the routine executes a queued item via getattr(os, 'sys'+'tem')(...), a call shape the effect scanner never sees",
        edits=[
            (
                "approval_queue.py",
                "def pending_items(doc=None) -> list:",
                "def drain_and_execute():  # ADVERSARIAL: executes every pending approval, no human in the loop\n"
                "    import os as _os\n"
                "    for _item in pending_items():\n"
                '        getattr(_os, "sys" + "tem")("echo EXECUTED %s" % _item.get("approval_id"))\n'
                "\n"
                "\n"
                "def pending_items(doc=None) -> list:",
            ),
            (
                "approval_queue.py",
                '    doc["items"].append(item)\n    save_document(doc, now=now)\n    return item',
                '    doc["items"].append(item)\n    save_document(doc, now=now)\n'
                "    drain_and_execute()  # ADVERSARIAL: the routine executes what it just queued\n"
                "    return item",
            ),
        ],
    ),
    dict(
        id="adv4-r1-conditional-backdoor",
        rule=1,
        why="R1 evasion: an obfuscated write fires only when FREECASH_LIVE_READ=1, a condition no detector run exercises",
        edits=[
            (
                "readonly_client.py",
                '    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)',
                '    if os.environ.get("FREECASH_LIVE_READ") == "1":  # ADVERSARIAL: conditional, obfuscated write\n'
                '        _m = "PO" + "ST"\n'
                '        _p = "/" + "cash" + "out"\n'
                '        _transport(_m, url.rsplit("/", 1)[0] + _p, timeout=timeout)\n'
                '    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)',
            )
        ],
    ),
    dict(
        id="adv5-r3-compare-disabled",
        rule=3,
        why="R3 evasion: the load/save order and the comparison operator are untouched, but compare() returns no change for any real pair",
        edits=[
            (
                "changedetect.py",
                '    result = {"baseline": False, "changes": [], "degraded": []}',
                '    result = {"baseline": False, "changes": [], "degraded": []}\n'
                "    if _has_data(prior) and _has_data(current):  # ADVERSARIAL R3: a change is never reported\n"
                "        return result",
            )
        ],
    ),
    dict(
        id="adv6-r1-new-socket-file",
        rule=1,
        why="R1 evasion: a NEW module that imports a socket client and can POST -- FORBIDDEN_IMPORTS has no http.client and PINNED_IMPORTS only pins readonly_client.py",
        edits=[],
        add=[
            (
                "status_shim.py",
                '"""ADVERSARIAL: a new module with an un-pinned socket client and an obfuscated write verb.\n\n'
                "PINNED_IMPORTS pins ('readonly_client.py', 'http.client') and nothing else, but the\n"
                "import scan only rejects names in FORBIDDEN_IMPORTS -- which does not list http.client.\n"
                'So this module is neither forbidden nor pinned, and the scan reports success.\n"""\n'
                "from http.client import HTTPConnection\n"
                "\n"
                "\n"
                'def _verb():\n    return "PO" + "ST"\n'
                "\n"
                "\n"
                "def post_nowhere(path, payload=b\"\"):\n"
                '    conn = HTTPConnection("127.0.0.1", 3001, timeout=5)\n'
                "    conn.request(_verb(), path, body=payload)\n"
                "    return conn.getresponse().status\n",
            )
        ],
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def apply(name: str, edits, add=None) -> Path:
    target = WORK / name / "pkg"
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


def run_gate(package: Path, workdir: Path):
    process = subprocess.run(
        [sys.executable, str(GATE), "--package", str(package), "--workdir", str(workdir)],
        capture_output=True,
        text=True,
        timeout=1800,
    )
    return process.returncode, (process.stdout or "") + (process.stderr or "")


def rule_result(output: str, rule: int) -> str:
    match = re.search(r">>> RULE %d RESULT: (\w+)" % rule, output)
    return match.group(1) if match else "MISSING"


def summary_line(output: str) -> str:
    for line in output.splitlines():
        if line.startswith("SUMMARY:"):
            return line.strip()
    return "<no SUMMARY line>"


def main() -> int:
    if not PACKAGE.is_dir():
        print("FATAL: package not found: %s" % PACKAGE)
        return 2
    if not GATE.is_file():
        print("FATAL: gate not found: %s" % GATE)
        return 2
    WORK.mkdir(parents=True, exist_ok=True)

    evidence = HERE / "mutation-evidence"
    evidence.mkdir(parents=True, exist_ok=True)

    print("package : %s (sha of readonly_client.py = %s)" % (PACKAGE, sha(PACKAGE / "readonly_client.py")))
    print("gate    : %s (sha = %s)" % (GATE, sha(GATE)))
    print("python  : %s (%s)" % (sys.executable, sys.version.split()[0]))
    print("workdir : %s" % WORK)
    print("prod    : %s (must gain no file; harness never writes there)" % PRODUCTION_ROOT)
    print()

    rows = []
    for mutation in MUTATIONS:
        name = mutation["id"]
        target = apply(name, mutation["edits"], mutation.get("add"))
        workdir = WORK / name / "work"
        exit_code, output = run_gate(target, workdir)
        (evidence / ("%s.gate.txt" % name)).write_text(output, encoding="utf-8")
        (evidence / ("%s.mutation.txt" % name)).write_text(
            ("rule=%d\nwhy=%s\nedits=%s\n" % (mutation["rule"], mutation["why"], len(mutation["edits"])))
            + "\n".join("  %s: %d change(s)" % (e[0], 1) for e in mutation["edits"]),
            encoding="utf-8",
        )
        results = {r: rule_result(output, r) for r in (1, 2, 3, 4)}
        first_fail = next((line.strip() for line in output.splitlines() if line.strip().startswith("FAIL")), "<none>")
        expected_rule = mutation["rule"]
        detected = exit_code != 0 and (
            results[expected_rule] == "FAIL" if expected_rule else "NOT VERIFIABLE" in output
        )
        rows.append(
            dict(name=name, rule=expected_rule, exit=exit_code, results=results,
                 detected=detected, first_fail=first_fail, why=mutation["why"])
        )
        print("%-30s rule=%s exit=%-2d R1=%-14s R2=%-14s R3=%-14s R4=%-14s DETECTED=%s"
              % (name, expected_rule or "G0", exit_code, results[1], results[2], results[3], results[4],
                 "YES" if detected else "NO"))
        print("    first FAIL: %s" % first_fail[:150])

    table = []
    table.append("mutation\trule\texit\tR1\tR2\tR3\tR4\tdetected\tfirst_fail\twhy")
    for row in rows:
        table.append("\t".join([
            row["name"], str(row["rule"] or "G0"), str(row["exit"]),
            row["results"][1], row["results"][2], row["results"][3], row["results"][4],
            "YES" if row["detected"] else "NO", row["first_fail"].replace("\t", " "), row["why"],
        ]))
    (evidence / "MUTATION-TABLE.tsv").write_text("\n".join(table) + "\n", encoding="utf-8")

    print()
    print("SUMMARY TABLE (also in mutation-evidence/MUTATION-TABLE.tsv)")
    print("%-30s %-4s %-5s %-6s" % ("mutation", "rule", "exit", "caught"))
    for row in rows:
        print("%-30s %-4s %-5d %-6s" % (row["name"], row["rule"] or "G0", row["exit"],
                                        "YES" if row["detected"] else "NO"))
    missed = [row["name"] for row in rows if not row["detected"]]
    print()
    if missed:
        print("UNDETECTED MUTATIONS (blind spots): %s" % ", ".join(missed))
    else:
        print("All %d mutations were flagged by the gate." % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
