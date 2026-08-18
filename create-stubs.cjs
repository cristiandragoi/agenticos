const fs = require('fs');
const path = require('path');

const pages = [
  "AgentDetail", "RunsBoard", "ProvidersBoard", "MemoryBoard", 
  "BuildsGallery", "ControlRoom", "BoardsGallery", "ResearchBoard", 
  "ModelsPage", "SettingsPage"
];

const dir = path.join(__dirname, 'src', 'pages');

pages.forEach(page => {
  const file = path.join(dir, `${page}.tsx`);
  const content = `import React from 'react';\n\nconst ${page}: React.FC = () => {\n  return <div style={{ padding: 24 }}>${page} Placeholder</div>;\n};\n\nexport default ${page};\n`;
  fs.writeFileSync(file, content);
});

console.log("Stubs created.");
