---
trigger: always_on
glob:
description: Antigravity completion and verification standards for AgenticOS — enforce empirical evidence before declaring PASS.
---

# AgenticOS Verification and Completion Standard

Before declaring any repair, fix, or task as PASS in AgenticOS:

1. **Check All Acceptance Criteria**: Explicitly list and evaluate each requirement individually.
2. **Identify Concrete Evidence**: Attach verifiable runtime or test evidence to each claim (process IDs, HTTP response bodies, log snippets, or test results). Never declare PASS based solely on source inspection.
3. **Distinguish Verification Modalities**:
   - Explicitly label automated/synthetic verification (unit tests, mock payloads, compile/bundle checks).
   - Explicitly label physical/user verification (actual speaker output, physical microphone capture, live desktop window observation).
   - NEVER report synthetic test passes as physical/user verification.
4. **List Remaining Unverified Items**: Explicitly enumerate anything that was not verified or could not be exercised autonomously.
5. **No Partial PASS**: Do NOT convert PARTIAL status into PASS simply because the build compiled or substantial progress was achieved.
