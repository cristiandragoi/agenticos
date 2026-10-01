const fs = require('fs');
const readline = require('readline');

async function main() {
  const logFile = 'C:\\Users\\cd-pr\\AppData\\Roaming\\AgenticOS\\.agentos\\logs\\backend-managed.log';
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const lines = [];
  let capture = false;
  for await (const line of rl) {
    if (line.includes('TURN_ID=11') || line.includes('TURN_ID=12') || line.includes('TURN_ID=13') || line.includes('TURN_ID=14')) {
      capture = true;
    }
    if (capture) {
      if (line.includes('RAW_STT') || line.includes('USER_STT_TEXT') || line.includes('FINAL_RESPONSE') || line.includes('ROUTE=') || line.includes('INTERRUPTING_EVENT_TYPE') || line.includes('CONTROL_INTENT')) {
        lines.push(line);
      }
    }
  }

  for (const l of lines.slice(-40)) {
    console.log(l);
  }
}

main().catch(console.error);
