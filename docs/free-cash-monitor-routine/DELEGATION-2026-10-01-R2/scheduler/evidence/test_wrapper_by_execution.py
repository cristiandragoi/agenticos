"""Prove the staged wrapper (freecash-daily.cmd) by EXECUTING it -- on a harness
copy whose production paths were mechanically substituted, with the substitution
asserted before anything runs.

Why a copy: the production wrapper pins FREECASH_DATA_ROOT to the live state root
as a literal (by design -- an ambient env value must never be able to redirect
production state).  Running it as-is would spend a real production day lock.
So we substitute ONLY the data root, assert the substitution (count == 1, prod
string absent afterwards, scratch string present), and fail closed otherwise --
the assertion is the mechanism, not the sed.

Never touches D:\\AgenticOS\\data\\freecash-monitor.
"""

import os
import re
import shutil
import subprocess
import sys

REPO = r"D:/AgenticOS"
DELEG = REPO + "/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R2/scheduler"
WRAPPER = DELEG + "/freecash-daily.cmd"
EV = DELEG + "/evidence"
BASE = r"C:/Users/cd-pr/AppData/Local/Temp/fc-r2"

PROD_ROOT = r"D:\AgenticOS\data\freecash-monitor"
SCRATCH_ROOT = BASE + "/wrapperprod"
NOTZDATA_PY = r"C:\Python314\python.exe"

PROBE_BLOCK = (
    'if defined FREECASH_PY call :probe "%FREECASH_PY%"\n'
    'call :probe "C:\\Users\\cd-pr\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\python.exe"\n'
    'call :probe "%LOCALAPPDATA%\\hermes\\hermes-agent\\venv\\Scripts\\python.exe"\n'
    'call :probe "%HERMES_HOME%\\hermes-agent\\venv\\Scripts\\python.exe"\n'
    'call :probe "py -3.11"\n'
)
PROBE_REPLACED = (
    'REM [HARNESS COPY 2] every interpreter candidate replaced by a known\n'
    'REM no-tzdata python, to prove the fail-closed path (exit 90, no lock).\n'
    'call :probe "%s"\n' % NOTZDATA_PY
)


def read_wrapper():
    with open(WRAPPER, "r", encoding="utf-8") as fh:
        return fh.read()


def assert_and_sub(text, old, new, label):
    n = text.count(old)
    print("  [%s] occurrences of target = %d (must be exactly 1)" % (label, n))
    assert n == 1, "ABORT [%s]: expected exactly 1 occurrence, found %d" % (label, n)
    out = text.replace(old, new)
    assert new in out, "ABORT [%s]: replacement string absent afterwards" % label
    if old not in new:
        assert old not in out, "ABORT [%s]: original string still present afterwards" % label
    print("  [%s] substituted; original string now present = %s"
          % (label, old in out))
    return out


def run_cmd(cmd_path, label):
    p = subprocess.run(["cmd.exe", "/c", cmd_path], capture_output=True, text=True)
    print("  %s: exit=%d  stdout_bytes=%d  stderr_bytes=%d"
          % (label, p.returncode, len(p.stdout.encode()), len(p.stderr.encode())))
    if p.stdout:
        print("    stdout: %r" % p.stdout)
    if p.stderr:
        print("    stderr: %r" % p.stderr)
    return p


def state(root, label):
    locks = sorted(os.listdir(root + "/state/day-locks")) if os.path.isdir(root + "/state/day-locks") else []
    snaps = sorted(os.listdir(root + "/snapshots")) if os.path.isdir(root + "/snapshots") else []
    logs = sorted(os.listdir(root + "/logs")) if os.path.isdir(root + "/logs") else []
    print("  %s: locks=%s snapshots=%s logs=%s" % (label, locks, snaps, logs))
    return locks, snaps, logs


def main():
    os.makedirs(EV, exist_ok=True)
    src = read_wrapper()
    print("read %s (%d bytes)" % (WRAPPER, len(src)))

    # ---------------------------------------------------------------- copy 1
    print("\n=== HARNESS COPY 1: data-root redirect, interpreter unchanged ===")
    c1 = assert_and_sub(src, PROD_ROOT, SCRATCH_ROOT, "copy1/data-root")
    assert SCRATCH_ROOT in c1 and PROD_ROOT not in c1, "ABORT copy1: root redirect not clean"
    print("  [copy1] wrap-inert check: 'INERT ARTIFACT' comment still present = %s"
          % ("INERT ARTIFACT" in c1))
    p1 = EV + "/wrapper-harness-copy1-dataroot-redirect.cmd"
    with open(p1, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(c1)
    print("  wrote %s" % p1)

    shutil.rmtree(SCRATCH_ROOT, ignore_errors=True)
    os.makedirs(SCRATCH_ROOT, exist_ok=True)

    print("\n--- FILTERED SOURCE PROOF: the copy's pinned env block ---")
    for line in c1.splitlines():
        if line.startswith('set "FREECASH_') or line.startswith('set "FC_'):
            print("    %s" % line)

    print("\n--- run 1 (fresh day in the scratch root) ---")
    r1 = run_cmd(p1, "copy1 run1")
    state(SCRATCH_ROOT, "after run1")

    print("\n--- run 2 (immediate second run, same day) ---")
    l2_before, s2_before, _ = state(SCRATCH_ROOT, "before run2")
    r2 = run_cmd(p1, "copy1 run2")
    l2_after, s2_after, _ = state(SCRATCH_ROOT, "after run2")
    print("  locks unchanged=%s   snapshots unchanged=%s"
          % (l2_before == l2_after, s2_before == s2_after))

    print("\n--- log file written by the wrapper (proof it logged, not emitted) ---")
    logdir = SCRATCH_ROOT + "/logs"
    for name in sorted(os.listdir(logdir)):
        path = os.path.join(logdir, name)
        print("  ### %s (%d bytes)" % (name, os.path.getsize(path)))
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                print("      %s" % line.rstrip())

    # ---------------------------------------------------------------- copy 2
    print("\n=== HARNESS COPY 2: interpreter candidates replaced by a NO-TZDATA python ===")
    c2 = assert_and_sub(c1, PROBE_BLOCK, PROBE_REPLACED, "copy2/probe-block")
    assert NOTZDATA_PY in c2
    p2 = EV + "/wrapper-harness-copy2-no-tzdata.cmd"
    with open(p2, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(c2)
    print("  wrote %s" % p2)

    root2 = BASE + "/wrapperprod-notzdata"
    shutil.rmtree(root2, ignore_errors=True)
    os.makedirs(root2, exist_ok=True)
    # copy2 still points at SCRATCH_ROOT; give it its own root so the counts are clean
    c2b = c2.replace(SCRATCH_ROOT, root2)
    p2b = EV + "/wrapper-harness-copy2b-no-tzdata-own-root.cmd"
    with open(p2b, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(c2b)
    print("  wrote %s (own root: %s)" % (p2b, root2))
    print("\n--- run under the no-tzdata interpreter: expect exit 90, NO lock, no snapshot ---")
    r3 = run_cmd(p2b, "copy2 run")
    state(root2, "after copy2 run")
    print("  day-locks dir exists=%s  (must be False or empty: no day consumed)"
          % (os.path.isdir(root2 + "/state/day-locks") and bool(os.listdir(root2 + "/state/day-locks"))))

    print("\n=== VERDICT ===")
    print("  copy1 run1 exit=%d (expect 0), run2 exit=%d (expect 0); stdout/stderr empty on both: %s"
          % (r1.returncode, r2.returncode,
             (not r1.stdout and not r1.stderr and not r2.stdout and not r2.stderr)))
    print("  copy2 exit=%d (expect 90), stderr non-empty: %s, no lock consumed: %s"
          % (r3.returncode, bool(r3.stderr),
             not (os.path.isdir(root2 + "/state/day-locks") and os.listdir(root2 + "/state/day-locks"))))
    ok = (r1.returncode == 0 and r2.returncode == 0 and not r1.stdout and not r1.stderr
          and not r2.stdout and not r2.stderr and r3.returncode == 90 and bool(r3.stderr))
    print("  WRAPPER VERIFIED BY EXECUTION =", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
