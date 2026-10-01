const fs = require('fs');
const ttsJson = JSON.parse(fs.readFileSync('D:/AgenticOS/server/scripts/notion_command.mp3', 'utf8'));
const audioBuf = Buffer.from(ttsJson.audioData, 'base64');
fs.writeFileSync('D:/AgenticOS/server/scripts/real_command.mp3', audioBuf);
console.log('Saved raw MP3:', audioBuf.length, 'bytes');
