"""make_allowlist_variant.py -- generate the PROPOSED allowlist variant of approval_queue.py.

It reads the shipped file from the routine COPY in this stream directory, asserts that both
anchor blocks are present, rewrites the identity guard as an allowlist, writes
proposed/approval_queue_allowlist.py and emits a unified diff into
proposed/approval_queue.allowlist.patch.

monitoring/freecash/** is never written to.  If either anchor is missing the script refuses
and writes nothing -- a silent no-op would make the whole identity proof meaningless.

Usage: python make_allowlist_variant.py <routine_copy_dir> <proposed_dir>
"""

import difflib
import hashlib
import sys
from pathlib import Path

OLD_GUARD = '''#: A machine may not sign a decision.
NON_HUMAN_DECIDERS = frozenset(
    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}
)
'''

NEW_GUARD = '''#: PROPOSED (workflow stream S1) -- the guard is an ALLOWLIST read from
#: <data root>/state/human-deciders.json, not a denylist of ten literal words.  The ten
#: words are kept only as defence in depth: an operator who pasted one of them into the
#: allowlist still could not sign with it.
NON_HUMAN_DECIDERS = frozenset(
    {"system", "routine", "automation", "agent", "cron", "scheduler", "monitor", "bot", "script", "machine"}
)

HUMAN_DECIDERS_FILENAME = "human-deciders.json"


def load_human_deciders():
    """Return (lowercased names, path).  Missing/malformed/empty file -> empty set."""
    path = paths.state_dir() / HUMAN_DECIDERS_FILENAME
    document = paths.read_json(path, default=None)
    names = []
    if isinstance(document, dict) and isinstance(document.get("deciders"), list):
        names = [str(name).strip() for name in document["deciders"] if str(name).strip()]
    return {name.lower() for name in names}, path
'''

OLD_BODY = '''    if who.lower() in NON_HUMAN_DECIDERS:
        raise NotHumanError(
            "refused: %r is not a human identity; this routine may only record a "
            "decision made by a person" % who
        )
    return who
'''

NEW_BODY = '''    allowed, path = load_human_deciders()
    if not allowed:
        raise NotHumanError(
            "refused: no human deciders are configured; add your own name to %s "
            "(an empty allowlist refuses everyone)" % path
        )
    if who.lower() in NON_HUMAN_DECIDERS:
        raise NotHumanError(
            "refused: %r is a machine identity; this routine may only record a "
            "decision made by a person" % who
        )
    if who.lower() not in allowed:
        raise NotHumanError(
            "refused: %r is not on the human-deciders allowlist %s; an unlisted identity "
            "may not sign (the shipped denylist would have accepted it)" % (who, path)
        )
    return who
'''


def main() -> int:
    routine_copy = Path(sys.argv[1])
    proposed = Path(sys.argv[2])
    source = (routine_copy / "approval_queue.py").read_text(encoding="utf-8")
    if OLD_GUARD not in source:
        print("REFUSED: anchor 1 (NON_HUMAN_DECIDERS block) not found in %s" % (routine_copy / "approval_queue.py"))
        return 2
    if OLD_BODY not in source:
        print("REFUSED: anchor 2 (_normalise_decider body) not found in %s" % (routine_copy / "approval_queue.py"))
        return 2

    variant = source.replace(OLD_GUARD, NEW_GUARD, 1).replace(OLD_BODY, NEW_BODY, 1)
    assert variant != source
    proposed.mkdir(parents=True, exist_ok=True)
    variant_path = proposed / "approval_queue_allowlist.py"
    variant_path.write_text(variant, encoding="utf-8")

    diff = "".join(
        difflib.unified_diff(
            source.splitlines(keepends=True),
            variant.splitlines(keepends=True),
            fromfile="a/monitoring/freecash/approval_queue.py (shipped)",
            tofile="b/proposed/approval_queue_allowlist.py (proposed, unapplied)",
        )
    )
    patch_path = proposed / "approval_queue.allowlist.patch"
    patch_path.write_text(diff, encoding="utf-8")

    print("anchor 1 replaced: %s" % (NEW_GUARD.splitlines()[0] in variant))
    print("anchor 2 replaced: %s" % (NEW_BODY.splitlines()[0] in variant))
    print("old body still present (must be False): %s" % (OLD_BODY in variant))
    print("shipped  sha256: %s  (%d bytes)" % (hashlib.sha256(source.encode()).hexdigest(), len(source)))
    print("variant  sha256: %s  (%d bytes)" % (hashlib.sha256(variant.encode()).hexdigest(), len(variant)))
    print("wrote: %s" % variant_path)
    print("wrote: %s  (%d diff lines)" % (patch_path, len(diff.splitlines())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
