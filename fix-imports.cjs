const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // If it contains the injected import
      if (content.includes("import { useData } from '../store/dataStore'; // injected by script") || content.includes("import { useData } from '../../store/dataStore'; // injected by script")) {
        
        // Fix the relative path for dataStore
        const depth = fullPath.split(path.sep).length - path.resolve(__dirname, 'src').split(path.sep).length;
        const relativePrefix = depth === 1 ? '../' : '../../';
        
        content = content.replace(/import \{ useData \} from '\.\.\/store\/dataStore'; \/\/ injected by script/g, `import { useData } from '${relativePrefix}store/dataStore';`);
        content = content.replace(/import \{ useData \} from '\.\.\/\.\.\/store\/dataStore'; \/\/ injected by script/g, `import { useData } from '${relativePrefix}store/dataStore';`);

        // Insert the hook call at the top of the component
        // We look for `const ComponentName: React.FC = () => {` or similar
        const componentRegex = /const (\w+): React\.FC.*?\= \([^)]*\) => \{/;
        const match = content.match(componentRegex);
        if (match) {
          const insertPos = match.index + match[0].length;
          // We need to map `agents` to `mockAgents` etc. to not rewrite all code.
          const hookCall = `\n  const { agents: mockAgents, runs: mockRuns, providers: mockProviders, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, boards: mockBoards, runtimes: mockRuntimes, tools: mockTools, isLoading } = useData();\n  if (isLoading) return null;\n`;
          content = content.slice(0, insertPos) + hookCall + content.slice(insertPos);
        }

        // Handle `getAgentById` etc. that were removed. We'll replace them with array finds since they were just functions in mock/data.ts.
        content = content.replace(/getAgentById\((.*?)\)/g, 'mockAgents.find(a => a.id === $1)');
        content = content.replace(/getRunById\((.*?)\)/g, 'mockRuns.find(r => r.id === $1)');
        content = content.replace(/getProviderById\((.*?)\)/g, 'mockProviders.find(p => p.id === $1)');
        content = content.replace(/getMemoryScopeById\((.*?)\)/g, 'mockMemoryScopes.find(s => s.id === $1)');
        content = content.replace(/getArtifactById\((.*?)\)/g, 'mockArtifacts.find(a => a.id === $1)');

        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
