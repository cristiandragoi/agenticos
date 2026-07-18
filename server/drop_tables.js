import Database from 'better-sqlite3';

const db = new Database('./data/agentic_os.db');

console.log('Dropping tables...');
db.exec('DROP TABLE IF EXISTS agent_executions;');
db.exec('DROP TABLE IF EXISTS agent_prompt_versions;');
db.exec('DROP TABLE IF EXISTS run_evaluations;');
db.exec('DROP TABLE IF EXISTS evaluation_datasets;');
db.exec('DROP TABLE IF EXISTS evaluation_test_cases;');
db.exec('DROP TABLE IF EXISTS evaluation_suite_runs;');
db.exec('DROP TABLE IF EXISTS evaluation_case_results;');

console.log('Done dropping tables.');
