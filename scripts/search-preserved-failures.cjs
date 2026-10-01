const fs = require('fs');
const readline = require('readline');

async function searchLog() {
  const logFile = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\.agentos\\logs\\backend-managed-sep25-preserved.log';
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const findings = {
    acrossAllProjects: [],
    selfCorrection: [],
    automateInside: [],
    selfHearingEcho: [],
    bargeInPending: [],
    whatDoYouNeed: [],
    startWorkingOrStopWorking: [],
    disconnectReconnect: [],
  };

  for await (const line of rl) {
    if (line.includes('across all projects') || line.includes('what work is actually running')) {
      findings.acrossAllProjects.push(line);
    }
    if (line.includes('effectivePrompt="running?"') || line.includes('effectivePrompt="running')) {
      findings.selfCorrection.push(line);
    }
    if (line.includes('automate the inside the project')) {
      findings.automateInside.push(line);
    }
    if (line.includes('SELF_HEARING_ECHO_DROPPED') || line.includes('echo_drop') || line.includes('ECHO_DROPPED')) {
      findings.selfHearingEcho.push(line);
    }
    if (line.includes('BARGE_IN_PENDING') || line.includes('playout continues')) {
      findings.bargeInPending.push(line);
    }
    if (line.includes('What do you need') || line.includes('need to start')) {
      findings.whatDoYouNeed.push(line);
    }
    if (line.includes('Stop working on it') || line.includes('Start working')) {
      findings.startWorkingOrStopWorking.push(line);
    }
    if (line.includes('disconnect') || line.includes('reconnect') || line.includes('ROOM_DISCONNECTED')) {
      findings.disconnectReconnect.push(line);
    }
  }

  for (const [k, v] of Object.entries(findings)) {
    console.log(`=== ${k} (${v.length} matches) ===`);
    for (const l of v.slice(-10)) {
      console.log(l);
    }
  }
}

searchLog().catch(console.error);
