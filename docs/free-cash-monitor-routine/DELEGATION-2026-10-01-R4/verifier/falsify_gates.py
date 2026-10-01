"""falsify_gates.py -- plant plausible violations in COPIES of each gate's target
and record the gate's exit code, so every gate is shown to be falsifiable
(green on the unmutated copy, non-zero on a planted violation).

Writes only under DELEGATION-2026-10-01-R4/verifier/ (+ a throwaway temp workdir).
Never touches monitoring/freecash/** or data/freecash-monitor/**.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = Path("D:/AgenticOS")
PY = r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
TMP = Path(__import__("os").environ.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local")) / "Temp" / "fc-r4-verifier-gates"

GATES = {
    "G1_shipped_rule_gate_verify": [PY, str(REPO / "scripts/monitoring/rule_gate_verify.py")],
    "G2_0930_rule_gate": [PY, str(HERE / "rule_gate_0930.py")],
    "G3_1001_verify_freecash_rules": [PY, str(HERE / "verify_freecash_rules_1001.py")],
    "G4_r3_verifier_rule_gate_r3": [PY, str(HERE / "rule_gate_r3.py")],
}

# ---- package-level plant sites (verified unique per copy) --------------------
ANCHOR_READ_RETURN = '    return operator_state.read_source(day)\n'
POST_BLOCK = (
    '    if kind == "operator_state":\n'
    '        # PLANTED VIOLATION (V-R1-earn): an automated earning action.\n'
    '        import http.client as _hc\n'
    '        _conn = _hc.HTTPConnection("127.0.0.1", 4699, timeout=2)\n'
    '        _conn.request("POST", "/api/v1/cashout", body=b\'{"amount_cents":1}\')\n'
    '        _conn.getresponse().read()\n'
    '        _conn.close()\n'
    '    return operator_state.read_source(day)  # planted\n'
)

ANCHOR_LOCK = ("        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n"
               "    except FileExistsError:\n"
               "        return False, lock")
LOCK_OPEN = ("        fd = os.open(str(lock), os.O_CREAT | os.O_WRONLY)  # planted: no O_EXCL\n"
             "    except FileExistsError:\n"
             "        return True, lock  # planted: a consumed day is re-acquired")

ANCHOR_ORDER = ('    prior = changedetect.load_prior_snapshot(day)\n'
                '    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)\n'
                '    verdict = changedetect.compare(prior, snapshot)\n'
                '    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)\n')
ORDER_SWAP = ('    snapshot = changedetect.build_snapshot(day, metrics, source, raw.get("raw_body") or b"", now=now)\n'
              '    snapshot_file, written = changedetect.save_snapshot(snapshot, now=now)  # planted: saved first\n'
              '    prior = changedetect.load_prior_snapshot(day)\n'
              '    verdict = changedetect.compare(prior, snapshot)\n')

ANCHOR_GUARD_ALLOW = ('    HUMAN_OPERATORS = frozenset({"alice operator", "bob operator", "cd-pr"})\n'
                      '    if who.lower() not in HUMAN_OPERATORS:\n'
                      '        raise NotHumanError(\n'
                      '            "refused: %r is not an allowlisted human operator" % who\n'
                      '        )\n'
                      '    return who\n')
GUARD_NONE = '    return who  # planted: no identity guard at all\n'

ANCHOR_GUARD_DENY = ('    if who.lower() in NON_HUMAN_DECIDERS:\n'
                     '        raise NotHumanError(\n'
                     '            "refused: %r is not a human identity; this routine may only record a "\n'
                     '            "decision made by a person" % who\n'
                     '        )\n'
                     '    return who\n')

ANCHOR_DEGRADED = ('    if not source["data_available"]:\n'
                   '        outcome = "MONITOR_DEGRADED"\n'
                   '        notify.alert(\n')
DEGRADED_SUCCESS = ('    if not source["data_available"]:\n'
                    '        outcome = "MONITOR_DEGRADED"\n'
                    '        # PLANTED VIOLATION (V-R2-daybudget): a data-less run books a success day.\n'
                    '        ledger["last_success_day"] = day\n'
                    '        ledger["consecutive_missed_days"] = 0\n'
                    '        notify.alert(\n')


def sub(path: Path, old: str, new: str):
    src = path.read_text(encoding="utf-8")
    n = src.count(old)
    if n != 1:
        raise SystemExit("anchor matched %d times in %s" % (n, path))
    path.write_text(src.replace(old, new), encoding="utf-8", newline="\n")


def make_mutant(base: Path, name: str) -> Path:
    dst = HERE / "mutants" / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(base, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    rd = dst / "run_daily_check.py"
    aq = dst / "approval_queue.py"
    g = dst / "gate.py"
    if name == "P1-earn-action":
        sub(rd, ANCHOR_READ_RETURN, POST_BLOCK)
    elif name == "P2-day-lock-nonbinding":
        sub(g, ANCHOR_LOCK, LOCK_OPEN)
    elif name == "P3-notify-save-before-load":
        sub(rd, ANCHOR_ORDER, ORDER_SWAP)
    elif name == "P4-approval-no-guard":
        try:
            sub(aq, ANCHOR_GUARD_ALLOW, GUARD_NONE)
        except SystemExit:
            sub(aq, ANCHOR_GUARD_DENY, GUARD_NONE)
    elif name == "P5-daybudget-degraded-success":
        sub(rd, ANCHOR_DEGRADED, DEGRADED_SUCCESS)
    else:
        raise SystemExit("unknown mutant " + name)
    return dst


def run(gate_key, target: Path, tag: str):
    cmd = GATES[gate_key][:]
    wd = TMP / (gate_key + "-" + tag)
    if wd.exists():
        shutil.rmtree(wd, ignore_errors=True)
    wd.mkdir(parents=True, exist_ok=True)
    if gate_key == "G1_shipped_rule_gate_verify":
        cmd.append(str(target))
    elif gate_key == "G2_0930_rule_gate":
        cmd += ["--package", str(target), "--workdir", str(wd)]
    elif gate_key == "G4_r3_verifier_rule_gate_r3":
        cmd += ["--package", str(target)]
    else:
        cmd += [str(target), "--workdir", str(wd)]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=900, errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    summ = next((l.strip() for l in out.splitlines() if l.strip().startswith(("SUMMARY:", "[verify_freecash_rules] RESULT"))), "(no summary)")
    return p.returncode, summ


def main():
    TMP.mkdir(parents=True, exist_ok=True)
    clean = HERE / "pkg-clean"
    repaired = HERE / "pkg-repaired"
    g1base = HERE / "g1-synthetic" / "g1_clean.py"

    # per-gate target sets: the base each gate is GREEN on
    plans = {
        "G1_shipped_rule_gate_verify": (g1base, [
            ("G1-V1-write-call", '    return local_day(now)\n',
             '    import http.client as _hc  # PLANTED: an outbound write\n'
             '    _c = _hc.HTTPConnection("127.0.0.1", 4699, timeout=2)\n'
             '    _c.request("POST", "/api/v1/cashout")\n'
             '    return local_day(now)\n'),
            ("G1-V2-no-excl", '        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n',
             '        fd = os.open(str(lock), os.O_CREAT | os.O_WRONLY)  # PLANTED: no O_EXCL\n'),
        ]),
        "G2_0930_rule_gate": (clean, ["P1-earn-action", "P2-day-lock-nonbinding",
                                      "P3-notify-save-before-load", "P4-approval-no-guard",
                                      "P5-daybudget-degraded-success"]),
        "G3_1001_verify_freecash_rules": (clean, ["P1-earn-action", "P2-day-lock-nonbinding",
                                                  "P3-notify-save-before-load", "P4-approval-no-guard",
                                                  "P5-daybudget-degraded-success"]),
        "G4_r3_verifier_rule_gate_r3": (repaired, ["P1-earn-action", "P2-day-lock-nonbinding",
                                                   "P3-notify-save-before-load", "P4-approval-no-guard",
                                                   "P5-daybudget-degraded-success"]),
    }

    results = []
    for gate_key, (base, muts) in plans.items():
        rc, summ = run(gate_key, base, "BASE")
        results.append({"gate": gate_key, "target": "BASE(unmutated)", "exit": rc, "summary": summ})
        print("%-32s %-36s exit=%d  %s" % (gate_key, "BASE(unmutated)", rc, summ))
        for m in muts:
            if isinstance(m, tuple):
                name, old, new = m
                tgt = HERE / "g1-synthetic" / (name + ".py")
                shutil.copy2(base, tgt)
                sub(tgt, old, new)
            else:
                name = m
                tgt = make_mutant(base, name)
            rc, summ = run(gate_key, tgt, name)
            results.append({"gate": gate_key, "target": name, "exit": rc, "summary": summ})
            print("%-32s %-36s exit=%d  %s" % (gate_key, name, rc, summ))
        print()

    (HERE / "evidence" / "gate-falsification.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
