
import { db } from './src/db/index.js';
import { TeamRunner } from './src/services/agentTeams/teamRunner.js';
async function run() {
  await TeamRunner.startTeam('5251d359-b6f9-42d3-8f3b-dfad79c0c120', '7b6966f0-762f-4594-bbf3-cba68a3ba33c');
  // Keep alive
  setInterval(() => {}, 1000);
}
run();
  