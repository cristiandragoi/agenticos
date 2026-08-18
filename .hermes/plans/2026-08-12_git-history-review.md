# AgenticOS Git History Review — Plan

> **For Hermes:** This is an analysis/review plan (read-only), not an implementation plan. Execute it with read-only git commands and produce a findings report. No code changes, no commits.

**Goal:** Systematically review the AgenticOS project's git history — commits, branches, and repository structure — to produce a structured, evidence-backed report of what the history contains, how the project evolved, and any integrity/anomaly concerns.

**Architecture:** The review is phased: (1) snapshot the repo topology (branches, refs, history stats), (2) read the commit stream by theme/time, (3) deep-dive the branches and key milestones with diffs, (4) verify integrity (unrelated histories, dangling commits, reflog), (5) write the final report to the workspace.

**Tech Stack:** git CLI (bash/MSYS on Windows), no external tools.

**Repository context (verified 2026-08-12):**
- Workspace: `B:\AgenticOS` (git-bash path `/b/AgenticOS`)
- Current branch: `stabilize-runtime` @ `d975ba3` (2026-08-12 16:50:38 +0200)
- 74 commits on HEAD; oldest `2e5c0a7` "Initial AgenticOS working baseline" (2026-07-18) → ~1 month of history
- Branches: local `agenticos-phase1-working-checkpoint`, `experimental-jarvis-voice`, `feature/agents-overview`, `jarvis-working-checkpoint`, `main`, `master`, `recovery/jarvis-ui-clean`, `stabilize-runtime` (current); remote `origin/main`, `origin/final-jarvis-humanoid-asset-c0f53`
- One tag: `agent-teams-runtime-v1`
- `git merge-base main HEAD` returns empty → local `main` and HEAD history are UNRELATED (known: `main` tracks origin's asset-only minimal repo; the real work lives on the working branches). Do NOT checkout/reset to `main`.
- Working tree dirty (runtime data + `dist-electron` — expected; do not touch)

---

## Phase 0 — Safety constraints

- Read-only commands only: `git log`, `git show`, `git diff`, `git branch`, `git tag`, `git reflog`, `git fsck`, `git rev-list`. No `checkout`, `reset`, `merge`, `rebase`, `clean`, `stash`, `commit`.
- Never blind-checkout `main`/`master` (unrelated/asset-only history — removes app workspace context).
- Do not stage, modify, or restore any working-tree files (runtime data `.agentic/*`, `dist-electron/*` are intentionally dirty).
- Run all commands from `/b/AgenticOS`.

---

## Phase 1 — Repo topology snapshot

**Objective:** Establish ground truth of refs, counts, and date ranges before reading any commits.

**Steps (exact commands, expected outputs):**

1. Current state
   - `git status -sb` → expect `## stabilize-runtime` with dirty runtime/dist files (already known)
   - `git branch -vv` → local branches with upstream tracking info
   - `git tag -n` → tag `agent-teams-runtime-v1` with annotation, if any
2. History stats on HEAD
   - `git rev-list --count HEAD` → 74
   - `git log --reverse --format='%h %ci %s'` → first commit `2e5c0a7` (2026-07-18)
   - `git log -1 --format='%h %ci %s'` → HEAD `d975ba3` (2026-08-12)
3. Graph topology
   - `git log --graph --oneline --all --decorate` → capture the full graph; note where branches diverge/merge, and the unrelated `main` lineage
   - `git merge-base --is-ancestor main HEAD; echo $?` → non-zero confirms unrelated histories (expected)
4. Author/theme distribution
   - `git shortlog -sn --all` → author commit counts
   - `git log --format='%s' | sed -E 's/^([a-z]+)(\([^)]*\))?:.*/\1/' | sort | uniq -c | sort -rn` → conventional-commit type distribution (feat/fix/refactor/...)
   - `git log --format='%s' | grep -cE '\(jarvis\)'` → jarvis-themed commit count (expected: high — recent work is jarvis-heavy)

**Verify:** numbers match the baseline above (74 commits, dates 07-18 → 08-12, 8 local branches). Flag any discrepancy.

---

## Phase 2 — Commit stream reading

**Objective:** Read the full commit history on HEAD and summarize what each commit did, grouped into logical workstreams.

**Steps:**

1. Full listing with stats
   - `git log --oneline --stat HEAD` → capture (74 commits; paginate output as needed)
   - Read each commit message; note the 5 recent jarvis/projects fixes seen at HEAD (HTTP 402 durability, active-project self-healing, ghost-id fix, effective-path chips, responsive grid) — confirm their context in surrounding commits.
2. Workstream grouping — cluster commits into themes, e.g.:
   - Initial baseline / bootstrap (`2e5c0a7`)
   - Agent teams runtime (`agent-teams-runtime-v1` tag region; `c8289ff`)
   - Codex integration / approval policy (`f8ef65b` and neighbors)
   - Jarvis humanoid / voice / UI (recent dense cluster)
   - Projects / knowledge / revenue engine (per agenticos-codebase inventory)
   - Infra: API client hardening, startup race / probe prep, build/release
3. Per-cluster deep read
   - `git show <sha> --stat` then `git show <sha>` for the 5–10 most significant commits (baseline, tag, first jarvis commit, first projects commit, any merge commits)
   - Record: files touched, purpose, follow-ups visible in later commits
4. Check for anomalies in messages
   - Squash/merge commits vs linear history: `git log --merges --oneline` → note any merge commits and what they joined
   - `git log --format='%h %s' | grep -iE 'wip|tmp|temp|revert|fixup'` → mark WIP/revert commits for separate review

**Deliverable artifact (working notes):** `review-notes/commits-by-theme.md` (workspace-local scratch; not committed).

---

## Phase 3 — Branch and milestone deep-dives

**Objective:** For each local branch, determine purpose, divergence point, and delta vs `stabilize-runtime`.

**Steps:**

1. Branch list with last commit
   - `git branch -v` → last commit per branch
   - For each of the 7 non-current local branches run:
     - `git log -1 --format='%h %ci %s' <branch>`
     - `git rev-list --count <branch>` (and `--count <branch> ^HEAD` for delta size)
     - `git log --oneline HEAD..<branch>` → commits on branch not in HEAD
     - `git log --oneline <branch>..HEAD` → commits on HEAD not in branch
2. Milestone diffs (pick 3–5 based on Phase 2 clustering):
   - Baseline → tag: `git diff 2e5c0a7 agent-teams-runtime-v1 --stat`
   - Tag → current: `git diff agent-teams-runtime-v1 HEAD --stat`
   - For each branch delta: `git diff HEAD <branch> --stat` (expect large for `main` — unrelated; small/empty for checkpoints)
   - `git show agent-teams-runtime-v1 --stat` and `git show -s --format='%H %ci %s %an' agent-teams-runtime-v1`
3. Branch purpose hypothesis
   - `agenticos-phase1-working-checkpoint` / `jarvis-working-checkpoint`: likely snapshots; verify by comparing `git rev-list --count` and delta — if `HEAD..branch` is empty and `branch..HEAD` is large, they are ancestors (checkpoint tags-in-branch-form).
   - `experimental-jarvis-voice`: check for voice-specific commits and whether they were later superseded (memory: OpenRouter 402 blocks live voice legs as of 2026-08).
   - `recovery/jarvis-ui-clean`, `feature/agents-overview`: check for orphaned or merged-in work.
   - `master`: compare to `main` — check `git rev-list --count master` and `git merge-base master HEAD` to see if it's another lineage.
   - `origin/final-jarvis-humanoid-asset-c0f53`: remote ref for the locked humanoid asset — verify the referenced blob/commit exists locally (`git cat-file -t c0f53...` if resolvable).

**Verify:** every branch gets one row in the report: purpose, divergence, delta, verdict (merged / ancestor / orphan / unrelated / asset-only).

---

## Phase 4 — Integrity and archaeology

**Objective:** Detect dangling commits, unreferenced work, reflog recoveries, and repository oddities.

**Steps:**

1. `git fsck --full --no-reflogs --unreachable` → list unreachable/dangling commits; for each dangling commit that looks like real work, capture `git show --stat <sha>` to assess whether it should be preserved or flagged
2. `git reflog --all --date=iso | head -50` → recent ref movements (checkouts, resets); note any history that was rewritten (rebases) — evidence for why checkpoints exist
3. `git count-objects -vH` → repo size; flag if pack is unexpectedly large vs 74 commits
4. `git log --all --oneline -- dist-electron/` → check whether build artifacts were ever committed (memory says they should stay unstaged — verify no commit accidentally added them)
5. `git log --all --oneline -- .env server/.env` → confirm no secrets/config files were ever committed (critical: memory says keys never written to config/source/Git)
6. `git log --all -S'api.deepseek.com' --oneline -- '*.json' '*.js' '*.ts'` → confirm provider-key config history is limited to expected `opencode.json`/profile `.env` locations, no key values leaked in history

**Verify:** produce a short integrity section in the report: unreachable count, any history rewrites, whether artifacts/secrets appear in any commit.

---

## Phase 5 — Report

**Objective:** Write the final deliverable.

**Steps:**

1. Author `review-notes/git-history-review-report.md` (workspace-local; NOT committed) containing:
   - Repository snapshot (branch, HEAD sha+date, commit count, date range, tag)
   - Topology summary (graph description, unrelated `main` lineage, branch table)
   - Workstream chronology (Phase 2 clustering, 5–10 key commits with sha/message/stat summary)
   - Branch deep-dive table (Phase 3)
   - Integrity findings (Phase 4) — include any flags needing user attention
   - Open questions / recommendations (e.g., whether to tag more milestones, prune stale branches, or preserve dangling work)
2. Present a concise summary to the user with the report path. Include the required fields: versions/SHAs, paths, validation performed, and any rollback note (rollback = N/A for read-only review; no refs modified).

**Verify:** report exists at the stated path and every claim cites a sha or command output captured during Phases 1–4.

---

## Files likely to be created (workspace-local, untracked, NOT staged)

- `B:\AgenticOS\.hermes\plans\2026-08-12_git-history-review.md` (this plan)
- `B:\AgenticOS\review-notes\commits-by-theme.md` (scratch, Phase 2)
- `B:\AgenticOS\review-notes\git-history-review-report.md` (final report, Phase 5)

No tracked files will be modified. No commits will be created.

---

## Tests / validation

- Each phase ends with an explicit verify line comparing captured output to expected baseline values (74 commits, dates, branch count).
- Report claims must trace to a captured command output (sha, count, or stat).
- Final gate: `git status -sb` unchanged from start (still `## stabilize-runtime` with only runtime/dist dirty files) — proves the review was read-only.

---

## Risks, tradeoffs, open questions

- **Unrelated `main` lineage** — `git log --all` mixes the asset-only `main` history with real work; all `--all` outputs must be interpreted with `--graph --decorate` to avoid confusion. Known and expected; not a defect.
- **`master` branch origin unknown** — Phase 3 determines whether it is another lineage, a stale copy of work, or an orphan; if ambiguous, flag for user decision rather than guessing.
- **Dangling commits** — `git fsck` may surface real unreferenced work; do NOT delete anything. Report and let the user decide (memory: checkpoints exist because of past history rewrites).
- **Large diffs on branch deltas** — `main` diff will be huge/unrelated; cap `--stat` output and summarize rather than reading fully.
- **Evidence discipline** — this is a source/history review, not a production-runtime claim; the report will NOT assert runtime behavior, only what history shows.
