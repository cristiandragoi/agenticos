const { rawDb } = require('../server/dist/db/index.js');
const del = rawDb.prepare(`
  DELETE FROM repair_knowledge 
  WHERE (surface = 'browser' AND (url LIKE '%google.com/search%' OR goal_type IN ('capture_screenshot', 'observe', 'perceive') OR target IN ('camera', 'desktop', 'Paint')))
     OR (surface = 'learned' AND target IN ('camera', 'desktop'))
`).run();
console.log('Purged poisoned repair_knowledge rows:', del.changes);
