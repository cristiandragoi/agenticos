# R4 identity — decider guard: denylist → operator-owned allowlist

**Stream I, DELEGATION-2026-10-01-R3.** Delivered as a **proposal** (diff + runnable proof); nothing in
`monitoring/freecash/` was edited and nothing was applied.

**Rule under work:** **R4 — "human approval before ANY external action; nothing auto-executes"**
(the operator's title; the shipped `gate.py`/`readonly_client.py` label this rule `R4` too — the repo's
internal inversion affects the *other* rule, `gate.py` calling the day-lock rule `R1`. Always carry the title.)

---

## 1. The defect (verified in this session, not quoted)

`monitoring/freecash/approval_queue.py:55`

```python
NON_HUMAN_DECIDERS = frozenset({"system","routine","automation","agent","cron","scheduler","monitor","bot","script","machine"})
```

enforced at `:153` as `if who.lower() in NON_HUMAN_DECIDERS: raise NotHumanError(...)`.

That is a **denylist of exact words**. Any decider string not equal (case-folded) to one of those ten
words is accepted as a human. Reproduced live this session against a throwaway root
(`raw/02-live-denylist-defect-this-session.txt`):

| decider passed to the LIVE module | live result |
|---|---|
| `hermes-agent` | `recorded APPROVED … by hermes-agent`, exit **0** |
| `Claude` | `recorded APPROVED … by Claude`, exit **0** |
| `operator-1` | `recorded APPROVED … by operator-1`, exit **0** |
| `assistant` | `recorded APPROVED … by assistant`, exit **0** |
| `agent` | `REFUSED`, exit 4 (floor works for the literal word only) |

An earlier pass already recorded `decided_by='hermes-agent'` on this surface. The control is therefore
"some words are refused", not "only a human may sign".

## 2. The change

Replace the control with an **operator-owned allowlist**:

* `_normalise_decider(name)` now, in order:
  1. rejects an empty name (unchanged);
  2. **loads the operator allowlist — and refuses every decider if the allowlist is absent, unreadable,
     malformed, out-of-schema, empty, or contains a machine-looking entry** (fail closed);
  3. applies the retained word floor `NON_HUMAN_DECIDERS` (now explicitly *not* the control) and
     `MACHINE_LABEL_PATTERN` to the decider;
  4. accepts only a decider that case-insensitively matches a configured identity; otherwise refuses and
     names the allowlist path.
* `NON_HUMAN_DECIDERS` is **kept** — as a cheap floor, documented as such in the code.
* Everything else is byte-for-byte the shipped module: the frozen fields, `decide()` signature,
  notifications, the append-only `approvals/decided.jsonl` trail. The diff is `proposed/approval-allowlist.patch`
  (272 lines; the whole module is also delivered as `proposed/approval_queue.py` for a drop-in apply).

## 3. Where the allowlist lives, and its format

**Location:** `<data root>/state/human-deciders.json` — i.e. `paths.state_dir() / "human-deciders.json"`.
The filename is a constant in code (`OPERATOR_ALLOWLIST_FILENAME`), **not** an environment variable, so a
decider cannot point the guard at a file of their choosing. Resolve it read-only with the new
`approval_queue.py allowlist` subcommand.

**Format** (operator writes it by hand):

```json
{ "schema_version": 1, "operators": ["Alice Operator"] }
```

`proposed/human-deciders.example.json` is an example. **The name shown there and used throughout the
tests, "Alice Operator", is obviously synthetic — no real person's name is written anywhere in this
delivery.**

**Optional second source:** `FREECASH_OPERATOR_IDENTITY=<name>` in the host environment adds exactly one
identity. It is **read, never written**, by the routine, and a machine-looking value is refused at load.
It exists for hosts that prefer no file; it does not widen the trust boundary, because whoever can set
that variable can equally edit the file.

## 4. Fail-closed matrix (the acceptance property)

`load_operator_allowlist()` raises `AllowlistError` (a subclass of `NotHumanError`) — and because the CLI
already maps `NotHumanError` to a refusal, **an unusable allowlist refuses 100% of deciders with exit 4**.
A missing allowlist is never an open door.

| state of the allowlist | outcome for **every** decider | exit | refusal attribution (stderr) |
|---|---|---|---|
| file absent **and** env unset | REFUSED | 4 | names the exact path to create and the env var; says "an unconfigured allowlist refuses every decider (fail-closed)" |
| file not valid JSON | REFUSED | 4 | names the path and the JSON error |
| file is not a JSON object | REFUSED | 4 | names the path and the type found |
| `schema_version` ≠ 1 | REFUSED | 4 | names the path, the version found, the version required |
| `operators` missing / not a list / empty | REFUSED | 4 | names the source; "lists no identities" |
| an entry is not a non-empty string | REFUSED | 4 | names the source and the offending entry |
| an entry looks machine-generated | REFUSED | 4 | names the source and the entry; "a machine may not be allowlisted" |
| env override is machine-looking | REFUSED | 4 | names `FREECASH_OPERATOR_IDENTITY` and the value |
| file unreadable (OSError) | REFUSED | 4 | names the path and the OSError class |
| valid, decider not listed | REFUSED | 4 | names the decider, the allowlist path, and how many identities are configured |
| valid, decider listed (case-insensitive) | **ACCEPTED** | 0 | — |

## 5. "Must not itself become a new attack surface"

* **The routine has no write path to the allowlist.** It only ever opens it for reading
  (`_read_allowlist_file`); the module's only writers are `write_json_atomic(pending.json)` and
  `append_jsonl(decided.jsonl)`. No new file is created by this change.
* **Tampering is not sufficient to sign.** An allowlist entry that looks machine-generated is rejected at
  *load* time (REF-7: an allowlist containing `hermes-agent` refuses every decider), and the decider must
  *also* pass the word floor and the machine-label pattern. REF-1 therefore refuses `hermes-agent` even
  against a perfectly valid allowlist.
* **Residual trust assumption, stated plainly:** whoever can write `<data root>/state/human-deciders.json`
  or set `FREECASH_OPERATOR_IDENTITY` is the operator. That is the same authority as editing the routine's
  code, so the allowlist does not add a boundary — it *relocates the decision to a named, editable
  artifact* instead of a hard-coded word list. Two consequences the operator should know:
  1. the data root is chosen by `FREECASH_DATA_ROOT`; the operator must pin that variable (a decider who
     can set it can point the whole routine, guard included, at a root they control);
  2. the allowlist deliberately lives *outside* the code, so changing who may sign does not require a
     code change — which is the point, and also the reason it must be protected like any operator config.
* This is a **provenance** control, not a host-security control. It makes the *record* attributable; it
  cannot stop a host-level attacker, and it does not claim to.

## 6. ATTRIBUTION vs SAFETY — two different properties

| property | statement | status |
|---|---|---|
| **ATTRIBUTION** ("who may sign") | only a name the operator has configured may be written as `decided_by` | **improved by this change** — that is all this change does |
| **SAFETY** ("an approval can never arm an action") | an approval cannot cause, schedule or permit any external action; the item can never become armed or expire into a go-ahead | **already true before this change, and not the work here** |

The safety half is carried by the frozen fields, which this proposal **preserves unchanged**: every item
is written and re-written with `execution_state="NOT_EXECUTED"`, `execution_allowed_by_this_routine=False`
and `expires_at_utc=None`; there is no execution site in the package; `expire`/timeout cannot convert
PENDING → EXECUTED. **No credit for the safety property is claimed here** — proving a refusal does not
prove execution is impossible, and proving execution is impossible does not prove the signer was human.
Both directions of the *attribution* property are proven in `test_identity_allowlist.py`; the safety
property is only spot-checked there (frozen fields survive a bad decider and a good one) and is owned by
rule-gate R4 (20 checks), not by this stream.

## 7. Operator enablement steps (human decisions, not taken by an agent)

1. Decide who may sign. Write `<data root>/state/human-deciders.json`
   `{"schema_version": 1, "operators": ["<the real operator's name>"]}` — or set
   `FREECASH_OPERATOR_IDENTITY` in the host environment.
2. Verify read-only: `python monitoring/freecash/approval_queue.py allowlist` → prints the resolved path
   and the configured identities, or prints the fail-closed reason and exits 4.
3. **Lockstep requirement (open item):** the delivered R4 runtime detector
   (`docs/free-cash-monitor-routine/DELEGATION-2026-09-30/verifier/rule_gate.py`) runs its own scratch root
   with *no* allowlist and currently assumes an unconfigured guard accepts a human name. Once this
   proposal is applied, that detector **fails closed** — proof in `raw/05-rule-gate-on-proposal.txt`
   (`RULE 4 FAIL`, 1 of 15 checks, and the failure evidence is literally the fail-closed message). With the
   operator identity configured in the gate's environment it is green again:
   `raw/06-rule-gate-on-proposal-configured.txt` → `SUMMARY: R1=PASS R2=PASS R3=PASS R4=PASS`, `RULE 4 PASS
   (20 checks)`, exit 0. Because the brief forbids editing files outside this stream's directory, updating
   that detector is left as an explicit **operator/next-pass item**, not silently patched here.
4. Do not apply while any caller (including the detector) relies on the old "unconfigured ⇒ accept"
   behaviour.

## 8. What is preserved (unchanged, on purpose)

`STATUS_PENDING/APPROVED/REJECTED`; `decide(approval_id, decision, by, note, now)`; `enqueue`/`build_item`;
`NAG_INTERVAL_DAYS`/`NAG_EVENT`; delivered notifications; the append-only `approvals/decided.jsonl` trail
with the same record shape; the frozen `execution_state`/`execution_allowed_by_this_routine`/`expires_at_utc`
fields; and the CLI's `decide`/`list` verbs (a read-only `allowlist` verb is added).
