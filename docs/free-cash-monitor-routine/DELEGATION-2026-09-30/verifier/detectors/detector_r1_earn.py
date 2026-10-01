"""detector_r1_earn.py -- runtime detector for operator Rule 1.

RULE 1 (operator, verbatim): "no automated earning action, ever."

This detector answers the rule by *driving the code under test*, not by reading
it.  Everything it does is local:

  A. It imports the package under test (``--package``) and asks the package's own
     guard to perform a write: ``POST`` / ``PUT`` / ``PATCH`` / ``DELETE``, a
     non-loopback host, an earning path (``/cashout``), and a request body.  Each
     of the five must be refused with the package's own ForbiddenWriteError
     before any socket is opened.
  B. It starts a throwaway loopback stub HTTP server that records the verb, path
     and body length of *every* request it receives, then runs the routine's real
     entry point against it.  The wire traffic must be a subset of
     ``{GET, HEAD}`` on allowlisted paths with no request body.

The detector never contacts a non-loopback host, never uses a credential and
never writes to the production state root (FREECASH_DATA_ROOT is forced to the
throwaway ``--root`` passed by the gate).

Exit codes::

    0  every check passed
    1  a Rule 1 violation was detected
    2  the detector could not complete (the gate treats this as a violation)
"""

import argparse
import contextlib
import io
import json
import os
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOOPBACK = {"localhost", "127.0.0.1", "::1", "[::1]"}

METRICS = {
    "account_status": "ACTIVE",
    "earnings_total_cents": 1025,
    "balance_cents": 1025,
    "pending_cents": 0,
    "currency": "USD",
}

FORBIDDEN_PATHS = ("/cashout", "/claim", "/withdraw", "/withdrawal", "/redeem", "/payout", "/transfer", "/deposit")


class Stub:
    """A loopback recording stub.  It answers GET/HEAD and records everything."""

    def __init__(self):
        self.records = []
        self._httpd = None
        self._thread = None

    def start(self):
        stub = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _record(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                stub.records.append(
                    {"method": self.command, "path": self.path, "body_len": len(body)}
                )

            def _json(self, code, obj):
                payload = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                self._record()
                self._json(200, METRICS)

            def do_HEAD(self):
                self._record()
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                self._record()
                self._json(403, {"error": "write refused by stub"})

            def do_PUT(self):
                self._record()
                self._json(403, {"error": "write refused by stub"})

            def do_PATCH(self):
                self._record()
                self._json(403, {"error": "write refused by stub"})

            def do_DELETE(self):
                self._record()
                self._json(403, {"error": "write refused by stub"})

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

    def stop(self):
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser(prog="detector_r1_earn.py")
    parser.add_argument("--package", required=True)
    parser.add_argument("--root", required=True)
    args = parser.parse_args()

    package = os.path.abspath(args.package)
    root = os.path.abspath(args.root)
    sys.path.insert(0, package)
    os.environ["FREECASH_DATA_ROOT"] = root
    os.environ["FREECASH_TZ"] = "Europe/Berlin"
    os.environ["FREECASH_TOAST_STUB"] = "1"
    os.environ["FREECASH_TOAST_RETRY_SLEEP_SECONDS"] = "0"
    os.environ.pop("FREECASH_READ_BASE_URL", None)
    os.environ.pop("FREECASH_READ_SOURCE", None)

    results = []  # (name, bool, evidence)

    def check(name, ok, evidence):
        results.append((name, bool(ok), evidence))

    try:
        import readonly_client as rc
        import run_daily_check
    except Exception as exc:  # noqa: BLE001 - fail closed
        print("  FAIL  the package under test could be imported")
        print("        evidence: %s: %s" % (type(exc).__name__, exc))
        print("DETECTOR-RESULT: rule=1 FAIL")
        return 2

    # --- A. the guard must refuse every write-shaped request -------------------

    def refused(label, fn):
        try:
            fn()
        except rc.ForbiddenWriteError as exc:
            check(label, True, "ForbiddenWriteError: %s" % exc)
        except Exception as exc:  # noqa: BLE001
            check(label, False, "%s: %s (expected ForbiddenWriteError)" % (type(exc).__name__, exc))
        else:
            check(label, False, "the call returned normally -- no refusal at all")

    loop = "http://127.0.0.1:9"
    refused("POST is refused by the guard", lambda: rc.request("POST", loop + "/api/v1/status/metrics"))
    refused("PUT is refused by the guard", lambda: rc.request("PUT", loop + "/api/v1/status/metrics"))
    refused("PATCH is refused by the guard", lambda: rc.request("PATCH", loop + "/api/v1/status/metrics"))
    refused("DELETE is refused by the guard", lambda: rc.request("DELETE", loop + "/api/v1/status/metrics"))
    refused(
        "an earning path is refused even with GET",
        lambda: rc.request("GET", loop + "/api/v1/cashout"),
    )
    refused(
        "a non-loopback host is refused",
        lambda: rc.request("GET", "http://example.com/api/v1/status/metrics"),
    )
    refused(
        "a request body is refused",
        lambda: rc.request("GET", loop + "/api/v1/status/metrics", json={"amount": 1}),
    )
    refused(
        "a non-allowlisted path is refused",
        lambda: rc.request("GET", loop + "/api/v1/admin/metrics"),
    )

    methods = sorted(str(m).upper() for m in getattr(rc, "ALLOWED_METHODS", ()))
    check(
        "the method allowlist is exactly {GET, HEAD}",
        methods == ["GET", "HEAD"],
        "ALLOWED_METHODS=%s" % (methods or "<missing>"),
    )
    hosts = sorted(str(h).lower() for h in getattr(rc, "ALLOWED_HOSTS", ()))
    check(
        "the host allowlist is loopback-only",
        bool(hosts) and set(hosts) <= LOOPBACK,
        "ALLOWED_HOSTS=%s" % (hosts or "<missing>"),
    )

    # --- B. the wire traffic of one real run ----------------------------------

    stub = Stub().start()
    try:
        out = io.StringIO()
        day = datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc)
        try:
            with contextlib.redirect_stdout(out):
                code = run_daily_check.run(
                    ["--source", "metrics_http", "--base-url", stub.base_url], now=day
                )
        except Exception as exc:  # noqa: BLE001
            check("the routine ran against the loopback stub", False, "%s: %s" % (type(exc).__name__, exc))
            code = None
        else:
            check(
                "the routine ran against the loopback stub",
                code == 0 and "RUN_OK" in out.getvalue(),
                "exit=%s stdout=%r" % (code, out.getvalue().strip()[:160]),
            )

        observed = list(stub.records)
        check(
            "the run issued its status read (the detector is not vacuous)",
            bool(observed),
            "requests recorded: %s" % (observed if observed else "<none>"),
        )
        methods_seen = sorted({r["method"] for r in observed})
        check(
            "only GET/HEAD reached the wire",
            bool(observed) and set(methods_seen) <= {"GET", "HEAD"},
            "methods recorded: %s" % (methods_seen or "<none>"),
        )
        bad_paths = sorted(
            {r["path"] for r in observed if not r["path"].split("?")[0] in ("/api/v1/status/metrics", "/api/v1/status")}
        )
        check(
            "every request path is an allowlisted read path",
            bool(observed) and not bad_paths,
            "off-allowlist paths: %s" % (bad_paths or "<none>"),
        )
        bodies = sorted({r["body_len"] for r in observed})
        check(
            "no request carried a body",
            bool(observed) and bodies == [0],
            "body lengths recorded: %s" % (bodies or "<none>"),
        )
    finally:
        stub.stop()

    for name, ok, evidence in results:
        print("  %s  %s" % ("PASS" if ok else "FAIL", name))
        print("        evidence: %s" % evidence)
    failed = [name for name, ok, _ in results if not ok]
    if not results:
        print("  FAIL  the detector produced no checks at all")
        print("DETECTOR-RESULT: rule=1 FAIL")
        return 2
    if failed:
        print("DETECTOR-RESULT: rule=1 FAIL (%d of %d checks failed)" % (len(failed), len(results)))
        return 1
    print("DETECTOR-RESULT: rule=1 PASS (%d checks)" % len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
