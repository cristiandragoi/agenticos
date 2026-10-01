"""bridge_proof.py -- S4: proves the DESIGNED loopback bridge shape works
end-to-end against the real entry point, WITHOUT installing any bridge.

A throwaway 127.0.0.1 server stands in for the proposed operator read-bridge.
It serves the two paths readonly_client already allows and records every verb it
sees.  The routine is run from the COPY in this stream dir, against a throwaway
FREECASH_DATA_ROOT.  Nothing under monitoring/freecash/** or data/freecash-monitor/**
is written.

Shows: the routine carries a REAL figure over loopback with no allowlist change,
records only GET/HEAD on the wire, and still stamps refined snapshot degraded:true
(hardcoded at changedetect.py:168).
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROUTINE = HERE / "routine_copy"
RUN_DAILY = ROUTINE / "run_daily_check.py"

#: A figure a human would have read off their own logged-in dashboard.
BRIDGE_PAYLOAD = {
    "account_status": "ACTIVE",
    "earnings_total_cents": 1340,
    "balance_cents": 1340,
    "pending_cents": 0,
    "currency": "USD",
}

received = []


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        received.append((self.command, self.path))
        if self.path == "/api/v1/status/metrics":
            self._send(200, json.dumps(BRIDGE_PAYLOAD).encode())
        else:
            self._send(404, b"{}")

    def do_HEAD(self):
        received.append((self.command, self.path))
        self._send(200, b"")

    def do_POST(self):
        received.append((self.command, self.path))
        self._send(405, b"{}")

    def log_message(self, *a):
        return


def main():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    host, port = httpd.server_address[:2]
    base = "http://%s:%d" % (host, port)
    print("bridge stand-in listening on %s (loopback only)" % base)

    tmp = tempfile.TemporaryDirectory(prefix="s4-bridge-proof-", ignore_cleanup_errors=True)
    root = Path(tmp.name) / "freecash-monitor"
    env = dict(os.environ)
    env.update({
        "FREECASH_DATA_ROOT": str(root),
        "FREECASH_TZ": "Europe/Berlin",
        "FREECASH_TOAST_STUB": "1",
        "FREECASH_TOAST_RETRY_SLEEP_SECONDS": "0",
        "FREECASH_READ_SOURCE": "metrics_http",
        "FREECASH_READ_BASE_URL": base,
        "AGENT_TEAMS_DB_PATH": str(Path(tmp.name) / "agent-teams.db"),
        "AGENTICOS_DATA_DIR": str(Path(tmp.name) / "agenticos-data"),
    })

    proc = subprocess.run([sys.executable, str(RUN_DAILY)], capture_output=True, text=True,
                          env=env, cwd="D:/AgenticOS", timeout=120)
    httpd.shutdown()
    httpd.server_close()

    print("entry point exit code: %s" % proc.returncode)
    print("entry point stdout   : %s" % proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else "(none)")
    print("entry point stderr   : %s" % (proc.stderr.strip() or "(none)"))
    print("VERBS THE BRIDGE SAW : %r" % (received,))
    writes = [r for r in received if r[0] not in ("GET", "HEAD")]
    print("WRITE VERBS THE BRIDGE SAW: %r -> %s" %
          (writes, "NONE (zero write capability exercised)" if not writes else "*** WRITE SEEN ***"))

    snaps = sorted((root / "snapshots").glob("*.json"))
    print("snapshots written to the THROWAWAY root: %r" % [p.name for p in snaps])
    for p in snaps:
        d = json.loads(p.read_text(encoding="utf-8"))
        print("--- %s ---" % p.name)
        print(json.dumps(d, indent=2))

    tmp.cleanup()


if __name__ == "__main__":
    main()
