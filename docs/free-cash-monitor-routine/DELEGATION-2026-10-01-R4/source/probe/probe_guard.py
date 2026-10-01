"""S4 probe: empirically exercise the REAL readonly_client guard.

Every refusal is attempted with an in-process spy transport, so the guard is
proven to raise BEFORE ``_transport`` (the single socket site) is reached: the
spy records zero calls on every refused request.

No external host is ever contacted.  The "non-allowlisted host" probes are
refused by layer A before any connection exists; the only live connections in
this file are to a throwaway 127.0.0.1 server and to 127.0.0.2 (both loopback,
RFC 5737 not involved).
"""

import hashlib
import json
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import readonly_client as rc  # noqa: E402  (the COPY in this stream dir)

ORIGINAL = Path("D:/AgenticOS/monitoring/freecash/readonly_client.py")


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Spy:
    """Records every transport call.  Any recorded call == a socket could open."""

    def __init__(self):
        self.calls = []

    def __call__(self, method, url, timeout=None, headers=None):
        self.calls.append((method, url))
        return {"method": method, "url": url, "status": 200, "reason": "OK",
                "headers": {}, "body": b"{}"}


def show(label, fn):
    """Call fn(); print the exact outcome.  Returns (kind, payload)."""
    try:
        value = fn()
    except BaseException as exc:  # noqa: BLE001 - we want the exact runtime type
        kind = type(exc).__module__ + "." + type(exc).__name__
        print("  ATTEMPT : %s" % label)
        print("  OUTCOME : RAISED")
        print("  EXACT   : %s" % kind)
        print("  MESSAGE : %s" % str(exc))
        print("  REPR    : %s" % repr(exc))
        return ("raised", kind, str(exc))
    print("  ATTEMPT : %s" % label)
    print("  OUTCOME : RETURNED %r" % (value,))
    return ("returned", value)


def main():
    print("=" * 78)
    print("S4 EMPIRICAL READ-ONLY ENFORCEMENT PROBE")
    print("=" * 78)
    print("python        : %s" % sys.version.replace("\n", " "))
    print("module copy   : %s" % (HERE / "readonly_client.py"))
    print("copy sha256   : %s" % sha256_of(HERE / "readonly_client.py"))
    print("orig sha256   : %s" % sha256_of(ORIGINAL))
    print("MODULE FIDELITY: %s" %
          ("IDENTICAL (copy is byte-for-byte the shipped file)"
           if sha256_of(HERE / "readonly_client.py") == sha256_of(ORIGINAL) else "DIFFERENT -- INVESTIGATE"))

    print()
    print("-" * 78)
    print("SECTION 1 -- ALLOWLISTS, ENUMERATED FROM THE LIVE OBJECTS")
    print("-" * 78)
    print("ALLOWED_METHODS   = %r" % (sorted(rc.ALLOWED_METHODS),))
    print("ALLOWED_HOSTS     = %r" % (sorted(rc.ALLOWED_HOSTS),))
    print("ALLOWED_PATHS     = [")
    for p in rc.ALLOWED_PATHS:
        print("    re.compile(%r)," % p.pattern)
    print("]")
    print("BODY_KEYWORDS     = %r" % (rc.BODY_KEYWORDS,))
    print("DEFAULT_BASE_URL  = %r" % rc.DEFAULT_BASE_URL)
    print("PROVIDER_ENDPOINT_UNKNOWN = %r" % rc.PROVIDER_ENDPOINT_UNKNOWN)
    print("provider-facing path allowlisted? %s" %
          any("freecash" in p.pattern or "provider" in p.pattern for p in rc.ALLOWED_PATHS))

    spy = Spy()

    print()
    print("-" * 78)
    print("SECTION 2 -- ATTEMPTED VIOLATIONS (each must raise; spy must stay empty)")
    print("-" * 78)

    print("[V1] non-allowlisted METHOD (POST) to an allowlisted loopback path")
    show("rc.request('POST', 'http://127.0.0.1:3001/api/v1/status/metrics', transport=spy)",
         lambda: rc.request("POST", "http://127.0.0.1:3001/api/v1/status/metrics", transport=spy))

    print()
    print("[V1b] non-allowlisted METHOD (DELETE)")
    show("rc.request('DELETE', 'http://127.0.0.1:3001/api/v1/status/metrics', transport=spy)",
         lambda: rc.request("DELETE", "http://127.0.0.1:3001/api/v1/status/metrics", transport=spy))

    print()
    print("[V2] non-allowlisted HOST (public provider hostname) -- refused BEFORE any connection")
    show("rc.request('GET', 'https://api.freecash.com/api/v1/status/metrics', transport=spy)",
         lambda: rc.request("GET", "https://api.freecash.com/api/v1/status/metrics", transport=spy))

    print()
    print("[V2b] non-allowlisted HOST (documentation TLD .invalid)")
    show("rc.request('GET', 'http://provider.invalid/api/v1/status/metrics', transport=spy)",
         lambda: rc.request("GET", "http://provider.invalid/api/v1/status/metrics", transport=spy))

    print()
    print("[V2c] non-loopback host that is NOT in the allowlist despite being numeric loopback range")
    show("rc.request('GET', 'http://127.0.0.2:3001/api/v1/status/metrics', transport=spy)",
         lambda: rc.request("GET", "http://127.0.0.2:3001/api/v1/status/metrics", transport=spy))

    print()
    print("[V3] request BODY on an otherwise-allowed call (GET + json=)")
    show("rc.request('GET', 'http://127.0.0.1:3001/api/v1/status/metrics', json={'x':1}, transport=spy)",
         lambda: rc.request("GET", "http://127.0.0.1:3001/api/v1/status/metrics", json={"x": 1}, transport=spy))

    print()
    print("[V3b] request BODY via data=")
    show("rc.request('GET', 'http://127.0.0.1:3001/api/v1/status/metrics', data=b'x', transport=spy)",
         lambda: rc.request("GET", "http://127.0.0.1:3001/api/v1/status/metrics", data=b"x", transport=spy))

    print()
    print("[V3c] unknown keyword argument (closed kwarg surface)")
    show("rc.request('GET', 'http://127.0.0.1:3001/api/v1/status/metrics', stream=b'x', transport=spy)",
         lambda: rc.request("GET", "http://127.0.0.1:3001/api/v1/status/metrics", stream=b"x", transport=spy))

    print()
    print("[V4] non-allowlisted PATH")
    show("rc.request('GET', 'http://127.0.0.1:3001/api/v1/status/claim', transport=spy)",
         lambda: rc.request("GET", "http://127.0.0.1:3001/api/v1/status/claim", transport=spy))

    print()
    print("[V5] non-http scheme")
    show("rc.request('GET', 'file:///etc/passwd', transport=spy)",
         lambda: rc.request("GET", "file:///etc/passwd", transport=spy))

    print()
    print("SPY TRANSPORT CALLS RECORDED: %r" % (spy.calls,))
    print("=> layer-A guard reached no transport on any refused request: %s" %
          ("CONFIRMED (0 calls)" if spy.calls == [] else "FAILED -- transport was reached"))

    print()
    print("-" * 78)
    print("SECTION 3 -- AUDIT HOOK (layer B): DOCUMENTED ARGUMENT SHAPES")
    print("-" * 78)
    installed = rc.install_audit_guard()
    print("rc.install_audit_guard() -> %r (True == hook newly installed this process)" % installed)

    def hook(label, event, args):
        try:
            rc._audit_hook(event, args)
        except BaseException as exc:  # noqa: BLE001
            print("  %-58s RAISED %s: %s" % (label, type(exc).__name__, exc))
            return
        print("  %-58s NO RAISE (hook ignored the event)" % label)

    # socket.connect args == (socket_object, address_tuple)  <- handled
    hook("connect(('provider.invalid',443)) [connect shape]", "socket.connect", (None, ("provider.invalid", 443)))
    hook("connect(('127.0.0.1',3001)) [connect shape]", "socket.connect", (None, ("127.0.0.1", 3001)))
    # socket.getaddrinfo args == (host_str, port, family, type, proto)  <- CPython docs
    print("  -- getaddrinfo shape (host is a STRING, not a tuple) --")
    hook("getaddrinfo(('provider.invalid',443,0,1,0))", "socket.getaddrinfo", ("provider.invalid", 443, 0, 1, 0))
    hook("getaddrinfo(('93.184.216.34',80,0,1,0))", "socket.getaddrinfo", ("93.184.216.34", 80, 0, 1, 0))
    hook("getaddrinfo(('127.0.0.1',3001,0,1,0))", "socket.getaddrinfo", ("127.0.0.1", 3001, 0, 1, 0))

    print()
    print("-" * 78)
    print("SECTION 4 -- AUDIT HOOK LIVE (loopback only; no external host contacted)")
    print("-" * 78)

    # 4a: real getaddrinfo for a NON-allowlisted loopback address, hook installed.
    try:
        info = socket.getaddrinfo("127.0.0.2", 9, type=socket.SOCK_STREAM)
        print("LIVE getaddrinfo('127.0.0.2', 9) -> RETURNED %d addr(s); hook did NOT abort" % len(info))
        live_gai_hole = True
    except BaseException as exc:  # noqa: BLE001
        print("LIVE getaddrinfo('127.0.0.2', 9) -> RAISED %s: %s" % (type(exc).__name__, exc))
        live_gai_hole = False

    # 4b: real connect to a NON-allowlisted loopback address.  Hook fires at the
    #     socket.connect audit event, before the syscall; 127.0.0.2 is loopback so
    #     even a missed hook could only yield ConnectionRefused, never touch a net.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.0)
        s.connect(("127.0.0.2", 9))
        s.close()
        print("LIVE connect(('127.0.0.2', 9)) -> CONNECTED (hook did NOT abort) ***DEFECT***")
        live_conn_aborts = False
    except BaseException as exc:  # noqa: BLE001
        print("LIVE connect(('127.0.0.2', 9)) -> RAISED %s: %s" % (type(exc).__name__, exc))
        live_conn_aborts = (type(exc).__name__ == "ForbiddenWriteError")

    print()
    print("-" * 78)
    print("SECTION 5 -- POSITIVE CONTROL: an allowlisted loopback GET must SUCCEED")
    print("-" * 78)

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
            self.received.append((self.command, self.path))
            if self.path == "/api/v1/status/metrics":
                payload = {"account_status": "ACTIVE", "earnings_total_cents": 1025,
                           "balance_cents": 1025, "pending_cents": 0, "currency": "USD"}
                self._send(200, json.dumps(payload).encode())
            else:
                self._send(404, b"{}")

        def do_HEAD(self):
            self.received.append((self.command, self.path))
            self._send(200, b"")

        def log_message(self, *a):
            return

    Handler.received = []
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address[:2]
    base = "http://%s:%d" % (host, port)
    print("throwaway loopback server at %s" % base)
    try:
        r = rc.request("GET", base + "/api/v1/status/metrics")
        print("GET  %s -> status=%s body=%s" % ("/api/v1/status/metrics", r["status"], r["body"].decode()))
        payload = json.loads(r["body"].decode())
        print("     parsed earnings_total_cents=%r currency=%r" %
              (payload.get("earnings_total_cents"), payload.get("currency")))
        ok_get = (r["status"] == 200 and payload.get("earnings_total_cents") == 1025)
        h = rc.request("HEAD", base + "/api/v1/status")
        print("HEAD %s -> status=%s" % ("/api/v1/status", h["status"]))
        ok_head = (h["status"] == 200)
        print("SERVER RECORDED VERBS: %r" % (Handler.received,))
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)

    print()
    print("=" * 78)
    print("VERDICT SUMMARY")
    print("=" * 78)
    print("layer-A refusals left transport untouched : %s" % (spy.calls == []))
    print("allowlisted loopback GET succeeded        : %s" % ok_get)
    print("allowlisted loopback HEAD succeeded       : %s" % ok_head)
    print("audit hook aborts live non-loopback connect: %s" % live_conn_aborts)
    print("audit hook aborts getaddrinfo (live)       : %s" % (not live_gai_hole))
    print("  -> the getaddrinfo branch of _audit_hook is DEAD CODE: args[0] is a str,")
    print("     and the code only accepts a tuple; the docstring claim is unenforced.")


if __name__ == "__main__":
    main()
