const fs = require('fs');
const path = 'C:\\Users\\Cris\\.gemini\\antigravity\\scratch\\agenticos\\src\\components\\layout\\UniversalChatDock.tsx';
let c = fs.readFileSync(path, 'utf8');

// Find the pipe separator and arrow label block
// We look for the specific pattern in the context bar
const pipeLine = '          <span className="text-dim text-xxs">|</span>';
const arrowBlock = `          <span className="text-dim text-xxs">
            {chat.routingMode === 'auto' ? (
              <span className="flex-row gap-1"><Zap size={10} color="var(--color-hermes)" /> Auto-routing</span>
            ) : (
              <span>\u2192 {targetAgent?.name || 'Unknown'}</span>
            )}
          </span>`;

// Build the full block to replace (pipe + blank line + arrow block)
const fullBlock = pipeLine + '\n\n' + arrowBlock;

if (c.includes(fullBlock)) {
  // Replace with clean selected-agent label (only when agent is selected)
  const replacement = `          {targetAgent && (
            <span className="text-dim text-xxs">\u2192 {targetAgent.name}</span>
          )}`;
  c = c.replace(fullBlock, replacement);
  fs.writeFileSync(path, c, 'utf8');
  console.log('SUCCESS: Replaced pipe + arrow block with clean selected-agent label.');
} else {
  console.log('EXACT MATCH NOT FOUND. Trying flexible search...');
  
  // Try finding just the pipe line
  const pipeIdx = c.indexOf(pipeLine);
  if (pipeIdx !== -1) {
    console.log('Found pipe at char index:', pipeIdx);
    // Find the end of the arrow block (next </span> after Auto-routing)
    const autoIdx = c.indexOf('Auto-routing', pipeIdx);
    const closeSpanAfterAuto = c.indexOf('</span>', autoIdx) + 7;
    // Include the newline after the closing span
    let endIdx = closeSpanAfterAuto;
    while (endIdx < c.length && (c[endIdx] === '\n' || c[endIdx] === '\r')) endIdx++;
    
    const block = c.substring(pipeIdx, endIdx);
    console.log('Block to remove:');
    console.log(JSON.stringify(block).substring(0, 200));
    
    const replacement = `          {targetAgent && (
            <span className="text-dim text-xxs">\u2192 {targetAgent.name}</span>
          )}\n`;
    
    c = c.substring(0, pipeIdx) + replacement + c.substring(endIdx);
    fs.writeFileSync(path, c, 'utf8');
    console.log('SUCCESS via flexible match.');
  } else {
    console.log('FAILED: Could not find pipe separator line.');
    process.exit(1);
  }
}
