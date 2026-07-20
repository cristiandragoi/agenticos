# Team Sheet: SimpleFileCreationTeam

**Objective**: Create a simple hello.txt file that says 'Hello, World!' and verify its contents.
**Workspace Root**: `B:\AgenticOS\scratch`

## Acceptance Criteria

- The hello.txt file contains the text 'Hello, World!' exactly as specified.

## Execution Sequence

1. **Planner** (Planner)
2. **Builder** (Builder)
3. **Verifier** (Verifier)

## Handoffs

- **planner1** ➔ **builder1**: `plan.json` (Required)
- **builder1** ➔ **verifier1**: `hello.txt` (Required)

## Agent Definitions

### Planner (planner1)

- **Role**: Planner
- **Responsibilities**: Plan the file creation process

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: `**/*`
- **Write Scopes**: None
- **Output Artifacts**: `plan.json`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a plan to create a hello.txt file with the content 'Hello, World!' and verify its contents.
```

### Builder (builder1)

- **Role**: Builder
- **Responsibilities**: Create the hello.txt file and verify its contents
- **Dependencies**: planner1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `**/*`
- **Write Scopes**: `*.txt`
- **Output Artifacts**: `hello.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Use the plan provided by Planner to create a hello.txt file with the content 'Hello, World!' and verify its contents.
```

### Verifier (verifier1)

- **Role**: Verifier
- **Responsibilities**: Verify the contents of the hello.txt file
- **Dependencies**: planner1, builder1

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `**/*`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Check that the content of hello.txt is 'Hello, World!'
```

