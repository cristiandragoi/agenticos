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
      if (fullPath.includes('mocks\\data.ts') || fullPath.includes('mocks/data.ts')) continue;

      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Strip all existing imports for mocks/data
      content = content.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\.?\/\.\.?\/mocks\/data['"];?\r?\n/gm, '');
      content = content.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\.?\/mocks\/data['"];?\r?\n/gm, '');

      // Determine needed mock variables
      const needed = [];
      for (const name of mockDataNames) {
        const regex = new RegExp(`\\b${name}\\b`, 'g');
        if (regex.test(content)) {
          needed.push(name);
        }
      }

      if (needed.length > 0) {
        const depth = fullPath.split(path.sep).length - path.resolve(__dirname, 'src').split(path.sep).length;
        const relativePrefix = depth === 2 ? '../../' : '../'; // components/ui is depth 2, pages is depth 1
        
        let prefix = '../';
        if (fullPath.includes('components\\layout') || fullPath.includes('components/layout') || fullPath.includes('components\\drawers') || fullPath.includes('components/drawers')) {
          prefix = '../../';
        }
        if (fullPath.includes('hooks\\') || fullPath.includes('hooks/')) {
          prefix = '../../';
        }

        const importStatement = `import { ${needed.join(', ')} } from '${prefix}mocks/data';\n`;
        
        if (content.includes("import React")) {
          content = content.replace(/(import React.*?;\r?\n)/, `$1${importStatement}`);
        } else {
          content = importStatement + content;
        }
      }

      fs.writeFileSync(fullPath, content);
    }
  }
}

processDir(path.join(__dirname, 'src'));
