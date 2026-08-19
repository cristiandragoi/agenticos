// Locate the actual agentic-os.db used by the running deployed backend
const fs = require('fs');
const path = require('path');

const candidates = [
  'C:/Users/Cris/AppData/Roaming/agenticos/data/agentic-os.db',
  'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db',
  'B:/AgenticOS/server/data/agentic-os.db',
];

for (const p of candidates) {
  try {
    const st = fs.statSync(p);
    console.log(`FOUND ${p} size=${st.size} mtime=${st.mtime.toISOString()}`);
  } catch (e) {
    console.log(`absent ${p}`);
  }
}

// search AppData Roaming for agentic-os.db
function walk(dir, depth) {
  if (depth <= 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.includes('agentic-os.db')) console.log('WALK FOUND:', path.join(dir, e.name));
    if (e.isDirectory() && !e.name.startsWith('.') && depth > 1) walk(path.join(dir, e.name), depth - 1);
  }
}
console.log('--- walking AppData/Roaming/agenticos ---');
walk('C:/Users/Cris/AppData/Roaming/agenticos', 4);
