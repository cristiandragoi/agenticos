# WorkspaceIndexer — Audit + Design Proposal (Stage 3)

Status: **AUDIT + DESIGN ONLY** — no implementation. Per overnight directive,
this is a proposal answering the five mandated questions.

## 1. What already exists

| Surface | Location | Mechanism | Ranking | Index |
|---|---|---|---|---|
| `search_files` agent tool | `server/src/services/agent/tools/fileTool.ts` | spawnSync grep/findstr (content) + find/dir (names) | none (first N lines) | none — O(repo) per query |
| Memory FTS | `server/src/services/memory/store.ts` | SQLite **FTS5** + `bm25()` | bm25 rank, LIMIT 200 | maintained incrementally on insert/update/delete |
| CodeX repo inspection | `server/src/loops/codexLoop.ts` | agent-driven `readFile` tool calls | model decides | none |
| Research retrieval | `webSearchTool.ts`, researchBriefs.json | external web search | provider-side | none (legacy briefs file) |
| Citations/provenance | memory_records (task/sourceType provenance) | provenance fields on memory rows | n/a | SQLite |

**Key asset:** the memory FTS5 table (`memory_fts`, bm25) is a proven,
maintained pattern in this exact codebase — the WorkspaceIndexer should reuse
it, not invent a second approach.

## 2. What is duplicated / inconsistent

1. **File-name search exists twice** — `search_files` target=files (find/dir)
   and ad-hoc reads; both are shell-outs with no shared logic.
2. **Platform-inconsistent content search (latent bug):** Windows uses
   `findstr /c:` (LITERAL string), Unix uses `grep -rn` (REGEX). The same
   `pattern` parameter has different semantics per OS — a regex query silently
   behaves as literal match on Windows. Any indexer work should fix this by
   making the query layer platform-independent.
3. **No AST search anywhere**; no symbol index; no path ranking.
4. CodeX re-discovers repo structure on every goal (repeated readFile calls) —
   the same structural knowledge is rebuilt each run.

## 3. Are embeddings necessary?

**No — not for v1.** Reasons:
- The workspace is small (hundreds of source files); FTS5 bm25 over
  path+symbols+content answers "where is X / who calls Y" deterministically.
- This machine has **no CUDA GPU** (HardwareProfiler tier: balanced, Iris Xe);
  local embedding models would compete with the models we actually run, and
  cloud embeddings would violate the very Stage 2 privacy policies we just
  shipped for sensitive projects.
- Embedding infra (model choice, storage, incremental drift, re-index cost,
  verification) is a large unverifiable surface for a need ("semantic
  similarity") no current workflow has demonstrated.

**Verdict:** defer embeddings; keep the retrieval interface abstract so a
semantic provider can be slotted in later without redesign.

## 4. How grep / AST / FTS / semantic retrieval should coexist

```
query
 ├── exact/regex  → live grep (zero-staleness, authoritative for exact match)
 │                   fix the Windows findstr-vs-grep semantics gap
 ├── keyword      → FTS5 workspace_index (bm25, warm, incremental)
 ├── symbols      → index-time heuristic extraction (export/function/
 │                   interface/class line regex) — AST parsing deferred
 │                   (heavy deps, low v1 payoff)
 └── semantic     → NOT BUILT; reserved seam behind the same query interface
```

Precedence: FTS for ranked recall, live grep as ground-truth fallback,
symbol hits boosted in ranking. The agent keeps both tools; the indexer adds
speed/recall, never replaces exact search.

## 5. Smallest WorkspaceIndexer v1

**Scope (one milestone, no schema migration beyond an additive FTS table):**

1. `workspace_index` FTS5 table: `(path UNINDEXED, symbols, content, mtime, size)`
   — same maintenance pattern as `memory_fts`.
2. Incremental scanner: walk `getWorkspaceRoot()`, skip
   node_modules/.git/dist/.agentos; index only files changed since stored
   mtime+size; per-file size cap (~512KB); text-only detection.
3. Query service: `searchWorkspace(query, {mode: 'fts'|'exact', limit})` —
   bm25-ranked, path-aware boost (filename hits rank above body hits),
   falls back to live grep for exact mode.
4. Router: `GET /api/workspace/search?q=…&mode=…` (same cache conventions as
   `/api/system/hardware-profile`; refresh on demand, never on every render).
5. Privacy contract (Stage 2 alignment): the index is local SQLite; indexed
   content is never sent anywhere; `localOnly`/`secret` projects get no
   behavioral difference because nothing leaves the machine.

**Explicitly out of v1:** embeddings/vector store, AST parsing, cross-workspace
indexing, watch-mode (on-demand refresh is sufficient), re-ranking models.

**Verification plan (when implemented):** unit tests with a fixture tree
(incremental update, deletion, rename, binary skip, size cap); live query
comparison against ripgrep/grep ground truth on B:\AgenticOS; latency budget
(<100ms warm query).
