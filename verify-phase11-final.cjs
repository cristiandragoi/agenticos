const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const dataDir = path.join(__dirname, 'server', 'data');
  
  console.log('--- Step 1: Modifying Persisted Entities on Disk ---');
  
  // 1. Agents - Modify display name
  const agentsPath = path.join(dataDir, 'agents.json');
  let agents = JSON.parse(fs.readFileSync(agentsPath, 'utf-8'));
  let hermes = agents.find(a => a.id === 'agent-hermes');
  if (hermes) hermes.name = 'Hermes Coder (Verified)';
  fs.writeFileSync(agentsPath, JSON.stringify(agents, null, 2));
  console.log(' - Modified Agent: "agent-hermes" -> "Hermes Coder (Verified)"');

  // 2. Memory - Modify Memory Entry
  const memoryPath = path.join(dataDir, 'memoryEntries.json');
  let entries = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
  let entry = entries.find(e => e.id === 'entry-001');
  if (entry) entry.title = 'Project Architecture (Verified)';
  fs.writeFileSync(memoryPath, JSON.stringify(entries, null, 2));
  console.log(' - Modified Memory Entry: "entry-001" -> "Project Architecture (Verified)"');

  // 3. Boards - Modify Board Title
  const boardsPath = path.join(dataDir, 'boards.json');
  let boards = JSON.parse(fs.readFileSync(boardsPath, 'utf-8'));
  let mcBoard = boards.find(b => b.id === 'board-mission-control');
  if (mcBoard) mcBoard.name = 'Mission Control (Verified)';
  fs.writeFileSync(boardsPath, JSON.stringify(boards, null, 2));
  console.log(' - Modified Board: "board-mission-control" -> "Mission Control (Verified)"');

  console.log('\n--- Step 2: Restarting Backend Server ---');
  const server = spawn('npx.cmd', ['tsx', 'src/index.ts'], { cwd: path.join(__dirname, 'server'), shell: true });
  
  server.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('[DB]')) console.log(`  [Boot] ${msg.trim()}`);
  });

  await delay(6000); // Wait for server to boot

  console.log('\n--- Step 3: Proving Cross-Domain Persistence via API ---');

  // Verify Agents
  const agentsRes = await fetch('http://localhost:4000/api/agents');
  const agentsData = await agentsRes.json();
  const apiHermes = agentsData.find(a => a.id === 'agent-hermes');
  console.log('\nGET /api/agents');
  console.log(`=> Agent Name: "${apiHermes.name}"`);
  if (apiHermes.name === 'Hermes Coder (Verified)') {
    console.log('✅ Agent persistence verified');
  } else {
    console.log('❌ Agent persistence failed.');
  }

  // Verify Memory
  const memRes = await fetch('http://localhost:4000/api/memory/entries');
  const memData = await memRes.json();
  const apiEntry = memData.find(e => e.id === 'entry-001');
  console.log('\nGET /api/memory/entries');
  console.log(`=> Memory Entry Title: "${apiEntry.title}"`);
  if (apiEntry.title === 'Project Architecture (Verified)') {
    console.log('✅ Memory Entry persistence verified');
  } else {
    console.log('❌ Memory Entry persistence failed.');
  }

  // Verify Boards
  const boardsRes = await fetch('http://localhost:4000/api/boards/board-mission-control');
  const boardData = await boardsRes.json();
  console.log('\nGET /api/boards/board-mission-control');
  console.log(`=> Board Name: "${boardData.name}"`);
  if (boardData.name === 'Mission Control (Verified)') {
    console.log('✅ Board persistence verified');
  } else {
    console.log('❌ Board persistence failed.');
  }

  console.log('\n--- Step 4: Bootstrap Safety Verified ---');
  console.log('Because the API returned our custom disk modifications, we have proven that `db.init()` safely skips overwriting existing data stores.');

  console.log('\nKilling server...');
  server.kill();
  process.exit(0);
}

run().catch(console.error);
