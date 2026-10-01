# AgenticOS Jarvis Live Perception Repair Report

## Status Summary
- **Goal**: Restore live voice visual grounding path for 'Jarvis, can you see me? What am I holding right now?'
- **Current Issue**: Camera activation succeeds, but `camera.perceive` returns canned text ('Yes, I can see you through the physical webcam') or fails to bind vision frames. Follow-up corrections trigger 'Command failed with exit code 1' and misrouted actions ('Indeed').
- **Root Cause**: Missing integration of fresh camera-frame metadata (device, timestamp, dimensions, SHA-256) into `camera.perceive` response; `ActionClaimGuard` lacks enforced verification before emitting 'I can see you'; same-GoalRun recovery path not wired to invoke Hermes/Codex for retrying original goal and Argus re-verification.

## Observed Failures
1. Generic webcam text without verified physical frame evidence.
2. Follow-up corrections fail with exit code 1, leading to unrelated actions.
3. Argus verification claims present but no passing record exists in `argus_verifications`.
4. Camera activation alone is insufficient; perception grounding requires fresh vision results.

## Identified Turn/Goal Context
- Extracted recent TURN_IDs from logs: turn-1790357582046, turn-1790372686625, turn-1790372737799, etc.
- GoalRun IDs present in logs (e.g., goal-waiting) but no explicit failed visual-goal ID; trace recovery requires linking user corrections to original GOAL_RUN identifier via session/room metadata.

## Proposed Fixes
1. **Enhance `camera.perceive` Response Schema**:
   - Ensure response includes `device: string`, `timestamp: number`, `dimensions: { width, height }`, `sha256: string`, `visionResult: object` (grounded description).
   - Reject canned text; require evidence-backed result.

2. **Strengthen `ActionClaimGuard`**:
   - Block 'I can see you' unless `camera.perceive` has returned a verified fresh frame with valid SHA-256.
   - Log Guard decision and trigger Argus verification if claim is made without evidence.

3. **Wire Recovery Path for Same GoalRun**:
   - On user correction ('that result is wrong'), transition to `RECOVERING` state, invoke Hermes/Codex agent for retry, and ensure Argus re-verifies original goal.
   - Avoid creating new task/goal; persist in current GOAL_RUN until successful perception grounding.

4. **Inject Fresh Frame on Activation**:
   - On camera activation, immediately capture frame metadata and pass to perception module.
   - Subsequent queries reuse latest frame or acquire new one as needed.

5. **Test Coverage**:
   - Create test case: `camera.perceive` returns canned text -> fail; verify Guard blocks claim without frame.
   - Simulate user correction -> assert recovery path retries original goal and Argus verifies.

## Next Steps
- Implement `camera.perceive` response update (add metadata fields).
- Update `ActionClaimGuard` to enforce verification check.
- Modify recovery logic to persist GOAL_RUN on correction and invoke Hermes/Codex.
- Add tests and run `npm test` to validate changes.
- Validate in live session: ask 'What am I holding?' after camera activation and verify grounded response.

## Evidence Collection
- Logs scanned for TURN_ID, GOAL_RUN identifier, Argus verification records (currently empty).
- Camera frame metadata structure defined; missing fields identified as cause of canned responses.
- Guard decision logic traced; enforcement patch ready.
