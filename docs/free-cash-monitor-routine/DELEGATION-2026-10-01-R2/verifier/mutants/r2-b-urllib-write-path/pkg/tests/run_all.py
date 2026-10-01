"""Run the whole offline suite without needing a test runner.

    py -3 D:/AgenticOS/monitoring/freecash/tests/run_all.py

Equivalent, if you prefer the standard discovery form::

    py -3 -m unittest discover -s monitoring/freecash/tests -v

Everything here is offline: a throwaway loopback server is the only "network",
and the toast channel is a recording stub.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROUTINE_DIR = os.path.dirname(HERE)

for entry in (ROUTINE_DIR, HERE):
    if entry not in sys.path:
        sys.path.insert(0, entry)


def main() -> int:
    suite = unittest.TestLoader().discover(HERE, pattern="test_*.py", top_level_dir=HERE)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(
        "run_all: tests=%d failures=%d errors=%d skipped=%d"
        % (result.testsRun, len(result.failures), len(result.errors), len(result.skipped))
    )
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
