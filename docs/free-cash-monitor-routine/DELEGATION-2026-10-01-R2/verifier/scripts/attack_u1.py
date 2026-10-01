#!/usr/bin/env python
"""U1 ATTACK -- "Don't perform earning actions automatically."

Claim under attack: the routine's only network path refuses every write verb and
every non-allowlisted path, and the refusal happens BEFORE any socket is opened.

Method (all in one process, offline):
  * instrument http.client.HTTPConnection (the class the single socket site
    instantiates) with a tripwire that RECORDS and refuses;
  * install a sys.addaudithook that records every socket.connect /
    socket.getaddrinfo / subprocess.Popen / os.system / os.exec event;
  * fire 14 violating calls at readonly_client.request() and check each one is
    refused with ForbiddenWriteError;
  * prove the tripwire is armed by firing one LEGITIMATE allowlisted read
    (positive control) and showing it does reach the socket site.

Then attacks the layer boundary directly: _transport() is a public, unguarded
socket site -- see the HOLE at the end.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import check, header, line, sandbox, set_env, use_package  # noqa: E402

root = sandbox("u1") / "data"
root.mkdir(parents=True, exist_ok=True)
set_env(root)
use_package()

import readonly_client as rc  # noqa: E402

EQUALS_BEFORE = "=" * 96
header("U1 / R2 ATTACK -- read-only interceptor: write verbs, non-allowlisted paths,"
       " and does the refusal precede the socket?")
line("package under attack : D:/AgenticOS/monitoring/freecash (imported read-only, never edited)")
line("sandbox data root    : %s" % root)

# ---------------------------------------------------------------- instrumentation
socket_events = []
exec_events = []


def audit_hook(event, args):
    if event in ("socket.connect", "socket.getaddrinfo", "socket.gethostbyname"):
        socket_events.append((event, repr(args)[:160]))
    elif event in ("subprocess.Popen", "os.system", "os.exec", "os.spawn", "os.posix_spawn"):
        exec_events.append((event, repr(args)[:160]))


sys.addaudithook(audit_hook)

opened = []


class TripwireConnection:
    """Stands in for the real socket.  If this is constructed, a socket WAS about
    to open.  It records the attempt and refuses, so the attack stays offline."""

    def __init__(self, *a, **k):
        opened.append((a, k))
        raise AssertionError("SOCKET SITE REACHED: host=%r port=%r" % (a[0] if a else None, a[1] if len(a) > 1 else None))

    def request(self, *a, **k):
        raise AssertionError("unreachable")

    def close(self):
        pass


rc.HTTPConnection = TripwireConnection

line("")
line("--- instrumentation: %s" % ("armed" if rc.HTTPConnection is TripwireConnection else "NOT ARMED"))
line("    socket site             : readonly_client._transport -> HTTPConnection (only socket site in the package)")
line("    audit hook events armed : socket.connect, socket.getaddrinfo, socket.gethostbyname,")
line("                              subprocess.Popen, os.system, os.exec, os.spawn, os.posix_spawn")
line("")

LOOP = "http://127.0.0.1:9"

ATTACKS = [
    ("write verb POST", "rc.request('POST', <loopback allowlisted path>)",
     lambda: rc.request("POST", LOOP + "/api/v1/status/metrics")),
    ("write verb PUT", "rc.request('PUT', <loopback allowlisted path>)",
     lambda: rc.request("PUT", LOOP + "/api/v1/status/metrics")),
    ("write verb PATCH", "rc.request('PATCH', <loopback allowlisted path>)",
     lambda: rc.request("PATCH", LOOP + "/api/v1/status/metrics")),
    ("write verb DELETE", "rc.request('DELETE', <loopback allowlisted path>)",
     lambda: rc.request("DELETE", LOOP + "/api/v1/status/metrics")),
    ("write verb CONNECT", "rc.request('CONNECT', <loopback allowlisted path>)",
     lambda: rc.request("CONNECT", LOOP + "/api/v1/status/metrics")),
    ("earning path with a legal GET", "rc.request('GET', <loopback>/api/v1/cashout)",
     lambda: rc.request("GET", LOOP + "/api/v1/cashout")),
    ("non-allowlisted path", "rc.request('GET', <loopback>/api/v1/admin/metrics)",
     lambda: rc.request("GET", LOOP + "/api/v1/admin/metrics")),
    ("non-allowlisted path (traversal)", "rc.request('GET', <loopback>/api/v1/status/metrics/../../admin)",
     lambda: rc.request("GET", LOOP + "/api/v1/status/metrics/../../admin")),
    ("non-loopback host", "rc.request('GET', http://example.com/api/v1/status/metrics)",
     lambda: rc.request("GET", "http://example.com/api/v1/status/metrics")),
    ("non-http scheme", "rc.request('GET', ftp://127.0.0.1/api/v1/status)",
     lambda: rc.request("GET", "ftp://127.0.0.1/api/v1/status")),
    ("request body via json=", "rc.request('GET', <allowlisted>, json={'amount':1})",
     lambda: rc.request("GET", LOOP + "/api/v1/status/metrics", json={"amount": 1})),
    ("request body via data=", "rc.request('GET', <allowlisted>, data=b'x')",
     lambda: rc.request("GET", LOOP + "/api/v1/status/metrics", data=b"x")),
    ("unsupported kwarg", "rc.request('GET', <allowlisted>, verify=False)",
     lambda: rc.request("GET", LOOP + "/api/v1/status/metrics", verify=False)),
    ("non-string method", "rc.request(123, <allowlisted>)",
     lambda: rc.request(123, LOOP + "/api/v1/status/metrics")),
]

line("%-34s %-9s %-20s %s" % ("attack", "refused?", "exception", "socket-site reached?"))
line("-" * 96)
rows = []
all_refused = True
for label, cmd, fn in ATTACKS:
    before = len(opened)
    caught = None
    returned = None
    try:
        fn()
    except rc.ForbiddenWriteError as exc:
        caught = "ForbiddenWriteError"
    except Exception as exc:  # noqa: BLE001
        caught = type(exc).__name__
        returned = str(exc)[:60]
    except BaseException as exc:  # noqa: BLE001
        caught = type(exc).__name__
    reached = len(opened) - before
    refused = caught == "ForbiddenWriteError"
    all_refused = all_refused and refused
    rows.append((label, cmd, refused, caught, reached))
    line("%-34s %-9s %-20s %s" % (label, "YES" if refused else "NO", caught or "<returned>", reached))

line("-" * 96)
check("all 14 violating calls refused with ForbiddenWriteError", all_refused)
check("ZERO socket sites reached during the 14 refusals", not opened,
      "tripwire instantiations: %d" % len(opened))
check("ZERO real socket audit events during the 14 refusals", not socket_events,
      "socket.connect/getaddrinfo events: %s" % (socket_events or "none"))
check("ZERO process/exec audit events during the 14 refusals", not exec_events,
      "exec events: %s" % (exec_events or "none"))

# ---------------------------------------------------------------- positive control
line("")
line("--- POSITIVE CONTROL: the tripwire must be reachable, or the zero above is vacuous")
before = len(opened)
control_ok = False
control_err = None
try:
    rc.request("GET", LOOP + "/api/v1/status/metrics")
except AssertionError as exc:
    control_ok = True
    control_err = str(exc)
except Exception as exc:  # noqa: BLE001
    control_err = "%s: %s" % (type(exc).__name__, exc)
reached = len(opened) - before
line("    allowlisted GET at the same call site -> socket site reached %d time(s); tripwire said: %s"
     % (reached, control_err))
check("an allowlisted read DOES reach the single socket site (tripwire is armed)", control_ok and reached == 1,
      "opened=%d" % reached)

# ---------------------------------------------------------------- allowlist content
line("")
line("--- the allowlists themselves")
line("    ALLOWED_METHODS = %s" % sorted(rc.ALLOWED_METHODS))
line("    ALLOWED_HOSTS   = %s" % sorted(rc.ALLOWED_HOSTS))
line("    ALLOWED_PATHS   = %s" % [p.pattern for p in rc.ALLOWED_PATHS])
check("method allowlist is exactly {GET, HEAD}", set(rc.ALLOWED_METHODS) == {"GET", "HEAD"})
check("host allowlist is loopback-only", set(h.lower() for h in rc.ALLOWED_HOSTS) <= {"localhost", "127.0.0.1", "::1", "[::1]"})
check("no provider path is allowlisted (PROVIDER_ENDPOINT_UNKNOWN stays unresolved)",
      all("provider" not in p.pattern for p in rc.ALLOWED_PATHS))

# ---------------------------------------------------------------- HOLE: _transport
line("")
line("--- HOLE PROBE: the guard lives in request(); _transport() is an unguarded socket site")
before = len(opened)
hole_reached = False
hole_err = None
try:
    rc._transport("POST", LOOP + "/x")
except AssertionError as exc:
    hole_reached = True
    hole_err = str(exc)
except Exception as exc:  # noqa: BLE001
    hole_err = "%s: %s" % (type(exc).__name__, exc)
line("    rc._transport('POST', 'http://127.0.0.1:9/x') -> socket site reached: %s ; said: %s"
     % (hole_reached, hole_err))
check("HOLE H6 confirmed: _transport() is directly callable and bypasses every guard",
      hole_reached, "no shipped caller does this today, but nothing in the module prevents it")

line("")
line("U1 attack finished.  Verdict inputs: all_refused=%s socket_sites=%d exec_events=%d hole_H6=%s"
     % (all_refused, len(opened) - 1, len(exec_events), hole_reached))
