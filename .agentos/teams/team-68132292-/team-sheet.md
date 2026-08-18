# Team Sheet: WeatherAppDev

**Objective**: Create a simple Python script to fetch the current weather for a city and save the output to a text file.
**Workspace Root**: `B:\AgenticOS\weather_app`

## Acceptance Criteria

- The script correctly fetches weather data for a city.
- The output is saved to the text file.

## Execution Sequence

1. **WeatherPlanner** (Planner)
2. **WeatherBuilder** (Builder)
3. **WeatherVerifier** (Verifier)

## Handoffs

- **planner** ➔ **builder**: `planner_plan.txt` (Required)
- **builder** ➔ **verifier**: `weather_script.py` (Required)

## Agent Definitions

### WeatherPlanner (planner)

- **Role**: Planner
- **Responsibilities**: define script requirements, design API calls

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files
- **Read Scopes**: None
- **Write Scopes**: `planner_plan.txt`
- **Output Artifacts**: `planner_plan.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Understand the user request and design a plan to fetch weather data for a city using an external API.
```

### WeatherBuilder (builder)

- **Role**: Builder
- **Responsibilities**: implement the script, test the functionality
- **Dependencies**: planner

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, patch_file, write_file
- **Read Scopes**: `planner_plan.txt`
- **Write Scopes**: `weather_script.py`, `output.txt`
- **Output Artifacts**: `weather_script.py`, `output.txt`

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Develop a Python script based on the plan created by WeatherPlanner. Ensure it fetches weather data for a city and saves the output to a text file.
```

### WeatherVerifier (verifier)

- **Role**: Verifier
- **Responsibilities**: verify the script's correctness, test edge cases
- **Dependencies**: planner, builder

#### Permissions & Artifacts

- **Allowed Tools**: read_file, search_files, terminal
- **Read Scopes**: `weather_script.py`, `output.txt`
- **Write Scopes**: None
- **Output Artifacts**: None

#### Instructions

> [!NOTE]
> Instructions provide guidance only and do not grant permissions.

```text
Run the weather script and ensure it correctly fetches weather data for a city. Verify that the output is saved to the text file.
```

