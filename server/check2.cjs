const db = require('better-sqlite3')('B:/AgenticOS/.agentos/runtime-tests/ui-real/test.db');
console.log(db.prepare("SELECT payload FROM goal_events WHERE event_type = 'handoff_created' ORDER BY sequence ASC LIMIT 1").get().payload);
