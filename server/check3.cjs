const db = require('better-sqlite3')('B:/AgenticOS/.agentos/runtime-tests/ui-real/test.db');
console.log(db.prepare("SELECT message FROM goal_events WHERE event_type='step_failed'").all());
