"""make_root.py -- build a THROWAWAY data root for the routine, outside the repository.

Usage:
    python make_root.py <root> <day_key> <template|record> <routine_dir>

    template  -> the operator-state template only, records: []  (a DATA-LESS day)
    record    -> the template plus one operator-entered record for <day_key>
                 (a DATA-CARRYING day)

Writes only under <root>.  Never touches D:/AgenticOS/data/freecash-monitor.
"""

import json
import os
import sys
from pathlib import Path


def main() -> int:
    root = Path(sys.argv[1])
    day = sys.argv[2]
    mode = sys.argv[3]
    routine_dir = sys.argv[4]
    if mode not in ("template", "record"):
        print("usage: make_root.py <root> <day_key> <template|record> <routine_dir>")
        return 2
    if str(root).replace("\\", "/").lower().startswith("d:/agenticos/data/freecash-monitor"):
        print("REFUSED: that is the production root")
        return 2

    sys.path.insert(0, routine_dir)
    os.environ["FREECASH_DATA_ROOT"] = str(root)
    import operator_state  # noqa: E402

    operator_state.ensure_template()
    state_file = root / "state" / "operator-state.json"
    if mode == "record":
        document = json.loads(state_file.read_text(encoding="utf-8"))
        document["records"].append(
            {
                "day_key": day,
                "entered_at_utc": "%sT06:40:00Z" % day,
                "account_status": "ACTIVE",
                "earnings_total_cents": 1025,
                "balance_cents": 1025,
                "pending_cents": 0,
                "currency": "USD",
            }
        )
        state_file.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    document = json.loads(state_file.read_text(encoding="utf-8"))
    print("make_root: root=%s day=%s mode=%s records=%d" % (root, day, mode, len(document["records"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
