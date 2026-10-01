#!/usr/bin/env python
"""make_testfixture_patch.py -- build the second half of the apply-ready pair.

The R4 identity allowlist FAILS CLOSED when nothing is configured.  The shipped
offline suite decides as 'Operator Jane' without configuring anything, so
applying proposed/approval-allowlist.patch alone turns three shipped tests red
(1 failure + 2 errors, all in test_r4_approval.HumanDecisionTests).  This script
produces the companion diff for the test fixture so the suite is green again,
and applies it to a scratch COPY only.

    work/repo-proposed/monitoring/freecash/tests/_support.py   (shipped)
      -> work/stage/_support.new.py                            (patched)
      -> proposed/tests-allowlist.patch

Nothing under monitoring/, scripts/ or data/ is touched.
"""

import difflib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "work", "repo-proposed", "monitoring", "freecash", "tests", "_support.py")
STAGE = os.path.join(HERE, "work", "stage")
os.makedirs(STAGE, exist_ok=True)

OLD_ENV = '''ENV_KEYS = (
    "FREECASH_DATA_ROOT",
    "FREECASH_TZ",
    "FREECASH_TOAST_STUB",
    "FREECASH_TOAST_RETRY_SLEEP_SECONDS",
    "FREECASH_READ_SOURCE",
    "FREECASH_READ_BASE_URL",
    "FREECASH_HTTP_TIMEOUT",
)'''

NEW_ENV = '''ENV_KEYS = (
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
)'''

OLD_ENTER = '''        for key, value in self.overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = str(value)
        return self'''

NEW_ENTER = '''        for key, value in self.overrides.items():
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
        return self'''

OLD_NAME = '''ROUTINE_DIR = HERE.parent
REPO_ROOT = ROUTINE_DIR.parent.parent'''

NEW_NAME = '''ROUTINE_DIR = HERE.parent
REPO_ROOT = ROUTINE_DIR.parent.parent
#: The single human identity this suite decides as (see TempDataRoot.__enter__).
OPERATOR_IDENTITY = "Operator Jane"'''

src = open(SRC, encoding="utf-8").read()
for old, new in ((OLD_ENV, NEW_ENV), (OLD_ENTER, NEW_ENTER), (OLD_NAME, NEW_NAME)):
    assert src.count(old) == 1, ("anchor not unique", old.splitlines()[0], src.count(old))
    src = src.replace(old, new)

new_path = os.path.join(STAGE, "_support.new.py")
with open(new_path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(src)

orig_lines = open(SRC, encoding="utf-8").read().splitlines(keepends=True)
new_lines = src.splitlines(keepends=True)
patch = "".join(difflib.unified_diff(
    orig_lines, new_lines,
    fromfile="a/monitoring/freecash/tests/_support.py",
    tofile="b/monitoring/freecash/tests/_support.py",
))
out = os.path.join(HERE, "proposed", "tests-allowlist.patch")
with open(out, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(patch)
print("wrote %s (%d lines)" % (out, patch.count("\n")))
print("staged %s" % new_path)
