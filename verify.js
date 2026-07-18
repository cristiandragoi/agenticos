import http from 'http';
import fs from 'fs';

async function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  console.log("=== VERIFICATION SCRIPT ===\n");

  // 1. Loop engine proof
  console.log("-> Creating loop definition...");
  const loopDef = await request('POST', '/api/loops', {
    name: "Iterative Code Review",
    description: "Review code until score > 90",
    maxIterations: 5,
    stopCondition: "Score exceeded 90",
    steps: [
      { id: "s1", agentId: "agent-hermes", prompt: "Write code", mode: "task", outputKey: "code" },
      { id: "s2", agentId: "agent-sentinel", prompt: "Review code", dependsOn: ["s1"], mode: "task" }
    ]
  });
  console.log("Created Loop:", loopDef.id);

  console.log("-> Running loop...");
  const loopRunReq = await request('POST', `/api/loops/${loopDef.id}/run`);
  
  // Poll loop until completed
  let loopRun = { status: 'running', iteration: 0 };
  let loopRunId = null;
  while (loopRun.status === 'running') {
    await new Promise(r => setTimeout(r, 800));
    const statusRes = await request('GET', `/api/loops/${loopDef.id}/status`);
    loopRun = statusRes.currentRun || loopRun;
    if (loopRun.id) loopRunId = loopRun.id;
    console.log(`Loop ${loopRunId || 'starting'} - Status: ${loopRun.status}, Iteration: ${loopRun.iteration}, Score: ${loopRun.score}`);
  }
  console.log(`Loop finished. Stop Reason: ${loopRun.stopReason}\n`);

  // 2. Video pipeline proof
  console.log("-> Creating video job...");
  const videoJob = await request('POST', '/api/video/jobs', {
    prompt: "A cinematic flythrough of a neon city",
    format: "landscape-long"
  });
  const videoJobId = videoJob.id;
  console.log("Created Video Job:", videoJobId);

  // Poll video job until completed
  let vJob = videoJob;
  let lastStage = '';
  while (vJob.status === 'running' || vJob.status === 'queued') {
    await new Promise(r => setTimeout(r, 500));
    vJob = await request('GET', `/api/video/jobs/${videoJobId}`);
    if (vJob.stage !== lastStage) {
      console.log(`Video ${videoJobId} - Transitioned to stage: ${vJob.stage}`);
      lastStage = vJob.stage;
    }
  }
  console.log(`Video job finished. Artifact ID: ${vJob.artifactId}\n`);

  // 3. Persistence proof
  console.log("-> Persistence Verification (server/data/):");
  const files = fs.readdirSync('./server/data');
  for (const file of files) {
    const stats = fs.statSync(`./server/data/${file}`);
    console.log(`- ${file} (${stats.size} bytes)`);
  }

  console.log("\n-> Sample Persisted Loop Run:");
  const loopRunsFile = JSON.parse(fs.readFileSync('./server/data/loopRuns.json', 'utf8'));
  console.log(JSON.stringify(loopRunsFile.find(r => r.id === loopRunId), null, 2));

  console.log("\n-> Sample Persisted Video Job:");
  const videoJobsFile = JSON.parse(fs.readFileSync('./server/data/videoJobs.json', 'utf8'));
  console.log(JSON.stringify(videoJobsFile.find(r => r.id === videoJobId), null, 2));

}

main().catch(console.error);
