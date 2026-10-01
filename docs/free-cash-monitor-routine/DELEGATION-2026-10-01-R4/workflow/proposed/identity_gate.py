"""identity_gate.py -- the R4 identity check as an ALLOWLIST.  PROPOSED, NOT APPLIED.

Operator numbering: R4 = APPROVAL BEFORE EXTERNAL ACTION.  The shipped guard
(approval_queue.py:55-57, checked at :153) is a DENYLIST of ten literal words, so
`hermes-agent`, `assistant`, `claude` and `the monitor` are all ACCEPTED today.

This gate is the proposed replacement rule: a decision names an identity that must appear
in the operator-editable allowlist `<data root>/state/human-deciders.json`.  An unlisted
name is refused whatever it says about itself.

NOT INSTALLED.  Nothing in monitoring/freecash/** imports this file.  It exists so the
rule can be executed and its refusals observed; the patch that wires it into
approval_queue.decide() is proposed/approval_queue.allowlist.patch (also unapplied).

Usage:
    python identity_gate.py --by "<name>" [--root <data root>]
Exit codes:
    0  ACCEPTED (the name is on the allowlist)
    4  REFUSED  (empty allowlist, denylisted word, or a name that is not on the allowlist)
    2  usage error
"""

import argparse
import os
import sys
from pathlib import Path

ALLOWLIST_FILENAME = "human-deciders.json"

#: Kept as defence in depth: even if an operator pastes one of these into the allowlist,
#: the gate still refuses it.
NON_HUMAN_DECIDERS = frozenset(
    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot",
     "script", "machine"}
)

ACCEPTED = 0
REFUSED = 4


def allowlist_path(state_dir) -> Path:
    return Path(state_dir) / ALLOWLIST_FILENAME


def load_deciders(state_dir):
    """Return (set_of_lowercased_names, path).  Missing or malformed -> empty set (deny all)."""
    path = allowlist_path(state_dir)
    try:
        import json

        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set(), path
    if not isinstance(document, dict) or not isinstance(document.get("deciders"), list):
        return set(), path
    return {str(name).strip().lower() for name in document["deciders"] if str(name).strip()}, path


def check(name, state_dir):
    who = (name or "").strip()
    allowed, path = load_deciders(state_dir)
    if not who:
        return REFUSED, "refused: no identity given (--by is required)"
    if not allowed:
        return REFUSED, ("refused: the human-deciders allowlist %s is empty or missing; an "
                         "empty allowlist refuses everyone" % path)
    if who.lower() in NON_HUMAN_DECIDERS:
        return REFUSED, "refused: %r is a machine identity" % who
    if who.lower() not in allowed:
        return REFUSED, ("refused: %r is not on the human-deciders allowlist %s (the shipped "
                         "denylist would have accepted it)" % (who, path))
    return ACCEPTED, "accepted: %r is on the human-deciders allowlist %s" % (who, path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="identity_gate.py",
                                     description="R4 APPROVAL BEFORE EXTERNAL ACTION: allowlist identity gate (proposed)")
    parser.add_argument("--by", required=True, help="the identity that wants to sign the decision")
    parser.add_argument("--root", default=None, help="data root (default: FREECASH_DATA_ROOT)")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    root = args.root or os.environ.get("FREECASH_DATA_ROOT")
    if not root:
        print("identity_gate: usage error: no data root (--root or FREECASH_DATA_ROOT)")
        return 2
    state_dir = Path(root) / "state"
    code, message = check(args.by, state_dir)
    print("identity_gate: root=%s" % root)
    print("identity_gate: %s" % message)
    print("identity_gate: VERDICT=%s" % ("ACCEPTED" if code == ACCEPTED else "REFUSED"))
    return code


if __name__ == "__main__":
    sys.exit(main())
