// Fix the 10 frontend type errors in RevenueOperatorPage.tsx (NEW regressions).
// Exact-string replacements with assertions — fails loudly if any target is missing.
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'src/pages/RevenueOperatorPage.tsx');
let src = fs.readFileSync(file, 'utf-8');

function replaceOne(oldStr, newStr, label) {
  const count = src.split(oldStr).length - 1;
  if (count !== 1) {
    throw new Error(`Expected exactly 1 occurrence for "${label}", found ${count}`);
  }
  src = src.replace(oldStr, newStr);
  console.log(`OK ${label}`);
}

function replaceAll(oldStr, newStr, label) {
  const count = src.split(oldStr).length - 1;
  if (count === 0) throw new Error(`Expected >=1 occurrence for "${label}", found 0`);
  src = src.split(oldStr).join(newStr);
  console.log(`OK ${label} (${count} occurrences)`);
}

// 1. Split type-only imports (verbatimModuleSyntax).
replaceOne(
  "import { revenueOperatorClient, RevenueMission, RevenueExperiment, RevenueLedgerEntry, RevenueHumanGate, RevenueObservability } from '../api/revenueOperatorClient';",
  "import { revenueOperatorClient } from '../api/revenueOperatorClient';\nimport type { RevenueMission, RevenueExperiment, RevenueLedgerEntry, RevenueHumanGate, RevenueObservability } from '../api/revenueOperatorClient';",
  'import-split'
);

// 2. Remove nonexistent `tasks`, add `agents`/`providers` (both exist in DataState).
replaceOne(
  'const { runs, tasks, isLoading: isDataLoading } = useData();',
  'const { runs, agents, providers, isLoading: isDataLoading } = useData();',
  'useData-destructure'
);

// 3. `awaiting_approval` is a typo; canonical RunRecord status is `awaiting_review`.
replaceAll("'awaiting_approval'", "'awaiting_review'", 'status-typo');

// 4. Insert truthful provider resolver after the openGates line.
replaceOne(
  "  const openGates = gates.filter(g => g.status === 'open');",
  "  const openGates = gates.filter(g => g.status === 'open');\n\n  const providerForRun = (run: (typeof runs)[number]): string => {\n    const agent = agents.find(a => a.id === run.agentId);\n    const providerId = agent?.providerIds?.[0];\n    const provider = providerId ? providers.find(p => p.id === providerId) : undefined;\n    return provider?.name ?? '\\u2014';\n  };",
  'insert-providerForRun'
);

// 5. `run.goalId` doesn't exist — use `run.input` (the actual task text), truncated.
replaceOne(
  "{run.goalId || 'Revenue Task'}",
  "{run.input ? (run.input.length > 40 ? run.input.slice(0, 40) + '\\u2026' : run.input) : 'Revenue Task'}",
  'goalId->input'
);

// 6. `run.modelId` doesn't exist — use the derived provider name (no fabrication).
replaceOne(
  "{run.modelId || 'DeepSeek V4 Flash'}",
  '{providerForRun(run)}',
  'modelId->providerForRun'
);

fs.writeFileSync(file, src, 'utf-8');
console.log('\nAll edits applied successfully.');
