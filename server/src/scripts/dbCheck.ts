import { logger } from '../utils/logger.js';
import Database from 'better-sqlite3';

const DB_PATH = 'C:/Users/Cris/.agentic-os/agentic-os.db';
const db = new Database(DB_PATH, { readonly: true });

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
logger.info('ALL TABLES:');
tables.forEach(t => logger.info(' -', t.name));

// Check canonical conversations tables
const convCount = db.prepare('SELECT COUNT(*) as c FROM conversations').get() as any;
const msgCount = db.prepare('SELECT COUNT(*) as c FROM conversation_messages').get() as any;
logger.info('\nconversations count:', convCount.c);
logger.info('conversation_messages count:', msgCount.c);

// Check old jarvis prototype tables are GONE
const oldConvTable = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='jarvis_conversations'").get() as any;
const oldMsgTable = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='jarvis_messages'").get() as any;
logger.info('\nOld jarvis_conversations table exists:', oldConvTable.c > 0, '(should be false)');
logger.info('Old jarvis_messages table exists:', oldMsgTable.c > 0, '(should be false)');

// Check CodeX data integrity
try {
  const goalsCount = db.prepare('SELECT COUNT(*) as c FROM goals').get() as any;
  logger.info('\nCodeX goals count:', goalsCount.c);
} catch (e) {
  logger.info('\nNo goals table (expected if no goals created yet)');
}

try {
  const runsCount = db.prepare('SELECT COUNT(*) as c FROM runs').get() as any;
  logger.info('Runs count:', runsCount.c);
} catch (e) {
  logger.info('No runs table (expected if no runs created yet)');
}

db.close();
logger.info('\nDB check PASSED.');
