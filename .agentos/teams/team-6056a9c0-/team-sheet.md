# Team Sheet: TicTacToe Team

**Objective**: Build a simple tic-tac-toe in python
**Workspace Root**: `B:\\AgenticOS`

## Acceptance Criteria

- Game works

## Execution Sequence

1. **Architect** (Planner)
2. **Developer** (Builder)
3. **QA** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `plan.md` (Required)
- **builder** ➔ **verifier**: `tic-tac-toe.py` (Required)

## Agent Definitions

### Architect (planner)

- **Role**: Planner
- **Responsibilities**: Design the game

#### Permissions & Artifacts

- **Allowed Tools**: read_file
- **Read Scopes**: `*`
- **Write Scopes**: None
- **Output Artifacts**: `plan.md`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Create a plan.
```

### Developer (builder)

- **Role**: Builder
- **Responsibilities**: Write python code
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, write_file
- **Read Scopes**: `*`
- **Write Scopes**: `tic-tac-toe.py`
- **Output Artifacts**: `tic-tac-toe.py`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Implement tic-tac-toe.py
```

### QA (verifier)

- **Role**: Verifier
- **Responsibilities**: Test the game
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, terminal
- **Read Scopes**: `*`
- **Write Scopes**: None
- **Output Artifacts**: `test-results.md`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Run tic-tac-toe.py and verify.
```

