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
    if (line.match(/2\s*plus\s*2|two\s*plus\s*two|plus/i) || line.match(/stop\s+speaking|be\s+quiet/i)) {
      matches.push(line);
      if (matches.length > 50) matches.shift();
    }
  }

  for (const m of matches) {
    console.log(m);
  }
}

main().catch(console.error);
