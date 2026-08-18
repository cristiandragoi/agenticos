const fs = require('fs');
const path = require('path');

const mockDataNames = [
  'mockAgents', 'mockRuntimes', 'mockProviders', 'mockRuns', 
  'mockMemoryScopes', 'mockMemoryEntries', 'mockArtifacts', 
  'mockBoards', 'mockTools', 'getAgentById', 'getRunById', 
  'getProviderById', 'getMemoryScopeById', 'getArtifactById'
];

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;
      
      // Remove any broken imports or useData hooks we added
      content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]\.\.?\/\.\.?\/(?:mocks\/data|store\/dataStore)['"];?\r?\n/g, '');
      content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]\.\.?\/(?:mocks\/data|store\/dataStore)['"];?\r?\n/g, '');
      content = content.replace(/\s*const\s+\{\s*agents:\s*mockAgents.*?useData\(\);\s*if\s*\(isLoading\)\s*return\s*null;\s*/g, '');

      // Determine needed mock variables
      const needed = [];
      for (const name of mockDataNames) {
        // Find usage as a word
        const regex = new RegExp(`\\b${name}\\b`, 'g');
        if (regex.test(content)) {
          needed.push(name);
        }
      }

      if (needed.length > 0) {
        const depth = fullPath.split(path.sep).length - path.resolve(__dirname, 'src').split(path.sep).length;
        const relativePrefix = depth === 1 ? '../' : '../../';
        const importStatement = `import { ${needed.join(', ')} } from '${relativePrefix}mocks/data';\n`;
        
        // insert after React import
        if (content.includes("import React")) {
          content = content.replace(/(import React.*?;\r?\n)/, `$1${importStatement}`);
        } else {
          content = importStatement + content;
        }
      }

      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

processDir(path.join(__dirname, 'src'));
