#!/usr/bin/env python3
"""blindspot_probe.py -- prove the two UNCAUGHT mutations are live violations.

The mutation harness found that the 2026-09-30 gate does not flag
  adv3-r4-getattr-exec        (R4: the routine executes a queued approval)
  adv4-r1-conditional-backdoor (R1: an obfuscated, condition-gated write)
This probe drives each mutant and shows the harmful effect actually happen, so
"not detected" means a blind spot and not dead code.

All execution is confined to a throwaway FREECASH_DATA_ROOT under Temp.  The
only external effect produced is `echo` (adv3) and a loopback HTTP request to a
throwaway stub (adv4) -- no provider contact, no credential.
"""

import os
import subprocess
import sys
from pathlib import Path

P = "C:/Users/cd-pr/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
BASE = Path("C:/Users/cd-pr/AppData/Local/Temp/verifier-v2-2026-10-01")
MUT = BASE / "mutants"
DETECTORS = Path("D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/detectors")

ADV3 = MUT / "adv3-r4-getattr-exec" / "pkg"
ADV4 = MUT / "adv4-r1-conditional-backdoor" / "pkg"

# ---- A. does adv3 actually execute something on enqueue? ---------------------
ADV3_CODE = r'''
import sys, os
sys.path.insert(0, r"__PKG__")
os.environ["FREECASH_DATA_ROOT"] = r"__ROOT__"
os.environ["FREECASH_TZ"] = "Europe/Berlin"
import paths, approval_queue
paths.ensure_layout()
item = approval_queue.enqueue("2026-03-11", {"dedupe_key": "probe", "new_value": 12345}, "liveness probe")
print("ENQUEUED id=%s status=%s execution_state=%s" % (item["approval_id"], item["status"], item["execution_state"]))
'''.replace("__PKG__", ADV3.as_posix()).replace("__ROOT__", (BASE / "adv3-live-root").as_posix())

# ---- B/C. does adv4 actually put a POST on the wire when its condition holds?
ADV4_CODE = r'''
import sys, os, io, contextlib
from datetime import datetime, timezone
sys.path.insert(0, r"__PKG__")
sys.path.insert(0, r"__DET__")
os.environ["FREECASH_DATA_ROOT"] = r"__ROOT__"
os.environ["FREECASH_TZ"] = "Europe/Berlin"
os.environ["FREECASH_TOAST_STUB"] = "1"
os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
if os.environ.get("PROBE_SET_CONDITION") == "1":
    os.environ["FREECASH_LIVE_READ"] = "1"
from detector_r1_earn import Stub
import run_daily_check
stub = Stub().start()
try:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = run_daily_check.run(["--source", "metrics_http", "--base-url", stub.base_url],
                                   now=datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc))
    print("run exit=%s stdout=%r" % (code, out.getvalue().strip()[:120]))
    print("WIRE=" + str([(r["method"], r["path"]) for r in stub.records]))
finally:
    stub.stop()
'''.replace("__PKG__", ADV4.as_posix()).replace("__DET__", DETECTORS.as_posix()).replace(
    "__ROOT__", (BASE / "adv4-live-root").as_posix())


def run(label, code, extra_env=None, root=None):
    env = dict(os.environ)
    env.pop("FREECASH_DATA_ROOT", None)
    env.update(extra_env or {})
    if root is not None:
        import shutil
        shutil.rmtree(root, ignore_errors=True)
    out = []
    out.append("=" * 78)
    out.append(label)
    out.append("=" * 78)
    process = subprocess.run([P, "-c", code], capture_output=True, text=True, env=env, timeout=300)
    out.append(process.stdout.rstrip())
    if process.stderr.strip():
        out.append("--stderr--")
        out.append(process.stderr.rstrip())
    out.append("exit=%d" % process.returncode)
    out.append("")
    return "\n".join(out)


def main():
    chunks = []
    chunks.append("BLIND-SPOT LIVENESS PROBE  (are the two UNCAUGHT mutations real violations?)\n")
    chunks.append(run("A. adv3-r4-getattr-exec : enqueue() -> drain_and_execute() -> os.system('echo ...')",
                      ADV3_CODE, root=BASE / "adv3-live-root"))
    chunks.append(run("B. adv4-r1-conditional-backdoor : condition FREECASH_LIVE_READ=1 SET  (the mutant's own condition)",
                      ADV4_CODE, extra_env={"PROBE_SET_CONDITION": "1"}, root=BASE / "adv4-live-root"))
    chunks.append(run("C. adv4-r1-conditional-backdoor : condition FREECASH_LIVE_READ unset  (what every detector run does)",
                      ADV4_CODE, extra_env={"PROBE_SET_CONDITION": "0"}, root=BASE / "adv4-live-root"))
    text = "\n".join(chunks)
    out = Path("D:/AgenticOS/docs/free-cash-monitor-routine/DELEGATION-2026-10-01/verifier/blindspot-liveness.txt")
    out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
