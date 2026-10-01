"""summarize_rows.py -- print one compact line per mutant row (verifier evidence)."""

import glob
import json
import os
import sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mutants")


def main():
    for row_path in sorted(glob.glob(os.path.join(BASE, "*", "row.json"))):
        row = json.load(open(row_path, encoding="utf-8"))
        print("=" * 78)
        print("%s | %s | gateA exit=%s | %s" % (row["id"], row["rule"], row.get("gateA_exit"), row.get("gateA_summary")))
        print("  gateB exit=%s | %s" % (row.get("gateB_exit"), row.get("gateB_summary")))
        print("  readonly-scan exit=%s | %s" % (row.get("readonly_scan_exit"), row.get("readonly_scan_line")))
        for kind, d in row["demos"].items():
            if kind == "r1_twice":
                print("  r1_twice: run1=%r run2=%r run2_read=%s snapshots=%s" % (
                    d.get("run1_first_line", "")[:44], d.get("run2_first_line", "")[:44],
                    d.get("run2_performed_a_read"), d.get("snapshots")))
            elif kind == "r1_concurrent":
                print("  r1_concurrent: workers=%s ok_runs=%s skip_runs=%s snapshots=%s" % (
                    d.get("workers"), d.get("ok_runs"), d.get("skip_runs"), d.get("snapshots")))
            elif kind == "r3_two_days":
                print("  r3_two_days: day1=%s day2=%s new_alerts=%s pending=%s" % (
                    d.get("day1_outcome"), d.get("day2_outcome"), d.get("day2_new_alert_types"), d.get("pending_items")))
            elif kind == "r2_forbidden":
                print("  r2_forbidden: outcomes=%s allowed_writes=%s transport_reached=%s" % (
                    [(a["attempt"].split()[0], a["outcome"]) for a in d.get("attempts", [])],
                    d.get("allowed_write_requests"), d.get("transport_reached")))
            elif kind == "r2_bypass":
                extra = {k: v for k, v in d.items() if k.startswith("_")}
                print("  r2_bypass: helpers=%s %s" % (d.get("helpers_found"), extra))
            elif kind == "r4_decide":
                api = d.get("api", {})
                accepted = sorted(k for k, v in api.items() if v == "ACCEPTED")
                refused = sorted(k for k, v in api.items() if v != "ACCEPTED")
                print("  r4_decide: accepted=%s" % accepted)
                print("            refused =%s" % refused)
                print("            cli=%s" % json.dumps(d.get("cli")))
                print("            frozen_after=%s" % d.get("frozen_fields"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
