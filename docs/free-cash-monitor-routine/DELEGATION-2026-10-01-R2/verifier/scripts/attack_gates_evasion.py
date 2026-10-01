#!/usr/bin/env python
"""GATE EVASION ATTACK -- H2.

A dormant, string-built automated earning action (POST /cashout) is injected into
a SANDBOX COPY of monitoring/freecash/readonly_client.py.  It is dormant unless
FREECASH_ALLOW_ACTION=1 (a feature-flag backdoor), so:

  * verify_readonly.py          (shipped, regex over raw text)
  * rule_gate.py --static-only  (shipped, AST over the package)
  * scripts/monitoring/rule_gate_verify.py (shipped, per-file regex lint)

are all asked to certify the mutant.  If any of them passes, that checker is
worthless for this class of violation -- unless a runtime layer catches it, which
is why the mutant is then ACTUALLY FIRED against a loopback recording stub to
prove the violation is real and not theoretical.

Nothing is written to monitoring/freecash/.  The mutant lives in the sandbox.
"""

import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import (PKG, REPO, check, copy_package, header, line, sandbox,  # noqa: E402
                     set_env, use_package, utc)

VENV = sys.executable
VERIFY_READONLY = REPO / "monitoring" / "freecash" / "verify_readonly.py"
RULE_GATE = REPO / "docs" / "free-cash-monitor-routine" / "DELEGATION-2026-09-30" / "verifier" / "rule_gate.py"
RULE_GATE_VERIFY = REPO / "scripts" / "monitoring" / "rule_gate_verify.py"

header("H2 ATTACK -- does any shipped static checker refuse a dormant automated cashout?")
base = sandbox("h2")
mutant = copy_package(base)
ORIG = (mutant / "readonly_client.py").read_text(encoding="utf-8")

ANCHOR = "    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)"
INJECT = (
    "    if verb == \"GET\" and os.environ.get(\"FREECASH_ALLOW_ACTION\") == \"1\":\n"
    "        # dormant by default: only a feature-flag flip wakes it up\n"
    "        _transport(\"PO\" + \"ST\", url.rsplit(\"/\", 1)[0] + \"/\" + \"cash\" + \"out\", timeout=timeout)\n"
)
assert ORIG.count(ANCHOR) == 1, "anchor not found exactly once"
MUTATED = ORIG.replace(ANCHOR, INJECT + ANCHOR)
(mutant / "readonly_client.py").write_text(MUTATED, encoding="utf-8", newline="")

line("mutant package : %s   (sandbox copy -- the shipped tree is untouched)" % mutant)
line("injected into  : readonly_client.py, immediately before the single guarded return")
for row in INJECT.rstrip("\n").splitlines():
    line("    + %s" % row)
line("")
line("does the mutant contain any token the shipped checkers look for?")
import re  # noqa: E402
line("    grep -n '\\bPOST\\b'      mutant/readonly_client.py -> %s"
     % ([n for n, t in enumerate(MUTATED.splitlines(), 1) if re.search(r"\bPOST\b", t)] or "no match"))
line("    grep -n '/cashout'      mutant/readonly_client.py -> %s"
     % ([n for n, t in enumerate(MUTATED.splitlines(), 1) if "/cashout" in t] or "no match"))
line("    (the verb and the path are assembled at runtime from 'PO'+'ST' and '/'+'cash'+'out')")


def run(cmd, cwd=None):
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=900)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


line("")
line("-" * 96)
line("CHECKER 1 -- monitoring/freecash/verify_readonly.py (shipped regex scanner) on the MUTANT")
line("-" * 96)
code, out = run([VENV, str(VERIFY_READONLY), str(mutant)])
for row in out.strip().splitlines()[-6:]:
    line("    %s" % row)
line("    EXIT=%d" % code)
c1 = code == 0
check("verify_readonly.py PASSES the mutant (it cannot see a runtime-built write verb)", c1,
      "exit=%d" % code)

line("")
line("-" * 96)
line("CHECKER 2 -- DELEGATION-2026-09-30/verifier/rule_gate.py --static-only (AST layer) on the MUTANT")
line("-" * 96)
wd = sandbox("h2-work")
code2, out2 = run([VENV, str(RULE_GATE), "--package", str(mutant), "--workdir", str(wd), "--static-only"])
for row in out2.strip().splitlines()[-5:]:
    line("    %s" % row)
line("    EXIT=%d" % code2)
c2 = code2 == 0 and "R1=PASS  R2=PASS  R3=PASS  R4=PASS" in out2
check("rule_gate.py's AST layer PASSES the mutant", c2, "exit=%d" % code2)

line("")
line("-" * 96)
line("CHECKER 3 -- scripts/monitoring/rule_gate_verify.py (per-file regex lint) on the MUTANT module")
line("-" * 96)
code3, out3 = run([VENV, str(RULE_GATE_VERIFY), str(mutant / "readonly_client.py")])
summary = [r for r in out3.splitlines() if r.startswith("SUMMARY")]
verdict = [r for r in out3.splitlines() if r.startswith("VERDICT")]
line("    %s" % (summary[0] if summary else "<no SUMMARY>"))
line("    %s" % (verdict[0] if verdict else "<no VERDICT>"))
line("    EXIT=%d" % code3)
r2 = [r for r in out3.splitlines() if ">>> R2 RESULT" in r]
line("    %s" % (r2[0] if r2 else "<no R2 line>"))
c3 = bool(r2) and "PASS" in r2[0]
check("rule_gate_verify.py's R2 PASSES the mutant module", c3, r2[0] if r2 else "")

line("")
line("=" * 96)
if c1 and c2 and c3:
    line("RESULT: all three shipped static checkers certify a package containing an automated")
    line("        POST /cashout.  The static layer has a blind spot; only a RUNTIME probe that")
    line("        actually drives the code can see this class of violation.")
else:
    line("RESULT: at least one shipped checker refused the mutant -- see the EXIT codes above.")
line("=" * 96)

# ------------------------------------------------------------------ prove it is REAL
line("")
line("-" * 96)
line("PROOF THE VIOLATION IS REAL -- drive the mutant against a loopback recording stub")
line("-" * 96)


class Stub:
    def __init__(self):
        self.records = []

    def start(self):
        stub = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _rec(self):
                stub.records.append((self.command, self.path))

            def do_GET(self):
                self._rec()
                body = (b'{"account_status":"ACTIVE","earnings_total_cents":1025,'
                        b'"balance_cents":1025,"pending_cents":0,"currency":"USD"}')
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_HEAD(self):
                self._rec()
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                self._rec()
                n = int(self.headers.get("Content-Length") or 0)
                if n:
                    self.rfile.read(n)
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *a):
                return

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    @property
    def base_url(self):
        return "http://127.0.0.1:%d" % self.httpd.server_address[1]

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def drive(flag, data_root, day):
    set_env(data_root, tz="Europe/Berlin")
    os.environ["FREECASH_DATA_ROOT"] = str(data_root)
    if flag:
        os.environ["FREECASH_ALLOW_ACTION"] = "1"
    else:
        os.environ.pop("FREECASH_ALLOW_ACTION", None)
    for mod in [m for m in list(sys.modules) if m in
                ("paths", "gate", "readonly_client", "changedetect", "notify",
                 "approval_queue", "operator_state", "run_daily_check", "watchdog")]:
        del sys.modules[mod]
    use_package(mutant)
    import contextlib
    import io
    import run_daily_check
    stub = Stub().start()
    try:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = run_daily_check.run(["--source", "metrics_http", "--base-url", stub.base_url], now=day)
        return code, buf.getvalue().strip(), list(stub.records)
    finally:
        stub.stop()


r1root = sandbox("h2-armed") / "data"
r1root.mkdir(parents=True, exist_ok=True)
code_a, out_a, rec_a = drive(True, r1root, utc(2026, 10, 1, 6))
line("ARMED   (FREECASH_ALLOW_ACTION=1) exit=%s" % code_a)
for m, p in rec_a:
    line("    wire: %-6s %s" % (m, p))
line("    stdout: %s" % out_a[:130])

r2root = sandbox("h2-dormant") / "data"
r2root.mkdir(parents=True, exist_ok=True)
code_b, out_b, rec_b = drive(False, r2root, utc(2026, 10, 1, 6))
line("DORMANT (flag unset)             exit=%s" % code_b)
for m, p in rec_b:
    line("    wire: %-6s %s" % (m, p))

os.environ.pop("FREECASH_ALLOW_ACTION", None)
check("H2 PROVEN REAL: the mutant actually sends POST /api/v1/status/cashout when armed",
      any(m == "POST" for m, _p in rec_a), "wire=%s" % rec_a)
check("and stays silent when the gate runs it without the flag (which is why the AST gate passes)",
      all(m in ("GET", "HEAD") for m, _p in rec_b), "wire=%s" % rec_b)

line("")
line("H2 attack finished.  static_checkers_passed_mutant=%s violation_is_real=%s"
     % (all([c1, c2, c3]), any(m == "POST" for m, _p in rec_a)))
