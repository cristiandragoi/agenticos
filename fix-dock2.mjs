import fs from 'fs';

const path = 'C:\\Users\\Cris\\.gemini\\antigravity\\scratch\\agenticos\\src\\components\\layout\\UniversalChatDock.tsx';
let c = fs.readFileSync(path, 'utf8');

// The current block (after previous partial edit)
const currentBlock = `          <span className="text-dim text-xxs" style={{ marginLeft: 8 }}>\n            {chat.routingMode === 'auto' ? (\n              <span className="flex-row gap-1"><Zap size={10} color="var(--color-hermes)" /> Auto-routing</span>\n            ) : (\n              <span>Selected agent: {targetAgent?.name || 'Unknown'}</span>\n            )}\n          </span>`;

if (c.includes(currentBlock)) {
  // Remove the entire block — the dropdown already shows what's selected
  c = c.replace(currentBlock, '');
  // Clean up extra blank lines left behind
  c = c.replace(/<\/select>\n\n\n+ {10}/, '</select>\n\n          ');
  fs.writeFileSync(path, c, 'utf8');
  console.log('SUCCESS: Removed the entire connector/label block.');
  console.log('The context bar now only has the dropdown + expand button.');
} else {
  console.log('Block not found. Dumping context...');
  const idx = c.indexOf('context-bar');
  if (idx !== -1) {
    console.log(JSON.stringify(c.substring(idx, idx + 800)));
  }
}
