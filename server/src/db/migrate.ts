import { logger } from '../utils/logger.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index.js';

migrate(db, { migrationsFolder: './drizzle' });
logger.info('Migrations applied successfully');
