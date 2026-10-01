const fs = require('fs');
const readline = require('readline');

async function main() {
  const logFile = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\.agentos\\logs\\backend-managed.log';
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const matches = [];
  for await (const line of rl) {
    if (line.includes('RAW_STT=') || line.includes('USER_STT_TEXT=') || line.includes('FINAL_RESPONSE=') || line.includes('REAL_TURN_ROUTING_TRACE') || line.includes('LIVE_TURN_TRACE') || line.includes('INTERRUPTING_EVENT_TYPE=')) {
      matches.push(line);
      if (matches.length > 50) matches.shift();
    }
  }

  for (const m of matches) {
    console.log(m);
  }
}

main().catch(console.error);
