"""plant_error_and_run.py -- falsify R3's day-budget suite in BOTH directions.

Baseline (pkg-daybudget-fix) is GREEN 7/7.  Then:
  E1 package-side: restore "MONITOR_DEGRADED" into gate.SUCCESS_OUTCOMES.
  E2 package-side: delete the pre-lock data-less guard (the day is spent again).
  E3 test-side:    corrupt one assertion in a COPY of the test file itself.
Each is expected to turn the suite RED.  Nothing outside this stream's dir is
written; every run uses a throwaway FREECASH_DATA_ROOT.
"""
import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = r"C:\Users\cd-pr\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
TEST = Path("D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01-R3/"
            "daybudget/failing-test-first/test_daybudget_data_less.py")
FIX = HERE / "pkg-daybudget-fix"

GUARD_ANCHOR = ('    if source_kind == "operator_state" and operator_state.record_for_day(day) is None:\n')


def run_suite(pkg: Path, test: Path, tag: str):
    env = dict(os.environ)
    env["FREECASH_DATA_ROOT"] = str(Path(env.get("LOCALAPPDATA", "C:/Users/cd-pr/AppData/Local"))
                                     / "Temp" / "fc-r4-verifier" / ("dbroot-" + tag))
    env["FREECASH_ROUTINE_DIR"] = str(pkg)
    p = subprocess.run([PY, str(test)], capture_output=True, text=True, env=env,
                       cwd=str(pkg), timeout=300, errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    tail = [l for l in out.splitlines() if l.startswith(("Ran ", "OK", "FAILED"))]
    return p.returncode, " | ".join(tail), out


def copy_pkg(name: str) -> Path:
    d = HERE / "daybudget-mutants" / name
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(FIX, d, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return d


results = []

# E1
e1 = copy_pkg("E1-degraded-is-success")
g = e1 / "gate.py"
t = g.read_text(encoding="utf-8")
old = '        "INITIAL_BASELINE",\n'
assert t.count(old) == 1
g.write_text(t.replace(old, old + '        "MONITOR_DEGRADED",\n', 1), encoding="utf-8", newline="\n")
rc, tail, out = run_suite(e1, TEST, "E1")
results.append(("E1 package: MONITOR_DEGRADED restored to SUCCESS_OUTCOMES", rc, tail))
print("E1 exit=%d %s" % (rc, tail))

# E2
e2 = copy_pkg("E2-guard-removed")
rd = e2 / "run_daily_check.py"
t = rd.read_text(encoding="utf-8")
i = t.index(GUARD_ANCHOR)
j = t.index('    acquired, lock = gate.acquire_day_lock(day)\n', i)
rd.write_text(t[:i] + t[j:], encoding="utf-8", newline="\n")
rc, tail, out = run_suite(e2, TEST, "E2")
results.append(("E2 package: pre-lock data-less guard deleted (day spent again)", rc, tail))
print("E2 exit=%d %s" % (rc, tail))

# E3 -- corrupt an assertion in a COPY of the test itself
tcopy = HERE / "daybudget-mutants" / "test_daybudget_corrupt.py"
tcopy.parent.mkdir(parents=True, exist_ok=True)
tt = TEST.read_text(encoding="utf-8")
old = 'self.assertEqual(day_locks(self.root), [], "a data-less run must leave no day lock")'
assert tt.count(old) == 1
tt = tt.replace(old, 'self.assertEqual(day_locks(self.root), ["NOT-THE-DAY.lock"], '
                     '"DELIBERATELY CORRUPTED ASSERTION")', 1)
tcopy.write_text(tt, encoding="utf-8", newline="\n")
rc, tail, out = run_suite(FIX, tcopy, "E3")
results.append(("E3 test-side: assertion in a COPY of the test corrupted", rc, tail))
print("E3 exit=%d %s" % (rc, tail))

(HERE / "raw" / "14-daybudget-falsification.txt").write_text(
    "\n".join("%s -> exit=%d  %s" % r for r in results) + "\n", encoding="utf-8")
