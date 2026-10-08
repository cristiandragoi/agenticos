# AgenticOS Shared Engineering Lessons (Hindsight MEMORY.md)

This file contains durable, validated engineering lessons distilled from real-world failures, repairs, and regression evidence.

Rules:
1. Every lesson must trace to confirmed evidence and tests.
2. Speculative diagnoses must NEVER be recorded as settled facts.
3. Deduplicate in-place; do not append redundant duplicate entries.
4. Keep Ornith/Hermes (user/business memory), Cortex (code knowledge), and Hindsight (lessons) separate.

---

### [2026-10-08] compose on Gmail: Spoken recipient address lost during multi-turn continuation; context dropped (VERIFIED)
- **Subsystem**: `task_continuation`
- **Confirmed Root Cause**: Task continuation broken: Capability failure or task continuation broken
- **Code References**:
  - `server/src/services/email/EmailService.ts`
  - `server/src/domains/turnLifecycle/controller.ts`
- **Repair & Regression Evidence**: Argus verdict: approve. Test report: PASS
- **Recurrence Prevention**: Preserve task state in session memory and enforce canonical transition guard