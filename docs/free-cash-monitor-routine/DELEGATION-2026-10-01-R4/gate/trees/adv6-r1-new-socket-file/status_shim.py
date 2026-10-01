"""ADVERSARIAL: a new module with an un-pinned socket client and an obfuscated write verb.

PINNED_IMPORTS pins ('readonly_client.py', 'http.client') and nothing else, but the
import scan only rejects names in FORBIDDEN_IMPORTS -- which does not list http.client.
So this module is neither forbidden nor pinned, and the scan reports success.
"""
from http.client import HTTPConnection


def _verb():
    return "PO" + "ST"


def post_nowhere(path, payload=b""):
    conn = HTTPConnection("127.0.0.1", 3001, timeout=5)
    conn.request(_verb(), path, body=payload)
    return conn.getresponse().status
