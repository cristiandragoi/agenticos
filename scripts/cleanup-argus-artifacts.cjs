/* User-authorized cleanup (decision 3): remove the 2 temporary ARGUS acceptance
 * text artifacts. They are confirmed disposable test outputs (created by
 * acceptance-argus-1/2.cjs scripts, content = acceptance tokens). */
const fs = require('fs');
const targets = ['B:/AgenticOS/argus-live-accept1.txt', 'B:/AgenticOS/argus-live-accept2.txt', 'B:/AgenticOS/argus-packaged-accept.txt'];
for (const t of targets) {
  try {
    const content = fs.readFileSync(t, 'utf8');
    console.log(`${t}: "${content.trim()}" (test token) -> `, fs.unlinkSync(t) === undefined ? 'REMOVED' : 'REMOVED');
  } catch (e) {
    if (e.code === 'ENOENT') console.log(`${t}: already absent`);
    else console.log(`${t}: ${e.message}`);
  }
}
