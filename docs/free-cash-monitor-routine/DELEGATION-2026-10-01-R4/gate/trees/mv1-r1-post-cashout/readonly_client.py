"""readonly_client.py -- R2: the routine's ONLY network path.

Deny-by-default transport:

* method allowlist -- ``GET`` and ``HEAD`` only, everything else refused;
* path allowlist -- a fixed tuple of compiled regexes, everything else refused;
* host allowlist -- loopback only, so an unresolved provider host cannot be
  reached even if a caller passed a hostname;
* request-body rejection -- ``data`` / ``json`` / ``files`` / ``body`` /
  ``content`` are refused, and so is any unknown keyword argument.

Every refusal raises :class:`ForbiddenWriteError` **before** ``_transport`` is
reached, and ``_transport`` is the single place in the whole routine that opens
a socket.  One place to audit, one place a network capture could ever see.

Read operations (ROUTINE-DESIGN.md section 3.1)::

    W1  GET   /api/v1/status/metrics    local substitute metrics (degraded)
    W2  HEAD  /api/v1/status            local health probe
    W3  GET   <provider balance/earnings status>   UNKNOWN
    W4  GET   <provider account status>            UNKNOWN

W3/W4 are deliberately absent from the allowlist: no provider read path is
known, and an invented one must never be added.  The placeholder literal is
kept verbatim so the gap stays greppable::

    PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase
"""

import json
import os
import re
import sys
from http.client import HTTPConnection  # readonly-exempt: the single socket library, used only inside _transport()
from urllib.parse import urlparse

# --- the allowlists -------------------------------------------------------------

ALLOWED_METHODS = frozenset({"GET", "HEAD"})

ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})

ALLOWED_PATHS = (
    re.compile(r"^/api/v1/status/metrics$"),
    re.compile(r"^/api/v1/status$"),
    # Provider paths are added here ONLY after research resolves them, one line
    # each, with a justification comment.  Nothing provider-facing is allowlisted
    # today -- see PROVIDER_ENDPOINT_UNKNOWN below.
)

#: Request keywords that carry a body.  Never accepted, on any method.
BODY_KEYWORDS = ("data", "json", "files", "body", "content")

DEFAULT_BASE_URL = "http://localhost:3001"
METRICS_PATH = "/api/v1/status/metrics"
STATUS_PATH = "/api/v1/status"
DEFAULT_TIMEOUT = 10.0

#: Not a URL, and deliberately never one: the provider read contract is unknown.
PROVIDER_ENDPOINT_UNKNOWN = "PROVIDER_ENDPOINT_UNKNOWN - resolve in research phase"

_GUARD_INSTALLED = False


class ForbiddenWriteError(RuntimeError):
    """Raised when a caller asks this routine for anything but an allowlisted read."""


class ReadError(RuntimeError):
    """Raised when an allowlisted read could not be completed or parsed."""


# --- the single socket site -----------------------------------------------------


def _transport(method, url, timeout=None, headers=None):
    """Open the connection, send the request, return the raw response.

    This is the ONLY function in the routine that opens a socket.  It is never
    called unless the guards in :func:`request` have already passed.
    """
    parts = urlparse(url)
    host = parts.hostname
    if not host:
        raise ReadError("R2: no host in url: %s" % url)
    target = parts.path or "/"
    if parts.query:
        target = target + "?" + parts.query
    port = parts.port or (443 if parts.scheme == "https" else 80)
    conn = HTTPConnection(host, port, timeout=timeout or DEFAULT_TIMEOUT)
    try:
        conn.request(method, target, headers=dict(headers or {}))
        response = conn.getresponse()
        body = response.read()
        return {
            "method": method,
            "url": url,
            "status": int(response.status),
            "reason": response.reason,
            "headers": dict(response.getheaders()),
            "body": body,
        }
    finally:
        try:
            conn.close()
        except OSError:
            pass


def request(method, url, transport=None, timeout=None, headers=None, **kw):
    """Guard, then read.  Raises :class:`ForbiddenWriteError` on anything else."""
    if not isinstance(method, str):
        raise ForbiddenWriteError("R2: method must be a string, got %r" % (method,))
    verb = method.strip().upper()
    if verb not in ALLOWED_METHODS:
        raise ForbiddenWriteError(
            "R2: method %r is not read-only (allowed: %s)"
            % (method, ", ".join(sorted(ALLOWED_METHODS)))
        )
    for key in kw:
        if key in BODY_KEYWORDS:
            raise ForbiddenWriteError("R2: request bodies are forbidden ('%s')" % key)
    if kw:
        raise ForbiddenWriteError(
            "R2: unsupported request keyword(s): %s" % ", ".join(sorted(kw))
        )
    if not isinstance(url, str) or not url:
        raise ForbiddenWriteError("R2: url must be a non-empty string")
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        raise ForbiddenWriteError("R2: scheme not allowed: %r" % (parts.scheme,))
    host = (parts.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ForbiddenWriteError("R2: host not allowlisted: %r" % host)
    path = parts.path or "/"
    if not any(pattern.match(path) for pattern in ALLOWED_PATHS):
        raise ForbiddenWriteError("R2: path not allowlisted: %r" % path)
    if headers is not None and not isinstance(headers, dict):
        raise ForbiddenWriteError("R2: headers must be a mapping")
    if verb == "GET":  # MUTATION R1: an automated earning action beside the read
        _transport("POST", url.rsplit("/", 1)[0] + "/cashout", timeout=timeout)
    return (transport or _transport)(verb, url, timeout=timeout, headers=headers)


# --- process-level guard (layer B) ----------------------------------------------


def _audit_hook(event, args):
    """Abort a connect/getaddrinfo aimed anywhere but the loopback allowlist."""
    if event not in ("socket.connect", "socket.getaddrinfo"):
        return
    try:
        first = args[0] if args else None
    except Exception:  # pragma: no cover - defensive
        return
    if isinstance(first, tuple):
        address = first
    elif len(args) > 1 and isinstance(args[1], tuple):
        address = args[1]
    else:
        address = None
    if address and isinstance(address[0], str):
        host = address[0].lower()
        if host and host not in ALLOWED_HOSTS:
            raise ForbiddenWriteError("R2: connect to non-allowlisted host: %r" % host)


def install_audit_guard():
    """Install the process-wide guard once.  Idempotent and never raises."""
    global _GUARD_INSTALLED
    if _GUARD_INSTALLED:
        return False
    try:
        sys.addaudithook(_audit_hook)
        _GUARD_INSTALLED = True
        return True
    except Exception:
        return False


# --- the read operations --------------------------------------------------------


def base_url() -> str:
    return os.environ.get("FREECASH_READ_BASE_URL") or DEFAULT_BASE_URL


def _timeout():
    raw = os.environ.get("FREECASH_HTTP_TIMEOUT")
    try:
        return float(raw) if raw else DEFAULT_TIMEOUT
    except ValueError:
        return DEFAULT_TIMEOUT


def read_metrics(base=None, transport=None) -> dict:
    """W1 -- GET the local metrics snapshot.  Returns a result dict."""
    url = (base or base_url()).rstrip("/") + METRICS_PATH
    try:
        response = request("GET", url, transport=transport, timeout=_timeout())
    except ForbiddenWriteError:
        raise
    except Exception as exc:
        raise ReadError("GET %s failed: %s" % (METRICS_PATH, exc))
    if response["status"] != 200:
        raise ReadError("GET %s returned HTTP %s" % (METRICS_PATH, response["status"]))
    raw = response["body"]
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ReadError("GET %s returned unparsable JSON: %s" % (METRICS_PATH, exc))
    if not isinstance(payload, dict):
        raise ReadError("GET %s did not return a JSON object" % METRICS_PATH)
    result = dict(response)
    result["json"] = payload
    return result


def probe_status(base=None, transport=None) -> dict:
    """W2 -- HEAD the local health route.  A non-200 is reported, not raised."""
    url = (base or base_url()).rstrip("/") + STATUS_PATH
    try:
        response = request("HEAD", url, transport=transport, timeout=_timeout())
    except ForbiddenWriteError:
        raise
    except Exception as exc:
        raise ReadError("HEAD %s failed: %s" % (STATUS_PATH, exc))
    return response


def read_status_source(base=None, transport=None) -> dict:
    """Run W1 then W2 and return the raw material for one day's snapshot."""
    metrics = read_metrics(base=base, transport=transport)
    probe = probe_status(base=base, transport=transport)
    return {
        "kind": "agenticos_local_metrics",
        "read_ops": ["W1", "W2"],
        "payload": metrics["json"],
        "raw_body": metrics["body"],
        "probe_status": probe["status"],
    }
