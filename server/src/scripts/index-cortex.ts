import { quartzIndexer } from '../services/cortex/quartzIndexer.js';
import { cortexDb } from '../services/cortex/cortexDb.js';

console.log('[Cortex] Initializing DB and indexing AgenticOS source code...');
cortexDb.init();
const res = quartzIndexer.indexWorkspace();
console.log('[Cortex] Indexing completed successfully:', res);
