// query-live-db-overview.cjs — read-only overview of the DEPLOYED conversation DB
const Database = require('B:/AgenticOS/server/node_modules/better-sqlite3');
const DB = process.argv[2] || 'C:/Users/Cris/Desktop/desktop/Agentic_OS/Agentic OS/resources/server/data/agentic-os.db';
const db = new Database(DB, { readonly: true, fileMustExist: true });
try {
  const total = db.prepare('SELECT COUNT(*) AS n FROM conversation_messages').get().n;
  console.log('total conversation_messages:', total);

  console.log('\n=== routed_agent distribution ===');
  for (const r of db.prepare('SELECT routed_agent, COUNT(*) AS n FROM conversation_messages GROUP BY routed_agent ORDER BY n DESC').all()) {
    console.log(`  ${r.routed_agent || '(null)'}: ${r.n}`);
  }

  console.log('\n=== role distribution ===');
  for (const r of db.prepare('SELECT role, COUNT(*) AS n FROM conversation_messages GROUP BY role ORDER BY n DESC').all()) {
    console.log(`  ${r.role}: ${r.n}`);
  }

  console.log('\n=== any metadata mentioning codex/worker/grounded/repository_analysis ===');
  const kw = db.prepare(`
    SELECT id, conversation_id, role, routed_agent, goal_id, created_at,
           substr(metadata,1,200) AS m, substr(content,1,80) AS c
    FROM conversation_messages
    WHERE metadata LIKE '%codex%' OR metadata LIKE '%CodeX%'
       OR metadata LIKE '%grounded%' OR metadata LIKE '%workerResult%'
       OR metadata LIKE '%repository_analysis%'
    ORDER BY created_at DESC LIMIT 25
  `).all();
  console.log('matches:', kw.length);
  for (const r of kw) console.log(JSON.stringify(r));

  console.log('\n=== conversations (recent) ===');
  for (const r of db.prepare('SELECT id, title, created_at FROM conversations ORDER BY created_at DESC LIMIT 15').all()) {
    console.log(JSON.stringify(r));
  }

  console.log('\n=== goals with codex/repository ===');
  try {
    for (const r of db.prepare("SELECT id, title, status, category, objective FROM goals WHERE title LIKE '%codex%' OR title LIKE '%CodeX%' OR category LIKE '%repositor%' OR objective LIKE '%CodeX%' ORDER BY created_at DESC LIMIT 15").all()) {
      console.log(JSON.stringify({ id: r.id, title: r.title, status: r.status, category: r.category, obj: (r.objective||'').slice(0,60) }));
    }
  } catch (e) { console.log('goals query err:', e.message); }
} finally { db.close(); }
