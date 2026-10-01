"""Shared fixtures for the routine's offline test suite.

Everything here is offline: a throwaway ``http.server`` on 127.0.0.1 stands in
for the local metrics route, a recording sender stands in for the Windows toast,
and every test runs against a temporary data root so the real state directory is
never touched.  No credential is used and no external host is contacted.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROUTINE_DIR = HERE.parent
REPO_ROOT = ROUTINE_DIR.parent.parent
#: The single human identity this suite decides as (see TempDataRoot.__enter__).
OPERATOR_IDENTITY = "Operator Jane"
RUN_DAILY = ROUTINE_DIR / "run_daily_check.py"
SHELL_CHECKER = REPO_ROOT / "docs" / "free-cash-monitor-routine" / "verify-readonly.sh"

if str(ROUTINE_DIR) not in sys.path:
    sys.path.insert(0, str(ROUTINE_DIR))

ENV_KEYS = (
    "FREECASH_DATA_ROOT",
    "FREECASH_TZ",
    "FREECASH_TOAST_STUB",
    "FREECASH_TOAST_RETRY_SLEEP_SECONDS",
    "FREECASH_READ_SOURCE",
    "FREECASH_READ_BASE_URL",
    "FREECASH_HTTP_TIMEOUT",
    #: R4 identity (allowlist proposal): the decider guard fails CLOSED when no
    #: operator identity is configured, so the suite must configure one.  Saved
    #: and restored with the other keys.
    "FREECASH_OPERATOR_IDENTITY",
)


class TempDataRoot:
    """Point the routine at a throwaway data root for the duration of a test."""

    def __init__(self, **overrides):
        self.overrides = overrides
        self._saved = {}
        self._tmp = None
        self.root = None

    def __enter__(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="freecash-test-", ignore_cleanup_errors=True)
        self.root = Path(self._tmp.name) / "freecash-monitor"
        for key in ENV_KEYS:
            self._saved[key] = os.environ.get(key)
        os.environ["FREECASH_DATA_ROOT"] = str(self.root)
        os.environ["FREECASH_TZ"] = "Europe/Berlin"
        os.environ["FREECASH_TOAST_STUB"] = "1"
        os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
        for key, value in self.overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = str(value)
        #: R4 identity (allowlist proposal): the decider guard is an
        #: operator-owned allowlist that fails CLOSED when unconfigured.  This
        #: suite decides as 'Operator Jane', so seed the allowlist for the
        #: throwaway root.  It exercises the FILE source, not the env override.
        allowlist = self.root / "state" / "human-deciders.json"
        allowlist.parent.mkdir(parents=True, exist_ok=True)
        allowlist.write_text(
            json.dumps({"schema_version": 1, "operators": [OPERATOR_IDENTITY]}, indent=2),
            encoding="utf-8",
        )
        return self

    def env(self, **extra):
        """Environment mapping for a child process (same throwaway root)."""
        env = dict(os.environ)
        for key, value in extra.items():
            env[key] = str(value)
        return env

    def __exit__(self, *exc):
        import paths as _paths

        _paths.clear_clock()
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()
        return False


# --------------------------------------------------------------------------- toast


class RecordingSender:
    """Stands in for the toast channel and counts deliveries."""

    delivery_label = "TOAST_OK"

    def __init__(self, fail_times=0):
        self.messages = []
        self.fail_times = fail_times
        self.attempts = 0

    def __call__(self, message):
        self.attempts += 1
        if self.attempts <= self.fail_times:
            raise RuntimeError("simulated toast failure #%d" % self.attempts)
        self.messages.append(message)


# --------------------------------------------------------------------------- source


DEFAULT_METRICS = {
    "account_status": "ACTIVE",
    "earnings_total_cents": 1025,
    "balance_cents": 1025,
    "pending_cents": 0,
    "currency": "USD",
}


class StubSource:
    """A throwaway loopback HTTP server standing in for the local metrics route.

    It records the verb of every request it receives, which is how the tests show
    that the routine only ever read.
    """

    def __init__(self, payload=None, metrics_status=200, status_code=200):
        self.payload = dict(payload if payload is not None else DEFAULT_METRICS)
        self.metrics_status = metrics_status
        self.status_code = status_code
        self.records = []
        self._httpd = None
        self._thread = None

    def start(self):
        stub = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _record(self):
                stub.records.append((self.command, self.path))

            def _send(self, code, body=b"", content_type="application/json"):
                self.send_response(code)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body:
                    self.wfile.write(body)

            def do_GET(self):
                self._record()
                if self.path == "/api/v1/status/metrics":
                    body = json.dumps(stub.payload).encode("utf-8")
                    self._send(stub.metrics_status, body)
                else:
                    self._send(404, b"{}")

            def do_HEAD(self):
                self._record()
                self._send(stub.status_code, b"")

            def log_message(self, *args):
                return

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    @property
    def base_url(self):
        host, port = self._httpd.server_address[:2]
        return "http://%s:%d" % (host, port)

    @property
    def methods(self):
        return sorted({method for method, _path in self.records})

    def stop(self):
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()
        return False


# --------------------------------------------------------------------------- state


def alerts(root) -> list:
    path = Path(root) / "alerts" / "alerts.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


def alert_lines(root) -> list:
    path = Path(root) / "alerts" / "alerts.jsonl"
    if not path.exists():
        return []
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def events(root, event_type) -> list:
    return [record for record in alerts(root) if record.get("event_type") == event_type]


def snapshot_files(root) -> list:
    path = Path(root) / "snapshots"
    if not path.exists():
        return []
    return sorted(p.name for p in path.glob("*.json"))


def day_locks(root) -> list:
    path = Path(root) / "state" / "day-locks"
    if not path.exists():
        return []
    return sorted(p.name for p in path.glob("*.lock"))


def ledger(root) -> dict:
    path = Path(root) / "state" / "last-run.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def pending_document(root) -> dict:
    path = Path(root) / "approvals" / "pending.json"
    if not path.exists():
        return {"items": []}
    return json.loads(path.read_text(encoding="utf-8"))


def operator_state_document(root) -> dict:
    path = Path(root) / "state" / "operator-state.json"
    return json.loads(path.read_text(encoding="utf-8"))


def write_operator_record(root, day, **fields):
    """Append one operator-entered record for *day* to the state file."""
    path = Path(root) / "state" / "operator-state.json"
    if path.exists():
        document = json.loads(path.read_text(encoding="utf-8"))
    else:
        import operator_state

        document = operator_state.template_document()
    record = {
        "day_key": day,
        "entered_at_utc": "%sT06:40:00Z" % day,
        "account_status": fields.get("account_status", "ACTIVE"),
        "earnings_total_cents": fields.get("earnings_total_cents", 1025),
        "balance_cents": fields.get("balance_cents", 1025),
        "pending_cents": fields.get("pending_cents", 0),
        "currency": fields.get("currency", "USD"),
    }
    document["records"].append(record)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2), encoding="utf-8")
    return record


def run_entry_point(args=(), env=None, timeout=120):
    """Run the real entry point as a child process (real exit code and stdout)."""
    command = [sys.executable, str(RUN_DAILY)] + list(args)
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        env=env if env is not None else dict(os.environ),
        timeout=timeout,
        cwd=str(REPO_ROOT),
    )


def copy_routine(destination) -> Path:
    """Copy the routine source tree (excluding caches) to *destination*."""
    destination = Path(destination)
    shutil.copytree(
        ROUTINE_DIR,
        destination,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    return destination
