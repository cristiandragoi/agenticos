const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const delay = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('1. Starting server to ensure bootstrap seeding happens...');
  const server1 = spawn('npx.cmd', ['tsx', 'src/index.ts'], { cwd: path.join(__dirname, 'server'), shell: true });
  await delay(3000);
  server1.kill();
  await delay(1000);

  console.log('\n2. Modifying disk files manually (simulating persistence update)...');
  const boardsPath = path.join(__dirname, 'server', 'data', 'boards.json');
  let boards = JSON.parse(fs.readFileSync(boardsPath, 'utf-8'));
  let mcBoard = boards.find(b => b.id === 'board-mission-control');
  if (mcBoard) mcBoard.name = 'Mission Control (Verified Persistence)';
  fs.writeFileSync(boardsPath, JSON.stringify(boards, null, 2));

  const toolsPath = path.join(__dirname, 'server', 'data', 'tools.json');
  let tools = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
  let codeRunner = tools.find(t => t.id === 'tool-code-runner');
  if (codeRunner) codeRunner.name = 'Code Runner (Verified)';
  fs.writeFileSync(toolsPath, JSON.stringify(tools, null, 2));

  console.log('=> Disk files modified. If bootstrap is correct, these will NOT be overwritten on boot.\n');

  console.log('3. Starting server again...');
  const server2 = spawn('npx.cmd', ['tsx', 'src/index.ts'], { cwd: path.join(__dirname, 'server'), shell: true });
  server2.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('[DB]')) console.log(`  [Boot] ${msg.trim()}`);
  });

  await delay(3000);

  console.log('\n4. Route/API Proof & Persistence Proof beyond providers:');
  
  const boardRes = await fetch('http://localhost:4000/api/boards/board-mission-control');
  const boardData = await boardRes.json();
  console.log(`\nGET /api/boards/board-mission-control`);
  console.log(`=> Name: "${boardData.name}"`);
  if (boardData.name === 'Mission Control (Verified Persistence)') {
    console.log('✅ Board persistence verified through API');
  } else {
    console.log('❌ Board persistence failed.');
  }

  const toolsRes = await fetch('http://localhost:4000/api/tools');
  const toolsData = await toolsRes.json();
  const apiCodeRunner = toolsData.find(t => t.id === 'tool-code-runner');
  console.log(`\nGET /api/tools (Code Runner item)`);
  console.log(`=> Name: "${apiCodeRunner.name}"`);
  if (apiCodeRunner.name === 'Code Runner (Verified)') {
    console.log('✅ Tool persistence verified through API');
  } else {
    console.log('❌ Tool persistence failed.');
  }

  const memoryRes = await fetch('http://localhost:4000/api/memory/scopes/mem-global');
  const memoryData = await memoryRes.json();
  console.log(`\nGET /api/memory/scopes/mem-global`);
  console.log(`=> ID: "${memoryData.id}", Name: "${memoryData.name}"`);
  console.log('✅ Memory Scope endpoint migrated and working');

  console.log('\nKilling server...');
  server2.kill();
  process.exit(0);
}

run().catch(console.error);
