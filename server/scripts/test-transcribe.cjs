const http = require('http');
const fs = require('fs');

async function main() {
  const ttsJson = JSON.parse(fs.readFileSync('D:/AgenticOS/server/scripts/notion_command.mp3', 'utf8'));
  const audioBuf = Buffer.from(ttsJson.audioData, 'base64');
  console.log('Audio buffer size:', audioBuf.length);

  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const crlf = '\r\n';
  let body = '';
  body += '--' + boundary + crlf;
  body += 'Content-Disposition: form-data; name="audio"; filename="audio.mp3"' + crlf;
  body += 'Content-Type: audio/mpeg' + crlf + crlf;

  const headerBuf = Buffer.from(body, 'utf8');
  const footerBuf = Buffer.from(crlf + '--' + boundary + '--' + crlf, 'utf8');
  const totalBuf = Buffer.concat([headerBuf, audioBuf, footerBuf]);

  const req = http.request({
    hostname: '127.0.0.1',
    port: 4600,
    path: '/api/voice/transcribe',
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': totalBuf.length
    }
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      console.log('Transcribe response:', data);
    });
  });

  req.on('error', console.error);
  req.write(totalBuf);
  req.end();
}

main().catch(console.error);
