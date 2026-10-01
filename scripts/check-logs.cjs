const fs = require('fs');
const path = require('path');

const logDir = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\.agentos\\logs';
const files = fs.readdirSync(logDir);
for (const f of files) {
  const p = path.join(logDir, f);
  const st = fs.statSync(p);
  console.log(f, 'mtime:', st.mtime.toISOString(), 'size:', st.size);
}
