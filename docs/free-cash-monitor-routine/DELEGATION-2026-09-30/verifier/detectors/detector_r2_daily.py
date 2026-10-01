"""detector_r2_daily.py -- runtime detector for operator Rule 2.

RULE 2 (operator, verbatim): "exactly one status check per operator-local
calendar day."

The detector measures the rule where it can be measured: the wire.  It runs the
routine's real entry point against a throwaway loopback stub that counts every
request, twice on the *same* operator-local day and once on the *next* day.

  * run #1 on day D     -> must perform the status read  (RUN_OK, wire > 0)
  * run #2 on day D     -> must NOT perform a status read (SKIP_DUPLICATE_DAY,
                           wire unchanged, one snapshot, one day lock)
  * run #3 on day D + 1 -> must perform the status read  (proves the detector is
                           not vacuous: a fresh day is still allowed; a gate that
                           always reports "no second read" for any input would
                           fail here)

Exit codes:: 0 all checks pass, 1 a Rule 2 violation, 2 detector could not run.
"""

import argparse
import contextlib
import io
import json
import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

METRICS = {
    "account_status": "ACTIVE",
    "earnings_total_cents": 1340,
    "balance_cents": 1340,
    "pending_cents": 0,
    "currency": "USD",
}

DAY_ONE = datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc)


class Stub:
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
                stub.records.append((self.command, self.path, len(body)))

            def do_GET(self):
                self._record()
                payload = json.dumps(METRICS).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_HEAD(self):
                self._record()
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

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
    def count(self):
        return len(self.records)

    def stop(self):
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)


def read_jsonl(path):
    out = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        out.append({"__unparsable__": line})
    return out


def main():
    parser = argparse.ArgumentParser(prog="detector_r2_daily.py")
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

    results = []

    def check(name, ok, evidence):
        results.append((name, bool(ok), evidence))

    try:
        import gate
        import run_daily_check
    except Exception as exc:  # noqa: BLE001
        print("  FAIL  the package under test could be imported")
        print("        evidence: %s: %s" % (type(exc).__name__, exc))
        print("DETECTOR-RESULT: rule=2 FAIL")
        return 2

    day_one = gate.day_key(DAY_ONE)
    day_two = gate.day_key(DAY_ONE + timedelta(days=1))
    check(
        "the operator-local day key is a calendar date",
        len(day_one) == 10 and day_one.count("-") == 2,
        "day_key(2026-03-10T12:00Z) = %r with FREECASH_TZ=Europe/Berlin" % day_one,
    )

    stub = Stub().start()
    try:
        def run_once():
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = run_daily_check.run(
                    ["--source", "metrics_http", "--base-url", stub.base_url], now=DAY_ONE
                )
            return code, out.getvalue().strip()

        code1, text1 = run_once()
        wire1 = stub.count
        check(
            "run #1 on day D performs the status read",
            code1 == 0 and "RUN_OK" in text1 and wire1 > 0,
            "exit=%s wire=%d stdout=%r" % (code1, wire1, text1[:160]),
        )

        code2, text2 = run_once()
        wire2 = stub.count
        check(
            "run #2 on the same day D does NOT perform a status read",
            wire2 == wire1,
            "wire before=%d after=%d (delta=%d)" % (wire1, wire2, wire2 - wire1),
        )
        check(
            "run #2 on the same day reports the duplicate instead of running",
            "SKIP_DUPLICATE_DAY" in text2 and "RUN_OK" not in text2,
            "exit=%s stdout=%r" % (code2, text2[:160]),
        )

        snapshots = sorted(os.listdir(os.path.join(root, "snapshots"))) if os.path.isdir(os.path.join(root, "snapshots")) else []
        locks = sorted(os.listdir(os.path.join(root, "state", "day-locks"))) if os.path.isdir(os.path.join(root, "state", "day-locks")) else []
        check(
            "exactly one snapshot and one day lock exist for day D",
            snapshots == ["%s.json" % day_one] and locks == ["%s.lock" % day_one],
            "snapshots=%s locks=%s" % (snapshots, locks),
        )

        alerts = read_jsonl(os.path.join(root, "alerts", "alerts.jsonl"))
        skips = [a for a in alerts if a.get("event_type") == "SKIP_DUPLICATE_DAY"]
        check(
            "exactly one SKIP_DUPLICATE_DAY alert line was written",
            len(skips) == 1,
            "SKIP_DUPLICATE_DAY lines=%d (lock=%s)" % (
                len(skips),
                (skips[0].get("observed") or {}).get("lock") if skips else "<none>",
            ),
        )

        # non-vacuity: a fresh day must still be allowed to read.
        out3 = io.StringIO()
        with contextlib.redirect_stdout(out3):
            code3 = run_daily_check.run(
                ["--source", "metrics_http", "--base-url", stub.base_url],
                now=DAY_ONE + timedelta(days=1),
            )
        text3 = out3.getvalue().strip()
        check(
            "run #3 on the next day D+1 is allowed to read (not vacuous)",
            code3 == 0 and "RUN_OK" in text3 and stub.count > wire2,
            "exit=%s wire=%d stdout=%r" % (code3, stub.count, text3[:160]),
        )
        check(
            "the next day's key is a distinct calendar date",
            day_two != day_one and len(day_two) == 10,
            "day D+1 key = %r" % day_two,
        )
    except Exception as exc:  # noqa: BLE001 - fail closed
        check("the detector ran to completion", False, "%s: %s" % (type(exc).__name__, exc))
    finally:
        stub.stop()

    for name, ok, evidence in results:
        print("  %s  %s" % ("PASS" if ok else "FAIL", name))
        print("        evidence: %s" % evidence)
    failed = [name for name, ok, _ in results if not ok]
    if not results:
        print("  FAIL  the detector produced no checks at all")
        print("DETECTOR-RESULT: rule=2 FAIL")
        return 2
    if failed:
        print("DETECTOR-RESULT: rule=2 FAIL (%d of %d checks failed)" % (len(failed), len(results)))
        return 1
    print("DETECTOR-RESULT: rule=2 PASS (%d checks)" % len(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
