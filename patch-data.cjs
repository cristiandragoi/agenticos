const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      if (fullPath.includes('dataStore.tsx') || fullPath.includes('client.ts') || fullPath.includes('eventPipeline.ts') || fullPath.includes('App.tsx')) continue;
      
      let content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes("from '../../mocks/data'") || content.includes("from '../mocks/data'")) {
        console.log('Patching', fullPath);
        
        // Remove the import line
        content = content.replace(/import\s+\{\s*mock[^}]+\}\s+from\s+['"]\.\.\/?\.\.\/?mocks\/data['"];?/g, '');
        
        // Ensure useData is imported
        let hookImportPath = '../../store/dataStore';
        if (fullPath.includes('pages\\') || fullPath.includes('hooks\\')) hookImportPath = '../store/dataStore';
        
        if (!content.includes('useData')) {
          content = `import { useData } from '${hookImportPath}';\n` + content;
        }
        
        // Inject the hook invocation at the top of the functional component
        const compMatch = content.match(/const\s+([A-Za-z0-9_]+)(?:\s*:\s*React\.FC(?:<[^>]+>)?\s*)?=\s*\([^)]*\)\s*=>\s*\{/);
        if (compMatch) {
            content = content.replace(compMatch[0], compMatch[0] + "\n  const { agents: mockAgents, providers: mockProviders, runs: mockRuns, memoryScopes: mockMemoryScopes, memoryEntries: mockMemoryEntries, artifacts: mockArtifacts, runtimes: mockRuntimes, boards: mockBoards, tools: mockTools, isLoading } = useData();\n  if (isLoading) return null;\n");
        }
        
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}
processDir('./src');
