const fs = require('fs');
const path = require('path');

const dirs = [
  'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\data\\voice_turns',
  'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\resources\\server\\data\\voice_turns',
  'D:\\AgenticOS\\server\\data\\voice_turns',
  'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\data\\voice_turns',
  'C:\\Users\\cd-pr\\AppData\\Local\\Programs\\AgenticOS\\resources\\data\\voice_turns',
];

for (const d of dirs) {
  if (fs.existsSync(d)) {
    console.log('Checking dir:', d);
    const files = fs.readdirSync(d);
    for (const f of files) {
      if (f.endsWith('.wav')) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        // Look for today's files (Sept 25)
        if (st.mtime.toISOString().startsWith('2026-09-25')) {
          console.log(`[TODAY] ${p} | size=${st.size} | mtime=${st.mtime.toISOString()}`);
        }
      }
    }
  }
}
