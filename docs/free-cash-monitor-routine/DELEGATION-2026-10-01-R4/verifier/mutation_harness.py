#!/usr/bin/env python3
"""mutation_harness.py -- mutate-and-catch proof for rule_gate.py.

Plants N >= 10 concrete rule violations into COPIES of the Free Cash daily status
routine and requires rule_gate.py to fail on each, naming the violated rule TITLE.

ISOLATION
    The ONLY routine this harness touches is a copy under this stream's
    raw/mutants/.  D:/AgenticOS/monitoring/freecash is READ (shutil.copytree),
    never written.  Every child process is given throwaway FREECASH_DATA_ROOT,
    AGENT_TEAMS_DB_PATH and AGENTICOS_DATA_DIR.

WHAT THIS PROVES (and what it does not)
    Proven: for each planted violation, the gate exits non-zero and names the
    rule the violation breaks.  Together with the GREEN run on the unmodified
    copy, this is the failing-something proof the brief demands.
    NOT proven: that the gate is complete against violations nobody planted.
    A surviving mutant is reported as an OPEN DEFECT, and no PASS is printed
    when any mutant survives.
"""

import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
RAW = HERE / "raw"
MUT = RAW / "mutants"
SRC = pathlib.Path("D:/AgenticOS/monitoring/freecash")
VENV = pathlib.Path(r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe")
GATE = HERE / "rule_gate.py"
SELF = HERE / "mutation_harness.py"

TITLE = {
    "R1": "NO EARNING ACTION",
    "R2": "ONCE PER DAY",
    "R3": "NOTIFY ON CHANGE",
    "R4": "APPROVAL BEFORE EXTERNAL ACTION",
}

CORE = [
    "gate.py", "readonly_client.py", "changedetect.py", "notify.py",
    "approval_queue.py", "paths.py", "operator_state.py", "run_daily_check.py",
]

# --- the planted violations ---------------------------------------------------
# Each entry MUST map to exactly one detector in rule_gate.py.  `old` must occur
# exactly once in `rel`; the harness refuses to run a mutant whose plant did not
# land (count != 1), so a silent no-op mutation cannot be reported as "caught".
MUTANTS = [
    dict(id="M01", rule="R1", rel="run_daily_check.py",
         desc="POST /cashout write call",
         old='    source_kind = resolve_source(args.source)',
         new='    source_kind = resolve_source(args.source)\n'
             '    _MUT = readonly_client.request("POST", "http://localhost:3001/api/v1/cashout", json={"amount_cents": 1})  # MUTANT M01'),
    dict(id="M02", rule="R1", rel="notify.py",
         desc="os.system(...) shell-out",
         old='def set_sender(sender) -> None:',
         new='def _mutant_shell(path):\n'
             '    return os.system("cmd /c del /q " + str(path))  # MUTANT M02 shell-out\n'
             '\n\n'
             'def set_sender(sender) -> None:'),
    dict(id="M03", rule="R1", rel="readonly_client.py",
         desc="request body on a GET",
         old='        response = request("GET", url, transport=transport, timeout=_timeout())',
         new='        response = request("GET", url, transport=transport, timeout=_timeout(), json={"probe": 1})  # MUTANT M03 body on GET'),
    dict(id="M04", rule="R1", rel="readonly_client.py",
         desc="connect to a non-loopback host",
         old='DEFAULT_BASE_URL = "http://localhost:3001"',
         new='DEFAULT_BASE_URL = "https://api.freecash.com"  # MUTANT M04 non-loopback host'),
    dict(id="M05", rule="R2", rel="run_daily_check.py",
         desc="second status read within one day",
         old='        raw = read_source(source_kind, day, base=args.base_url or base, transport=transport)',
         new='        raw = read_source(source_kind, day, base=args.base_url or base, transport=transport)\n'
             '        raw = read_source(source_kind, day, base=args.base_url or base, transport=transport)  # MUTANT M05 second read in one day'),
    dict(id="M06", rule="R2", rel="gate.py",
         desc="unresolvable timezone name",
         old='DEFAULT_TZ = "Europe/Berlin"',
         new='DEFAULT_TZ = "Europe/Berlin-Nowhere"  # MUTANT M06 unresolvable tz'),
    dict(id="M07", rule="R2", rel="gate.py",
         desc="non-atomic day lock (O_EXCL dropped)",
         old='        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)',
         new='        if lock.exists():  # MUTANT M07 non-atomic day lock\n'
             '            return False, lock\n'
             '        fd = os.open(str(lock), os.O_CREAT | os.O_WRONLY)'),
    dict(id="M08", rule="R3", rel="run_daily_check.py",
         desc="save_snapshot() BEFORE load_snapshot()",
         old='    prior = changedetect.load_prior_snapshot(day)',
         new='    changedetect.save_snapshot({"day_key": day, "schema_version": 1}, now=now)  # MUTANT M08 save BEFORE load\n'
             '    prior = changedetect.load_prior_snapshot(day)'),
    dict(id="M09", rule="R3", rel="run_daily_check.py",
         desc="dropped change notification",
         old='        result = dispatch_change(\n'
             '            day, change, snapshot, prior, source, sender, sleep_seconds, now=now, enqueue=enqueue\n'
             '        )',
         new='        result = "NOTIFIED"  # MUTANT M09 change notification dropped'),
    dict(id="M10", rule="R4", rel="approval_queue.py",
         desc="auto-executed approval (execution_state != NOT_EXECUTED)",
         old='EXECUTION_STATE_NOT_EXECUTED = "NOT_EXECUTED"',
         new='EXECUTION_STATE_NOT_EXECUTED = "EXECUTED"  # MUTANT M10 auto-executed approval'),
    dict(id="M11", rule="R4", rel="approval_queue.py",
         desc="bypassable decider string 'hermes-agent'",
         old='def _normalise_decider(name) -> str:',
         new='TRUSTED_DECIDERS = frozenset({"hermes-agent", "assistant", "claude"})  # MUTANT M11 bypassable decider string\n'
             '\n\n'
             'def _normalise_decider(name) -> str:'),
    dict(id="M12", rule="R4", rel="approval_queue.py",
         desc="non-human-decider denylist emptied",
         old='NON_HUMAN_DECIDERS = frozenset(\n'
             '    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}\n'
             ')',
         new='NON_HUMAN_DECIDERS = frozenset()  # MUTANT M12 denylist emptied'),
]


def env():
    roots = RAW / "throwaway"
    data = roots / "data"
    agenticos = roots / "agenticos"
    data.mkdir(parents=True, exist_ok=True)
    agenticos.mkdir(parents=True, exist_ok=True)
    e = dict(__import__("os").environ)
    e["FREECASH_DATA_ROOT"] = str(data)
    e["AGENT_TEAMS_DB_PATH"] = str(roots / "teams.db")
    e["AGENTICOS_DATA_DIR"] = str(agenticos)
    return e


def run(cmd):
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, env=env(), cwd=str(HERE))


def copy_routine(dest):
    if dest.parent.exists():
        shutil.rmtree(dest.parent)
    shutil.copytree(SRC, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    MUT.mkdir(parents=True, exist_ok=True)
    lines = []

    def emit(s=""):
        print(s)
        lines.append(s)

    emit("=== mutation_harness.py -- mutate-and-catch proof for rule_gate.py ===")
    emit("source routine (READ ONLY): %s" % SRC)
    emit("interpreter: %s" % VENV)
    check = run([VENV, "-c", "import sys,zoneinfo;from zoneinfo import ZoneInfo;"
                "print(sys.version.split()[0]);print('tzdata OK', ZoneInfo('Europe/Berlin'))"])
    emit("interpreter probe: %s" % " / ".join(check.stdout.split()))

    # 1. py_compile the gate itself.
    pc = run([VENV, "-m", "py_compile", GATE, SELF])
    emit("\n[1] py_compile rule_gate.py + mutation_harness.py -> exit %d" % pc.returncode)
    if pc.stdout.strip():
        emit(pc.stdout.strip())
    if pc.stderr.strip():
        emit(pc.stderr.strip())

    # 2. pristine copy = the artifact under test.
    baseline = MUT / "BASELINE" / "freecash"
    copy_routine(baseline)
    emit("\n[2] pristine copy of the routine -> %s" % baseline)

    # 3. py_compile the EXACT artifact the gate certifies.
    pc2 = run([VENV, "-m", "py_compile"] + [baseline / f for f in CORE])
    emit("[3] py_compile of the certified artifact (8 core modules) -> exit %d" % pc2.returncode)
    if pc2.stdout.strip():
        emit(pc2.stdout.strip())
    if pc2.stderr.strip():
        emit(pc2.stderr.strip())

    # 4. GREEN: gate must exit 0 on the unmodified artifact.
    green = run([VENV, GATE, baseline])
    emit("\n[4] GREEN run -- unmodified artifact:")
    emit("$ %s rule_gate.py %s" % (VENV, baseline))
    for ln in (green.stdout + green.stderr).splitlines():
        emit("  " + ln)
    emit("  exit=%d" % green.returncode)
    green_ok = green.returncode == 0

    # 5. mutants.
    emit("\n[5] planted mutants (N=%d):" % len(MUTANTS))
    caught = []
    survivors = []
    errors = []
    red = None
    for m in MUTANTS:
        dest = MUT / m["id"] / "freecash"
        copy_routine(dest)
        f = dest / m["rel"]
        txt = f.read_text(encoding="utf-8")
        n = txt.count(m["old"])
        if n != 1:
            errors.append((m["id"], "plant anchor occurs %d times (need 1) in %s" % (n, m["rel"])))
            emit("  %s %-9s ERROR: anchor count=%d" % (m["id"], m["rule"], n))
            continue
        f.write_text(txt.replace(m["old"], m["new"], 1), encoding="utf-8")
        if f.read_text(encoding="utf-8") == txt:
            errors.append((m["id"], "plant did not change %s" % m["rel"]))
            emit("  %s %-9s ERROR: plant did not land" % (m["id"], m["rule"]))
            continue

        p = run([VENV, GATE, dest])
        marker = "[%s %s]" % (m["rule"], TITLE[m["rule"]])
        blob = p.stdout + p.stderr
        ok = p.returncode != 0 and marker in blob
        if ok:
            caught.append(m["id"])
            emit("  %s %-9s CAUGHT (exit %d) -- %s" % (m["id"], m["rule"], p.returncode, m["desc"]))
            if red is None and p.returncode != 0:
                red = (m, dest, p)
        else:
            survivors.append((m["id"], m["desc"], p.returncode))
            emit("  %s %-9s *** SURVIVED *** exit=%d marker=%r -- %s"
                 % (m["id"], m["rule"], p.returncode, marker in blob, m["desc"]))

    # 6. verdict.
    emit("\n[6] catch summary: %d/%d caught, %d survivors, %d harness errors"
         % (len(caught), len(MUTANTS), len(survivors), len(errors)))
    for sid, sdesc, rc in survivors:
        emit("  OPEN DEFECT: mutant %s survived (exit %d): %s" % (sid, rc, sdesc))
    for eid, edesc in errors:
        emit("  HARNESS ERROR: %s -- %s" % (eid, edesc))

    (RAW / "30-mutation-report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # 7. single evidence file: RED and GREEN together.
    ev = []
    ev.append("=== VERIFIER EVIDENCE -- failing-something proof (stream S3 'verifier') ===")
    ev.append("target artifact : %s (copied to %s)" % (SRC, baseline))
    ev.append("gate            : %s" % GATE)
    ev.append("interpreter     : %s" % VENV)
    ev.append("")
    ev.append("--- py_compile of the EXACT artifact the gate certifies (BASELINE copy, 8 core modules) ---")
    ev.append("command : %s -m py_compile %s" % (VENV, " ".join(str(baseline / f) for f in CORE)))
    ev.append("exit    : %d" % pc2.returncode)
    ev.append("stdout  : %r" % pc2.stdout)
    ev.append("stderr  : %r" % pc2.stderr)
    ev.append("")
    ev.append("--- GREEN : gate exits 0 on the UNMODIFIED artifact ---")
    ev.append("command : %s rule_gate.py %s" % (VENV, baseline))
    ev.append("exit    : %d" % green.returncode)
    ev.append(green.stdout.rstrip("\n"))
    if green.stderr.strip():
        ev.append(green.stderr.rstrip("\n"))
    ev.append("")
    if red:
        m, dest, p = red
        ev.append("--- RED : gate exits %d on NAMED PLANTED VIOLATION %s (%s) ---"
                  % (p.returncode, m["id"], m["desc"]))
        ev.append("planted in : %s/%s" % (dest, m["rel"]))
        ev.append("command    : %s rule_gate.py %s" % (VENV, dest))
        ev.append("exit       : %d" % p.returncode)
        ev.append("stdout     : %r" % p.stdout)
        ev.append("stderr     :")
        ev.append(p.stderr.rstrip("\n"))
    else:
        ev.append("--- RED : MISSING -- no planted violation produced a non-zero exit ---")
    ev.append("")
    ev.append("--- per-mutant catch table (all %d) ---" % len(MUTANTS))
    for m in MUTANTS:
        if m["id"] in caught:
            ev.append("  %s  %-3s  CAUGHT    %s" % (m["id"], m["rule"], m["desc"]))
        elif any(m["id"] == s[0] for s in survivors):
            ev.append("  %s  %-3s  SURVIVED  %s  <-- OPEN DEFECT" % (m["id"], m["rule"], m["desc"]))
        else:
            ev.append("  %s  %-3s  ERROR     %s" % (m["id"], m["rule"], m["desc"]))
    ev.append("")
    ev.append("CATCH COUNT : %d/%d" % (len(caught), len(MUTANTS)))
    ev.append("SURVIVORS   : %d" % len(survivors))
    ev.append("GREEN       : %s" % ("PASS (exit 0 on unmodified artifact)" if green_ok else "FAIL"))
    if survivors or errors or not green_ok:
        ev.append("RESULT      : NOT ACCEPTED -- see OPEN DEFECT / HARNESS ERROR lines above")
    else:
        ev.append("RESULT      : ACCEPTED -- RED on a named plant, GREEN on the unmodified artifact, "
                  "0 survivors of %d" % len(MUTANTS))
    (RAW / "verifier-evidence.txt").write_text("\n".join(ev) + "\n", encoding="utf-8")

    ok = green_ok and not survivors and not errors and len(caught) == len(MUTANTS)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
